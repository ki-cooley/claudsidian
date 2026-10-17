// Inspection for the "This vault" grouping in the second Obsidian (CDP 9333): prints counts, key names and value
// types only (no titles, ids, paths, or event contents). Usage: node e2e/obsidian/inspect-learning.mjs
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page over CDP');
const out = await page.evaluate(async () => {
  const p = window.app.plugins.plugins['claudsidian'];
  if (!p) return { plugin: false };
  const typesOf = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v])) : typeof o);
  const tally = (xs) => xs.reduce((m, x) => ((m[String(x)] = (m[String(x)] ?? 0) + 1), m), {});
  const s = p.store;
  const sessions = s.sessions.value;
  let envs = [];
  let envErr = null;
  try {
    envs = await p.client.listEnvironments();
  } catch (e) {
    envErr = String(e?.name ?? 'error');
  }
  let wire = [];
  try {
    wire = await p.client.listSessions();
  } catch {}
  return {
    settings: { environmentDirs: Object.keys(p.settings.environmentDirs ?? {}).length, sessionCwds: Object.keys(p.settings.sessionCwds ?? {}).length, vaultPathOnMacSet: !!p.settings.vaultPathOnMac },
    store: { envDirs: s.envDirs?.size, cwdCache: s.cwdCache?.size, envCache: s.envCache?.length, hasPersistDep: typeof s.deps?.persistLearned },
    sessions: { count: sessions.length, byKind: tally(sessions.map((x) => x.environmentKind)), withEnvId: sessions.filter((x) => x.environmentId).length, withCwd: sessions.filter((x) => x.cwd).length },
    environments: { count: envs.length, envErr, byKind: tally(envs.map((e) => e.kind)), firstKeys: typesOf(envs[0]), bridgeInfoKeys: typesOf(envs.find((e) => e.bridge_info)?.bridge_info) },
    wire: { count: wire.length, firstKeys: typesOf(wire[0]), envKindTally: tally(wire.map((w) => w.environment_kind)) },
    groups: [...document.querySelectorAll('.claudsidian-session-group-title, .claudsidian-group-title, .claudsidian-sessions h3, .claudsidian-session-group > :first-child')].length,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close().catch(() => {});
