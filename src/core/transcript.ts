/**
 * Pure transcript reducer over Remote Control event rows (Claude Code stream-json payloads).
 * applyEvents orders and dedupes a poll by sequence number, applyEvent reduces one row, and the
 * mark* functions record local actions (optimistic sends, answered requests, offline). Every
 * function returns the input state object when nothing changed. Rules: docs/protocol.md.
 */
import type {
  ControlRequestEvent,
  ControlResponseEvent,
  PermissionResult,
  ResultEvent,
  StreamJsonEvent,
  SystemOtherEvent,
  UserEvent,
  WireEventRow,
} from '../api/types';
import { isCanUseTool } from '../api/types';
import { log } from '../util/log';
import { uuidv4 } from '../util/uuid';
import type {
  PendingControl,
  PermissionItem,
  QuestionItem,
  ResultItem,
  SessionInit,
  SystemItem,
  TranscriptItem,
  TranscriptState,
  TurnState,
  UserItem,
} from './types';
import { toEpochMs } from './types';
import {
  appendInScope,
  finalizePartials,
  findItemIn,
  hasItem,
  isRecord,
  lastItem,
  optNumber,
  optString,
  resolveRequest,
  stringArray,
  systemItem,
  turnAfterResolution,
  updateItem,
  type EventContext,
} from './transcript-items';
import { reduceAssistant, reduceStreamEvent, reduceUser } from './transcript-stream';

// ---------------------------------------------------------------------------
// Applying wire rows
// ---------------------------------------------------------------------------

/** Reduce one row. lastSeq moves to max(lastSeq, seq); the payload may change nothing. */
export function applyEvent(state: TranscriptState, row: WireEventRow): TranscriptState {
  const seq = seqOf(row);
  const payload: unknown = row?.payload;
  let next = state;
  if (isRecord(payload) && typeof payload.type === 'string') {
    const ev = payload as StreamJsonEvent;
    next = reducePayload(state, ev, contextFor(ev, row, seq));
  }
  if (Number.isFinite(seq) && seq > next.lastSeq) next = { ...next, lastSeq: seq };
  return next;
}

/** Reduce a poll: sort by sequence number, skip rows at or below lastSeq (and duplicates inside the batch). */
export function applyEvents(state: TranscriptState, rows: WireEventRow[]): TranscriptState {
  if (!Array.isArray(rows) || rows.length === 0) return state;
  const ordered = rows
    .map((row, index) => ({ row, index, seq: seqOf(row) }))
    .sort((a, b) => sortKey(a.seq) - sortKey(b.seq) || a.index - b.index);
  let next = state;
  for (const { row, seq } of ordered) {
    if (Number.isFinite(seq) && seq <= next.lastSeq) continue;
    next = applyEvent(next, row);
  }
  return next;
}

function seqOf(row: WireEventRow | undefined): number {
  const v: unknown = row?.sequence_num;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return Number.NaN;
}

/** Rows without a usable sequence number sort last, in arrival order, and never move lastSeq. */
function sortKey(seq: number): number {
  return Number.isFinite(seq) ? seq : Number.POSITIVE_INFINITY;
}

function contextFor(ev: StreamJsonEvent, row: WireEventRow, seq: number): EventContext {
  const parent = ev.parent_tool_use_id;
  return {
    seq,
    ts: toEpochMs(optString(ev.timestamp)) ?? toEpochMs(optString(row.created_at)),
    uuid: optString(ev.uuid),
    parentToolUseId: typeof parent === 'string' && parent ? parent : undefined,
  };
}

function reducePayload(state: TranscriptState, ev: StreamJsonEvent, ctx: EventContext): TranscriptState {
  switch (ev.type) {
    case 'system':
      return reduceSystem(state, ev as SystemOtherEvent, ctx);
    case 'user':
      return reduceUser(state, ev as UserEvent, ctx);
    case 'assistant':
      return reduceAssistant(state, ev as never, ctx);
    case 'stream_event':
      return reduceStreamEvent(state, ev as never, ctx);
    case 'result':
      return reduceResult(state, ev as ResultEvent, ctx);
    case 'control_request':
      return reduceControlRequest(state, ev as ControlRequestEvent, ctx);
    case 'control_response':
      return reduceControlResponse(state, ev as ControlResponseEvent, ctx);
    case 'control_cancel_request':
      return reduceControlCancel(state, ev);
    default:
      log.debug('transcript: ignored event', { type: ev.type, seq: ctx.seq });
      return state;
  }
}

