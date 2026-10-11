/**
 * The slash commands a Remote Control host runs locally when they arrive as plain user text,
 * plus the composer's helpers for detecting one and filtering the suggestion list.
 */
export interface SlashCommand {
  name: string;
  args?: string;
  description: string;
}

export const REMOTE_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Summarise the conversation so far to free context' },
  { name: 'clear', description: 'Clear the conversation history' },
  { name: 'context', description: 'Show what is using the context window' },
  { name: 'usage', description: 'Show plan usage and rate limits' },
  { name: 'recap', description: 'Summarise what happened in this session' },
  { name: 'model', args: '<name>', description: 'Switch the model for this session' },
  { name: 'effort', args: '<level>', description: 'Set reasoning effort (low, medium, high, max)' },
  { name: 'fast', description: 'Toggle fast mode' },
  { name: 'rename', args: '<title>', description: 'Rename this session' },
  { name: 'mcp', description: 'Show MCP server status' },
  { name: 'autocompact', args: '<size>', description: 'Set the context size that triggers auto compaction' },
];

const SLASH_RE = /^\/[a-z][\w-]*(?:\s|$)/i;

/** True when the text is a slash command: a leading slash followed by a word, then a space or the end. */
export function isSlashCommand(text: string): boolean {
  return SLASH_RE.test(text.trimStart());
}

/**
 * Commands matching the composer text. The query may carry the slash and trailing arguments;
 * only the first word counts. Prefix matches on the name come first, then substring matches.
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  const word = (query.trimStart().replace(/^\//, '').split(/\s+/)[0] ?? '').toLowerCase();
  if (!word) return [...REMOTE_SLASH_COMMANDS];
  const prefix = REMOTE_SLASH_COMMANDS.filter((c) => c.name.startsWith(word));
  const inner = REMOTE_SLASH_COMMANDS.filter((c) => !c.name.startsWith(word) && c.name.includes(word));
  return [...prefix, ...inner];
}
