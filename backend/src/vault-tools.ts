/**
 * Vault Tool Definitions for Claude Agent SDK
 *
 * Defines vault tools using the Agent SDK's tool() + createSdkMcpServer()
 * pattern with Zod schemas for input validation.
 */

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { logger, truncate } from './utils.js';
import type { VaultBridge, AgentEvent } from './protocol.js';

/**
 * Tool execution result (kept for mock-agent.ts compatibility)
 */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

/**
 * Execute a vault tool by name (used by mock-agent.ts)
 */
export async function executeVaultTool(
  toolName: string,
  input: Record<string, unknown>,
  bridge: VaultBridge
): Promise<ToolResult> {
  logger.debug(`Executing tool: ${toolName}`, input);

  try {
    switch (toolName) {
      case 'vault_read': {
        const path = input.path as string;
        const content = await bridge.read(path);
        return { content };
      }

      case 'vault_write': {
        const path = input.path as string;
        const content = input.content as string;
        await bridge.write(path, content);
        return { content: `Successfully wrote ${content.length} characters to ${path}` };
      }

      case 'vault_edit': {
        const path = input.path as string;
        const oldString = input.old_string as string;
        const newString = input.new_string as string;
        await bridge.edit(path, oldString, newString);
        return { content: `Successfully edited ${path}` };
      }

      case 'vault_search': {
        const query = input.query as string;
        const limit = (input.limit as number) || 20;
        const results = await bridge.search(query, limit);
        if (results.length === 0) return { content: 'No matching notes found.' };
        const formatted = results
          .map((r) => `- ${r.path}: ${truncate(r.snippet, 100)}`)
          .join('\n');
        return { content: `Found ${results.length} result(s):\n${formatted}` };
      }

      case 'vault_grep': {
        const pattern = input.pattern as string;
        const folder = (input.folder as string) || '';
        const filePattern = (input.file_pattern as string) || '*.md';
        const limit = (input.limit as number) || 50;
        const results = await bridge.grep(pattern, folder, filePattern, limit);
        if (results.length === 0) return { content: 'No matches found.' };
        const formatted = results
          .map((r) => `${r.path}:${r.line}: ${truncate(r.content, 100)}`)
          .join('\n');
        return { content: `Found ${results.length} match(es):\n${formatted}` };
      }

      case 'vault_glob': {
        const pattern = input.pattern as string;
        const files = await bridge.glob(pattern);
        if (files.length === 0) return { content: 'No files matched the pattern.' };
        const formatted = files.map((f) => `- ${f}`).join('\n');
        return { content: `Found ${files.length} file(s):\n${formatted}` };
      }

      case 'vault_list': {
        const folder = (input.folder as string) || '';
        const items = await bridge.list(folder);
        if (items.length === 0) {
          return { content: folder ? `Folder "${folder}" is empty.` : 'Vault is empty.' };
        }
        const formatted = items
          .map((i) => `- ${i.type === 'folder' ? '📁' : '📄'} ${i.name}`)
          .join('\n');
        return { content: `Contents of ${folder || 'vault root'}:\n${formatted}` };
      }

      case 'vault_rename': {
        const oldPath = input.old_path as string;
        const newPath = input.new_path as string;
        await bridge.rename(oldPath, newPath);
        return { content: `Renamed ${oldPath} → ${newPath}` };
      }

      case 'vault_delete': {
        const path = input.path as string;
        await bridge.delete(path);
        return { content: `Deleted ${path}` };
      }

      default:
        return { content: `Unknown tool: ${toolName}`, isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Tool ${toolName} failed:`, message);
    return { content: `Error: ${message}`, isError: true };
  }
}

/**
 * Create an SDK MCP server with all vault tools bound to a VaultBridge.
 * Tool handlers push tool_end events to the shared queue for the agent generator.
 */
export function createVaultMcpServer(bridge: VaultBridge, eventQueue: AgentEvent[]) {
  return createSdkMcpServer({
    name: 'vault-tools',
    version: '1.0.0',
    tools: [
      tool(
        'vault_read',
        'Read the content of a note from the vault. Returns the full markdown content including frontmatter. Use this before editing any existing note.',
        {
          path: z.string().describe('Path relative to vault root, e.g. "folder/note.md" or "note.md"'),
        },
        async (args) => {
          const content = await bridge.read(args.path);
          eventQueue.push({ type: 'tool_end', name: 'vault_read', result: content });
          return { content: [{ type: 'text' as const, text: content }] };
        }
      ),

      tool(
        'vault_write',
        'Write content to a note. Creates the file if it does not exist, overwrites if it does. Parent folders are created automatically. Always read a note first before overwriting it.',
        {
          path: z.string().describe('Path relative to vault root'),
          content: z.string().describe('Full markdown content to write'),
        },
        async (args) => {
          await bridge.write(args.path, args.content);
          const result = `Successfully wrote ${args.content.length} characters to ${args.path}`;
          eventQueue.push({ type: 'tool_end', name: 'vault_write', result });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      tool(
        'vault_edit',
        'Make precise edits to an existing note by replacing a specific string. More efficient than rewriting entire file. The old_string must match exactly (including whitespace).',
        {
          path: z.string().describe('Path to the note to edit'),
          old_string: z.string().describe('Exact text to find and replace (must be unique in file)'),
          new_string: z.string().describe('Text to replace it with'),
        },
        async (args) => {
          await bridge.edit(args.path, args.old_string, args.new_string);
          const result = `Successfully edited ${args.path}`;
          eventQueue.push({ type: 'tool_end', name: 'vault_edit', result });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      tool(
        'vault_search',
        'Search for notes by content or filename. Returns matching file paths with content snippets. Useful for finding relevant notes before reading them.',
        {
          query: z.string().describe('Search query - matches against filenames and content'),
          limit: z.number().optional().describe('Maximum results to return (default: 20)'),
        },
        async (args) => {
          const limit = args.limit ?? 20;
          const results = await bridge.search(args.query, limit);
          let result: string;
          if (results.length === 0) {
            result = 'No matching notes found.';
          } else {
            const formatted = results
              .map((r) => `- ${r.path}: ${truncate(r.snippet, 100)}`)
              .join('\n');
            result = `Found ${results.length} result(s):\n${formatted}`;
          }
          eventQueue.push({ type: 'tool_end', name: 'vault_search', result });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      tool(
        'vault_grep',
        'Search file contents using a regex pattern. More powerful than vault_search for pattern matching. Returns matching lines with context.',
        {
          pattern: z.string().describe('Regular expression pattern to search for'),
          folder: z.string().optional().describe('Folder to search in (empty for entire vault)'),
          file_pattern: z.string().optional().describe('Glob pattern to filter files, e.g. "*.md" (default: all markdown files)'),
          limit: z.number().optional().describe('Maximum results to return (default: 50)'),
        },
        async (args) => {
          const folder = args.folder || '';
          const filePattern = args.file_pattern || '*.md';
          const limit = args.limit ?? 50;
          const results = await bridge.grep(args.pattern, folder, filePattern, limit);
          let result: string;
          if (results.length === 0) {
            result = 'No matches found.';
          } else {
            const formatted = results
              .map((r) => `${r.path}:${r.line}: ${truncate(r.content, 100)}`)
              .join('\n');
            result = `Found ${results.length} match(es):\n${formatted}`;
          }
          eventQueue.push({ type: 'tool_end', name: 'vault_grep', result });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      tool(
        'vault_glob',
        'Find files matching a glob pattern. Use this to discover files by name pattern, e.g. "**/*.md" for all markdown files, "projects/*.md" for markdown in projects folder.',
        {
          pattern: z.string().describe('Glob pattern, e.g. "**/*.md", "daily/*.md", "projects/**/*"'),
        },
        async (args) => {
          const files = await bridge.glob(args.pattern);
          let result: string;
          if (files.length === 0) {
            result = 'No files matched the pattern.';
          } else {
            const formatted = files.map((f) => `- ${f}`).join('\n');
            result = `Found ${files.length} file(s):\n${formatted}`;
          }
          eventQueue.push({ type: 'tool_end', name: 'vault_glob', result });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      tool(
        'vault_list',
        'List files and folders in a directory. Use empty string or "/" for vault root.',
        {
          folder: z.string().optional().describe('Folder path relative to vault root, empty for root'),
        },
        async (args) => {
          const folder = args.folder || '';
          const items = await bridge.list(folder);
          let result: string;
          if (items.length === 0) {
            result = folder ? `Folder "${folder}" is empty.` : 'Vault is empty.';
          } else {
            const formatted = items
              .map((i) => `- ${i.type === 'folder' ? '📁' : '📄'} ${i.name}`)
              .join('\n');
            result = `Contents of ${folder || 'vault root'}:\n${formatted}`;
          }
          eventQueue.push({ type: 'tool_end', name: 'vault_list', result });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      tool(
        'vault_rename',
        'Rename or move a note to a new path. Updates any internal links pointing to this file if possible.',
        {
          old_path: z.string().describe('Current path of the note'),
          new_path: z.string().describe('New path for the note'),
        },
        async (args) => {
          await bridge.rename(args.old_path, args.new_path);
          const result = `Renamed ${args.old_path} → ${args.new_path}`;
          eventQueue.push({ type: 'tool_end', name: 'vault_rename', result });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),

      tool(
        'vault_delete',
        'Delete a note from the vault. The file will be moved to system trash. Use with caution - always confirm with user first before deleting.',
        {
          path: z.string().describe('Path of the note to delete'),
        },
        async (args) => {
          await bridge.delete(args.path);
          const result = `Deleted ${args.path}`;
          eventQueue.push({ type: 'tool_end', name: 'vault_delete', result });
          return { content: [{ type: 'text' as const, text: result }] };
        }
      ),
    ],
  });
}
