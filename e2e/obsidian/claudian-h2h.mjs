// Head-to-head: drives the Claudian plugin (id realclaudian) in the second Obsidian instance (CDP 9333) through the
// same note and prompt the UX tour gives Claudsidian, and screenshots each state into e2e/out/h2h/claudian/.
// Claudian spawns a local Claude Code in the vault folder (the scratch copy), so only read-only prompts are sent.
// Usage: node e2e/obsidian/claudian-h2h.mjs [--width 300] [--no-send]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : []))
    .filter((x) => x.length),
);
const width = Number(args.width ?? 300);
const send = !('no-send' in args);
const note = args.note ?? 'menus/latitude 10/prep-rd-2026-10-18.md';
const prompt = args.prompt ?? 'whats left on this for tomorrow, just the stuff i cant push';
const outDir = path.resolve('e2e/out/h2h/claudian');
mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log('[h2h]', ...a);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page over CDP');
const consoleLog = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(`${m.type()}: ${m.text().slice(0, 240)}`);
});

const ev = (fn, ...a) => page.evaluate(fn, ...a);
const sleep = (ms) => page.waitForTimeout(ms);
let n = 0;
const index = [];

async function shot(name, full = false) {
  n++;
  const base = `${String(n).padStart(2, '0')}-${name}`;
  const file = path.join(outDir, `${base}${full ? '-full' : ''}.png`);
  const box = full
    ? null
    : await ev(() => {
        const el = document.querySelector('.workspace-leaf-content[data-type="claudian-view"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.max(0, r.x - 2), y: Math.max(0, r.y - 2), width: r.width + 4, height: r.height + 4 };
      });
  await page.screenshot(box ? { path: file, clip: box } : { path: file });
  const metrics = await ev(() => {
    const el = document.querySelector('.workspace-leaf-content[data-type="claudian-view"]');
    if (!el) return { present: false };
    const small = [...el.querySelectorAll('button, [role="button"]')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && (r.width < 32 || r.height < 32);
    }).length;
    return { present: true, width: Math.round(el.getBoundingClientRect().width), smallTargets: small, textLength: el.innerText.length };
  });
  index.push({ name: base, file, metrics });
  log('shot', base, JSON.stringify(metrics));
}

