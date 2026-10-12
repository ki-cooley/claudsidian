/**
 * Paths the way the reader knows them: vault-relative first (the vault path from settings), then
 * session-relative (the init cwd), then `~/` for anything else under a home directory. Also the
 * one-line Bash cleanup (a leading `cd "<dir>" && ` carries nothing in a ledger row) and the
 * tool summary the cards share, built on core/tool-summary.
 */
import { summarizeTool } from '../../../../core/tool-summary';
import type { ToolItem } from '../../../../core/types';

export type PathRoots = readonly string[];

/** Trailing slashes dropped, blanks and duplicates removed, order kept (first root wins). */
export function pathRoots(...candidates: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    const base = (c ?? '').replace(/\/+$/, '');
    if (base && !out.includes(base)) out.push(base);
  }
  return out;
}

const HOME = /^\/Users\/[^/]+(?=\/|$)/;

/** One absolute path made relative to the first matching root, else `~/...` for a home path, else as given. */
export function relativizePath(path: string, roots: PathRoots): string {
  for (const root of roots) {
    const base = root.replace(/\/+$/, '');
    if (!base) continue;
    if (path === base) return '.';
    if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  }
  const home = HOME.exec(path);
  if (home) return path.length === home[0].length ? '~' : `~${path.slice(home[0].length)}`;
  return path;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every root prefix (and every `/Users/<name>/`) inside free text shortened the same way, in place. */
export function relativizeText(text: string, roots: PathRoots): string {
  let out = text;
  for (const root of roots) {
    const base = root.replace(/\/+$/, '');
    if (!base) continue;
    // A path starts the text or follows a separator; never cut through a longer path or word.
    out = out.replace(new RegExp(`(^|[^\\w/.-])${escapeRegExp(base)}/`, 'g'), '$1');
  }
  return out.replace(/(^|[^\w/.-])\/Users\/[^/\s"']+\//g, '$1~/');
}

const CD_PREFIX = /^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/;

/** `cd "/some/dir" && npm test` reads `npm test`; a bare `cd` stays. */
export function stripCdPrefix(command: string): string {
  const m = CD_PREFIX.exec(command);
  if (!m) return command;
  const rest = command.slice(m[0].length);
  return rest.trim() ? rest : command;
}

/** The ledger-row summary: core's one-liner with the cd prefix dropped and every path relativised. */
export function toolSummary(name: string, input: Record<string, unknown>, roots: PathRoots): string {
  const command = input.command;
  const prepared = name === 'Bash' && typeof command === 'string' ? { ...input, command: stripCdPrefix(command) } : input;
  return relativizeText(summarizeTool(name, prepared), roots);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** "Reading prep-rd-2026-10-18.md", "Running bash": what the working line says under a running tool. */
export function workingLabel(item: ToolItem, roots: PathRoots): string {
  const input = item.input;
  const path = (key: string): string | undefined => {
    const p = str(input[key]);
    return p ? relativizePath(p, roots) : undefined;
  };
  const withPath = (verb: string, p: string | undefined): string => (p ? `${verb} ${p}` : verb);
  switch (item.name) {
    case 'Read':
    case 'NotebookRead':
      return withPath('Reading', path('file_path') ?? path('notebook_path'));
    case 'Edit':
    case 'MultiEdit':
      return withPath('Editing', path('file_path'));
    case 'NotebookEdit':
      return withPath('Editing', path('notebook_path'));
    case 'Write':
      return withPath('Writing', path('file_path'));
    case 'Bash':
    case 'BashOutput':
      return 'Running bash';
    case 'Grep':
    case 'Glob':
      return 'Searching';
    case 'Agent':
    case 'Task': {
      const description = str(input.description);
      return description ? `Running agent: ${description.split('\n')[0]?.trim() ?? ''}` : 'Running agent';
    }
    case 'WebFetch':
      return 'Fetching a page';
    case 'WebSearch':
      return 'Searching the web';
    case 'AskUserQuestion':
      return 'Asking a question';
    default: {
      if (item.name.startsWith('mcp__')) {
        const server = item.name.split('__')[1];
        return server ? `Running ${server}` : 'Running a tool';
      }
      return `Running ${item.name}`;
    }
  }
}
