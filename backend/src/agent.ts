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
import { logger } from './utils.js';
import type {
  VaultBridge,
  AgentContext,
  AgentEvent,
} from './protocol.js';

const SYSTEM_PROMPT = `You are an Obsidian note-editing assistant. You help users create, edit, search, and organize their notes in their Obsidian vault.

## Capabilities
- Read notes from the vault
- Write/create notes
- Search across the vault
- List files and folders
- Delete notes (ask for confirmation first)

## Guidelines
1. When editing existing notes, ALWAYS read them first to understand current content
2. Preserve existing formatting and structure unless asked to change it
3. Use proper Obsidian markdown:
   - [[wikilinks]] for internal links
   - #tags for categorization
   - YAML frontmatter for metadata
4. When creating new notes, suggest appropriate folder locations
5. For destructive operations (delete, overwrite), confirm with the user first
6. If a search returns no results, suggest alternative search terms

## Response Style
- Be concise but helpful
- Explain what changes you're making
- If uncertain, ask for clarification`;

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
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
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const client = new Anthropic();
  const tools = getVaultToolDefinitions();
  const messages: ConversationMessage[] = [];

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
      const stream = await client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: tools as Anthropic.Tool[],
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

          const result = await executeVaultTool(
            toolUse.name,
            toolUse.input,
            bridge
          );

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
