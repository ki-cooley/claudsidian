// UX tour: drives the second Obsidian instance (CDP 9333) through the plugin's real states against the
// live API and captures screenshots plus DOM metrics for review. Writes e2e/out/ux/round<N>/<profile>/*.png
// and index.json. Needs the scratch vault seeded with a token (scripts/oauth-login.mjs + seed), the LaunchAgent
// host running, and the one test session (node e2e/obsidian/ux-setup.mjs --create). Every chat step runs in that
// session with read-only prompts about the copied vault notes; no other session is opened. Logs are counts only.
// Usage:
//   node e2e/obsidian/ux-tour.mjs --round 3 [--profiles desktop300,desktop420,ipad-portrait,ipad-landscape,iphone]
//                                 [--no-send] [--session "claudsidian ux test"]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : [])).filter((x) => x.length));
const round = String(args.round ?? '1');
const profiles = String(args.profiles ?? 'desktop300,desktop420,ipad-portrait,ipad-landscape,iphone').split(',');
const send = !('no-send' in args);
const vaultSession = args.session ?? 'claudsidian ux test';
const contextNote = args.note ?? 'menus/latitude 10/prep-rd-2026-10-18.md';
const outRoot = path.resolve(`e2e/out/ux/round${round}`);
mkdirSync(outRoot, { recursive: true });
const log = (...a) => console.log('[tour]', ...a);

const PROFILES = {
  desktop300: { mobile: false, sidebar: 300 },
  desktop420: { mobile: false, sidebar: 420 },
  'ipad-portrait': { mobile: true, width: 1024, height: 1366 },
  'ipad-landscape': { mobile: true, width: 1366, height: 1024 },
  iphone: { mobile: true, width: 390, height: 844 },
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const context = browser.contexts()[0];
const page = context.pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page over CDP');
const cdp = await context.newCDPSession(page);
const consoleLog = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(`${m.type()}: ${m.text().slice(0, 240)}`);
});
page.on('pageerror', (e) => consoleLog.push(`pageerror: ${String(e).slice(0, 240)}`));

const index = [];
let profileName = 'none';
let shotNo = 0;
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const sleep = (ms) => page.waitForTimeout(ms);