// ---------------------------------------------------------------------------
// system
// ---------------------------------------------------------------------------

function reduceSystem(state: TranscriptState, ev: SystemOtherEvent, ctx: EventContext): TranscriptState {
  switch (ev.subtype) {
    case 'init':
      return reduceInit(state, ev, ctx);
    case 'compact_boundary':
      return appendSystem(state, ctx, ev.subtype, 'Context compacted');
    case 'permission_denied': {
      const tool = optString(ev.tool_name);
      const text = optString(ev.message) ?? (tool ? `Permission denied for ${tool}` : 'Permission denied');
      return denyPendingFor(appendSystem(state, ctx, ev.subtype, text), tool, optString(ev.tool_use_id));
    }
    case 'api_retry': {
      const attempt = optNumber(ev.attempt);
      return appendSystem(state, ctx, ev.subtype, attempt === undefined ? 'Retrying API' : `Retrying API (attempt ${attempt})`);
    }
    default:
      return state;
  }
}

function reduceInit(state: TranscriptState, ev: SystemOtherEvent, ctx: EventContext): TranscriptState {
  const init: SessionInit = {
    cwd: optString(ev.cwd) ?? '',
    model: optString(ev.model) ?? '',
    permissionMode: optString(ev.permissionMode),
    effort: ev.effort === null ? null : optString(ev.effort),
    slashCommands: stringArray(ev.slash_commands),
    tools: stringArray(ev.tools),
    claudeCodeVersion: optString(ev.claude_code_version),
  };
  // The start line only when init opens the loaded window (lastSeq -1: no wire event applied yet).
  const items =
    state.lastSeq === -1
      ? [...state.items, systemItem(ctx, 'init', init.cwd ? `Session started in ${folderName(init.cwd)}` : 'Session started')]
      : state.items;
  return {
    ...state,
    items,
    init,
    model: init.model || state.model,
    permissionMode: init.permissionMode ?? state.permissionMode,
  };
}

function appendSystem(state: TranscriptState, ctx: EventContext, subtype: string, text: string): TranscriptState {
  return { ...state, items: appendInScope(state.items, ctx.parentToolUseId, systemItem(ctx, subtype, text)) };
}

/** A permission_denied for a tool answers the pending permission card for that call (by tool_use_id, else by tool name) as deny. */
function denyPendingFor(state: TranscriptState, toolName: string | undefined, toolUseId: string | undefined): TranscriptState {
  let next = state;
  for (const p of state.pending) {
    if (p.kind !== 'permission') continue;
    const item = findItemIn(next.items, p.requestId);
    if (item?.kind !== 'permission') continue;
    const match = toolUseId && item.toolUseId ? item.toolUseId === toolUseId : toolName !== undefined && item.toolName === toolName;
    if (match) next = resolveRequest(next, p.requestId, { behavior: 'deny' });
  }
  return next;
}

// ---------------------------------------------------------------------------
// result
// ---------------------------------------------------------------------------

