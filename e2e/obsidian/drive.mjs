// Drives a second Obsidian instance (started with --user-data-dir and --remote-debugging-port) over CDP
// through Playwright: enables the plugin, points it at a mock server, opens the view on desktop and in
// mobile emulation, sends a message, and screenshots each state into e2e/out/obsidian/.
// Usage: node e2e/obsidian/drive.mjs [--endpoint http://127.0.0.1:9333] [--api http://127.0.0.1:8765]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const endpoint = args.endpoint ?? 'http://127.0.0.1:9333';
const api = args.api ?? 'http://127.0.0.1:8765';
const outDir = path.resolve('e2e/out/obsidian');
mkdirSync(outDir, { recursive: true });

const log = (...a) => console.log('[drive]', ...a);
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = context.pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page found');
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

async function shot(name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  log('screenshot', file);
}
async function ev(fn, ...a) {
  return page.evaluate(fn, ...a);
}
async function waitFor(fn, label, ms = 15000) {
  const start = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${label}`);
    await page.waitForTimeout(250);
  }
}

async function dismissModals() {
  for (let i = 0; i < 4; i++) {
    const info = await ev(() => {
      const m = document.querySelector('.modal-container');
      if (!m) return null;
      const text = m.innerText.replace(/\s+/g, ' ').slice(0, 200);
      const cta = m.querySelector('button.mod-cta, button.mod-warning');
      const buttons = [...m.querySelectorAll('button')].map((b) => b.textContent.trim());
      return { text, hasCta: !!cta, buttons };
    });
    if (!info) return;
    log('modal:', info.text, '| buttons:', info.buttons.join(' / '));
    const wantsEnable = /restricted mode|community plugins|trust|turn on/i.test(info.text);
    if (wantsEnable && info.hasCta) {
      await ev(() => document.querySelector('.modal-container button.mod-cta, .modal-container button.mod-warning').click());
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);
  }
}

await waitFor(() => window.app && window.app.workspace && window.app.workspace.layoutReady, 'layout ready');
await dismissModals();
log('obsidian', await ev(() => ({ version: window.app.appVersion ?? 'n/a', vault: window.app.vault.getName() })));

// Enable community plugins and the plugin itself (a fresh vault starts in restricted mode).
await ev(async () => {
  const plugins = window.app.plugins;
  if (!plugins.isEnabled?.()) await plugins.setEnable(true);
  await plugins.loadManifests?.();
  await plugins.enablePluginAndSave('claudsidian');
});
await dismissModals();
await waitFor(() => !!window.app.plugins.plugins['claudsidian'], 'plugin loaded');
log('plugin loaded:', await ev(() => window.app.plugins.plugins['claudsidian'].manifest.version));

// Point the plugin at the mock server with a fake signed-in state, then reload it so the services pick up the URL.
await ev(async (apiBase) => {
  const p = window.app.plugins.plugins['claudsidian'];
  await p.saveSettings({
    apiBaseUrl: apiBase,
    oauthTokenUrl: `${apiBase}/v1/oauth/token`,
    vaultPathOnMac: '/Users/kicooley-winters/workspace/projects/yes-chef',
    clientId: 'obsidian-e2e',
    auth: { accessToken: 'mock-access-1', refreshToken: 'mock-refresh-1', expiresAt: Date.now() + 3600_000, scopes: ['user:sessions:claude_code'], clientId: 'mock', orgUuid: 'org-mock', email: 'ki@example.com' },
  });
  await window.app.plugins.disablePlugin('claudsidian');
  await window.app.plugins.enablePlugin('claudsidian');
}, api);
await waitFor(() => !!window.app.plugins.plugins['claudsidian'], 'plugin reloaded');

// Open the view (desktop) and screenshot.
await ev(() => window.app.commands.executeCommandById('claudsidian:open'));
await waitFor(() => !!document.querySelector('.claudsidian-root'), 'view root');
await page.waitForTimeout(1500);
const iconStats = await ev(() => {
  const root = document.querySelector('.claudsidian-view') ?? document.querySelector('.claudsidian-root');
  const svgs = root ? root.querySelectorAll('svg').length : 0;
  const empties = root ? [...root.querySelectorAll('[class*="icon"]')].filter((el) => !el.querySelector('svg') && !el.textContent.trim()).map((el) => el.className).slice(0, 10) : [];
  return { svgs, empties };
});
log('icons', JSON.stringify(iconStats));
await shot('01-desktop-sessions');

// Open the vault session, send a message, wait for the echo.
await waitFor(() => document.body.innerText.includes('L10 menu questions'), 'session list');
await dismissModals();
await page.getByText('L10 menu questions', { exact: false }).first().click();
await waitFor(() => !!document.querySelector('.claudsidian-view textarea'), 'composer');
await page.waitForTimeout(800);
await shot('02-desktop-chat');
await page.locator('.claudsidian-view textarea').first().fill('hello from real obsidian');
await page.locator('.claudsidian-view textarea').first().press('Enter');
await waitFor(() => document.body.innerText.includes('Echo: hello from real obsidian'), 'echo reply', 20000);
await page.waitForTimeout(500);
await shot('03-desktop-echo');

// Mobile emulation: the sidebar collapses, so reopen the view (the plugin opens a main-area leaf on mobile).
await ev(() => window.app.emulateMobile(true));
await page.waitForTimeout(1500);
await ev(() => window.app.commands.executeCommandById('claudsidian:open'));
await waitFor(() => !!document.querySelector('.claudsidian-root'), 'mobile view root');
await page.waitForTimeout(1200);
await shot('04-mobile-sessions');
if (await ev(() => document.body.innerText.includes('L10 menu questions'))) {
  await page.getByText('L10 menu questions', { exact: false }).first().click();
  await waitFor(() => !!document.querySelector('.claudsidian-view textarea'), 'mobile composer');
  await page.waitForTimeout(1000);
  await shot('04b-mobile-chat');
}
await ev(() => window.app.commands.executeCommandById('claudsidian:toggle-cooking'));
await page.waitForTimeout(1000);
await shot('04c-mobile-cooking');
await ev(() => window.app.commands.executeCommandById('claudsidian:toggle-cooking'));
await ev(() => window.app.emulateMobile(false));
await page.waitForTimeout(1200);

// Sign-in modal rendering check: open via command, screenshot, close.
await ev(() => window.app.commands.executeCommandById('claudsidian:sign-in'));
await page.waitForTimeout(800);
await shot('05-sign-in-modal');
await page.keyboard.press('Escape');

log('console errors:', JSON.stringify(consoleErrors.slice(0, 10)));
await browser.close();