async function waitFor(fn, label, ms = 20000, arg) {
  const start = Date.now();
  for (;;) {
    let v = null;
    try {
      v = await page.evaluate(fn, arg);
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timeout: ${label}`);
    await sleep(250);
  }
}

async function metrics() {
  return ev(() => {
    const root = document.querySelector('.claudsidian-root');
    if (!root) return { present: false };
    const rows = [...root.querySelectorAll('.claudsidian-session-row')];
    const clipped = rows.filter((r) => { const el = r.querySelector('.claudsidian-session-summary, .claudsidian-session-sub'); if (!el || el.clientHeight === 0) return false; const cs = getComputedStyle(el); return el.scrollHeight > el.clientHeight + 2 && cs.overflowY !== 'visible' && cs.textOverflow !== 'ellipsis'; }).length;
    const view = document.querySelector('.claudsidian-view') ?? root;
    const r = view.getBoundingClientRect();
    const overflowX = view.scrollWidth > view.clientWidth + 1;
    const smallTargets = [...root.querySelectorAll('button, [role="button"], .claudsidian-tap')].filter((b) => {
      const b2 = b.getBoundingClientRect();
      return b2.width > 0 && (b2.width < 32 || b2.height < 32);
    }).length;
    const textLength = root.innerText.length;
    const chipRows = new Set([...root.querySelectorAll('.claudsidian-chips .claudsidian-chip')].map((c) => Math.round(c.getBoundingClientRect().top))).size;
    return { present: true, chipRows, rows: rows.length, clippedRows: clipped, overflowX, viewWidth: Math.round(r.width), viewHeight: Math.round(r.height), smallTargets, textLength };
  });
}

async function shot(name, opts = {}) {
  shotNo++;
  const dir = path.join(outRoot, profileName);
  mkdirSync(dir, { recursive: true });
  const base = `${String(shotNo).padStart(2, '0')}-${name}`;
  const m = await metrics().catch(() => ({ present: false }));
  const entry = { profile: profileName, name, files: [], metrics: m, note: opts.note ?? '', consoleTail: consoleLog.slice(-3) };
  try {
    if (opts.full || !m.present) {
      const f = path.join(dir, `${base}-full.png`);
      await page.screenshot({ path: f });
      entry.files.push(f);
    }
    if (m.present) {
      const f = path.join(dir, `${base}.png`);
      const box = await ev(() => {
        const el = document.querySelector('.claudsidian-view') ?? document.querySelector('.claudsidian-root');
        const r = el.getBoundingClientRect();
        return { x: Math.max(0, r.x - 2), y: Math.max(0, r.y - 2), width: r.width + 4, height: r.height + 4 };
      });
      await page.screenshot({ path: f, clip: box });
      entry.files.push(f);
    }
  } catch (e) {
    entry.error = String(e?.message ?? e);
  }
  index.push(entry);
  log('shot', base, JSON.stringify(m));
  return entry;
}

async function dismissModals() {
  await ev(() => {
    for (const b of document.querySelectorAll('.modal-close-button')) b.click();
    for (const n of document.querySelectorAll('.notice')) n.click();
  }).catch(() => {});
}

async function plugin() {
  return waitFor(() => !!window.app.plugins.plugins['claudsidian'], 'plugin loaded');
}

async function openView() {
  await ev(() => window.app.commands.executeCommandById('claudsidian:open'));
  await waitFor(() => !!document.querySelector('.claudsidian-root'), 'view root');
  await sleep(800);
}

async function toList() {
  await ev(() => window.app.plugins.plugins['claudsidian'].store.close?.());
  await waitFor(() => !!document.querySelector('.claudsidian-session-list') || !!document.querySelector('.claudsidian-sessions'), 'session list', 20000);
  await sleep(600);
}

async function openSessionByTitle(title) {
  if (title !== vaultSession) throw new Error('the tour only opens the test session');
  const ok = await ev((t) => {
    const rows = [...document.querySelectorAll('.claudsidian-session-row')];
    const row = rows.find((r) => (r.querySelector('.claudsidian-session-title')?.textContent ?? '').trim() === t);
    if (!row) return false;
    (row.querySelector('.claudsidian-session-main') ?? row).click();
    return true;
  }, title);
  if (!ok) throw new Error(`session row not found: ${title}`);
  await waitFor(() => !!document.querySelector('.claudsidian-composer-input'), 'composer', 20000);
  await sleep(1500);
}

async function setProfile(name) {
  profileName = name;
  shotNo = 0;
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown profile ${name}`);
  await dismissModals();
  if (p.mobile) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: 2, mobile: true });
    await ev(() => window.app.emulateMobile(true));
    await sleep(1500);
  } else {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await ev(() => window.app.emulateMobile(false));
    await sleep(1200);
    await ev((w) => {
      const split = window.app.workspace.rightSplit;
      try {
        split.expand?.();
      } catch {}
      try {
        if (typeof split.setSize === 'function') split.setSize(w);
        else {
          const el = document.querySelector('.mod-right-split');
          if (el) el.style.width = `${w}px`;
        }
      } catch {}
    }, p.sidebar);
    await sleep(600);
  }
  await openView();
  log('profile', name, JSON.stringify(await ev(() => ({ w: window.innerWidth, h: window.innerHeight, mobile: !!window.app.isMobile }))));
}

async function mutationRate(ms = 5000) {
  return ev(async (ms) => {
    const root = document.querySelector('.claudsidian-root');
    if (!root) return null;
    let n = 0;
    const before = [...root.querySelectorAll('.claudsidian-session-row, .claudsidian-item')].slice(0, 30).map((e) => e.getBoundingClientRect().top);
    const mo = new MutationObserver((list) => (n += list.length));
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    await new Promise((r) => setTimeout(r, ms));
    mo.disconnect();
    const after = [...root.querySelectorAll('.claudsidian-session-row, .claudsidian-item')].slice(0, 30).map((e) => e.getBoundingClientRect().top);
    const shifted = before.filter((t, i) => after[i] !== undefined && Math.abs(after[i] - t) > 1).length;
    return { mutationsPerSec: +(n / (ms / 1000)).toFixed(1), shiftedElements: shifted };
  }, ms);
}

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    log(`step ${name} failed:`, String(e?.message ?? e).slice(0, 200));
    index.push({ profile: profileName, name: `${name} (failed)`, error: String(e?.message ?? e).slice(0, 300) });
    await dismissModals();
  }
}

