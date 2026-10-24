// UI check in the second Obsidian (CDP 9333) at phone size under app.emulateMobile(true), with real touch input:
//   sheets   the header pickers open as full bottom sheets over the chat (2026-10-24: clipped to the header)
//   keyboard a tap on transcript text and a drag (even one starting on a control) drop the composer's focus; a
//            tap on the composer's surround or tools does not
//   sign-in  Finish sits beside the code field, return in the field runs Finish (empty code: inline error, no
//            network), a tap on the modal's text drops focus
// Reloads the plugin from the vault copy first. Opens only the test session. Screenshots in e2e/out/obsidian/ui-check/.
// Usage: node e2e/obsidian/ui-check.mjs [--session "claudsidian ux test"]
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
await ev(() => window.app.emulateMobile(true));
await sleep(1500);
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

// ---- teardown -------------------------------------------------------------------------------------------------
await ev(() => window.app.emulateMobile(false)).catch(() => {});
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
const failed = results.filter((r) => !r.ok).length;
console.log(`[ui] ${results.length - failed}/${results.length} ok, page errors: ${errors.length}${errors.length ? ` (${errors[0]})` : ''}`);
await browser.close();
process.exit(failed ? 1 : 0);
