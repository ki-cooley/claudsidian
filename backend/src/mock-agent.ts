/**
 * Mock Agent for Testing
 *
 * Simulates Claude's behavior for testing the WebSocket server
 * and RPC protocol without making real API calls.
 */

import { logger } from './utils.js';
import type {
  VaultBridge,
  AgentContext,
  AgentEvent,
} from './protocol.js';
import { executeVaultTool } from './mcp-tools.js';

const MOCK_DELAY_MS = 50; // Delay between streaming chunks

/**
 * Sleep helper for simulating streaming delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simulate streaming text by yielding character by character
 */
async function* streamText(
  text: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const words = text.split(' ');
  for (const word of words) {
    if (signal?.aborted) return;
    yield word + ' ';
    await sleep(MOCK_DELAY_MS);
  }
}

/**
 * Mock agent scenarios based on user input
 */
interface MockScenario {
  response: string;
  tools?: Array<{
    name: string;
    input: Record<string, unknown>;
  }>;
  followUp?: string;
}

function getMockScenario(prompt: string): MockScenario {
  const promptLower = prompt.toLowerCase();

  // Test tool: vault_list
  if (promptLower.includes('list') || promptLower.includes('show files')) {
    return {
      response: "I'll list the files in your vault for you.",
      tools: [{ name: 'vault_list', input: { folder: '' } }],
      followUp: 'Here are the files I found in your vault root.',
    };
  }

  // Test tool: vault_search
  if (promptLower.includes('search') || promptLower.includes('find')) {
    const match = prompt.match(/(?:search|find)\s+(?:for\s+)?["']?([^"']+)["']?/i);
    const query = match?.[1] || 'test';
    return {
      response: `I'll search your vault for "${query}".`,
      tools: [{ name: 'vault_search', input: { query, limit: 10 } }],
      followUp: 'Here are the search results.',
    };
  }

  // Test tool: vault_read
  if (promptLower.includes('read') || promptLower.includes('open') || promptLower.includes('show me')) {
    const match = prompt.match(/(?:read|open|show me)\s+["']?([^"'\s]+\.md)["']?/i);
    const path = match?.[1] || 'test.md';
    return {
      response: `I'll read the contents of "${path}" for you.`,
      tools: [{ name: 'vault_read', input: { path } }],
      followUp: 'Here is the content of the file.',
    };
  }

  // Test tool: vault_write
  if (promptLower.includes('create') || promptLower.includes('write') || promptLower.includes('new note')) {
    const pathMatch = prompt.match(/(?:create|write|new note)\s+["']?([^"'\s]+\.md)["']?/i);
    const path = pathMatch?.[1] || 'new-note.md';
    return {
      response: `I'll create a new note at "${path}".`,
      tools: [{
        name: 'vault_write',
        input: {
          path,
          content: `# New Note\n\nThis is a test note created by the mock agent.\n\nCreated: ${new Date().toISOString()}\n`,
        },
      }],
      followUp: `Successfully created the note at "${path}".`,
    };
  }

  // Test tool: vault_delete (with warning)
  if (promptLower.includes('delete') || promptLower.includes('remove')) {
    const match = prompt.match(/(?:delete|remove)\s+["']?([^"'\s]+\.md)["']?/i);
    const path = match?.[1] || 'test.md';
    return {
      response: `⚠️ Are you sure you want to delete "${path}"? This will move it to trash. For this mock test, I'll proceed with the deletion.`,
      tools: [{ name: 'vault_delete', input: { path } }],
      followUp: `The file "${path}" has been moved to trash.`,
    };
  }

  // Test multiple tools
  if (promptLower.includes('multi') || promptLower.includes('several')) {
    return {
      response: "I'll demonstrate using multiple tools in sequence.",
      tools: [
        { name: 'vault_list', input: { folder: '' } },
        { name: 'vault_search', input: { query: 'test', limit: 5 } },
      ],
      followUp: 'I used multiple tools to gather information from your vault.',
    };
  }

  // Default: simple response without tools
  return {
    response: `Hello! I'm the mock Obsidian assistant. I received your message: "${prompt}"\n\nI can help you with:\n- **list files** - List vault contents\n- **search [query]** - Search your notes\n- **read [file.md]** - Read a note\n- **create [file.md]** - Create a new note\n- **delete [file.md]** - Delete a note\n- **multi** - Test multiple tools\n\nTry one of these commands to see the mock tools in action!`,
  };
}

/**
 * Run the mock agent with simulated streaming responses
 */
export async function* runMockAgent(
  prompt: string,
  bridge: VaultBridge,
  context?: AgentContext,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  logger.info('[MOCK] Running mock agent');

  // Build context-aware prompt for logging
  let fullPrompt = prompt;
  if (context?.currentFile) {
    fullPrompt = `[Currently viewing: ${context.currentFile}]\n\n${prompt}`;
    logger.debug(`[MOCK] Context - current file: ${context.currentFile}`);
  }
  if (context?.selection) {
    fullPrompt = `[Selected text: "${context.selection}"]\n\n${fullPrompt}`;
    logger.debug(`[MOCK] Context - selection: ${context.selection}`);
  }

  const scenario = getMockScenario(prompt);

  // Stream the initial response
  for await (const chunk of streamText(scenario.response, signal)) {
    if (signal?.aborted) {
      yield { type: 'complete', result: 'Cancelled by user' };
      return;
    }
    yield { type: 'text_delta', text: chunk };
  }

  // Execute tools if any
  if (scenario.tools && scenario.tools.length > 0) {
    for (const tool of scenario.tools) {
      if (signal?.aborted) {
        yield { type: 'complete', result: 'Cancelled by user' };
        return;
      }

      yield {
        type: 'tool_start',
        name: tool.name,
        input: tool.input,
      };

      // Actually execute the tool via RPC to the plugin
      const result = await executeVaultTool(tool.name, tool.input, bridge);

      yield {
        type: 'tool_end',
        name: tool.name,
        result: result.content,
      };

      await sleep(100);
    }

    // Stream follow-up response after tools
    if (scenario.followUp) {
      yield { type: 'text_delta', text: '\n\n' };
      for await (const chunk of streamText(scenario.followUp, signal)) {
        if (signal?.aborted) {
          yield { type: 'complete', result: 'Cancelled by user' };
          return;
        }
        yield { type: 'text_delta', text: chunk };
      }
    }
  }

  // Complete
  const finalText = scenario.followUp
    ? `${scenario.response}\n\n${scenario.followUp}`
    : scenario.response;
  yield { type: 'complete', result: finalText };
}
