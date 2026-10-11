// Live smoke in the second Obsidian instance (CDP 9333) with the token from scripts/oauth-login.mjs:
// seeds the plugin with the real endpoints and token, opens the view, lists sessions, opens the vault
// session, sends a message and waits for the reply. Screenshots in e2e/out/obsidian/live-*.png.
// Usage: node e2e/obsidian/live-smoke.mjs [--session "yes-chef"] [--message "ping"] [--no-send]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : [])).filter((x) => x.length));
const sessionTitle = args.session ?? 'yes-chef';
const message = args.message ?? 'ping from the claudsidian live smoke';
const send = !('no-send' in args);
const envFile = process.env.CLAUDSIDIAN_OAUTH_ENV ?? path.join(homedir(), 'workspace', 'private', 'claudsidian-oauth', 'token.env');
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8').split('\n').map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^"(.*)"$/, '$1')]),
);
if (!env.CLAUDSIDIAN_ACCESS_TOKEN) throw new Error(`no token in ${envFile}`);
const outDir = path.resolve('e2e/out/obsidian');
mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log('[live]', ...a);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page over CDP');
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
const ev = (fn, ...a) => page.evaluate(fn, ...a);
async function shot(name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  log('screenshot', file);
}
async function waitFor(fn, label, ms = 20000, arg) {
  const start = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timeout waiting for ${label}`);
    await page.waitForTimeout(300);
  }
}
const bodyText = () => ev(() => document.body.innerText);

// Seed the real endpoints and the stored token, then reload the plugin so its services pick them up.
await ev(async (auth) => {
  const p = window.app.plugins.plugins['claudsidian'];
  await p.saveSettings({
    apiBaseUrl: 'https://api.anthropic.com',
    oauthTokenUrl: 'https://api.anthropic.com/v1/oauth/token',
    oauthAuthorizeUrl: 'https://claude.ai/oauth/authorize',
    vaultPathOnMac: '/Users/kicooley-winters/workspace/projects/yes-chef',
    auth,
    lastSessionId: null,
  });
  await window.app.plugins.disablePlugin('claudsidian');
  await window.app.plugins.enablePlugin('claudsidian');
}, {
  accessToken: env.CLAUDSIDIAN_ACCESS_TOKEN,
  refreshToken: env.CLAUDSIDIAN_REFRESH_TOKEN,
  expiresAt: Number(env.CLAUDSIDIAN_EXPIRES_AT),
  scopes: (env.CLAUDSIDIAN_SCOPES ?? '').split(' ').filter(Boolean),
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  orgUuid: env.CLAUDSIDIAN_ORG_UUID,
});
await waitFor(() => !!window.app.plugins.plugins['claudsidian'], 'plugin reloaded');
for (const b of await page.$$('.modal-close-button')) await b.click().catch(() => {});

await ev(() => window.app.commands.executeCommandById('claudsidian:open'));
await waitFor(() => !!document.querySelector('.claudsidian-root'), 'view root');
await ev(() => window.app.plugins.plugins['claudsidian'].store.close?.());
await ev(() => window.app.plugins.plugins['claudsidian'].store.refreshSessions?.());
await waitFor((t) => document.body.innerText.includes(t), `session list with "${sessionTitle}"`, 30000, sessionTitle);
await page.waitForTimeout(1500);
const listInfo = await ev(() => {
  const root = document.querySelector('.claudsidian-root');
  const text = root?.innerText ?? '';
  return { groups: [...root.querySelectorAll('[class*="group"], h2, h3, h4')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 12), hasThisVault: /this vault/i.test(text), length: text.length };
});
log('list:', JSON.stringify(listInfo));
await shot('live-01-sessions');

await page.getByText(sessionTitle, { exact: true }).first().click();
await waitFor(() => !!document.querySelector('.claudsidian-view textarea'), 'composer');
await page.waitForTimeout(4000);
const chatInfo = await ev(() => {
  const root = document.querySelector('.claudsidian-root');
  const text = root?.innerText ?? '';
  return { textLength: text.length, undefinedCount: (text.match(/undefined|\[object Object\]|NaN/g) ?? []).length, head: text.slice(0, 400), tail: text.slice(-600) };
});
log('chat:', JSON.stringify(chatInfo));
await shot('live-02-chat-history');

let reply = null;
if (send) {
  const before = (await bodyText()).length;
  await page.locator('.claudsidian-view textarea').first().fill(message);
  await page.locator('.claudsidian-view textarea').first().press('Enter');
  await page.waitForTimeout(1500);
  await shot('live-03-sent');
  // Wait for the transcript to grow past our own message and then settle for 4 s.
  let stableSince = null;
  let last = before;
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const len = (await bodyText()).length;
    if (len !== last) {
      last = len;
      stableSince = Date.now();
    } else if (stableSince && len > before + message.length + 40 && Date.now() - stableSince > 4000) {
      break;
    }
    await page.waitForTimeout(1000);
  }
  reply = await ev(() => {
    const root = document.querySelector('.claudsidian-root');
    const text = root?.innerText ?? '';
    return { tail: text.slice(-900), working: /working|thinking|running/i.test(text.slice(-200)) };
  });
  log('after send:', JSON.stringify(reply));
  await shot('live-04-reply');
}

// If the plugin refreshed the token meanwhile, report it so the env file can be synced.
const authNow = await ev(() => {
  const a = window.app.plugins.plugins['claudsidian'].settings?.auth;
  return a ? { expiresAt: a.expiresAt, refreshedAt: a.refreshedAt ?? null, sameAccess: undefined } : null;
});
log('auth after run:', JSON.stringify(authNow), 'env expiresAt:', env.CLAUDSIDIAN_EXPIRES_AT);
log('console errors/warnings:', JSON.stringify(consoleErrors.slice(0, 15), null, 1));
await browser.close().catch(() => {});
