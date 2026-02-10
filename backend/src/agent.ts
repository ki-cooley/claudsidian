/**
 * Claude Agent Integration
 *
 * Implements the agent loop using the Anthropic SDK with streaming
 * and tool use support for vault operations.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  getVaultToolDefinitions,
  executeVaultTool,
  type ToolDefinition,
} from './mcp-tools.js';
import { mcpClientManager } from './mcp-client.js';
import { logger } from './utils.js';
import type {
  VaultBridge,
  AgentContext,
  AgentEvent,
} from './protocol.js';

const BASE_SYSTEM_PROMPT = `You are an Obsidian note-editing assistant. You help users create, edit, search, and organize their notes in their Obsidian vault.

## Capabilities
- Read notes from the vault
- Write/create notes
- Edit notes with precise string replacement (vault_edit)
- Search across the vault (vault_search for text, vault_grep for regex patterns)
- Find files by pattern (vault_glob)
- List files and folders
- Rename/move notes (vault_rename)
- Delete notes (ask for confirmation first)
- Search the web for current information (web_search) - useful for looking up documentation, news, or any external information

## Guidelines
1. When editing existing notes, ALWAYS read them first to understand current content
2. Use vault_edit for small precise changes - it's more efficient than rewriting the whole file
3. Preserve existing formatting and structure unless asked to change it
4. Use proper Obsidian markdown:
   - [[wikilinks]] for internal links
   - #tags for categorization
   - YAML frontmatter for metadata
5. When creating new notes, suggest appropriate folder locations
6. For destructive operations (delete, overwrite), confirm with the user first
7. If a search returns no results, suggest alternative search terms or use vault_grep with regex

## Response Style
- Be concise but helpful
- Explain what changes you're making
- If uncertain, ask for clarification`;

interface Skill {
  name: string;
  description: string;
  content: string;
}

/**
 * Load custom skills from .claude/skills/ directory
 */
async function loadSkills(bridge: VaultBridge): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    // Try to list files in .claude/skills/
    const skillFiles = await bridge.glob('.claude/skills/*.md');

    for (const skillPath of skillFiles) {
      try {
        const content = await bridge.read(skillPath);
        // Extract skill name from filename (e.g., "weekly-review.md" -> "weekly-review")
        const filename = skillPath.split('/').pop() || skillPath;
        const name = filename.replace(/\.md$/, '');

        // Try to extract description from first line or frontmatter
        let description = `Custom skill: ${name}`;
        const lines = content.split('\n');
        if (lines[0]?.startsWith('# ')) {
          description = lines[0].replace('# ', '').trim();
        } else if (lines[0]?.startsWith('---')) {
          // Try to parse YAML frontmatter for description
          const frontmatterEnd = content.indexOf('---', 4);
          if (frontmatterEnd > 0) {
            const frontmatter = content.substring(4, frontmatterEnd);
            const descMatch = frontmatter.match(/description:\s*(.+)/);
            if (descMatch) {
              description = descMatch[1].trim();
            }
          }
        }

        skills.push({ name, description, content });
        logger.info(`Loaded skill: ${name}`);
      } catch (e) {
        logger.warn(`Failed to load skill from ${skillPath}:`, e);
      }
    }
  } catch (e) {
    // .claude/skills/ doesn't exist, that's fine
    logger.debug('No .claude/skills/ directory found');
  }

  return skills;
}

/**
 * Build the full system prompt, including CLAUDE.md content and custom skills
 */
async function buildSystemPrompt(bridge: VaultBridge): Promise<string> {
  let systemPrompt = BASE_SYSTEM_PROMPT;

  // Try to read CLAUDE.md from vault root for project-specific context
  try {
    const claudeMd = await bridge.read('CLAUDE.md');
    if (claudeMd && claudeMd.trim()) {
      systemPrompt += `\n\n## Vault-Specific Instructions (from CLAUDE.md)\n\n${claudeMd}`;
      logger.info('Loaded CLAUDE.md from vault root');
    }
  } catch (e) {
    // CLAUDE.md doesn't exist, that's fine
    logger.debug('No CLAUDE.md found in vault root');
  }

  // Also check for .claude/instructions.md as an alternative location
  try {
    const instructions = await bridge.read('.claude/instructions.md');
    if (instructions && instructions.trim()) {
      systemPrompt += `\n\n## Additional Instructions (from .claude/instructions.md)\n\n${instructions}`;
      logger.info('Loaded .claude/instructions.md');
    }
  } catch (e) {
    // .claude/instructions.md doesn't exist, that's fine
  }

  // Load custom skills
  const skills = await loadSkills(bridge);
  if (skills.length > 0) {
    systemPrompt += `\n\n## Custom Skills\n\nThe user has defined the following custom skills. When they reference a skill by name (e.g., "run the weekly-review skill" or "/weekly-review"), follow the instructions in that skill:\n\n`;
    for (const skill of skills) {
      systemPrompt += `### Skill: ${skill.name}\n${skill.description}\n\n\`\`\`\n${skill.content}\n\`\`\`\n\n`;
    }
  }

  return systemPrompt;
}

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5-20251101';
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 10; // Prevent infinite tool loops

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | Anthropic.ContentBlock[];
}

