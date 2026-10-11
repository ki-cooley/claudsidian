// Driver over raw CDP against an already-running Chrome (--browser chrome). Opens a tab, drives it with
// Runtime/Input/Page/Emulation, and always closes the tab, including on failure. Two ways in:
//   1. the DevTools HTTP endpoint (PUT or GET /json/new?<url>, /json/close/<id>) when Chrome serves it;
//   2. otherwise the browser WebSocket named in Chrome's DevToolsActivePort file (the chrome://inspect
//      remote-debugging toggle exposes only that), with Target.createTarget / attachToTarget (flat sessions)
//      and Target.closeTarget.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BaseDriver, DriverError, sleep } from './driver-base.mjs';
import { PROFILES } from './profiles.mjs';

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

const CONNECT_TIMEOUT_MS = 10_000;

function activePortFile() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'DevToolsActivePort'),
    path.join(home, '.config', 'google-chrome', 'DevToolsActivePort'),
    path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'DevToolsActivePort'),
  ];
  return candidates.find((f) => fs.existsSync(f)) ?? null;
}

export class CdpDriver extends BaseDriver {
  static async launch(opts = {}) {
    const endpoint = opts.endpoint ?? 'http://127.0.0.1:9222';
    const driver = new CdpDriver(endpoint, opts);
    await driver.probe();
    return driver;
  }

  constructor(endpoint, opts) {
    super(opts);
    this.endpoint = endpoint;
    this.mode = null; // 'http' | 'browser'
    this.browserWsUrl = null;
    this.tabId = null;
    this.targetId = null;
    this.sessionId = null;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.profile = null;
    this.consoleErrors = [];
    this.listeners = new Set();
  }

  /** Decide how to reach Chrome: the HTTP endpoint when it answers, else the DevToolsActivePort browser socket. */
  async probe() {
    const res = await fetch(`${this.endpoint}/json/version`).catch(() => null);
    if (res && res.ok) {
      this.mode = 'http';
      return;
    }
    const file = activePortFile();
    if (!file) throw new DriverError(`no DevTools endpoint at ${this.endpoint} (${res ? res.status : 'unreachable'}) and no DevToolsActivePort file`);
    const [port, browserPath] = fs.readFileSync(file, 'utf8').split('\n').map((s) => s.trim());
    if (!port || !browserPath) throw new DriverError(`unreadable DevToolsActivePort at ${file}`);
    this.browserWsUrl = `ws://127.0.0.1:${port}${browserPath}`;
    this.mode = 'browser';
    this.log(`DevTools HTTP endpoint answered ${res ? res.status : 'nothing'}; using the browser socket from ${file}`);
  }

  // ---------------------------------------------------------------- transport

  async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new DriverError(`websocket to ${wsUrl} did not open within ${CONNECT_TIMEOUT_MS} ms (Chrome may be waiting for you to approve this client at chrome://inspect/#remote-debugging)`));
        ws.addEventListener('error', () => {}); // the close below reports an error nobody needs
        ws.close();
      }, CONNECT_TIMEOUT_MS);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener('error', (ev) => {
        clearTimeout(timer);
        reject(new DriverError(`websocket error: ${ev.message ?? 'unknown'}`));
      }, { once: true });
    });
    ws.addEventListener('message', (ev) => this.onMessage(JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())));
    this.ws = ws;
  }

  onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new DriverError(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ''}`));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') this.consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? 'exception');
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    for (const l of this.listeners) l(msg);
  }

  /** Send a command to the page session (or to the browser when `browser` is true). */
  send(method, params = {}, browser = false) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (!browser && this.sessionId) msg.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  waitForEvent(method, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(l);
        resolve(null);
      }, ms);
      const l = (msg) => {
        if (msg.method === method && (!msg.sessionId || msg.sessionId === this.sessionId)) {
          clearTimeout(timer);
          this.listeners.delete(l);
          resolve(msg.params);
        }
      };
      this.listeners.add(l);
    });
  }

  // ---------------------------------------------------------------- tab lifecycle

  async openTab(url) {
    if (this.mode === 'http') {
      let res = await fetch(`${this.endpoint}/json/new?${url}`, { method: 'PUT' });
      if (!res.ok) res = await fetch(`${this.endpoint}/json/new?${url}`);
      if (!res.ok) throw new DriverError(`could not open a tab: ${res.status} ${await res.text()}`);
      const info = await res.json();
      this.tabId = info.id;
      await this.connect(info.webSocketDebuggerUrl);
    } else {
      await this.connect(this.browserWsUrl);
      const { targetId } = await this.send('Target.createTarget', { url }, true);
      this.targetId = targetId;
      const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true }, true);
      this.sessionId = sessionId;
    }
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  async setProfile(name) {
    const p = PROFILES[name];
    if (!p) throw new DriverError(`unknown profile ${name}`);
    this.profile = name;
    if (!this.ws) await this.openTab('about:blank');
    await this.send('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: p.scale, mobile: p.mobile });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: p.touch, maxTouchPoints: p.touch ? 5 : 1 });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }).catch(() => {});
  }

  async goto(url) {
    if (!this.ws) await this.openTab(url);
    this.consoleErrors = [];
    const loaded = this.waitForEvent('Page.loadEventFired', 10_000);
    await this.send('Page.navigate', { url });
    await loaded;
  }

  async close() {
    try {
      if (this.mode === 'browser' && this.targetId && this.ws?.readyState === WebSocket.OPEN) {
        await Promise.race([this.send('Target.closeTarget', { targetId: this.targetId }, true), sleep(3000)]);
      }
    } catch {
      // the tab may already be gone
    } finally {
      this.ws?.close();
      this.ws = null;
      if (this.mode === 'http' && this.tabId) await fetch(`${this.endpoint}/json/close/${this.tabId}`).catch(() => {});
      this.tabId = null;
      this.targetId = null;
      this.sessionId = null;
    }
  }

  // ---------------------------------------------------------------- page actions

  async evalExpression(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) {
      const text = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
      throw new DriverError(`page evaluation failed: ${text}`);
    }
    return res.result.value;
  }

  async click(selector) {
    await this.waitFor(selector);
    const r = await this.rect(selector);
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async focus(selector) {
    await this.waitFor(selector);
    const ok = await this.evalExpression(`window.__harness.focusEl(${JSON.stringify(selector)})`);
    if (!ok) throw new DriverError(`could not focus ${selector}`);
  }

  async type(selector, text) {
    await this.focus(selector);
    for (const ch of text) {
      if (ch === '\n') {
        await this.press('Enter');
        continue;
      }
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
  }

  async fill(selector, text) {
    await this.focus(selector);
    await this.evalExpression(`(() => { const el = window.__harness.find(${JSON.stringify(selector)}); el.select ? el.select() : null; return true; })()`);
    await this.press('Backspace');
    if (text) await this.send('Input.insertText', { text });
  }

  async press(key) {
    let modifiers = 0;
    let name = key;
    for (const part of key.split('+')) {
      if (part === 'Shift') modifiers |= 8;
      else if (part === 'Control' || part === 'Ctrl') modifiers |= 2;
      else if (part === 'Alt') modifiers |= 1;
      else if (part === 'Meta') modifiers |= 4;
      else name = part;
    }
    const def = KEYS[name] ?? { key: name, code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), text: name.length === 1 ? name : undefined };
    const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, modifiers };
    await this.send('Input.dispatchKeyEvent', { type: def.text ? 'keyDown' : 'rawKeyDown', ...base, text: def.text, unmodifiedText: def.text });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async screenshot(name) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(this.outDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
    return file;
  }
}
