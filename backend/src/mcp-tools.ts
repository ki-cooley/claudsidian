/**
 * MCP Tool Definitions for Vault Operations
 *
 * Defines the tools that the Claude agent can use to interact
 * with the Obsidian vault through the plugin.
 */

import type { VaultBridge } from './protocol.js';
import { logger, truncate } from './utils.js';

/**
 * Tool definition for Claude's tool_use
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool execution result
 */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

/**
 * Get all vault tool definitions
 */
export function getVaultToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'vault_read',
      description:
        'Read the content of a note from the vault. Returns the full markdown content including frontmatter. Use this before editing any existing note.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Path relative to vault root, e.g. "folder/note.md" or "note.md"',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'vault_write',
      description:
        'Write content to a note. Creates the file if it does not exist, overwrites if it does. Parent folders are created automatically. Always read a note first before overwriting it.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path relative to vault root',
          },
          content: {
            type: 'string',
            description: 'Full markdown content to write',
          },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'vault_edit',
      description:
        'Make precise edits to an existing note by replacing a specific string. More efficient than rewriting entire file. The old_string must match exactly (including whitespace).',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the note to edit',
          },
          old_string: {
            type: 'string',
            description: 'Exact text to find and replace (must be unique in file)',
          },
          new_string: {
            type: 'string',
            description: 'Text to replace it with',
          },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    {
      name: 'vault_search',
      description:
        'Search for notes by content or filename. Returns matching file paths with content snippets. Useful for finding relevant notes before reading them.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query - matches against filenames and content',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default: 20)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'vault_grep',
      description:
        'Search file contents using a regex pattern. More powerful than vault_search for pattern matching. Returns matching lines with context.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regular expression pattern to search for',
          },
          folder: {
            type: 'string',
            description: 'Folder to search in (empty for entire vault)',
          },
          file_pattern: {
            type: 'string',
            description: 'Glob pattern to filter files, e.g. "*.md" (default: all markdown files)',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default: 50)',
          },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'vault_glob',
      description:
        'Find files matching a glob pattern. Use this to discover files by name pattern, e.g. "**/*.md" for all markdown files, "projects/*.md" for markdown in projects folder.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern, e.g. "**/*.md", "daily/*.md", "projects/**/*"',
          },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'vault_list',
      description:
        'List files and folders in a directory. Use empty string or "/" for vault root.',
      input_schema: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Folder path relative to vault root, empty for root',
          },
        },
        required: [],
      },
    },
    {
      name: 'vault_rename',
      description:
        'Rename or move a note to a new path. Updates any internal links pointing to this file if possible.',
      input_schema: {
        type: 'object',
        properties: {
          old_path: {
            type: 'string',
            description: 'Current path of the note',
          },
          new_path: {
            type: 'string',
            description: 'New path for the note',
          },
        },
        required: ['old_path', 'new_path'],
      },
    },
    {
      name: 'vault_delete',
      description:
        'Delete a note from the vault. The file will be moved to system trash. Use with caution - always confirm with user first before deleting.',
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path of the note to delete',
          },
        },
        required: ['path'],
      },
    },
  ];
}

/**
 * Execute a vault tool with the given input
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
        return {
          content: content,
        };
      }

      case 'vault_write': {
        const path = input.path as string;
        const content = input.content as string;
        await bridge.write(path, content);
        return {
          content: `Successfully wrote ${content.length} characters to ${path}`,
        };
      }

      case 'vault_search': {
        const query = input.query as string;
        const limit = (input.limit as number) || 20;
        const results = await bridge.search(query, limit);

        if (results.length === 0) {
          return {
            content: 'No matching notes found.',
          };
        }

        const formatted = results
          .map((r) => `- ${r.path}: ${truncate(r.snippet, 100)}`)
          .join('\n');
        return {
          content: `Found ${results.length} result(s):\n${formatted}`,
        };
      }

      case 'vault_list': {
        const folder = (input.folder as string) || '';
        const items = await bridge.list(folder);

        if (items.length === 0) {
          return {
            content: folder
              ? `Folder "${folder}" is empty.`
              : 'Vault is empty.',
          };
        }

        const formatted = items
          .map((i) => `- ${i.type === 'folder' ? '📁' : '📄'} ${i.name}`)
          .join('\n');
        return {
          content: `Contents of ${folder || 'vault root'}:\n${formatted}`,
        };
      }

      case 'vault_delete': {
        const path = input.path as string;
        await bridge.delete(path);
        return {
          content: `Deleted ${path}`,
        };
      }

      case 'vault_edit': {
        const path = input.path as string;
        const oldString = input.old_string as string;
        const newString = input.new_string as string;
        await bridge.edit(path, oldString, newString);
        return {
          content: `Successfully edited ${path}`,
        };
      }

      case 'vault_grep': {
        const pattern = input.pattern as string;
        const folder = (input.folder as string) || '';
        const filePattern = (input.file_pattern as string) || '*.md';
        const limit = (input.limit as number) || 50;
        const results = await bridge.grep(pattern, folder, filePattern, limit);

        if (results.length === 0) {
          return {
            content: 'No matches found.',
          };
        }

        const formatted = results
          .map((r) => `${r.path}:${r.line}: ${truncate(r.content, 100)}`)
          .join('\n');
        return {
          content: `Found ${results.length} match(es):\n${formatted}`,
        };
      }

      case 'vault_glob': {
        const pattern = input.pattern as string;
        const files = await bridge.glob(pattern);

        if (files.length === 0) {
          return {
            content: 'No files matched the pattern.',
          };
        }

        const formatted = files.map((f) => `- ${f}`).join('\n');
        return {
          content: `Found ${files.length} file(s):\n${formatted}`,
        };
      }

      case 'vault_rename': {
        const oldPath = input.old_path as string;
        const newPath = input.new_path as string;
        await bridge.rename(oldPath, newPath);
        return {
          content: `Renamed ${oldPath} → ${newPath}`,
        };
      }

      default:
        return {
          content: `Unknown tool: ${toolName}`,
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Tool ${toolName} failed:`, message);
    return {
      content: `Error: ${message}`,
      isError: true,
    };
  }
}