/**
 * Run the agent with streaming responses
 */
export async function* runAgent(
  prompt: string,
  bridge: VaultBridge,
  context?: AgentContext,
  signal?: AbortSignal,
  customSystemPrompt?: string,
  model?: string
): AsyncGenerator<AgentEvent> {
  const selectedModel = model || DEFAULT_MODEL;
  logger.info(`Using model: ${selectedModel}`);
  const client = new Anthropic();

  // Combine vault tools with MCP tools and built-in web search tool
  const vaultTools = getVaultToolDefinitions();
  const mcpTools = mcpClientManager.getToolDefinitions();
  const tools: (Anthropic.Tool | { type: string; name: string; max_uses?: number })[] = [
    ...vaultTools as Anthropic.Tool[],
    ...mcpTools as Anthropic.Tool[],
    // Built-in web search tool - requires type and name fields
    { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
  ];

  if (mcpTools.length > 0) {
    logger.info(`Including ${mcpTools.length} MCP tool(s): ${mcpTools.map(t => t.name).join(', ')}`);
  }

  const messages: ConversationMessage[] = [];

  // Build system prompt with CLAUDE.md context
  let systemPrompt = await buildSystemPrompt(bridge);

  // Prepend custom system prompt if provided (from user settings)
  if (customSystemPrompt && customSystemPrompt.trim()) {
    systemPrompt = `${customSystemPrompt.trim()}\n\n${systemPrompt}`;
  }

  // Build context-aware prompt
  let fullPrompt = prompt;
  if (context?.currentFile) {
    fullPrompt = `[Currently viewing: ${context.currentFile}]\n\n${prompt}`;
  }
  if (context?.selection) {
    fullPrompt = `[Selected text: "${context.selection}"]\n\n${fullPrompt}`;
  }

  messages.push({ role: 'user', content: fullPrompt });

  let iteration = 0;
  let continueLoop = true;

  while (continueLoop && iteration < MAX_ITERATIONS) {
    if (signal?.aborted) {
      yield { type: 'complete', result: 'Cancelled by user' };
      return;
    }

    iteration++;
    logger.debug(`Agent iteration ${iteration}`);

    try {
      // Create streaming request
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await client.messages.stream({
        model: selectedModel,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        tools: tools as any, // Mix of Anthropic.Tool and built-in tool types
        messages: messages as Anthropic.MessageParam[],
      });

      let currentText = '';
      const toolUses: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];

      // Process streaming events
      for await (const event of stream) {
        if (signal?.aborted) {
          yield { type: 'complete', result: 'Cancelled by user' };
          return;
        }

        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if ('text' in delta && delta.text) {
            currentText += delta.text;
            yield { type: 'text_delta', text: delta.text };
          } else if ('partial_json' in delta) {
            // Tool input is being streamed - we'll handle it when complete
          }
        } else if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            toolUses.push({
              id: block.id,
              name: block.name,
              input: {},
            });
          }
        } else if (event.type === 'message_delta') {
          // Message is complete
        }
      }

      // Get the final message to extract complete tool inputs
      const finalMessage = await stream.finalMessage();

      // Build assistant message content
      const assistantContent: Anthropic.ContentBlock[] = [];

      for (const block of finalMessage.content) {
        if (block.type === 'text') {
          assistantContent.push(block);
        } else if (block.type === 'tool_use') {
          assistantContent.push(block);
          // Update tool input from final message
          const toolUse = toolUses.find((t) => t.id === block.id);
          if (toolUse) {
            toolUse.input = block.input as Record<string, unknown>;
          } else {
            toolUses.push({
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            });
          }
        }
      }

      // Add assistant message to history
      messages.push({ role: 'assistant', content: assistantContent });

      // Check if we need to execute tools
      if (finalMessage.stop_reason === 'tool_use' && toolUses.length > 0) {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUses) {
          if (signal?.aborted) {
            yield { type: 'complete', result: 'Cancelled by user' };
            return;
          }

          yield {
            type: 'tool_start',
            name: toolUse.name,
            input: toolUse.input,
          };

          // Route to MCP client or vault tool handler
          const result = mcpClientManager.hasTool(toolUse.name)
            ? await mcpClientManager.callTool(toolUse.name, toolUse.input)
            : await executeVaultTool(toolUse.name, toolUse.input, bridge);

          yield {
            type: 'tool_end',
            name: toolUse.name,
            result: result.content,
          };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.content,
            is_error: result.isError,
          });
        }

        // Add tool results to messages
        messages.push({ role: 'user', content: toolResults as unknown as string });

        // Continue the loop to get the next response
        continueLoop = true;
      } else {
        // Agent is done
        continueLoop = false;
        yield { type: 'complete', result: currentText };
      }
    } catch (err) {
      logger.error('Agent error:', err);

      if (err instanceof Anthropic.APIError) {
        yield {
          type: 'error',
          code: `API_ERROR_${err.status}`,
          message: err.message,
        };
      } else {
        yield {
          type: 'error',
          code: 'AGENT_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        };
      }
      return;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    yield {
      type: 'error',
      code: 'MAX_ITERATIONS',
      message: 'Agent reached maximum iterations limit',
    };
  }
}
