# Claudsidian - Project Context

> **Status: dormant.** Last commit April 2026, this file last updated January 2026. Treat every specific below (version numbers, file lists, class names) as a starting point to verify, not as fact. If you pick the project back up, re-audit this file before trusting it.

## Overview

Claudsidian is a fork of [Smart Composer](https://github.com/glowingjade/obsidian-smart-composer), an Obsidian plugin for AI-assisted note-taking. This fork adds a custom backend server that enables Claude to directly interact with the Obsidian vault through tool calls, providing a Cursor-like agentic experience.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Obsidian Plugin (Frontend)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Chat UI     │  │ Backend     │  │ VaultRpcHandler         │  │
│  │ Components  │◄─┤ Provider    │◄─┤ (executes vault ops)    │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────────┘
                           │ WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend Server (Node.js)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ server.ts   │  │ agent.ts    │  │ mcp-tools.ts            │  │
│  │ (WebSocket) │◄─┤ (Claude AI) │◄─┤ (tool definitions)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Communication Flow

1. User sends prompt via Chat UI
2. `BackendProvider` sends prompt to backend server via WebSocket
3. Backend's `agent.ts` calls Claude API with vault tools
4. When Claude uses a tool, backend sends RPC request to plugin
5. `VaultRpcHandler` executes the operation (read/write/edit/etc.)
6. Result sent back to backend, which continues the conversation
7. Activity events (`tool_start`/`tool_end`) streamed to UI for display

## Key Directories

```
src/
├── components/chat-view/     # React UI components
│   ├── Chat.tsx              # Main chat container
│   ├── ActivityAccordion.tsx # Cursor-style activity display
│   ├── ActivityItem.tsx      # Individual activity row
│   ├── EditDiffBlock.tsx     # Diff preview for edits
│   └── AssistantToolMessageGroupItem.tsx  # Message grouping
├── core/
│   ├── backend/              # Backend integration
│   │   ├── BackendProvider.ts    # LLM provider for backend
│   │   ├── WebSocketClient.ts    # WebSocket communication
│   │   ├── VaultRpcHandler.ts    # Vault operation executor
│   │   ├── EditHistory.ts        # Undo/revert functionality
│   │   └── tool-result-formatter.ts  # Format tool results
│   ├── llm/                  # Other LLM providers (OpenAI, etc.)
│   └── mcp/                  # Model Context Protocol support
├── types/
│   ├── chat.ts               # Chat message types, ActivityEvent
│   └── llm/                  # LLM request/response types
└── utils/chat/
    └── responseGenerator.ts  # Merges activities into messages

backend/src/
├── server.ts                 # WebSocket server, message routing
├── agent.ts                  # Claude API integration, tool loop
├── mcp-tools.ts              # Vault tool definitions
└── protocol.ts               # Message type definitions
```

## Activity UI System (Cursor-style)

The activity UI shows tool operations in a collapsible accordion format:

### Key Types (`src/types/chat.ts`)

```typescript
interface ActivityEvent {
  id: string
  type: 'vault_read' | 'vault_write' | 'vault_edit' | 'vault_list' |
        'vault_search' | 'vault_grep' | 'vault_glob' | 'vault_rename' |
        'vault_delete' | 'web_search' | 'thinking' | 'tool_call'
  status: 'running' | 'complete' | 'error'
  startTime: number
  endTime?: number
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  filePath?: string
  diff?: { additions: number; deletions: number; oldContent?: string; newContent?: string }
  // ... more fields
}
```

### Activity Flow

1. `BackendProvider.onToolStart()` creates activity with `status: 'running'`
2. Activity added to chunk as `delta.activity`
3. `responseGenerator.mergeActivities()` collects activities into `message.activities`
4. `ActivityAccordion` renders collapsed summary (e.g., "Explored 5 files, 3 searches")
5. `ActivityItem` renders individual items with expand/collapse
6. `EditDiffBlock` shows diffs for write/edit operations with undo button

### Content Filtering

`AssistantToolMessageGroupItem.tsx` has `getDisplayContent()` which:
- Hides short content (<200 chars) that only contains tool result summaries
- Strips `**Read:**`, `**Created:**` etc. patterns from longer content
- Prevents duplicate display (activities shown in accordion, not as text)

## Vault Tools

Defined in `backend/src/mcp-tools.ts`, executed via `VaultRpcHandler`:

| Tool | Description | Activity Type |
|------|-------------|---------------|
| `vault_read` | Read file contents | `vault_read` |
| `vault_write` | Create new file | `vault_write` |
| `vault_edit` | Edit existing file (find/replace) | `vault_edit` |
| `vault_list` | List directory contents | `vault_list` |
| `vault_search` | Search vault content | `vault_search` |
| `vault_grep` | Regex search in files | `vault_grep` |
| `vault_glob` | Find files by pattern | `vault_glob` |
| `vault_rename` | Rename/move file | `vault_rename` |
| `vault_delete` | Delete file | `vault_delete` |

### Web Search Limitation

`web_search` uses Claude's built-in tool (`web_search_20250305`), which is handled by Anthropic's API server-side. It does NOT go through our `tool_start`/`tool_end` event system, so no activity accordion is shown for web searches.

## WebSocket Protocol

### Message Types (Backend → Plugin)

```typescript
// Tool execution request
{ type: 'rpc_request', id: string, method: string, params: object }

// Streaming events
{ type: 'tool_start', name: string, input: object, requestId: string }
{ type: 'tool_end', name: string, result: string, requestId: string }
{ type: 'text_delta', text: string, requestId: string }
{ type: 'complete', result: string, requestId: string }
```

### Message Types (Plugin → Backend)

```typescript
// Start conversation
{ type: 'prompt', prompt: string, context?: object, model?: string }

// Tool result
{ type: 'rpc_response', id: string, result?: any, error?: object }
```

## Edit History & Undo

`EditHistory.ts` tracks file modifications:
- Stores original content before edits
- Keyed by `activityId`
- `revertEdit(activityId)` restores original content
- Undo button in `EditDiffBlock` calls revert

## Settings Schema

Settings use versioned migrations (`src/settings/schema/migrations/`):
- Current version: read `SETTINGS_SCHEMA_VERSION` in `migrations/index.ts` (13 as of Aug 2026; this line has gone stale twice, so check it)
- Provider configs stored in `providers[]` array
- Backend provider requires `backendUrl` and `authToken`

## Development

### Build Commands

```bash
npm run build          # Production build
npm run dev            # Development with watch
npx tsc --noEmit       # Type check only
```

### Testing in Obsidian

1. Build: `npm run build`
2. Copy to vault: `cp main.js manifest.json styles.css ~/your-vault/.obsidian/plugins/claudsidian/`
3. Reload Obsidian or toggle plugin

### Backend Development

```bash
cd backend
npm run dev            # Start with hot reload
npm run build          # Production build
```

Backend deployed to Railway at `wss://claudsidian-production.up.railway.app`

## E2E Testing

**Use `yes-chef-test` (`~/yes-chef-test/`), never the live `yes-chef` vault.** `test-plugin-vault` is the clean-slate alternative. Vault paths are in `~/Library/Application Support/obsidian/obsidian.json`.

```bash
npm run build
cp main.js manifest.json styles.css ~/yes-chef-test/.obsidian/plugins/claudsidian/
open -a Obsidian "obsidian://open?vault=yes-chef-test"
```

Reload without restarting Obsidian: command palette -> "reload app without saving".

Driving the UI: this file used to carry ~180 lines of AppleScript that clicked at hardcoded pixel coordinates and screenshotted the result. That was written before better options existed. Prefer the `gemini-vision` skill for reading and judging screenshots, and chrome-devtools MCP where the surface is web. Fall back to `osascript` keystroke automation only for the Obsidian-native bits (command palette, plugin toggle) that nothing else can reach.

Per-tool smoke prompts: "List all files in the menus folder" (`vault_list`), "Create a file called test.md with Hello World" (`vault_write`), "Edit test.md and change Hello to Goodbye" (`vault_edit`), "Search for files containing 'sorbet'" (`vault_search`), "Delete the test.md file" (`vault_delete`).

## CSS Classes

Activity UI classes (in `styles.css`):
- `.smtcmp-activity-accordion` - Main accordion container
- `.smtcmp-activity-header` - Clickable header with summary
- `.smtcmp-activity-list` - Expanded activity list
- `.smtcmp-activity-item` - Individual activity row
- `.smtcmp-activity-file-link` - Clickable file links
- `.smtcmp-edit-diff-block` - Diff preview container
- `.smtcmp-diff-line-add` / `.smtcmp-diff-line-remove` - Diff highlighting

## Known Issues & Gotchas

1. **Web search no activity**: Claude's built-in web_search doesn't emit tool events
2. **Edit batching**: Multiple rapid edits to same file are batched (5s window)
3. **Activity merging**: Activities are merged by ID across streaming chunks
4. **Content stripping**: Short tool-only responses are hidden entirely when activities present
5. **PGlite environment**: Uses browser shims for Node.js modules (see DEVELOPMENT.md)

## Important Files to Know

| File | Purpose |
|------|---------|
| `src/main.ts` | Plugin entry point, registers providers |
| `src/core/backend/BackendProvider.ts` | Handles backend communication, activity events |
| `src/core/backend/WebSocketClient.ts` | WebSocket connection management |
| `src/core/backend/VaultRpcHandler.ts` | Executes vault operations from RPC |
| `src/components/chat-view/ActivityAccordion.tsx` | Activity summary UI |
| `src/components/chat-view/EditDiffBlock.tsx` | Diff display with undo |
| `src/utils/chat/responseGenerator.ts` | Merges streaming chunks, activities |
| `backend/src/agent.ts` | Claude API calls, tool execution loop |
| `backend/src/server.ts` | WebSocket server, routes messages |
