// Opens only the UX test session (by exact title) in the second Obsidian and reports what the store learned from
// it: event and payload type tallies, whether an init event with a cwd arrived, and the learned-map sizes in
// memory and in data.json. Counts and types only. Usage:
//   node e2e/obsidian/inspect-test-session.mjs [--title "claudsidian ux test"] [--send "read-only prompt"]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : [])).filter((x) => x.length));
const title = typeof args.title === 'string' ? args.title : 'claudsidian ux test';
const DATA = '/Users/kicooley-winters/workspace/scratch/claudsidian-test-vault/.obsidian/plugins/claudsidian/data.json';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page over CDP');
const out = await page.evaluate(
  async ({ title, send }) => {
    const p = window.app.plugins.plugins['claudsidian'];
    await p.store.refreshSessions();
    const matches = p.store.sessions.value.filter((s) => s.title === title && !s.archived);
    if (matches.length !== 1) return { testSessions: matches.length };
    const s = matches[0];
    await p.activateView(s.id);
    if (send) await p.store.send(s.id, send);
    await new Promise((r) => setTimeout(r, send ? 45000 : 4000));
    const rows = await p.client.listEvents(s.id, { limit: 100, sortOrder: 'asc' });
    const tally = {};
    for (const r of rows) {
      const k = `${r.payload?.type}/${r.payload?.subtype ?? ''}`;
      tally[k] = (tally[k] ?? 0) + 1;
    }
    const init = rows.find((r) => r.payload?.type === 'system' && r.payload?.subtype === 'init');
    const st = p.store.transcript(s.id).value;
    return {
      testSessions: 1,
      envKind: s.environmentKind,
      hasEnvId: !!s.environmentId,
      rowKeys: Object.keys(rows[0] ?? {}),
      rows: rows.length,
      tally,
      initCwdType: init ? typeof init.payload.cwd : 'no init',
      storeInitCwdType: typeof st.init?.cwd,
      summaryCwdType: typeof p.store.session(s.id)?.cwd,
      envDirs: p.store.envDirs.size,
      cwdCache: p.store.cwdCache.size,
      settingsEnvDirs: Object.keys(p.settings.environmentDirs).length,
      settingsCwds: Object.keys(p.settings.sessionCwds).length,
    };
  },
  { title, send: typeof args.send === 'string' ? args.send : '' },
);
const disk = JSON.parse(readFileSync(DATA, 'utf8'));
out.disk = { environmentDirs: Object.keys(disk.environmentDirs ?? {}).length, sessionCwds: Object.keys(disk.sessionCwds ?? {}).length, showThinking: disk.showThinking };
console.log(JSON.stringify(out, null, 1));
await browser.close().catch(() => {});