function reduceResult(state: TranscriptState, ev: ResultEvent, ctx: EventContext): TranscriptState {
  const subtype = optString(ev.subtype) ?? 'unknown';
  const item: ResultItem = {
    kind: 'result',
    id: `result-${ctx.uuid ?? ctx.seq}`,
    subtype,
    isError: ev.is_error === true || subtype.startsWith('error'),
    durationMs: optNumber(ev.duration_ms),
    costUsd: optNumber(ev.total_cost_usd),
    numTurns: optNumber(ev.num_turns),
    errors: Array.isArray(ev.errors) ? ev.errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))) : [],
    localCommand: optString(ev.local_command),
    ts: ctx.ts,
  };
  // A local command result (/cost, /effort, possibly from another client) does not end the worker's
  // turn: open streams and pending requests stay. A real result closes the stream and retires
  // requests nobody answered, so no stale card stays pinned.
  const local = item.localCommand !== undefined;
  let items = local ? state.items : finalizePartials(state.items);
  if (!local) for (const p of state.pending) items = cancelPending(items, p);
  items = [...items, item];
  const pending = local ? state.pending : [];
  return {
    ...state,
    items,
    pending,
    turn: pending.length > 0 ? 'needs_input' : 'idle',
    lastResult: item,
    inFlightUserUuids: [],
    streaming: local ? state.streaming : undefined,
  };
}

function cancelPending(items: TranscriptItem[], p: PendingControl): TranscriptItem[] {
  return updateItem(items, p.requestId, (it) => {
    if (it.kind === 'permission') return it.resolved ? it : { ...it, resolved: 'deny' };
    if (it.kind === 'question') return it.resolved ? it : { ...it, resolved: true };
    return it;
  });
}

// ---------------------------------------------------------------------------
// control_request / control_response
// ---------------------------------------------------------------------------

const DIALOG_SUBTYPES = new Set(['request_user_dialog', 'side_question']);
const DIALOG_TEXT_KEYS = ['title', 'header', 'question', 'message', 'description', 'text', 'prompt', 'body', 'detail'];

function reduceControlRequest(state: TranscriptState, ev: ControlRequestEvent, ctx: EventContext): TranscriptState {
  const requestId = optString(ev.request_id);
  const req: unknown = ev.request;
  if (!requestId || !isRecord(req) || typeof req.subtype !== 'string') return state;
  if (state.pending.some((p) => p.requestId === requestId) || hasItem(state.items, requestId)) return state;

  if (isCanUseTool(req as ControlRequestEvent['request'])) {
    const input = isRecord(req.input) ? req.input : {};
    const toolName = optString(req.tool_name) ?? 'tool';
    const item: PermissionItem | QuestionItem =
      toolName === 'AskUserQuestion'
        ? { kind: 'question', id: requestId, requestId, questions: parseQuestions(input), resolved: false, ts: ctx.ts }
        : {
            kind: 'permission',
            id: requestId,
            requestId,
            toolName,
            input,
            suggestions: Array.isArray(req.permission_suggestions) ? req.permission_suggestions.filter(isRecord) : [],
            blockedPath: optString(req.blocked_path),
            decisionReason: optString(req.decision_reason),
            toolUseId: optString(req.tool_use_id),
            ts: ctx.ts,
          };
    const pending: PendingControl = { requestId, kind: item.kind, raw: ev };
    return { ...state, items: [...state.items, item], pending: [...state.pending, pending], turn: 'needs_input' };
  }

  if (DIALOG_SUBTYPES.has(req.subtype)) {
    const item: SystemItem = { kind: 'system', id: `dialog-${requestId}`, subtype: req.subtype, text: dialogText(req), ts: ctx.ts };
    const pending: PendingControl = { requestId, kind: 'dialog', raw: ev };
    return { ...state, items: [...state.items, item], pending: [...state.pending, pending], turn: 'needs_input' };
  }

  // Echoes of our own requests (interrupt, set_model, ...) and anything else: nothing to show.
  return state;
}

function parseQuestions(input: Record<string, unknown>): QuestionItem['questions'] {
  const raw = input.questions;
  if (!Array.isArray(raw)) return [];
  const out: QuestionItem['questions'] = [];
  for (const q of raw) {
    if (!isRecord(q) || typeof q.question !== 'string') continue;
    const options: QuestionItem['questions'][number]['options'] = [];
    if (Array.isArray(q.options)) {
      for (const o of q.options) {
        if (!isRecord(o) || typeof o.label !== 'string') continue;
        options.push(typeof o.description === 'string' ? { label: o.label, description: o.description } : { label: o.label });
      }
    }
    const header = optString(q.header);
    out.push(header === undefined ? { question: q.question, options, multiSelect: q.multiSelect === true } : { question: q.question, header, options, multiSelect: q.multiSelect === true });
  }
  return out;
}

