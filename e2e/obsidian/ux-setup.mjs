// Prepares the second Obsidian (CDP 9333) for a UX round: reloads Claudsidian from the copied build, turns
// "Show thinking" off (and Claudian's thinking display, when --claudian), and finds or creates the one test
// session the tour uses. Prints counts and types only. Usage:
//   node e2e/obsidian/ux-setup.mjs [--title "claudsidian ux test"] [--create] [--claudian]
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)] : [])).filter((x) => x.length));
const title = typeof args.title === 'string' ? args.title : 'claudsidian ux test';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page over CDP');
const out = await page.evaluate(
  async ({ title, create }) => {
    const pl = window.app.plugins;
    await pl.disablePlugin('claudsidian');
    await pl.enablePlugin('claudsidian');
    for (let i = 0; i < 50 && !pl.plugins['claudsidian']?.store; i++) await new Promise((r) => setTimeout(r, 200));
    const p = pl.plugins['claudsidian'];
    await p.saveSettings({ showThinking: false });
    await p.store.refreshSessions();
    const envs = p.store.environments();
    const dflt = p.settings.defaultEnvironmentId;
    let matches = p.store.sessions.value.filter((s) => s.title === title && !s.archived);
    let created = false;
    if (matches.length === 0 && create) {
      // The live host: the default environment, else the bridge environment with the most connected sessions.
      const connected = (id) => p.store.sessions.value.filter((s) => s.environmentId === id && s.connectionStatus === 'connected').length;
      const env = envs.find((e) => e.id === dflt) ?? envs.filter((e) => e.kind === 'bridge').sort((a, b) => connected(b.id) - connected(a.id))[0];
      await p.store.createSession({ environmentId: env.id, title, permissionMode: 'default' });
      created = true;
      matches = p.store.sessions.value.filter((s) => s.title === title && !s.archived);
    }
    return {
      version: p.manifest.version,
      showThinking: p.settings.showThinking,
      envs: envs.map((e) => ({ kind: e.kind, sessions: e.sessionCount, hasCwd: !!e.cwd, isDefault: e.id === dflt })),
      testSessions: matches.length,
      created,
    };
  },
  { title, create: 'create' in args },
);
if (args.claudian) {
  out.claudian = await page.evaluate(async () => {
    const pl = window.app.plugins;
    await pl.enablePlugin('realclaudian');
    for (let i = 0; i < 50 && !pl.plugins['realclaudian']; i++) await new Promise((r) => setTimeout(r, 200));
    const c = pl.plugins['realclaudian'];
    const keys = Object.keys(c?.settings ?? {}).filter((k) => /think/i.test(k));
    return { loaded: !!c, thinkingKeys: keys.map((k) => `${k}:${typeof c.settings[k]}`) };
  });
}
console.log(JSON.stringify(out, null, 1));
await browser.close().catch(() => {});
