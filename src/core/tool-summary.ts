/**
 * One-line summaries, categories and diff extraction for Claude Code tool calls, for the tool
 * cards in the transcript. Pure string work over the tool_use input; never renders HTML.
 */
export type ToolCategory = 'read' | 'write' | 'shell' | 'search' | 'agent' | 'web' | 'mcp' | 'other';

export function toolCategory(name: string): ToolCategory {
  if (name.startsWith('mcp__')) return 'mcp';
  switch (name) {
    case 'Read':
    case 'NotebookRead':
    case 'LS':
      return 'read';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'write';
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
    case 'KillBash':
      return 'shell';
    case 'Grep':
    case 'Glob':
      return 'search';
    case 'Agent':
    case 'Task':
      return 'agent';
    case 'WebFetch':
    case 'WebSearch':
      return 'web';
    default:
      return 'other';
  }
}

/**
 * "Read menus/x.md", "Bash: npm test", "Edit recipes/tare.md". Paths are shown relative to
 * `cwd` (the session's init cwd) when given, otherwise as the tool received them.
 */
export function summarizeTool(name: string, input: Record<string, unknown>, cwd?: string): string {
  const path = (key: string): string | undefined => relativePath(str(input[key]), cwd);
  switch (name) {
    case 'Read': {
      const p = path('file_path');
      return p ? `Read ${p}${lineRange(input)}` : 'Read';
    }
    case 'Edit':
      return withPath('Edit', path('file_path'));
    case 'MultiEdit': {
      const n = Array.isArray(input.edits) ? input.edits.length : 0;
      return `${withPath('Edit', path('file_path'))}${n > 0 ? ` (${n} edit${n === 1 ? '' : 's'})` : ''}`;
    }
    case 'Write':
      return withPath('Write', path('file_path'));
    case 'NotebookEdit':
      return withPath('Edit', path('notebook_path'));
    case 'Bash': {
      const command = str(input.command);
      return command ? `Bash: ${firstLine(command)}` : 'Bash';
    }
    case 'Grep': {
      const pattern = str(input.pattern);
      const p = path('path');
      return `Grep${pattern ? ` "${pattern}"` : ''}${p ? ` in ${p}` : ''}`;
    }
    case 'Glob': {
      const pattern = str(input.pattern);
      const p = path('path');
      return `Glob${pattern ? ` ${pattern}` : ''}${p ? ` in ${p}` : ''}`;
    }
    case 'Agent':
    case 'Task': {
      const description = str(input.description);
      if (description) return `Agent: ${firstLine(description)}`;
      const type = str(input.subagent_type);
      return type ? `Agent (${type})` : 'Agent';
    }
    case 'WebFetch': {
      const url = str(input.url);
      return url ? `Fetch ${url}` : 'Fetch';
    }
    case 'WebSearch': {
      const query = str(input.query);
      return query ? `Search "${query}"` : 'Search';
    }
    case 'TodoWrite':
      return `Update todos (${Array.isArray(input.todos) ? input.todos.length : 0})`;
    case 'AskUserQuestion':
      return 'Ask a question';
    case 'EnterPlanMode':
      return 'Enter plan mode';
    case 'ExitPlanMode':
      return 'Exit plan mode';
    case 'Skill': {
      const skill = str(input.skill) ?? str(input.command);
      return skill ? `Skill: ${skill}` : 'Skill';
    }
    default: {
      if (name.startsWith('mcp__')) {
        const [, server, ...rest] = name.split('__');
        return rest.length > 0 ? `${server}: ${rest.join('__')}` : name;
      }
      const hint = ['file_path', 'path', 'pattern', 'command', 'query', 'url']
        .map((k) => relativePath(str(input[k]), cwd))
        .find((v): v is string => !!v);
      return hint ? `${name} ${firstLine(hint)}` : name;
    }
  }
}

/** Old and new text for Edit, Write, MultiEdit and NotebookEdit inputs; null for anything else. */
export function editDiff(input: Record<string, unknown>): { path: string; oldText: string; newText: string } | null {
  const path = str(input.file_path) ?? str(input.notebook_path);
  if (!path) return null;
  if (typeof input.old_string === 'string' || typeof input.new_string === 'string') {
    return { path, oldText: str(input.old_string) ?? '', newText: str(input.new_string) ?? '' };
  }
  if (Array.isArray(input.edits)) {
    const edits = input.edits.filter(
      (e): e is Record<string, unknown> => typeof e === 'object' && e !== null && !Array.isArray(e),
    );
    return {
      path,
      oldText: edits.map((e) => str(e.old_string) ?? '').join('\n\n'),
      newText: edits.map((e) => str(e.new_string) ?? '').join('\n\n'),
    };
  }
  if (typeof input.content === 'string') return { path, oldText: '', newText: input.content };
  if (typeof input.new_source === 'string') return { path, oldText: '', newText: input.new_source };
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function withPath(verb: string, p: string | undefined): string {
  return p ? `${verb} ${p}` : verb;
}

/** First non-empty line, with a count of the lines left out. */
function firstLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const head = lines[0] ?? '';
  return lines.length > 1 ? `${head} (+${lines.length - 1} lines)` : head;
}

function lineRange(input: Record<string, unknown>): string {
  const offset = typeof input.offset === 'number' ? input.offset : undefined;
  const limit = typeof input.limit === 'number' ? input.limit : undefined;
  if (offset !== undefined && limit !== undefined) return ` (lines ${offset}-${offset + limit - 1})`;
  if (offset !== undefined) return ` (from line ${offset})`;
  if (limit !== undefined) return ` (first ${limit} lines)`;
  return '';
}

function relativePath(p: string | undefined, cwd: string | undefined): string | undefined {
  if (!p) return undefined;
  if (!cwd) return p;
  const base = cwd.replace(/\/+$/, '');
  if (p === base) return '.';
  return p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p;
}
