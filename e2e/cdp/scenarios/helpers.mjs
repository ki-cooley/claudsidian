// Steps several scenarios share: opening a session from the list, finding the composer, sending a message,
// reading the store, and the selectors the plugin UI is expected to answer to. Selectors use the in-page finder
// (CSS, text=Exact, text*=Partial, stages joined with " >> ").

export const SIDEBAR = '#sidebar';
export const COMPOSER = `${SIDEBAR} >> textarea`;
/** The send control: an aria-label or text of "Send" inside the sidebar, else a submit button. */
export const SEND_BUTTON_CANDIDATES = [`${SIDEBAR} >> text=Send`, `${SIDEBAR} >> button[aria-label="Send"]`, `${SIDEBAR} >> button[type="submit"]`];

export const SESSIONS = {
  vault: { id: 'cse_vault', title: 'L10 menu questions' },
  ws: { id: 'cse_ws', title: 'Summarize tech tasks' },
  cloud: { id: 'cse_cloud', title: 'Cloud refactor' },
  blocked: { id: 'cse_blocked', title: 'Clean scratch dir' },
  old: { id: 'cse_old', title: 'Old archived session' },
};

/** Read a JSON-safe view of the store from the page. */
export function storeState(d) {
  return d.eval(() => {
    const s = window.__claudsidian && window.__claudsidian.store;
    if (!s) return null;
    const id = s.selectedId.value;
    const t = id ? s.transcript(id).value : null;
    return {
      selectedId: id,
      sessions: s.sessions.value.map((x) => ({ id: x.id, title: x.title, archived: x.archived, workerStatus: x.workerStatus, cwd: x.cwd ?? null })),
      banner: s.banner.value,
      turn: t ? t.turn : null,
      items: t ? t.items.map((i) => ({ kind: i.kind, id: i.id, text: i.text ?? null, name: i.name ?? null, status: i.status ?? null, resolved: i.resolved ?? null, toolName: i.toolName ?? null })) : [],
      pending: t ? t.pending.map((p) => p.requestId) : [],
    };
  });
}

export async function waitForSessions(d, minCount = 4, ms = 10_000) {
  return d.waitFor({
    fn: (min) => {
      const s = window.__claudsidian && window.__claudsidian.store;
      return s && s.sessions.value.length >= min ? s.sessions.value.length : null;
    },
    args: [minCount],
  }, ms, `at least ${minCount} sessions in the store`);
}

/** Open a seeded session by tapping its row, then wait for the transcript to load. */
export async function openSession(d, ctx, session) {
  await waitForSessions(d);
  await d.waitFor(`${SIDEBAR} >> text=${session.title}`);
  await d.click(`${SIDEBAR} >> text=${session.title}`);
  await d.waitFor({
    fn: (id) => {
      const s = window.__claudsidian.store;
      return s.selectedId.value === id && s.transcript(id).value.items.length > 0;
    },
    args: [session.id],
  }, ctx.timeoutMs, `session ${session.id} open with history`);
  await d.waitFor(COMPOSER, ctx.timeoutMs, 'the composer');
}

/** Click whichever send control exists. */
export async function clickSend(d) {
  for (const sel of SEND_BUTTON_CANDIDATES) {
    if (await d.exists(sel)) {
      await d.click(sel);
      return sel;
    }
  }
  throw new Error(`no send button found (tried ${SEND_BUTTON_CANDIDATES.join(' | ')})`);
}

/** Type a message and send it the way the profile sends: Enter on desktop, the Send button on mobile. */
export async function sendMessage(d, ctx, text) {
  await d.fill(COMPOSER, text);
  if (ctx.profile.mobile) return clickSend(d);
  await d.focus(COMPOSER);
  await d.press('Enter');
  return 'Enter';
}

/** The last assistant text item in the open transcript. */
export function waitForAssistantText(d, needle, ms = 8000) {
  return d.waitFor({
    fn: (needle) => {
      const s = window.__claudsidian.store;
      const id = s.selectedId.value;
      if (!id) return null;
      const items = s.transcript(id).value.items;
      const hit = items.find((i) => i.kind === 'assistant_text' && !i.partial && i.text.includes(needle));
      return hit ? hit.text : null;
    },
    args: [needle],
  }, ms, `assistant text containing "${needle}"`);
}

/** User payloads the mock recorded for a session (what the plugin actually sent). */
export function sentUserTexts(ctx, sessionId) {
  const rows = ctx.mock.state.events.get(sessionId) ?? [];
  return rows
    .filter((r) => r.source === 'client' && r.payload.type === 'user')
    .map((r) => {
      const c = r.payload.message?.content;
      if (typeof c === 'string') return c;
      return (Array.isArray(c) ? c : []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    });
}

export function controlResponses(ctx, sessionId) {
  const rows = ctx.mock.state.events.get(sessionId) ?? [];
  return rows.filter((r) => r.source === 'client' && r.payload.type === 'control_response').map((r) => r.payload.response);
}

export function assert(cond, message) {
  if (!cond) throw new Error(message);
}
