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

export const MAX_FILE_SUGGESTIONS = 6;

/** Folders whose notes rank after everything else: archives, templates, Obsidian's own files, the trash. */
const DEMOTED_RE = /(^|\/)(_archived|archived|archive|templates|_templates|\.obsidian|\.trash)\//i;

export function isDemotedPath(path: string): boolean {
  return DEMOTED_RE.test(path);
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/** "menus/latitude 10/menu.md" as { dir: "menus/latitude 10/", name: "menu.md" } for a two-tone row. */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i >= 0 ? { dir: path.slice(0, i + 1), name: path.slice(i + 1) } : { dir: '', name: path };
}

/**
 * What the popup ranks over. Built once when the popup opens (the composer caches it) so a
 * keystroke only filters an array instead of walking the vault again.
 */
export interface SuggestCandidates {
  /** every markdown path in the vault */
  all: string[];
  /** recently opened paths, newest first */
  recent?: string[];
  /** the active note, whose folder siblings rank after the recent files */
  activeNotePath?: string;
}

interface Scored {
  path: string;
  demoted: number;
  match: number;
  recent: number;
  sibling: number;
}

/**
 * Case-insensitive substring matches, at most MAX_FILE_SUGGESTIONS. Archived, template and
 * hidden-folder paths always rank last. With an empty query: recently opened files first (newest
 * first), then the active note's folder siblings, then the rest alphabetically. With a query:
 * basename-prefix matches, then basename matches, then directory matches; recent files and
 * siblings first within each group; alphabetical by path after that.
 */
export function filterFiles(candidates: string[] | SuggestCandidates, query: string): string[] {
  const c: SuggestCandidates = Array.isArray(candidates) ? { all: candidates } : candidates;
  const q = query.toLowerCase();
  const recentRank = new Map<string, number>();
  (c.recent ?? []).forEach((path, i) => {
    if (!recentRank.has(path)) recentRank.set(path, i);
  });
  const activeDir = c.activeNotePath !== undefined ? dirname(c.activeNotePath) : undefined;
  const scored: Scored[] = [];
  const seen = new Set<string>();
  for (const path of c.all) {
    if (seen.has(path) || path === c.activeNotePath) continue;
    seen.add(path);
    const lower = path.toLowerCase();
    if (q !== '' && !lower.includes(q)) continue;
    const name = basename(lower);
    const match = q === '' ? 0 : name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
    const recent = recentRank.get(path);
    scored.push({
      path,
      demoted: isDemotedPath(path) ? 1 : 0,
      match,
      recent: recent === undefined ? Number.MAX_SAFE_INTEGER : recent,
      sibling: activeDir !== undefined && dirname(path) === activeDir ? 0 : 1,
    });
  }
  scored.sort((a, b) => a.demoted - b.demoted || a.match - b.match || a.recent - b.recent || a.sibling - b.sibling || a.path.localeCompare(b.path));
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
