// Verifies the seed-via-data.json path: disables the plugin, confirms data.json already has auth,
// re-enables it (fresh load reads the seeded token), and checks it comes up signed in and lists real sessions.
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no obsidian page');
for (const b of await page.$$('.modal-close-button')) await b.click().catch(() => {});
const out = await page.evaluate(async () => {
  const plugins = window.app.plugins;
  await plugins.disablePlugin('claudsidian');
  await plugins.enablePlugin('claudsidian');
  for (let i = 0; i < 60 && !plugins.plugins['claudsidian']; i++) await new Promise((r) => setTimeout(r, 200));
  const p = plugins.plugins['claudsidian'];
  const res = { version: p.manifest.version, tokenUrl: p.settings.oauthTokenUrl, signedIn: p.auth.isSignedIn?.() ?? !!p.settings.auth?.accessToken };
  // Force a real session refresh and read the count.
  try {
    await p.store.refreshSessions?.();
    for (let i = 0; i < 40; i++) {
      const n = p.store.sessions?.value?.length ?? p.store.sessions?.length ?? 0;
      if (n > 0) { res.sessionCount = n; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    res.sessionCount = res.sessionCount ?? (p.store.sessions?.value?.length ?? 0);
  } catch (e) { res.refreshError = String(e?.message ?? e); }
  return res;
});
console.log(JSON.stringify(out, null, 2));
await browser.close().catch(() => {});
