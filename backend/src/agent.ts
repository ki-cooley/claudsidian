/**
 * Claude Agent Integration
 *
 * Implements the agent using the Claude Agent SDK's query() function,
 * which handles the tool execution loop automatically.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { createVaultMcpServer } from './vault-tools.js';
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

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-6';
const MAX_TURNS = 25; // Complex cookbook queries need many tool calls
const INACTIVITY_TIMEOUT_MS = 600_000; // 10 minutes of no activity = dead

/**
 * Strip MCP prefix from tool names for cleaner display.
 * e.g., "mcp__vault-tools__vault_read" → "vault_read"
 *       "mcp__cookbook-research__search_cookbooks" → "search_cookbooks"
 */
function cleanToolName(name: string): string {
  const match = name.match(/^mcp__[^_]+__(.+)$/);
  return match ? match[1] : name;
}

/**
 * Run the agent with streaming responses using the Claude Agent SDK
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

  // Build system prompt with CLAUDE.md context
  let systemPrompt = await buildSystemPrompt(bridge);

  // Prepend custom system prompt if provided (from user settings)
  if (customSystemPrompt?.trim()) {
    systemPrompt = `${customSystemPrompt.trim()}\n\n${systemPrompt}`;
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
  async function* singlePrompt() {
    yield {
      type: 'user' as const,
      message: { role: 'user' as const, content: fullPrompt },
      parent_tool_use_id: null,
      session_id: '',
    };
  }

  // Track tools that have been started but not yet ended
  // (vault tools push their own tool_end via eventQueue; external MCP tools don't)
  const pendingTools: string[] = [];

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
  (activityCheck as any).unref?.();

  try {
    const queryStream = query({
      prompt: singlePrompt(),
      options: {
        model: selectedModel,
        systemPrompt,
        mcpServers: mcpServers as Record<string, any>,
        allowedTools,
        maxTurns: MAX_TURNS,
        abortController,
        permissionMode: 'bypassPermissions' as const,
        includePartialMessages: true,
        thinking: { type: 'enabled', budgetTokens: 10000 },
        stderr: (data: string) => {
          heartbeat(); // stderr output = activity
          logger.warn(`CLI stderr: ${data.trimEnd()}`);
        },
      },
    });

    for await (const message of queryStream) {
      heartbeat(); // SDK yielded a message = alive

      // Drain tool_end events pushed by vault tool handlers
      yield* drainToolEvents();

      switch (message.type) {
        case 'stream_event': {
          // New content block starting = previous turn's tools are done
          if (message.event.type === 'content_block_start') {
            yield* closePendingTools();
            const block = (message.event as any).content_block;
            if (block?.type === 'thinking') {
              logger.info('[Thinking] Block started');
            }
          }

          // Stream text and thinking deltas in real time
          if (message.event.type === 'content_block_delta') {
            const delta = (message.event as any).delta;
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

          // Emit tool_start for each tool_use block (with full input)
          for (const block of message.message.content) {
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

          if (message.subtype === 'success') {
            logger.info('Agent completed successfully');
            yield { type: 'complete', result: message.result || '' };
          } else {
            const errors = 'errors' in message ? (message as any).errors : [];
            logger.error(`Agent stopped: ${message.subtype}`, errors);
            yield {
              type: 'error',
              code: message.subtype,
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
    logger.error('Agent error:', errMsg);
    logger.error('Agent error stack:', errStack);
    yield {
      type: 'error',
      code: 'AGENT_ERROR',
      message: errMsg,
    };
  } finally {
    clearInterval(activityCheck);
  }
}