function dialogText(req: Record<string, unknown>): string {
  const known = DIALOG_TEXT_KEYS.map((k) => optString(req[k])?.trim()).filter((v): v is string => !!v);
  if (known.length > 0) return known.join(': ');
  const rest = Object.entries(req)
    .filter(([k, v]) => k !== 'subtype' && !/id$/i.test(k) && typeof v === 'string' && v.trim())
    .map(([, v]) => (v as string).trim());
  return rest.length > 0 ? rest.join(' ') : `Request: ${String(req.subtype)}`;
}

function reduceControlResponse(state: TranscriptState, ev: ControlResponseEvent, ctx: EventContext): TranscriptState {
  const res: unknown = ev.response;
  if (!isRecord(res)) return state;
  let next = state;
  if (res.subtype === 'error') {
    const text = optString(res.error)?.trim() || 'Control request failed';
    next = { ...next, items: [...next.items, { kind: 'error', id: `err-${ctx.uuid ?? ctx.seq}`, text, ts: ctx.ts }] };
  }
  const requestId = optString(res.request_id);
  return requestId ? resolveRequest(next, requestId, res.response) : next;
}

function reduceControlCancel(state: TranscriptState, ev: StreamJsonEvent): TranscriptState {
  const requestId = optString((ev as { request_id?: unknown }).request_id);
  if (!requestId || !state.pending.some((p) => p.requestId === requestId)) return state;
  let items = state.items;
  for (const p of state.pending) if (p.requestId === requestId) items = cancelPending(items, p);
  const pending = state.pending.filter((p) => p.requestId !== requestId);
  return { ...state, items, pending, turn: turnAfterResolution(items, pending) };
}

// ---------------------------------------------------------------------------
// Local mutations (things this client did)
// ---------------------------------------------------------------------------

/** Optimistic user item for a message we just posted; the echo with the same uuid replaces it. */
export function markSent(
  state: TranscriptState,
  payload: UserEvent,
  textForDisplay: string,
  imageCount: number,
): TranscriptState {
  const uuid = optString(payload.uuid);
  const item: UserItem = {
    kind: 'user',
    id: uuid ?? uuidv4(),
    text: textForDisplay,
    imageCount,
    synthetic: false,
    ts: toEpochMs(optString(payload.timestamp)),
  };
  return {
    ...state,
    items: [...state.items, item],
    inFlightUserUuids: uuid ? [...state.inFlightUserUuids, uuid] : state.inFlightUserUuids,
    turn: state.pending.length > 0 ? 'needs_input' : 'sending',
  };
}

/**
 * Resolve a pending request locally after posting our control_response. Without `result` a
 * permission reads as allowed until the echo confirms; pass the PermissionResult you sent to
 * show deny (and question answers) right away.
 */
export function markControlSent(state: TranscriptState, requestId: string, result?: PermissionResult): TranscriptState {
  return resolveRequest(state, requestId, result ?? { behavior: 'allow' });
}

/** Offline overlay on the turn; clearing it derives the turn back from the transcript. */
export function markOffline(state: TranscriptState, offline: boolean): TranscriptState {
  if (offline) return state.turn === 'offline' ? state : { ...state, turn: 'offline' };
  if (state.turn !== 'offline') return state;
  return { ...state, turn: deriveTurn(state) };
}

function deriveTurn(state: TranscriptState): TurnState {
  if (state.pending.length > 0) return 'needs_input';
  if (state.inFlightUserUuids.length > 0) return 'sending';
  const last = lastItem(state.items);
  if (!last || last.kind === 'result') return 'idle';
  return 'working';
}

/** Find an item by id at any depth (subagent children included). */
export function findItem(state: TranscriptState, id: string): TranscriptItem | undefined {
  return findItemIn(state.items, id);
}

/** Last path segment of a working directory, for the start line ("yes-chef" rather than the full path). */
function folderName(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}
