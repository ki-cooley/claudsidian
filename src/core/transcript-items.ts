/**
 * Immutable helpers over the transcript item tree. Tool items nest subagent traffic in
 * `children`, so lookups and updates walk that nesting and return the same array when
 * nothing changed. Also the small coercions the reducers share over untrusted wire data.
 */
import type { SystemItem, ToolItem, TranscriptItem } from './types';

/** Per-row facts the reducers need beyond the payload itself. */
export interface EventContext {
  seq: number;
  ts?: number;
  uuid?: string;
  parentToolUseId?: string;
}

export function findItemIn(items: TranscriptItem[], id: string): TranscriptItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.kind === 'tool' && item.children.length > 0) {
      const hit = findItemIn(item.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function hasItem(items: TranscriptItem[], id: string): boolean {
  return findItemIn(items, id) !== undefined;
}

/** Apply fn to the item with `id` wherever it sits. Same array when it is missing or fn returns it unchanged. */
export function updateItem(
  items: TranscriptItem[],
  id: string,
  fn: (item: TranscriptItem) => TranscriptItem,
): TranscriptItem[] {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.id === id) {
      const next = fn(item);
      if (next === item) return items;
      const copy = items.slice();
      copy[i] = next;
      return copy;
    }
    if (item.kind === 'tool' && item.children.length > 0) {
      const children = updateItem(item.children, id, fn);
      if (children !== item.children) {
        const copy = items.slice();
        copy[i] = { ...item, children };
        return copy;
      }
    }
  }
  return items;
}

/** Stand-in for an Agent call whose tool_use is outside the loaded window but whose traffic is not. */
export function placeholderTool(id: string, children: TranscriptItem[], ts?: number): ToolItem {
  return { kind: 'tool', id, name: 'Agent', input: {}, status: 'running', isError: false, children, ts };
}

/** Append at the top level, or under the parent tool item (created as a placeholder when missing). */
export function appendInScope(
  items: TranscriptItem[],
  parentToolUseId: string | undefined,
  item: TranscriptItem,
): TranscriptItem[] {
  if (!parentToolUseId) return [...items, item];
  const parent = findItemIn(items, parentToolUseId);
  if (parent && parent.kind === 'tool') {
    return updateItem(items, parentToolUseId, (p) => (p.kind === 'tool' ? { ...p, children: [...p.children, item] } : p));
  }
  if (parent) return [...items, item];
  return [...items, placeholderTool(parentToolUseId, [item], item.ts)];
}

/** Replace the item with the same id in place, else append in scope. */
export function upsertItem(
  items: TranscriptItem[],
  item: TranscriptItem,
  parentToolUseId: string | undefined,
): TranscriptItem[] {
  if (hasItem(items, item.id)) return updateItem(items, item.id, () => item);
  return appendInScope(items, parentToolUseId, item);
}

/** Close every partial text or thinking item at any depth. Same array when none was open. */
export function finalizePartials(items: TranscriptItem[]): TranscriptItem[] {
  let out = items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    let next = item;
    if ((item.kind === 'assistant_text' || item.kind === 'thinking') && item.partial) {
      next = { ...item, partial: false };
    } else if (item.kind === 'tool' && item.children.length > 0) {
      const children = finalizePartials(item.children);
      if (children !== item.children) next = { ...item, children };
    }
    if (next !== item) {
      if (out === items) out = items.slice();
      out[i] = next;
    }
  }
  return out;
}

export function lastItem(items: TranscriptItem[]): TranscriptItem | undefined {
  return items[items.length - 1];
}

export function systemItem(ctx: EventContext, subtype: string, text: string): SystemItem {
  return { kind: 'system', id: `sys-${ctx.uuid ?? ctx.seq}`, subtype, text, ts: ctx.ts };
}

// ---------------------------------------------------------------------------
// Coercions over untrusted wire data
// ---------------------------------------------------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A property of an unknown value, or undefined when it is not an object. */
export function field(v: unknown, key: string): unknown {
  return isRecord(v) ? v[key] : undefined;
}

export function optString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function optNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Text blocks joined by newlines; other block types contribute nothing. */
export function textOfBlocks(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (field(b, 'type') !== 'text') continue;
    const text = field(b, 'text');
    if (typeof text === 'string') parts.push(text);
  }
  return parts.join('\n');
}

export function countImages(blocks: unknown[]): number {
  return blocks.filter((b) => field(b, 'type') === 'image').length;
}

/** Tool result content for display: strings as-is, arrays as their text blocks with non-text noted. */
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      const type = field(b, 'type');
      if (type === 'text') return optString(field(b, 'text')) ?? '';
      if (type === 'image') return '[image]';
      return typeof type === 'string' ? `[${type}]` : '';
    })
    .join('\n');
}
