/**
 * Formats the "[Obsidian context]" block appended to outgoing user text (spec section 6), so the
 * same message reads identically in claude.ai/code, the terminal, and this plugin.
 */
import type { CapturedContext } from './types';

export interface FormatContextOptions {
  /** absolute path of the vault on the Mac that runs the session (settings.vaultPathOnMac) */
  vaultPathOnMac: string;
  /** cwd from the session's init event; undefined when the loaded history has no init */
  sessionCwd?: string;
}

const HEADER = '[Obsidian context]';
const FENCE = '"""';

function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, '');
}

/** True when the session already runs inside the vault, so relative paths resolve without help. */
function cwdIsVault(opts: FormatContextOptions): boolean {
  if (!opts.sessionCwd) return false;
  return stripTrailingSlash(opts.sessionCwd) === stripTrailingSlash(opts.vaultPathOnMac);
}

function mention(path: string): string {
  return path.startsWith('@') ? path : `@${path}`;
}

/** Build the context block, omitting lines whose data is missing. Returns '' when there is nothing to say. */
export function formatContextBlock(ctx: CapturedContext, opts: FormatContextOptions): string {
  const lines: string[] = [];

  if (ctx.activeNote) {
    const cursor = ctx.activeNote.cursorLine !== undefined ? ` (cursor line ${ctx.activeNote.cursorLine})` : '';
    lines.push(`active note: ${ctx.activeNote.path}${cursor}`);
  }

  if (ctx.selection && ctx.selection.text.length > 0) {
    const { fromLine, toLine, text, truncated } = ctx.selection;
    const range = fromLine === toLine ? `line ${fromLine}` : `lines ${fromLine}-${toLine}`;
    lines.push(`selection (${range}):`, FENCE, text);
    if (truncated) lines.push('[truncated]');
    lines.push(FENCE);
  }

  if (ctx.openNotes.length > 0) lines.push(`open notes: ${ctx.openNotes.join(', ')}`);
  if (ctx.mentions.length > 0) lines.push(`mentioned: ${ctx.mentions.map(mention).join(', ')}`);

  if (lines.length === 0) return '';

  // The vault line only earns its place when the session cannot resolve relative paths by itself.
  const head = cwdIsVault(opts) ? [] : [`vault: ${ctx.vaultName} (${stripTrailingSlash(opts.vaultPathOnMac)})`];
  return [HEADER, ...head, ...lines].join('\n');
}

/** User text followed by a blank line and the context block; the text alone when the block is empty. */
export function composeOutgoingText(userText: string, contextBlock: string): string {
  const text = userText.trimEnd();
  if (!contextBlock) return text;
  if (!text) return contextBlock;
  return `${text}\n\n${contextBlock}`;
}
