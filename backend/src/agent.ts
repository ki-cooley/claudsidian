/**
 * Claude Agent Integration
 *
 * Implements the agent using the Claude Agent SDK's query() function,
 * which handles the tool execution loop automatically.
 *
 * Optimizations:
 * - System prompt cached with 5-minute TTL (avoids 4+ vault RPCs per conversation)
 * - Multi-turn uses SDK session resume (skips system prompt rebuild)
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createVaultMcpServer } from './vault-tools.js';
import { logger, AsyncQueue } from './utils.js';
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
- Search the web for current information (WebSearch) - useful for looking up documentation, news, or any external information

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

## Cookbook Research Tools
When the user asks about cooking techniques, recipes, ingredients, or food science:
- Use search_cookbooks to find information in their cookbook collection
- ALWAYS include exact citations from the results: source book name, page numbers, and section
- When the user asks about a specific book, use the \`sources\` parameter to filter: sources="The Professional Chef"
- For multiple specific sources: sources="ChefSteps, Modernist Cuisine"
- **CRITICAL: Citation format rules — copy these EXACTLY as they appear in tool results:**
  - PDF citations start with \`[[cookbooks/filename.pdf#page=N]]\` — this is an Obsidian wikilink that opens the PDF to the exact page. You MUST include this exact text in your response for every PDF citation. Example: \`[[cookbooks/CIA professional chef.pdf#page=304]] CIA professional chef, pp. 285-286\`
  - ChefSteps citations use markdown links like \`[ChefSteps: title](https://...)\` — preserve these as-is
  - Do NOT rewrite, summarize, or strip the \`[[...]]\` wikilinks — they are clickable deep links
- Include multiple sources when available for a comprehensive answer
- Quote key passages directly when they're particularly informative

## Response Style
- Be concise but helpful
- Explain what changes you're making
- When citing cookbook sources, always include the exact page numbers and preserve any links from the tool results
- If uncertain, ask for clarification
- When integrating research results, present the final synthesis — avoid restating the same finding in multiple formats within one response
- For complex multi-topic research, work in batches of 5-8 tool calls at a time rather than launching dozens in parallel. Complete one batch, synthesize results, then proceed to the next batch.

## Memory Management
You have a persistent memory file (.claude/memory.md) loaded into your context.
- After learning user preferences, project context, or important decisions, use vault_edit or vault_write to update .claude/memory.md
- Keep it concise (<500 words), organized with ## headings
- Sections: ## User Preferences, ## Projects, ## Key Decisions, ## Conventions
- Don't store conversation-specific details — only persistent knowledge`;

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
    const skillFiles = await bridge.glob('.claude/skills/*.md');

    for (const skillPath of skillFiles) {
      try {
        const content = await bridge.read(skillPath);
        const filename = skillPath.split('/').pop() || skillPath;
        const name = filename.replace(/\.md$/, '');

        let description = `Custom skill: ${name}`;
        const lines = content.split('\n');
        if (lines[0]?.startsWith('# ')) {
          description = lines[0].replace('# ', '').trim();
        } else if (lines[0]?.startsWith('---')) {
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
    logger.debug('No .claude/skills/ directory found');
  }

  return skills;
}

/**
 * Build the full system prompt, including CLAUDE.md content and custom skills
 */
async function buildSystemPrompt(bridge: VaultBridge): Promise<string> {
  let systemPrompt = BASE_SYSTEM_PROMPT;

  try {
    const claudeMd = await bridge.read('CLAUDE.md');
    if (claudeMd && claudeMd.trim()) {
      systemPrompt += `\n\n## Vault-Specific Instructions (from CLAUDE.md)\n\n${claudeMd}`;
      logger.info('Loaded CLAUDE.md from vault root');
    }
  } catch (e) {
    logger.debug('No CLAUDE.md found in vault root');
  }

  try {
    const instructions = await bridge.read('.claude/instructions.md');
    if (instructions && instructions.trim()) {
      systemPrompt += `\n\n## Additional Instructions (from .claude/instructions.md)\n\n${instructions}`;
      logger.info('Loaded .claude/instructions.md');
    }
  } catch (e) {
    // .claude/instructions.md doesn't exist, that's fine
  }

  try {
    const memory = await bridge.read('.claude/memory.md');
    if (memory && memory.trim()) {
      systemPrompt += `\n\n## Persistent Memory\n\nThis is your long-term memory from past conversations. Use it for context continuity:\n\n${memory}`;
      logger.info('Loaded .claude/memory.md');
    }
  } catch (e) {
    logger.debug('No .claude/memory.md found');
  }

  const skills = await loadSkills(bridge);
  if (skills.length > 0) {
    systemPrompt += `\n\n## Custom Skills\n\nThe user has defined the following custom skills. When they reference a skill by name (e.g., "run the weekly-review skill" or "/weekly-review"), follow the instructions in that skill:\n\n`;
    for (const skill of skills) {
      systemPrompt += `### Skill: ${skill.name}\n${skill.description}\n\n\`\`\`\n${skill.content}\n\`\`\`\n\n`;
    }
  }

  return systemPrompt;
}

