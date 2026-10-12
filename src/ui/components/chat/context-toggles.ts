/**
 * Per-screen switches over the captured context (the chips), seeded from settings, and the
 * context block they produce for one outgoing message.
 */
import { formatContextBlock } from '../../../core/context-format';
import type { CapturedContext } from '../../../core/types';
import type { ContextSettings } from '../../../settings';

export type ContextToggles = { note: boolean; selection: boolean; cursor: boolean; open: boolean; mentions: boolean };

export function defaultToggles(settings: ContextSettings): ContextToggles {
  return {
    note: settings.includeActiveNote,
    selection: settings.includeSelection,
    cursor: settings.includeCursor,
    open: settings.includeOpenNotes,
    mentions: true,
  };
}

/** The captured context with the switched-off parts removed. */
export function applyToggles(ctx: CapturedContext, t: ContextToggles): CapturedContext {
  const out: CapturedContext = { vaultName: ctx.vaultName, openNotes: t.open ? ctx.openNotes : [], mentions: t.mentions ? ctx.mentions : [] };
  if (t.note && ctx.activeNote) {
    out.activeNote = t.cursor ? { ...ctx.activeNote } : { path: ctx.activeNote.path };
  }
  if (t.selection && ctx.selection) out.selection = { ...ctx.selection };
  return out;
}

export interface ContextBlockOptions {
  vaultPathOnMac: string;
  sessionCwd?: string;
}

/** The "[Obsidian context]" block for one message, or undefined when nothing is switched on. */
export function contextTextFor(ctx: CapturedContext, toggles: ContextToggles, opts: ContextBlockOptions): string | undefined {
  const block = formatContextBlock(applyToggles(ctx, toggles), opts);
  return block || undefined;
}

/** True when the context has anything a chip could show. */
export function hasContext(ctx: CapturedContext | null): ctx is CapturedContext {
  return !!ctx && (!!ctx.activeNote || !!ctx.selection || ctx.openNotes.length > 0 || ctx.mentions.length > 0);
}

/** The chips row exists only for an open note: without one there is nothing worth a toggle. */
export function showsChips(ctx: CapturedContext | null): ctx is CapturedContext {
  return !!ctx && !!ctx.activeNote;
}
