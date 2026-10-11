/**
 * Reducers for the message-bearing events: `user` (our echoes, other devices, tool results,
 * local command wrappers), `assistant` (final content blocks) and `stream_event` (partial
 * deltas, keyed by the open message of each scope). Pure: every path returns the input
 * state when nothing changed. Blocks are read as untrusted records, never cast.
 */
import type { AssistantEvent, StreamEventEvent, UserEvent } from '../api/types';
import type {
  AssistantTextItem,
  StreamScope,
  ThinkingItem,
  ToolItem,
  TranscriptItem,
  TranscriptState,
  TurnState,
  UserItem,
} from './types';
import {
  appendInScope,
  countImages,
  field,
  findItemIn,
  hasItem,
  isRecord,
  optNumber,
  optString,
  systemItem,
  textOfBlocks,
  toolResultText,
  updateItem,
  upsertItem,
  type EventContext,
} from './transcript-items';

/** The turn while the worker is busy: a pending request keeps the session blocked on the user. */
export function workingTurn(state: TranscriptState): TurnState {
  return state.pending.length > 0 ? 'needs_input' : 'working';
}

// ---------------------------------------------------------------------------
// user
// ---------------------------------------------------------------------------

const COMMAND_NAME = /<command-name>\s*([^<]*?)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const LOCAL_OUTPUT = /^<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>$/;

export function reduceUser(state: TranscriptState, ev: UserEvent, ctx: EventContext): TranscriptState {
  const content: unknown = ev.message?.content;
  if (typeof content !== 'string' && !Array.isArray(content)) return state;

  if (Array.isArray(content) && content.some((b) => field(b, 'type') === 'tool_result')) {
    return attachToolResults(state, content);
  }

  const text = typeof content === 'string' ? content : textOfBlocks(content);
  const imageCount = typeof content === 'string' ? 0 : countImages(content);
  const meta = ev.isMeta === true || ev.isSynthetic === true;
  const trimmed = text.trim();

  // Local command wrappers: "<command-name>/x</command-name>" becomes "Ran /x", output shows as a system line.
  if (trimmed.startsWith('<command-')) {
    const name = COMMAND_NAME.exec(trimmed)?.[1]?.trim();
    if (!name) return state;
    const args = COMMAND_ARGS.exec(trimmed)?.[1]?.trim() ?? '';
    return appendSystem(state, ctx, 'local_command', `Ran ${name}${args ? ` ${args}` : ''}`);
  }
  const output = LOCAL_OUTPUT.exec(trimmed);
  if (output) {
    const body = output[2]?.trim() ?? '';
    return body ? appendSystem(state, ctx, 'local_command', body) : state;
  }
  if (meta && trimmed.startsWith('<')) return state;
  if (!trimmed && imageCount === 0) return state;

  const id = ev.uuid ?? `user-${ctx.seq}`;
  const item: UserItem = { kind: 'user', id, text, imageCount, synthetic: meta, ts: ctx.ts };
  const inFlight =
    ev.uuid && state.inFlightUserUuids.includes(ev.uuid)
      ? state.inFlightUserUuids.filter((u) => u !== ev.uuid)
      : state.inFlightUserUuids;
  const items = upsertItem(state.items, item, ctx.parentToolUseId);
  return { ...state, items, inFlightUserUuids: inFlight, turn: workingTurn(state) };
}

function appendSystem(state: TranscriptState, ctx: EventContext, subtype: string, text: string): TranscriptState {
  return {
    ...state,
    items: appendInScope(state.items, ctx.parentToolUseId, systemItem(ctx, subtype, text)),
    turn: workingTurn(state),
  };
}

function attachToolResults(state: TranscriptState, blocks: unknown[]): TranscriptState {
  let items = state.items;
  for (const block of blocks) {
    if (field(block, 'type') !== 'tool_result') continue;
    const toolUseId = optString(field(block, 'tool_use_id'));
    if (!toolUseId) continue;
    const isError = field(block, 'is_error') === true;
    const result = toolResultText(field(block, 'content'));
    const status: ToolItem['status'] = isError ? 'error' : 'done';
    items = updateItem(items, toolUseId, (t) => {
      if (t.kind !== 'tool') return t;
      if (t.status === status && t.isError === isError && t.result === result) return t;
      return { ...t, status, isError, result };
    });
  }
  const turn = workingTurn(state);
  if (items === state.items && turn === state.turn) return state;
  return { ...state, items, turn };
}

// ---------------------------------------------------------------------------
// assistant
// ---------------------------------------------------------------------------