// ============================================================================
// System Prompt Cache
// ============================================================================

const SYSTEM_PROMPT_TTL_MS = 5 * 60 * 1000; // 5 minutes
let systemPromptCache: { prompt: string; builtAt: number } | null = null;

/**
 * Get system prompt, using cache if fresh (within TTL).
 * Avoids 4+ vault RPCs per new conversation.
 */
async function getCachedSystemPrompt(bridge: VaultBridge): Promise<string> {
  if (systemPromptCache && (Date.now() - systemPromptCache.builtAt) < SYSTEM_PROMPT_TTL_MS) {
    logger.info('Using cached system prompt (age: ' +
      Math.round((Date.now() - systemPromptCache.builtAt) / 1000) + 's)');
    return systemPromptCache.prompt;
  }
  const prompt = await buildSystemPrompt(bridge);
  systemPromptCache = { prompt, builtAt: Date.now() };
  logger.info('Built and cached system prompt');
  return prompt;
}

/** Force-invalidate the cache (e.g., after the agent edits CLAUDE.md) */
export function invalidateSystemPromptCache(): void {
  systemPromptCache = null;
  logger.info('System prompt cache invalidated');
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-7';
const MAX_TURNS = 50; // Complex research queries can use 30-40+ tool calls
const INACTIVITY_TIMEOUT_MS = 600_000; // 10 minutes of no activity = dead

/**
 * Strip MCP prefix from tool names for cleaner display.
 * e.g., "mcp__vault-tools__vault_read" -> "vault_read"
 *       "mcp__cookbook-research__search_cookbooks" -> "search_cookbooks"
 */
function cleanToolName(name: string): string {
  const match = name.match(/^mcp__[^_]+__(.+)$/);
  return match ? match[1] : name;
}

/**
 * Run the agent with streaming responses using the Claude Agent SDK
 */
/** Return type includes the captured SDK session ID for multi-turn */
export interface AgentRunResult {
  sdkSessionId?: string;
}

export async function* runAgent(
  prompt: string,
  bridge: VaultBridge,
  context?: AgentContext,
  signal?: AbortSignal,
  customSystemPrompt?: string,
  model?: string,
  images?: Array<{ mimeType: string; base64Data: string }>,
  /** If set, resume this SDK session (multi-turn follow-up) */
  resumeSessionId?: string,
  /** Callback to capture the SDK session ID from the first response */
  onSdkSessionId?: (id: string) => void,
  /** If set, use streaming input for interrupts/asides; otherwise single-prompt mode */
  inputQueue?: AsyncQueue<any>,
): AsyncGenerator<AgentEvent> {
  const selectedModel = model || DEFAULT_MODEL;
  logger.info(`Using model: ${selectedModel}`);

  // Shared event queue — tool handlers push tool_end events here
  const eventQueue: AgentEvent[] = [];

  // Activity tracker — updated by vault tool handlers, SDK iterator messages, and stderr
  const activity = { lastTs: Date.now() };
  const heartbeat = () => { activity.lastTs = Date.now(); };

  const vaultServer = createVaultMcpServer(bridge, eventQueue, heartbeat);

  // AbortController for the SDK (forward external signal)
  const abortController = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => abortController.abort());
  }

  // Build system prompt with CLAUDE.md context (only on first turn;
  // on resume, the SDK already has the system prompt from the prior session)
  let systemPrompt: string | undefined;
  if (!resumeSessionId) {
    systemPrompt = await getCachedSystemPrompt(bridge);
    if (customSystemPrompt?.trim()) {
      systemPrompt = `${customSystemPrompt.trim()}\n\n${systemPrompt}`;
    }
  }

  // Build context-aware prompt
  let fullPrompt = prompt;
  if (context?.currentFile) {
    fullPrompt = `[Currently viewing: ${context.currentFile}]\n\n${fullPrompt}`;
  }
  if (context?.selection) {
    fullPrompt = `[Selected text: "${context.selection}"]\n\n${fullPrompt}`;
  }

  // Build MCP server configs: vault tools (in-process) + external servers from env
  const mcpServers: Record<string, unknown> = { 'vault-tools': vaultServer };
  try {
    const externalServers = JSON.parse(process.env.MCP_SERVERS || '{}');
    Object.assign(mcpServers, externalServers);
  } catch (e) {
    logger.error('Failed to parse MCP_SERVERS env var:', e);
  }

  // Build allowed tools list — all MCP tools + web search
  const allowedTools: string[] = Object.keys(mcpServers).map(name => `mcp__${name}__*`);
  allowedTools.push('WebSearch');

  // Streaming input mode (required for mcpServers)
  // Build the user message. When images are present, use multimodal content blocks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMessage: any = { role: 'user', content: fullPrompt };
  if (images && images.length > 0) {
    userMessage.content = [
      ...images.map((img) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType,
          data: img.base64Data,
        },
      })),
      { type: 'text', text: fullPrompt },
    ];
  }

  /**
   * Input stream generator: either single-prompt or streaming (for interrupts/asides)
   *
   * If inputQueue is provided, messages are yielded as they're pushed to the queue.
   * The queue stays open for the entire agent lifetime, allowing new user messages
   * to be injected mid-turn (asides) or to signal interrupts.
   *
   * If inputQueue is not provided, a single user message is yielded and then the
   * stream ends (backward-compatible single-prompt mode).
   */
  async function* inputStream() {
    if (!inputQueue) {
      // Single-prompt mode (backward compatible)
      logger.info('Using single-prompt mode (no inputQueue provided)');
      yield {
        type: 'user' as const,
        message: userMessage,
        parent_tool_use_id: null,
        session_id: '',
      };
      return;
    }

    // Streaming input mode: push initial message and listen for more
    logger.info('Using streaming input mode for interrupts/asides');

    // Enqueue the initial user message
    inputQueue.push({
      type: 'user' as const,
      message: userMessage,
      parent_tool_use_id: null,
      session_id: '',
    });

    // Listen for new messages pushed to the queue (asides/interrupts)
    for await (const message of inputQueue) {
      yield message;
    }
  }

  // Track tools that have been started but not yet ended
  // (vault tools push their own tool_end via eventQueue; external MCP tools don't)
  const pendingTools: string[] = [];

  // Track if the agent completed successfully so we can suppress the
  // "process exited with code 1" error the SDK throws after completion
  let completedSuccessfully = false;

  function* drainToolEvents(): Generator<AgentEvent> {
    while (eventQueue.length > 0) {
      const event = eventQueue.shift()!;
      // Remove from pending if this is a tool_end for a tracked tool
      if (event.type === 'tool_end') {
        const idx = pendingTools.indexOf(event.name);
        if (idx >= 0) pendingTools.splice(idx, 1);
      }
      yield event;
    }
  }

  function* closePendingTools(): Generator<AgentEvent> {
    // Emit synthetic tool_end for any tools that didn't get one
    // (external MCP tools handled internally by the SDK)
    while (pendingTools.length > 0) {
      const name = pendingTools.shift()!;
      yield { type: 'tool_end', name, result: '' };
    }
  }

  // Periodic inactivity check — aborts agent if no activity for INACTIVITY_TIMEOUT_MS
  const activityCheck = setInterval(() => {
    const elapsed = Date.now() - activity.lastTs;
    if (elapsed > INACTIVITY_TIMEOUT_MS) {
      logger.error(`No activity for ${Math.round(elapsed / 1000)}s — aborting agent`);
      abortController.abort();
    }
  }, 15_000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (activityCheck as any).unref?.();

  try {
    if (resumeSessionId) {
      logger.info(`Resuming SDK session: ${resumeSessionId}`);
    }

    const queryStream = query({
      prompt: inputStream(),
      options: {
        model: selectedModel,
        ...(systemPrompt ? { systemPrompt } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mcpServers: mcpServers as Record<string, any>,
        allowedTools,
        maxTurns: MAX_TURNS,
        abortController,
        permissionMode: 'bypassPermissions' as const,
        includePartialMessages: true,
        thinking: { type: 'adaptive' },
        // Multi-turn: resume a prior SDK session
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        stderr: (data: string) => {
          heartbeat(); // stderr output = activity
          logger.warn(`CLI stderr: ${data.trimEnd()}`);
        },
      },
    });

    // The Agent SDK strips thinking blocks — it handles them internally and
    // only forwards text/tool events. Emit a synthetic "thinking" event so
    // the UI can show a thinking indicator during the wait for first content.
    let emittedSyntheticThinking = false;

    for await (const message of queryStream) {
      heartbeat(); // SDK yielded a message = alive

      // Drain tool_end events pushed by vault tool handlers
      yield* drainToolEvents();

      // Emit synthetic thinking event on the first SDK message (system/init)
      // so the UI immediately shows a thinking indicator.
      if (!emittedSyntheticThinking) {
        emittedSyntheticThinking = true;
        yield { type: 'thinking' as const, text: '' };
      }

      switch (message.type) {
        case 'stream_event': {
          // New content block starting = previous turn's tools are done
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((message as any).event?.type === 'content_block_start') {
            yield* closePendingTools();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const block = (message as any).event?.content_block;
            if (block?.type === 'thinking') {
              logger.info('[Thinking] Block started');
            }
          }

          // Stream text and thinking deltas in real time
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((message as any).event?.type === 'content_block_delta') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const delta = (message as any).event?.delta;
            if (delta?.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text };
            } else if (delta?.type === 'thinking_delta') {
              logger.info(`[Thinking] delta: ${(delta.thinking || '').substring(0, 80)}...`);
              yield { type: 'thinking', text: delta.thinking };
            }
          }
          break;
        }

        case 'assistant': {
          // Close any pending tools from the previous turn
          yield* closePendingTools();

          // Capture SDK session ID for multi-turn support
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (onSdkSessionId && (message as any).session_id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onSdkSessionId((message as any).session_id);
            onSdkSessionId = undefined; // Only capture once
          }

          // Emit tool_start for each tool_use block (with full input)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const block of (message as any).message.content) {
            if (block.type === 'tool_use') {
              const name = cleanToolName(block.name);
              pendingTools.push(name);
              yield {
                type: 'tool_start',
                name,
                input: block.input as Record<string, unknown>,
              };
            }
          }
          break;
        }

        case 'result': {
          // Close any remaining pending tools
          yield* drainToolEvents();
          yield* closePendingTools();

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((message as any).subtype === 'success') {
            completedSuccessfully = true;
            logger.info('Agent completed successfully');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            yield { type: 'complete', result: (message as any).result || '' };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } else if ((message as any).subtype === 'error_max_turns') {
            completedSuccessfully = true; // Partial result is still valid
            logger.warn(`Agent hit max turns limit (${MAX_TURNS})`);
            // Send any partial result, then add a note about the truncation
            yield { type: 'text_delta', text: '\n\n---\n*Response was truncated because the query required too many steps. You can ask me to continue where I left off.*\n' };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            yield { type: 'complete', result: (message as any).result || '' };
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errors = 'errors' in message ? (message as any).errors : [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            logger.error(`Agent stopped: ${(message as any).subtype}`, errors);
            yield {
              type: 'error',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              code: (message as any).subtype,
              message: errors?.join(', ') || 'Agent SDK error',
            };
          }
          break;
        }

        default:
          break;
      }
    }
  } catch (err) {
    // Close any pending tools so the UI doesn't show stuck "running" states
    yield* drainToolEvents();
    yield* closePendingTools();

    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    const errStack = err instanceof Error ? err.stack : '';

    // The SDK throws "process exited with code 1" after the agent has already
    // completed successfully. Suppress this spurious error.
    if (completedSuccessfully && errMsg.includes('exited with code')) {
      logger.warn(`Ignoring post-completion SDK error: ${errMsg}`);
    } else {
      logger.error('Agent error:', errMsg);
      logger.error('Agent error stack:', errStack);
      yield {
        type: 'error',
        code: 'AGENT_ERROR',
        message: errMsg,
      };
    }
  } finally {
    clearInterval(activityCheck);
  }
}
