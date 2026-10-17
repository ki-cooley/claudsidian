// Live message-flow checks in the second Obsidian (CDP 9333), in the one test session with read-only prompts:
//   A  a message sent mid-turn shows at once, the turn keeps working, both get answered, the turn ends idle
//   B  send, leave for the list before the reply, come back: the reply is there and the status is idle
//   C  send, leave for the list: the row moves from Working to Idle without the chat open
// Prints step results, counts and event types only. Usage: node e2e/obsidian/flows.mjs [--only A,B,C]
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? true] : [])).filter((x) => x.length));
const only = new Set(String(args.only ?? 'A,B,C').split(','));
const TITLE = 'claudsidian ux test';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no Obsidian page over CDP');
const ev = (fn, a) => page.evaluate(fn, a);
const sleep = (ms) => page.waitForTimeout(ms);
const results = [];

async function waitFor(fn, label, ms, arg) {
  const start = Date.now();
  for (;;) {
    const v = await ev(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timeout: ${label}`);
    await sleep(500);
  }
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log('[flow] ok  ', name, detail ? JSON.stringify(detail) : '');
  } catch (e) {
    results.push({ name, ok: false, detail: String(e?.message ?? e).slice(0, 300) });
    console.log('[flow] FAIL', name, String(e?.message ?? e).slice(0, 300));
  }
}

const sid = await ev(async (title) => {
  const p = window.app.plugins.plugins.claudsidian;
  await p.saveSettings({ showThinking: false });
  await p.store.refreshSessions();
  const s = p.store.sessions.value.filter((x) => x.title === title && !x.archived);
  if (s.length !== 1) throw new Error(`expected one test session, found ${s.length}`);
  return s[0].id;
}, TITLE);

const openTest = () => ev(async (id) => {
  const p = window.app.plugins.plugins.claudsidian;
  await p.activateView(id);
}, sid);
const toList = () => ev(() => window.app.plugins.plugins.claudsidian.store.close());
const send = (text) => ev(async ({ id, text }) => window.app.plugins.plugins.claudsidian.store.send(id, text), { id: sid, text });
const state = () => ev((id) => {
  const p = window.app.plugins.plugins.claudsidian;
  const st = p.store.transcript(id).value;
  const kinds = {};
  for (const i of st.items) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  const users = st.items.filter((i) => i.kind === 'user' && !i.synthetic);
  return { turn: st.turn, items: st.items.length, kinds, pendingUsers: users.filter((u) => u.pending).length, lastKind: st.items.at(-1)?.kind, lastSeq: st.lastSeq };
}, sid);
const serverTail = (n) => ev(async ({ id, n }) => {
  const p = window.app.plugins.plugins.claudsidian;
  const rows = await p.client.listEvents(id, { limit: n, sortOrder: 'desc' });
  return rows.reverse().map((r) => `${r.payload?.type}${r.payload?.subtype ? '/' + r.payload.subtype : ''}${r.source ? '@' + r.source : ''}`);
}, { id: sid, n });
const idle = () => waitFor((id) => {
  const st = window.app.plugins.plugins.claudsidian.store.transcript(id).value;
  return st.turn === 'idle' && st.items.at(-1)?.kind !== 'user';
}, 'turn idle', 240000, sid);

await openTest();
await waitFor((id) => window.app.plugins.plugins.claudsidian.store.transcript(id).value.turn === 'idle', 'test session idle before start', 120000, sid).catch(() => {});

if (only.has('A')) {
  await check('A1 a long read-only turn starts working', async () => {
    const tools = (await state()).kinds.tool ?? 0;
    await send('read every prep-rd note in menus/latitude 10 one at a time with the Read tool and give each a two-sentence summary; read only');
    await waitFor(({ id, tools }) => {
      const st = window.app.plugins.plugins.claudsidian.store.transcript(id).value;
      return st.turn === 'working' && st.items.filter((i) => i.kind === 'tool').length > tools;
    }, 'a new tool call', 120000, { id: sid, tools });
    return await state();
  });
  await check('A2 a mid-turn message shows at once as Queued, the turn keeps working, and Claude takes it in', async () => {
    const before = await state();
    await send('also, while you are at it: how many of those notes mention a dress-run? just the number at the end');
    const after = await state();
    if (after.kinds.user !== (before.kinds.user ?? 0) + 1) throw new Error(`user items ${before.kinds.user} -> ${after.kinds.user}`);
    if (after.turn !== 'working') throw new Error(`turn ${after.turn} right after the mid-turn send`);
    // Claude Code takes the message in at the next tool result, which can land within one poll, so "Queued" is
    // sampled at once and an already-taken-in message counts too.
    const queuedNow = await ev((id) => {
      const st = window.app.plugins.plugins.claudsidian.store.transcript(id).value;
      const last = st.items.filter((i) => i.kind === 'user').at(-1);
      const label = [...document.querySelectorAll('.claudsidian-user-pending')].some((e) => e.textContent.trim() === 'Queued');
      return { label, flagged: !!last?.queued };
    }, sid);
    if (!queuedNow.label || !queuedNow.flagged) throw new Error(`right after the send: ${JSON.stringify(queuedNow)}`);
    await waitFor((id) => {
      const st = window.app.plugins.plugins.claudsidian.store.transcript(id).value;
      return !st.items.some((i) => i.kind === 'user' && i.queued);
    }, 'Claude taking the message in', 180000, sid);
    const takenIn = await state();
    if (takenIn.items <= after.items) throw new Error('nothing new arrived before the message was taken in');
    return { queuedLabels: queuedNow, turnWhenTakenIn: takenIn.turn };
  });
  await check('A3 the turn ends idle with a reply after the mid-turn message', async () => {
    await idle();
    const st = await state();
    if (st.pendingUsers) throw new Error(`${st.pendingUsers} user messages still pending`);
    return { st, tail: await serverTail(14) };
  });
}

if (only.has('B')) {
  await check('B leave for the list before the reply, come back: the reply is there and the turn is idle', async () => {
    const before = await state();
    await send('in one short sentence: what is the covers number on prep-rd-2026-10-18? read only');
    await sleep(1500);
    await toList();
    await waitFor(() => !!document.querySelector('.claudsidian-session-row'), 'list', 20000);
    await sleep(45000);
    await openTest();
    await idle();
    const st = await state();
    if ((st.kinds.assistant_text ?? 0) <= (before.kinds.assistant_text ?? 0)) throw new Error('no new assistant text after reopening');
    return st;
  });
}

if (only.has('C')) {
  await check('C the list row goes from Working to Idle while the chat is closed', async () => {
    await send('in one short sentence: what is the period_end on prep-rd-2026-10-18? read only');
    await sleep(1500);
    await toList();
    const row = (id) => {
      const s = window.app.plugins.plugins.claudsidian.store.session(id);
      return s ? `${s.workerStatus}/${s.statusBucket ?? ''}` : 'missing';
    };
    const seen = new Set([await ev(row, sid)]);
    const start = Date.now();
    let settled = false;
    while (Date.now() - start < 150000) {
      await sleep(5000);
      const r = await ev(row, sid);
      seen.add(r);
      if (/idle/i.test(r) && seen.size > 1) {
        settled = true;
        break;
      }
    }
    if (!settled) throw new Error(`row never settled: ${[...seen].join(' -> ')}`);
    await openTest();
    await idle();
    return { rowStates: [...seen], st: await state() };
  });
}

await toList();
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }));
await browser.close().catch(() => {});
