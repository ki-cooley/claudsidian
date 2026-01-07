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
