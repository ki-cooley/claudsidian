// Reloads the plugin in the second Obsidian instance (CDP 9333) and runs its own sign-in exchange with a
// bogus code: the expected failure is the server's 400 invalid_grant text, not the edge's 429.
// Usage: node e2e/obsidian/exchange-e2e.mjs
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
const out = await page.evaluate(async () => {
  const plugins = window.app.plugins;
  await plugins.disablePlugin('claudsidian');
  await plugins.loadManifests();
  await plugins.enablePlugin('claudsidian');
  for (let i = 0; i < 50 && !plugins.plugins['claudsidian']; i++) await new Promise((r) => setTimeout(r, 200));
  const plugin = plugins.plugins['claudsidian'];
  const res = { version: plugin.manifest.version };
  const { url } = await plugin.auth.beginSignIn();
  res.authorizeHost = new URL(url).host;
  try {
    await plugin.auth.completeSignIn('bogus-code#' + new URL(url).searchParams.get('state'));
    res.exchange = 'unexpectedly succeeded';
  } catch (e) {
    res.exchange = { message: e?.message, status: e?.status, errorType: e?.errorType, requestId: e?.requestId };
  }
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close().catch(() => {});