export function reduceAssistant(state: TranscriptState, ev: AssistantEvent, ctx: EventContext): TranscriptState {
  const msgId = optString(ev.message?.id) || ctx.uuid || `seq${ctx.seq}`;
  const blocks: unknown[] = Array.isArray(ev.message?.content) ? ev.message.content : [];
  const scope = ctx.parentToolUseId ?? '';
  const scopes = state.streaming ?? {};
  const current = scopes[scope];
  // Claude Code sends one `assistant` event per content block, all with the same message id (the SDK
  // packs them into one event). The block index therefore continues from the blocks of this message
  // already finalized, so each final block replaces exactly its own partial.
  const same = current !== undefined && current.messageId === msgId;
  const base = same ? (current.finalized ?? 0) : 0;
  // A window that opened mid-stream gave its partials a placeholder message id: adopt them.
  const adopt = current !== undefined && !same && current.synthesized === true ? current : undefined;
  let items = state.items;
  blocks.forEach((block, i) => {
    const index = base + i;
    items = applyFinalBlock(items, block, `${msgId}:${index}`, msgId, ctx, adopt?.blocks[index]);
  });
  const error = optString(ev.error);
  if (error || ev.aborted === true) {
    items = appendInScope(items, ctx.parentToolUseId, {
      kind: 'error',
      id: `err-${ctx.uuid ?? ctx.seq}`,
      text: error ? `Assistant error: ${error}` : 'Request aborted',
      ts: ctx.ts,
    });
  }
  const streaming = {
    ...scopes,
    [scope]: { messageId: msgId, blocks: same ? current.blocks : {}, finalized: base + blocks.length },
  };
  return { ...state, items, streaming, turn: workingTurn(state) };
}

/** `replaceId`: a partial under a placeholder message id that this final block stands for. */
function applyFinalBlock(
  items: TranscriptItem[],
  block: unknown,
  id: string,
  messageId: string,
  ctx: EventContext,
  replaceId?: string,
): TranscriptItem[] {
  if (!isRecord(block)) return items;
  switch (block.type) {
    case 'text': {
      const text = optString(block.text) ?? '';
      const item: AssistantTextItem = {
        kind: 'assistant_text',
        id,
        messageId,
        text,
        partial: false,
        parentToolUseId: ctx.parentToolUseId,
        ts: ctx.ts,
      };
      return placeFinal(items, item, ctx.parentToolUseId, replaceId);
    }
    case 'thinking':
    case 'redacted_thinking': {
      const text = block.type === 'redacted_thinking' ? '[redacted]' : (optString(block.thinking) ?? '');
      const item: ThinkingItem = {
        kind: 'thinking',
        id,
        messageId,
        text,
        partial: false,
        parentToolUseId: ctx.parentToolUseId,
        ts: ctx.ts,
      };
      return placeFinal(items, item, ctx.parentToolUseId, replaceId);
    }
    case 'tool_use': {
      const toolId = optString(block.id) || id;
      const name = optString(block.name) || undefined;
      const input = isRecord(block.input) ? block.input : undefined;
      const existing = findItemIn(items, toolId);
      if (existing && existing.kind === 'tool') {
        return updateItem(items, toolId, (t) =>
          t.kind === 'tool'
            ? { ...t, name: name ?? t.name, input: input ?? t.input, inputPartial: undefined, ts: t.ts ?? ctx.ts }
            : t,
        );
      }
      const item: ToolItem = {
        kind: 'tool',
        id: toolId,
        name: name ?? 'tool',
        input: input ?? {},
        status: 'running',
        isError: false,
        parentToolUseId: ctx.parentToolUseId,
        children: [],
        ts: ctx.ts,
      };
      return appendInScope(items, ctx.parentToolUseId, item);
    }
    default:
      return items;
  }
}

/** A final text or thinking block replaces its partial (by id, or by the placeholder id), else appends; empty text never appends. */
function placeFinal(
  items: TranscriptItem[],
  item: AssistantTextItem | ThinkingItem,
  parentToolUseId: string | undefined,
  replaceId: string | undefined,
): TranscriptItem[] {
  if (replaceId && replaceId !== item.id && hasItem(items, replaceId)) return updateItem(items, replaceId, () => item);
  if (!item.text && !hasItem(items, item.id)) return items;
  return upsertItem(items, item, parentToolUseId);
}

// ---------------------------------------------------------------------------
// stream_event
// ---------------------------------------------------------------------------