async function waitFor(fn, label, ms = 20000) {
  const start = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await page.evaluate(fn);
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timeout: ${label}`);
    await sleep(300);
  }
}

// Desktop layout, sidebar at the requested width.
await ev(() => window.app.emulateMobile(false)).catch(() => {});
await sleep(800);
for (const b of await page.$$('.modal-close-button')) await b.click().catch(() => {});

// Enable Claudian (desktop-only plugin) next to Claudsidian.
const enabled = await ev(async () => {
  const pl = window.app.plugins;
  if (!pl.isEnabled?.()) await pl.setEnable(true);
  await pl.loadManifests?.();
  if (!pl.plugins['realclaudian']) await pl.enablePlugin('realclaudian');
  for (let i = 0; i < 60 && !pl.plugins['realclaudian']; i++) await new Promise((r) => setTimeout(r, 200));
  const p = pl.plugins['realclaudian'];
  return p ? { version: p.manifest.version, settingsKeys: Object.keys(p.settings ?? {}).length, permissionMode: p.settings?.permissionMode, model: p.settings?.model } : null;
});
log('claudian:', JSON.stringify(enabled));
if (!enabled) throw new Error('Claudian did not load');
// Claudian hardcodes adaptive thinking for Claude and has no display setting; hide its thinking blocks for the
// run so the screenshots match Claudsidian with "Show thinking" off.
await ev(() => {
  if (document.getElementById('h2h-hide-thinking')) return;
  const st = document.createElement('style');
  st.id = 'h2h-hide-thinking';
  st.textContent = '.claudian-thinking-block { display: none !important; }';
  document.head.appendChild(st);
});

// Open the note with a selection first, the way the Claudsidian tour does.
await ev(async (p) => {
  await window.app.workspace.openLinkText(p, '', false);
}, note);
await sleep(1500);
await ev(() => {
  const editor = window.app.workspace.activeEditor?.editor;
  if (editor) {
    const last = Math.min(editor.lineCount() - 1, 12);
    editor.setSelection({ line: Math.max(0, last - 4), ch: 0 }, { line: last, ch: 0 });
  }
});
await sleep(400);

await ev(() => window.app.commands.executeCommandById('realclaudian:open-view'));
await waitFor(() => !!document.querySelector('.workspace-leaf-content[data-type="claudian-view"]'), 'claudian view', 20000);
await ev((w) => {
  const split = window.app.workspace.rightSplit;
  try {
    split.expand?.();
  } catch {}
  try {
    if (typeof split.setSize === 'function') split.setSize(w);
  } catch {}
}, width);
await sleep(2500);
await shot('empty-state', true);
await shot('empty-state');

// Context row and composer.
const domInfo = await ev(() => {
  const el = document.querySelector('.workspace-leaf-content[data-type="claudian-view"]');
  const cls = new Set();
  el?.querySelectorAll('[class]').forEach((x) => x.classList.forEach((c) => c.startsWith('claudian-') && cls.add(c)));
  const input = el?.querySelector('textarea, [contenteditable="true"]');
  return { classes: cls.size, input: input ? { tag: input.tagName, hasPlaceholder: !!(input.getAttribute('placeholder') ?? input.getAttribute('data-placeholder')) } : null, textLength: el?.innerText.length ?? 0 };
});
log('dom:', JSON.stringify(domInfo));
index.push({ name: 'dom-info', info: domInfo });

const inputSel = '.workspace-leaf-content[data-type="claudian-view"] textarea, .workspace-leaf-content[data-type="claudian-view"] [contenteditable="true"]';
await page.locator(inputSel).first().click();
await page.locator(inputSel).first().fill(prompt);
await sleep(600);
await shot('composer-typed');
await page.locator(inputSel).first().fill('');
await page.locator(inputSel).first().type('@');
await sleep(900);
await shot('at-mention');
await page.keyboard.press('Escape');
await page.locator(inputSel).first().fill('/');
await sleep(900);
await shot('slash-menu');
await page.keyboard.press('Escape');
await page.locator(inputSel).first().fill('');

if (send) {
  await page.locator(inputSel).first().fill(prompt);
  await page.locator(inputSel).first().press('Enter');
  const start = Date.now();
  let shots = 0;
  let lastLen = -1;
  let stable = 0;
  while (Date.now() - start < 180000) {
    await sleep(3000);
    const len = await ev(() => document.querySelector('.workspace-leaf-content[data-type="claudian-view"]')?.innerText.length ?? 0);
    if (shots < 6 && len !== lastLen) {
      await shot(`stream-t${Math.round((Date.now() - start) / 1000)}s`);
      shots++;
    }
    stable = len === lastLen ? stable + 1 : 0;
    lastLen = len;
    const busy = await ev(() => !!document.querySelector('.claudian-cancel-btn:not(.claudian-hidden), .claudian-thinking, .claudian-spinner'));
    if (stable >= 3 && !busy) break;
  }
  await shot('reply-final', true);
  await shot('reply-final');
  // Expand the first tool line if any.
  const expanded = await ev(() => {
    const t = document.querySelector('.workspace-leaf-content[data-type="claudian-view"] .claudian-tool-line, .workspace-leaf-content[data-type="claudian-view"] .claudian-tool-line-wrap');
    if (!t) return false;
    t.click();
    return true;
  });
  if (expanded) {
    await sleep(700);
    await shot('tool-expanded');
  }
}

// History / session list.
const history = await ev(() => {
  const el = document.querySelector('.workspace-leaf-content[data-type="claudian-view"]');
  const btn = [...(el?.querySelectorAll('button, .clickable-icon, [aria-label]') ?? [])].find((b) => /history|sessions|conversations/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));
  if (!btn) return false;
  btn.click();
  return true;
});
if (history) {
  await sleep(1200);
  await shot('history', true);
  await page.keyboard.press('Escape');
}

// Settings tab.
await ev(() => {
  window.app.setting.open();
  window.app.setting.openTabById('realclaudian');
});
await sleep(1200);
await shot('settings', true);
await ev(() => window.app.setting.close());

// Leave Claudian disabled so it does not interfere with the Claudsidian tours.
await ev(async () => {
  document.getElementById('h2h-hide-thinking')?.remove();
  await window.app.plugins.disablePlugin('realclaudian');
});
writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), width, entries: index, console: consoleLog.slice(0, 40) }, null, 2));
log('done', index.length, 'entries');
await browser.close().catch(() => {});
