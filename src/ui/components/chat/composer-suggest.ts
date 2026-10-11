/**
 * Pure helpers behind the composer's popups: which token sits under the caret (an @path or a
 * leading /command) and how vault files are ranked for a query.
 */
import type { SlashCommand } from '../../../core/slash-commands';

export interface MentionToken {
  kind: 'mention';
  query: string;
  /** index of the @ */
  start: number;
  /** caret position */
  end: number;
}

export interface SlashToken {
  kind: 'slash';
  query: string;
  /** end of the command word (the caret) */
  end: number;
}

export type ComposerToken = MentionToken | SlashToken;

const MENTION_RE = /(^|[\s([{"'])@([^\s@]*)$/;
const SLASH_RE = /^\/([A-Za-z0-9_-]*)$/;

/** The popup-worthy token ending at the caret, if any. An @ glued to a word (an email) is not one. */
export function tokenAt(text: string, caret: number): ComposerToken | null {
  const before = text.slice(0, caret);
  const slash = SLASH_RE.exec(before);
  if (slash) return { kind: 'slash', query: slash[1] ?? '', end: caret };
  const mention = MENTION_RE.exec(before);
  if (mention) {
    const query = mention[2] ?? '';
    return { kind: 'mention', query, start: caret - query.length - 1, end: caret };
  }
  return null;
}

export const MAX_FILE_SUGGESTIONS = 8;

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Case-insensitive substring matches, at most MAX_FILE_SUGGESTIONS: files whose basename starts
 * with the query first, then basenames containing it, then matches only in the directory part;
 * alphabetical by path within a group.
 */
export function filterFiles(paths: string[], query: string): string[] {
  const q = query.toLowerCase();
  const scored: { path: string; rank: number }[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (!lower.includes(q)) continue;
    const name = basename(lower);
    const rank = q === '' ? 1 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
    scored.push({ path, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  return scored.slice(0, MAX_FILE_SUGGESTIONS).map((s) => s.path);
}

/** Replace the @token with the picked path and a trailing space. Returns the new text and caret. */
export function insertMention(text: string, token: MentionToken, path: string): { text: string; caret: number } {
  const inserted = `@${path} `;
  return { text: text.slice(0, token.start) + inserted + text.slice(token.end), caret: token.start + inserted.length };
}

/** Replace the leading /word with the command and a space, keeping whatever followed it. */
export function insertSlash(text: string, token: SlashToken, command: SlashCommand): { text: string; caret: number } {
  const inserted = `/${command.name} `;
  return { text: inserted + text.slice(token.end).trimStart(), caret: inserted.length };
}

/** Mentions still present in the text (the user may have deleted one by hand). */
export function keepMentions(text: string, mentions: string[]): string[] {
  return mentions.filter((m) => text.includes(`@${m}`));
}

/** One line for a slash command row. */
export function describeSlash(c: SlashCommand): string {
  return `/${c.name}${c.args ? ` ${c.args}` : ''}  ${c.description}`;
}
