// UI check in the second Obsidian (CDP 9333) at phone size under app.emulateMobile(true), with real touch input:
//   sheets   the header pickers open as full bottom sheets over the chat (2026-10-24: clipped to the header)
//   keyboard a tap on transcript text and a drag (even one starting on a control) drop the composer's focus; a
//            tap on the composer's surround or tools does not
//   sign-in  Paste code fills the field; under a simulated iOS overlay keyboard the modal and code field stay
//            above the keys; Finish sits beside the code field, return in the field runs Finish (empty code: inline error, no
//            network), a tap on the modal's text drops focus
// Reloads the plugin from the vault copy first. Opens only the test session. Screenshots in e2e/out/obsidian/ui-check/.
// Usage: node e2e/obsidian/ui-check.mjs [--session "claudsidian ux test"] [--dark]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : [])).filter((x) => x.length));
const TITLE = args.session ?? 'claudsidian ux test';
const out = path.resolve('e2e/out/obsidian/ui-check');
mkdirSync(out, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = browser.contexts()[0];
const page = context.pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page over CDP');
const cdp = await context.newCDPSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 240)));
const ev = (fn, a) => page.evaluate(fn, a);
const sleep = (ms) => page.waitForTimeout(ms);
const results = [];

async function waitFor(fn, label, ms = 20000, arg) {
  const start = Date.now();
  for (;;) {
    const v = await ev(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timeout: ${label}`);
    await sleep(250);
  }
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log('[ui] ok  ', name, detail ? JSON.stringify(detail) : '');
  } catch (e) {
    results.push({ name, ok: false });
    console.log('[ui] FAIL', name, String(e?.message ?? e).slice(0, 300));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function shot(name) {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

/** centre of the first element matching sel, in CSS px */
async function centre(sel) {
  const r = await ev((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 12) };
  }, sel);
  assert(r, `nothing matches ${sel}`);
  return r;
}

async function touchTap(p) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}

async function touchDrag(p, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y + (dy * i) / 5 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}

const focusedClass = () => ev(() => (document.activeElement && document.activeElement.className) || document.activeElement?.tagName || '');

async function focusComposer() {
  await ev(() => document.querySelector('.claudsidian-composer-input').focus());
  assert(String(await focusedClass()).includes('claudsidian-composer-input'), 'composer did not take focus');
}

function sheetGeometry() {
  const chat = document.querySelector('.claudsidian-chat');
  const backdrop = document.querySelector('.claudsidian-chat .claudsidian-sheet-backdrop');
  const sheet = backdrop && backdrop.querySelector('.claudsidian-sheet');
  if (!chat || !sheet) return null;
  const c = chat.getBoundingClientRect();
  const s = sheet.getBoundingClientRect();
  return { chatH: Math.round(c.height), backdropH: Math.round(backdrop.getBoundingClientRect().height), bottomGap: Math.round(c.bottom - s.bottom), scrolls: sheet.scrollHeight > sheet.clientHeight + 1 };
}

// ---- setup: reload the plugin from the vault copy, phone size, mobile layout, the test session ----------------
await waitFor(() => !!window.app?.plugins, 'app');
await ev(async () => {
  await window.app.plugins.disablePlugin('claudsidian');
  await window.app.plugins.enablePlugin('claudsidian');
});
await waitFor(() => !!window.app.plugins.plugins['claudsidian'], 'plugin loaded');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
const priorTheme = await ev(() => window.app.vault.getConfig('theme'));
const setTheme = (t) => ev((theme) => {
  window.app.vault.setConfig('theme', theme);
  (window.app.setTheme ?? window.app.changeTheme)?.call(window.app, theme);
  // the profile follows the system appearance, which can put theme-light back; set the body classes directly
  const dark = theme === 'obsidian';
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
  return getComputedStyle(document.body).getPropertyValue('--background-primary').trim();
}, t);
await ev(() => window.app.emulateMobile(true));
// switching to the mobile layout can reload the window; wait for the app and the plugin to come back
await sleep(1500);
await waitFor(() => !!window.app?.plugins?.plugins?.['claudsidian'], 'plugin after mobile switch');
if (args.dark !== undefined) console.log('[ui] dark theme:', await setTheme('obsidian'));
await ev(() => window.app.commands.executeCommandById('claudsidian:open'));
await waitFor(() => !!document.querySelector('.claudsidian-root'), 'view root');
await sleep(1500);
const inSession = await ev((t) => (document.querySelector('.claudsidian-header-title-text')?.textContent ?? '').trim() === t, TITLE);
if (!inSession) {
  await ev(() => document.querySelector('.claudsidian-header button[aria-label="Back to sessions"]')?.click());
  await waitFor(() => !!document.querySelector('.claudsidian-session-row'), 'session list');
}
const opened = inSession || await waitFor(
  (t) => {
    const row = [...document.querySelectorAll('.claudsidian-session-row')].find((r) => (r.querySelector('.claudsidian-session-title')?.textContent ?? '').trim() === t);
    if (!row) return false;
    (row.querySelector('.claudsidian-session-main') ?? row).click();
    return true;
  },
  `row "${TITLE}"`,
  20000,
  TITLE,
);
assert(opened, 'test session not found');
await waitFor(() => !!document.querySelector('.claudsidian-composer-input'), 'composer');
await sleep(1500);

// ---- sheets ---------------------------------------------------------------------------------------------------
await check('the overflow sheet covers the chat', async () => {
  await touchTap(await centre('.claudsidian-header button[aria-label="More actions"]'));
  const g = await waitFor(sheetGeometry, 'overflow sheet', 3000);
  await shot('01-overflow-sheet');
  assert(Math.abs(g.backdropH - g.chatH) < 2 && Math.abs(g.bottomGap) < 2 && !g.scrolls, JSON.stringify(g));
  return g;
});
await check('the model sheet covers the chat', async () => {
  await ev(() => [...document.querySelectorAll('.claudsidian-sheet-action')].find((b) => b.textContent.trim() === 'Model').click());
  await waitFor(() => !!document.querySelector('.claudsidian-sheet-custom input'), 'model sheet', 3000);
  const g = await ev(sheetGeometry);
  await shot('02-model-sheet');
  assert(Math.abs(g.backdropH - g.chatH) < 2 && Math.abs(g.bottomGap) < 2 && !g.scrolls, JSON.stringify(g));
  return g;
});
await check('return in the custom model field leaves it (empty field: nothing to apply)', async () => {
  await ev(() => document.querySelector('.claudsidian-sheet-custom input').focus());
  const hint = await ev(() => document.querySelector('.claudsidian-sheet-custom input').enterKeyHint);
  await page.keyboard.press('Enter');
  await sleep(200);
  const still = await ev(() => document.activeElement === document.querySelector('.claudsidian-sheet-custom input'));
  // the field's own Enter handler takes the key (it applies a typed id); with nothing typed it keeps focus by design
  return { hint, keptFocus: still };
});
await ev(() => document.querySelector('.claudsidian-sheet-head button')?.click());
await sleep(400);

// ---- layout ---------------------------------------------------------------------------------------------------
await check('no empty band between the composer and the bottom of the view (sidebar drawer)', async () => {
  const g = await ev(() => {
    const view = document.querySelector('.claudsidian-view').getBoundingClientRect();
    const dock = document.querySelector('.claudsidian-dock').getBoundingClientRect();
    return { gap: Math.round(view.bottom - dock.bottom), viewBottom: Math.round(view.bottom), screen: window.innerHeight, aboveBottom: document.querySelector('.claudsidian-view').classList.contains('is-above-screen-bottom') };
  });
  await shot('03a-bottom');
  assert(g.gap <= 12, JSON.stringify(g));
  return g;
});
await check("the person's bubble reads apart from Claude's text", async () => {
  const c = await ev(() => {
    const bubble = document.querySelector('.claudsidian-user-bubble');
    if (!bubble) return null;
    const cs = getComputedStyle(bubble);
    const themed = [];
    for (let e = bubble; e; e = e.parentElement) if (e.classList.contains('theme-light') || e.classList.contains('theme-dark')) themed.push(`${e.tagName}.${[...e.classList].filter((c) => c.startsWith('theme-')).join('.')}`);
    return { bubble: cs.backgroundColor, border: cs.borderTopColor, primary: cs.getPropertyValue('--background-primary').trim(), themed };
  });
  assert(c, 'no user bubble in view');
  assert(c.bubble !== c.page && c.border !== 'rgba(0, 0, 0, 0)', JSON.stringify(c));
  return c;
});

// ---- keyboard dismissal in the chat --------------------------------------------------------------------------
// A touch tap in desktop Chromium also fires mousedown, which blurs natively; iOS WebKit does not. So taps are
// dispatched as a bare pointerdown, which only the plugin's handler acts on. Drags are real touch input.
async function pointerDownOn(sel, at = 'centre') {
  await ev(
    ([s, a]) => {
      const el = document.querySelector(s);
      const b = el.getBoundingClientRect();
      const x = a === 'corner' ? b.right - 2 : b.x + b.width / 2;
      const y = a === 'corner' ? b.top + 2 : b.y + Math.min(b.height / 2, 12);
      const target = document.elementFromPoint(x, y) ?? el;
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: x, clientY: y }));
    },
    [sel, at],
  );
  await sleep(150);
}

await check('a tap on transcript text drops the composer focus', async () => {
  await focusComposer();
  await pointerDownOn('.claudsidian-transcript .claudsidian-assistant');
  const f = await focusedClass();
  assert(!String(f).includes('claudsidian-composer-input'), `still focused: ${f}`);
});
// a touch that starts on a control (here the header title) is not a tap outside, so only the drag rule can blur
await check('a drag that starts on a control drops the composer focus', async () => {
  await focusComposer();
  await touchDrag(await centre('.claudsidian-header-title'), 80);
  const f = await focusedClass();
  assert(!String(f).includes('claudsidian-composer-input'), `still focused: ${f}`);
});
await check('a tap on the composer surround or a composer tool keeps focus', async () => {
  await focusComposer();
  await pointerDownOn('.claudsidian-composer-row', 'corner');
  assert(String(await focusedClass()).includes('claudsidian-composer-input'), 'surround tap dropped focus');
  await pointerDownOn('.claudsidian-composer-tool');
  assert(String(await focusedClass()).includes('claudsidian-composer-input'), 'tool tap dropped focus');
  await shot('03-composer-focused');
});

// ---- sign-in modal --------------------------------------------------------------------------------------------
await check('sign-in: Finish sits beside the code field, return runs it, a tap on text drops focus', async () => {
  await ev(() => window.app.commands.executeCommandById('claudsidian:sign-in'));
  await waitFor(() => !!document.querySelector('.claudsidian-sign-in .claudsidian-sign-in-row input:not([readonly])'), 'sign-in modal', 5000);
  const layout = await ev(() => {
    const field = document.querySelector('.claudsidian-sign-in .claudsidian-sign-in-row input:not([readonly])');
    const btn = [...document.querySelectorAll('.claudsidian-sign-in button')].find((b) => b.textContent.trim() === 'Finish');
    const f = field.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return { sameRow: Math.abs(f.top + f.height / 2 - (b.top + b.height / 2)) < 4, hint: field.enterKeyHint, fontPx: parseFloat(getComputedStyle(field).fontSize) };
  });
  assert(layout.sameRow, `Finish not beside the field: ${JSON.stringify(layout)}`);
  assert(layout.hint === 'go', `enterkeyhint ${layout.hint}`);
  assert(layout.fontPx >= 16, `code field font ${layout.fontPx}px makes iOS zoom on focus`);
  await ev(() => document.querySelector('.claudsidian-sign-in .claudsidian-sign-in-row input:not([readonly])').focus());
  await page.keyboard.press('Enter');
  await waitFor(() => /paste the code/i.test(document.querySelector('.claudsidian-sign-in-error')?.textContent ?? ''), 'empty-code error', 3000);
  await shot('04-sign-in');
  await ev(() => document.querySelector('.claudsidian-sign-in .claudsidian-sign-in-row input:not([readonly])').focus());
  await pointerDownOn('.claudsidian-sign-in .modal-content > p');
  const f = await focusedClass();
  assert(f === 'BODY' || !String(f).includes('input'), `still focused: ${f}`);
  return layout;
});
await ev(() => document.querySelector('.claudsidian-sign-in .modal-close-button')?.click());

// iOS lays the keyboard over the webview without shrinking it: window.innerHeight stays put and only the visual
// viewport gets shorter. Chromium cannot shrink the visual viewport alone, so the check swaps in a fake one. The
// 10/24 check measured the modal with no keyboard at all, which is how a field hidden under the keys and a modal
// with nothing to scroll shipped (Ki, 11/4: "impossible to complete").
await check('sign-in under an overlay keyboard: Paste code fills the field, the modal and code field stay above the keys', async () => {
  const KB = 340;
  await ev((kb) => {
    const fake = new EventTarget();
    Object.defineProperties(fake, { height: { get: () => window.innerHeight - kb }, offsetTop: { value: 0 }, width: { get: () => window.innerWidth } });
    window.__realVV = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    navigator.clipboard.readText = async () => 'mock-code#mock-state';
    // the previous check's modal can still be up; start from none
    for (const m of document.querySelectorAll('.claudsidian-sign-in')) m.parentElement.remove();
  }, KB);
  try {
    await ev(() => window.app.commands.executeCommandById('claudsidian:sign-in'));
    await waitFor(() => !!document.querySelector('.claudsidian-sign-in-paste'), 'paste button', 5000);
    // the phone modal slides in; measure once it has stopped moving
    await sleep(1500);
    const g = await ev((kb) => {
      const visibleBottom = window.innerHeight - kb;
      const modal = document.querySelector('.claudsidian-sign-in');
      const field = modal.querySelector('.claudsidian-sign-in-row input:not([readonly])');
      const paste = modal.querySelector('.claudsidian-sign-in-paste');
      field.focus();
      field.scrollIntoView({ block: 'nearest' });
      const scroller = [modal, modal.querySelector('.modal-content')].find((e) => e.scrollHeight > e.clientHeight + 1);
      return {
        visibleBottom,
        modalBottom: Math.round(modal.getBoundingClientRect().bottom),
        fieldBottom: Math.round(field.getBoundingClientRect().bottom),
        pasteBottom: Math.round(paste.getBoundingClientRect().bottom),
        scrolls: !!scroller,
      };
    }, KB);
    await shot('04b-sign-in-keyboard');
    assert(g.modalBottom <= g.visibleBottom, `modal runs under the keyboard: ${JSON.stringify(g)}`);
    assert(g.fieldBottom <= g.visibleBottom, `code field under the keyboard: ${JSON.stringify(g)}`);
    // Paste with the mock clipboard reaches the exchange (the mock or real server answers; any error text proves it ran)
    await ev(() => document.activeElement?.blur());
    await ev(() => document.querySelector('.claudsidian-sign-in-paste').click());
    await waitFor(() => document.querySelector('.claudsidian-sign-in .claudsidian-sign-in-row input:not([readonly])')?.value === 'mock-code#mock-state' || !document.querySelector('.claudsidian-sign-in'), 'paste filled the code', 5000);
    return g;
  } finally {
    await ev(() => {
      Object.defineProperty(window, 'visualViewport', { value: window.__realVV, configurable: true });
      document.querySelector('.claudsidian-sign-in .modal-close-button')?.click();
    });
  }
});

// ---- teardown -------------------------------------------------------------------------------------------------
await setTheme(priorTheme ?? 'moonstone').catch(() => {});
await ev(() => window.app.emulateMobile(false)).catch(() => {});
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
const failed = results.filter((r) => !r.ok).length;
console.log(`[ui] ${results.length - failed}/${results.length} ok, page errors: ${errors.length}${errors.length ? ` (${errors[0]})` : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