// ---------------------------------------------------------------------------------------------------
await plugin();
// Thinking blocks stay out of every screenshot.
await ev(async () => {
  const p = window.app.plugins.plugins['claudsidian'];
  if (p.settings.showThinking) await p.saveSettings({ showThinking: false });
});
if (await ev(() => window.app.plugins.plugins['claudsidian'].settings.showThinking)) throw new Error('Show thinking is still on');
// Make sure the view exists once before profiles so emulateMobile has something to re-layout.
await openView();

for (const name of profiles) {
  await step(`profile ${name}`, async () => setProfile(name));
  const isMobile = PROFILES[name]?.mobile;

  await step('list', async () => {
    await toList();
    await ev(() => window.app.plugins.plugins['claudsidian'].store.refreshSessions?.());
    await sleep(2500);
    await shot('list-top', { full: true });
    const mr = await mutationRate(5000);
    index.push({ profile: profileName, name: 'list-idle-metrics', metrics: mr });
    log('list idle', JSON.stringify(mr));
    await ev(() => {
      const el = document.querySelector('.claudsidian-session-list') ?? document.querySelector('.claudsidian-sessions-body');
      if (el) el.scrollTop = el.scrollHeight / 2;
    });
    await sleep(500);
    await shot('list-middle');
    await ev(() => {
      const el = document.querySelector('.claudsidian-session-list') ?? document.querySelector('.claudsidian-sessions-body');
      if (el) el.scrollTop = 0;
    });
    await sleep(300);
  });

  await step('row-menu', async () => {
    const opened = await ev((t) => {
      const row = [...document.querySelectorAll('.claudsidian-session-row')].find((r) => (r.querySelector('.claudsidian-session-title')?.textContent ?? '').trim() === t);
      const b = row?.querySelector('.claudsidian-session-more');
      if (!b) return false;
      b.click();
      return true;
    }, vaultSession);
    if (opened) {
      await sleep(600);
      await shot('row-menu', { full: true });
      await page.keyboard.press('Escape');
      await sleep(300);
      await dismissModals();
    }
  });

  await step('new-sheet', async () => {
    const opened = await ev(() => {
      const b = document.querySelector('.claudsidian-sessions-new');
      if (!b) return false;
      b.click();
      return true;
    });
    if (opened) {
      await sleep(1200);
      await shot('new-session-sheet', { full: true });
      await page.keyboard.press('Escape');
      await sleep(300);
      await ev(() => document.querySelector('.claudsidian-ss-sheet-backdrop')?.click());
      await sleep(300);
    }
  });

  await step('chat-scroll', async () => {
    await toList();
    await openSessionByTitle(vaultSession);
    await shot('chat-bottom', { full: true });
    const mr = await mutationRate(4000);
    index.push({ profile: profileName, name: 'chat-idle-metrics', metrics: mr });
    log('chat idle', JSON.stringify(mr));
    await ev(() => {
      const el = document.querySelector('.claudsidian-transcript-wrap') ?? document.querySelector('.claudsidian-transcript');
      if (el) el.scrollTop = 0;
    });
    await sleep(600);
    await shot('chat-top');
    const older = await ev(() => {
      const b = document.querySelector('.claudsidian-older');
      if (!b) return false;
      b.click();
      return true;
    });
    if (older) {
      await sleep(2500);
      await shot('chat-after-earlier');
    }
    const expanded = await ev(() => {
      const t = document.querySelector('.claudsidian-tool .claudsidian-tool-row, .claudsidian-tool-summary, .claudsidian-tool');
      if (!t) return false;
      t.click();
      return true;
    });
    if (expanded) {
      await sleep(600);
      await shot('chat-tool-expanded');
    }
    await ev(() => {
      const el = document.querySelector('.claudsidian-transcript-wrap') ?? document.querySelector('.claudsidian-transcript');
      if (el) el.scrollTop = el.scrollHeight / 2;
    });
    await sleep(500);
    await shot('chat-middle');
  });

  await step('context-note', async () => {
    // Open a real note in the main area, select some lines, then come back to the plugin so chips appear.
    await ev(async (p) => {
      await window.app.workspace.openLinkText(p, '', false);
    }, contextNote);
    await sleep(1500);
    await ev(() => {
      const editor = window.app.workspace.activeEditor?.editor;
      if (editor) {
        const last = Math.min(editor.lineCount() - 1, 12);
        editor.setSelection({ line: Math.max(0, last - 4), ch: 0 }, { line: last, ch: 0 });
      }
    });
    await sleep(500);
    if (isMobile) await openView();
    await toList();
    await openSessionByTitle(vaultSession);
    await shot('chat-with-context', { full: true });
    await page.locator('.claudsidian-composer-input').first().click();
    await page.locator('.claudsidian-composer-input').first().fill('which of these items are R&D tests and which are production? one line each');
    await sleep(600);
    await shot('composer-typed');
    await page.locator('.claudsidian-composer-input').first().fill('');
    await page.locator('.claudsidian-composer-input').first().type('@');
    await sleep(900);
    await shot('composer-at-suggest');
    await page.keyboard.press('Escape');
    await page.locator('.claudsidian-composer-input').first().fill('');
  });

  if (send && !isMobile && name === 'desktop300') {
    await step('send-and-stream', async () => {
      const input = page.locator('.claudsidian-composer-input').first();
      await input.fill('which of the selected items are R&D tests and which are production? one line each, read only');
      await input.press('Enter');
      const start = Date.now();
      let n = 0;
      let lastLen = -1;
      let stable = 0;
      while (Date.now() - start < 150000) {
        await sleep(2500);
        const st = await ev(() => { const h = document.querySelector('.claudsidian-header .claudsidian-status, .claudsidian-status'); return { status: h?.textContent?.trim() ?? '', busy: !!h?.classList.contains('is-busy'), len: document.querySelector('.claudsidian-root')?.innerText.length ?? 0 }; });
        if (n < 7 && (st.len !== lastLen || n === 0)) {
          await shot(`stream-t${Math.round((Date.now() - start) / 1000)}s`);
          n++;
        }
        if (st.len === lastLen) stable++;
        else stable = 0;
        lastLen = st.len;
        if (stable >= 3 && !st.busy && !/working|running|thinking/i.test(st.status)) break;
      }
      await shot('reply-final', { full: true });
      const mr = await mutationRate(4000);
      index.push({ profile: profileName, name: 'chat-after-reply-idle-metrics', metrics: mr });
    });

    await step('ask-user-question', async () => {
      const input = page.locator('.claudsidian-composer-input').first();
      await input.fill('use the AskUserQuestion tool to ask me whether the dessert goes in a bowl or on a plate (two options), then just say ok after i answer');
      await input.press('Enter');
      // only an open card counts: earlier rounds leave resolved ones in the same session
      await waitFor(() => !!document.querySelector('.claudsidian-question:not(.is-resolved) .claudsidian-option'), 'question card', 240000);
      await sleep(800);
      await shot('question-card', { full: true });
      await input.fill('after that, how many prep-rd notes are in menus/latitude 10? just the number');
      await input.press('Enter');
      await sleep(2500);
      const queued = await ev(() => [...document.querySelectorAll('.claudsidian-user-pending')].map((e) => e.textContent.trim()));
      index.push({ profile: profileName, name: 'queued-labels', metrics: { count: queued.length, queued: queued.filter((t) => t === 'Queued').length, sending: queued.filter((t) => t.startsWith('Sending')).length } });
      await shot('queued-behind-question');
      await ev(() => document.querySelector('.claudsidian-question:not(.is-resolved) .claudsidian-option')?.click());
      await sleep(2500);
      const answered = await ev(() => ({ cardOpen: !!document.querySelector('.claudsidian-question:not(.is-resolved)'), resolved: document.querySelectorAll('.claudsidian-question.is-resolved').length }));
      index.push({ profile: profileName, name: 'question-one-tap', metrics: answered });
      log('one tap:', JSON.stringify(answered));
      await shot('question-answered');
      await waitFor(() => { const h = document.querySelector('.claudsidian-header .claudsidian-status, .claudsidian-status'); return h && !h.classList.contains('is-busy') && !document.querySelector('.claudsidian-user-pending'); }, 'idle after queued message', 120000).catch(() => {});
      await sleep(1500);
      await shot('question-after-ok');
    });
  }

  if (send && !isMobile && name === 'desktop300') {
    await step('queued-send', async () => {
      // Owner note: a message sent while the session works must show immediately as pending.
      const input = page.locator('.claudsidian-composer-input').first();
      await input.fill('read every prep-rd note in menus/latitude 10 and give each a one-paragraph summary, read only');
      await input.press('Enter');
      await sleep(3500);
      await input.fill('and the service prep note too');
      await input.press('Enter');
      await sleep(2500);
      await shot('queued-message');
      const stopped = await ev(() => {
        const b = document.querySelector('.claudsidian-composer-stop');
        if (!b || b.disabled) return false;
        b.click();
        return true;
      });
      await sleep(2500);
      await shot('after-stop', { note: stopped ? 'stop clicked' : 'stop button not available' });
      await waitFor(() => { const h = document.querySelector('.claudsidian-header .claudsidian-status, .claudsidian-status'); return h && !h.classList.contains('is-busy'); }, 'idle after stop', 60000).catch(() => {});
      await sleep(800);
      await shot('idle-after-stop');
    });

    await step('catch-up-after-reopen', async () => {
      const input = page.locator('.claudsidian-composer-input').first();
      await input.fill('list the next three items in the selection, one line each, nothing else, read only');
      await input.press('Enter');
      await sleep(1500);
      await ev(() => window.app.plugins.plugins['claudsidian'].store.close?.());
      await sleep(25000);
      await openSessionByTitle(vaultSession);
      await sleep(2500);
      const info = await ev(() => {
        const el = document.querySelector('.claudsidian-transcript-wrap') ?? document.querySelector('.claudsidian-transcript');
        const atBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 8 : null;
        const text = document.querySelector('.claudsidian-root')?.innerText ?? '';
        return { atBottom, hasJump: !!document.querySelector('.claudsidian-jump'), textLength: text.length };
      });
      log('catch-up:', JSON.stringify(info));
      index.push({ profile: profileName, name: 'catch-up-info', metrics: info });
      await shot('catch-up-after-reopen', { full: true });
    });
  }

  if (send && !isMobile && name === 'desktop300') {
    await step('permission', async () => {
      const input = page.locator('.claudsidian-composer-input').first();
      await input.fill('use the Bash tool to run ls on menus and tell me how many entries there are; read only, change nothing');
      await input.press('Enter');
      const card = await waitFor(() => !!document.querySelector('.claudsidian-permission:not(.is-resolved)'), 'permission card', 120000).catch(() => false);
      if (!card) {
        index.push({ profile: profileName, name: 'permission (skipped)', note: 'no permission card: the session did not ask' });
        return;
      }
      await sleep(800);
      await shot('permission-card', { full: true });
      await ev(() => {
        const btns = [...document.querySelectorAll('.claudsidian-permission:not(.is-resolved) button')];
        (btns.find((b) => /^allow$/i.test((b.textContent ?? '').trim())) ?? btns.find((b) => /allow/i.test(b.textContent ?? '')))?.click();
      });
      await sleep(2500);
      await shot('permission-allowed');
      await waitFor(() => { const h = document.querySelector('.claudsidian-header .claudsidian-status, .claudsidian-status'); return h && !h.classList.contains('is-busy'); }, 'idle after permission', 120000).catch(() => {});
      await sleep(800);
      await shot('after-permission-turn', { full: true });
    });
  }

  await step('cooking', async () => {
    await ev(() => window.app.commands.executeCommandById('claudsidian:toggle-cooking'));
    await sleep(1200);
    await shot('cooking-chat', { full: true });
    await toList();
    await shot('cooking-list');
    await ev(() => window.app.commands.executeCommandById('claudsidian:toggle-cooking'));
    await sleep(600);
  });

  if (!isMobile && name === 'desktop300') {
    await step('settings', async () => {
      await ev(() => {
        window.app.setting.open();
        window.app.setting.openTabById('claudsidian');
      });
      await sleep(1200);
      await shot('settings-tab', { full: true });
      await ev(() => {
        const el = document.querySelector('.vertical-tab-content');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await sleep(400);
      await shot('settings-tab-bottom', { full: true });
      await ev(() => window.app.setting.close());
      await sleep(400);
    });
  }
}

// Back to a sane desktop state.
await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
await ev(() => window.app.emulateMobile(false)).catch(() => {});
writeFileSync(path.join(outRoot, 'index.json'), JSON.stringify({ round, generatedAt: new Date().toISOString(), entries: index, console: consoleLog.slice(0, 60) }, null, 2));
log('done; entries', index.length, 'console lines', consoleLog.length, '->', path.join(outRoot, 'index.json'));
await browser.close().catch(() => {});