export function reduceStreamEvent(state: TranscriptState, ev: StreamEventEvent, ctx: EventContext): TranscriptState {
  const e: unknown = ev.event;
  const turn = workingTurn(state);
  if (!isRecord(e) || typeof e.type !== 'string') return turn === state.turn ? state : { ...state, turn };
  const scope = ctx.parentToolUseId ?? '';
  const scopes = state.streaming ?? {};
  let items = state.items;
  let streaming = state.streaming;

  switch (e.type) {
    case 'message_start': {
      const messageId = optString(field(e.message, 'id')) || ctx.uuid || `seq${ctx.seq}`;
      streaming = { ...scopes, [scope]: { messageId, blocks: {} } };
      break;
    }
    case 'content_block_start': {
      const index = optNumber(e.index);
      if (index === undefined) break;
      const current: StreamScope = scopes[scope] ?? { messageId: ctx.uuid ?? `seq${ctx.seq}`, blocks: {}, synthesized: true };
      const started = startBlock(items, e.content_block, current.messageId, index, ctx);
      items = started.items;
      streaming = { ...scopes, [scope]: { ...current, blocks: { ...current.blocks, [index]: started.id } } };
      break;
    }
    case 'content_block_delta': {
      const index = optNumber(e.index);
      const itemId = index === undefined ? undefined : scopes[scope]?.blocks[index];
      if (!itemId) break;
      const delta = e.delta;
      items = updateItem(items, itemId, (it) => applyDelta(it, delta));
      break;
    }
    case 'content_block_stop': {
      const index = optNumber(e.index);
      const itemId = index === undefined ? undefined : scopes[scope]?.blocks[index];
      if (!itemId) break;
      items = updateItem(items, itemId, stopBlock);
      break;
    }
    case 'message_stop': {
      // A synthesized scope stays: its partials still wait for the final message to name them.
      const open = scopes[scope];
      if (open && open.synthesized !== true) streaming = withoutScope(scopes, scope);
      break;
    }
    default:
      break;
  }
  if (items === state.items && streaming === state.streaming && turn === state.turn) return state;
  return { ...state, items, streaming, turn };
}

function startBlock(
  items: TranscriptItem[],
  block: unknown,
  messageId: string,
  index: number,
  ctx: EventContext,
): { items: TranscriptItem[]; id: string } {
  const id = `${messageId}:${index}`;
  if (!isRecord(block)) return { items, id };
  switch (block.type) {
    case 'text': {
      const item: AssistantTextItem = {
        kind: 'assistant_text',
        id,
        messageId,
        text: optString(block.text) ?? '',
        partial: true,
        parentToolUseId: ctx.parentToolUseId,
        ts: ctx.ts,
      };
      return { items: upsertItem(items, item, ctx.parentToolUseId), id };
    }
    case 'thinking':
    case 'redacted_thinking': {
      const item: ThinkingItem = {
        kind: 'thinking',
        id,
        messageId,
        text: block.type === 'redacted_thinking' ? '[redacted]' : (optString(block.thinking) ?? ''),
        partial: true,
        parentToolUseId: ctx.parentToolUseId,
        ts: ctx.ts,
      };
      return { items: upsertItem(items, item, ctx.parentToolUseId), id };
    }
    case 'tool_use': {
      const toolId = optString(block.id) || id;
      const name = optString(block.name) || undefined;
      const existing = findItemIn(items, toolId);
      if (existing && existing.kind === 'tool') {
        const updated = updateItem(items, toolId, (t) => (t.kind === 'tool' && name && t.name !== name ? { ...t, name } : t));
        return { items: updated, id: toolId };
      }
      const item: ToolItem = {
        kind: 'tool',
        id: toolId,
        name: name ?? 'tool',
        input: isRecord(block.input) ? block.input : {},
        status: 'running',
        isError: false,
        parentToolUseId: ctx.parentToolUseId,
        children: [],
        ts: ctx.ts,
      };
      return { items: appendInScope(items, ctx.parentToolUseId, item), id: toolId };
    }
    default:
      return { items, id };
  }
}

function applyDelta(item: TranscriptItem, delta: unknown): TranscriptItem {
  if (!isRecord(delta)) return item;
  if (delta.type === 'text_delta' && item.kind === 'assistant_text' && typeof delta.text === 'string') {
    return { ...item, text: item.text + delta.text };
  }
  if (delta.type === 'thinking_delta' && item.kind === 'thinking' && typeof delta.thinking === 'string') {
    return { ...item, text: item.text + delta.thinking };
  }
  if (delta.type === 'input_json_delta' && item.kind === 'tool' && typeof delta.partial_json === 'string') {
    return { ...item, inputPartial: (item.inputPartial ?? '') + delta.partial_json };
  }
  return item;
}

function stopBlock(item: TranscriptItem): TranscriptItem {
  if ((item.kind === 'assistant_text' || item.kind === 'thinking') && item.partial) return { ...item, partial: false };
  if (item.kind === 'tool' && item.inputPartial !== undefined) {
    const raw = item.inputPartial.trim();
    if (!raw) return { ...item, inputPartial: undefined };
    const parsed = parseRecord(raw);
    return parsed ? { ...item, input: parsed, inputPartial: undefined } : item;
  }
  return item;
}

function parseRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(raw);
    return isRecord(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function withoutScope(scopes: Record<string, StreamScope>, scope: string): Record<string, StreamScope> | undefined {
  const rest: Record<string, StreamScope> = {};
  for (const [k, v] of Object.entries(scopes)) if (k !== scope) rest[k] = v;
  return Object.keys(rest).length > 0 ? rest : undefined;
}
