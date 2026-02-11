# Claudsidian - Project Context

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
- Current version: 12
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

## E2E Testing (Autonomous UI Testing)

For fully autonomous E2E testing without user intervention, use AppleScript to control Obsidian.

### Test Vaults

**IMPORTANT: Always use `yes-chef-test` for testing, NOT the live `yes-chef` vault.**

Available test vaults (check `~/Library/Application Support/obsidian/obsidian.json` for paths):

| Vault | Path | Purpose |
|-------|------|---------|
| `yes-chef-test` | `~/yes-chef-test/` | **Primary test vault** - use this for all testing |
| `test-plugin-vault` | `~/test-plugin-vault/` | Clean vault for plugin testing |
| `yes-chef` | `~/yes-chef/` | **LIVE vault - DO NOT use for testing** |

### Deploy Plugin to Vault

```bash
# Build the plugin
npm run build

# Copy to TEST vault (yes-chef-test)
cp main.js ~/yes-chef-test/.obsidian/plugins/claudsidian/
cp manifest.json ~/yes-chef-test/.obsidian/plugins/claudsidian/
cp styles.css ~/yes-chef-test/.obsidian/plugins/claudsidian/
```

### Launch Obsidian with Specific Vault

```bash
# Open TEST vault by name
open -a Obsidian "obsidian://open?vault=yes-chef-test"

# Wait for Obsidian to start
sleep 3
```

### AppleScript Automation

#### Focus Obsidian Window

```bash
osascript << 'EOF'
tell application "Obsidian" to activate
tell application "System Events"
    tell process "Obsidian"
        set frontmost to true
        -- Find and raise specific vault window (adjust title as needed)
        -- Use: osascript -e 'tell app "System Events" to tell process "Obsidian" to name of every window'
        -- to find the exact window title
        set win to window 1
        perform action "AXRaise" of win
    end tell
end tell
EOF
```

#### Open Command Palette and Run Command

```bash
osascript << 'EOF'
tell application "System Events"
    keystroke "p" using command down  -- Cmd+P opens command palette
    delay 0.5
    keystroke "claudsidian"           -- Filter to Claudsidian commands
    delay 0.5
    key code 36                       -- Enter to select "Open chat"
end tell
EOF
```

#### Type in Chat Input and Send

```bash
osascript << 'EOF'
tell application "System Events"
    tell process "Obsidian"
        set frontmost to true
        delay 0.3
        -- Click in chat input area (adjust coordinates based on window position)
        click at {600, 700}
        delay 0.3
    end tell
    -- Type the prompt
    keystroke "List all files in the menus folder"
    delay 0.3
    key code 36  -- Enter to send
end tell
EOF
```

#### Get Window Position/Size

```bash
osascript << 'EOF'
tell application "System Events"
    tell process "Obsidian"
        set win to window 1
        set winPos to position of win
        set winSize to size of win
        log "Position: " & (item 1 of winPos) & ", " & (item 2 of winPos)
        log "Size: " & (item 1 of winSize) & ", " & (item 2 of winSize)
    end tell
end tell
EOF
```

### Taking Screenshots

```bash
# Create screenshot directory
mkdir -p ./test-screenshots

# Take full screen screenshot
screencapture ./test-screenshots/screen-001.png

# View screenshot (Claude can read images)
# Use the Read tool on the PNG file to see it
```

### Full Autonomous Test Workflow

```bash
# 1. Build and deploy to TEST vault
npm run build
cp main.js manifest.json styles.css ~/yes-chef-test/.obsidian/plugins/claudsidian/

# 2. Launch Obsidian with TEST vault
open -a Obsidian "obsidian://open?vault=yes-chef-test"
sleep 3

# 3. Open chat via command palette
osascript -e 'tell application "System Events" to keystroke "p" using command down'
sleep 0.5
osascript -e 'tell application "System Events" to keystroke "claudsidian open chat"'
sleep 0.5
osascript -e 'tell application "System Events" to key code 36'
sleep 2

# 4. Send test prompt
osascript << 'EOF'
tell application "System Events"
    tell process "Obsidian"
        click at {600, 700}
        delay 0.3
    end tell
    keystroke "Create a test file called activity-test.md with Hello World"
    key code 36
end tell
EOF
sleep 8

# 5. Take screenshot of result
screencapture ./test-screenshots/test-result.png
```

### Test Prompts for Each Tool

| Tool | Test Prompt |
|------|-------------|
| `vault_list` | "List all files in the menus folder" |
| `vault_read` | "Read the MANIFEST file" |
| `vault_write` | "Create a file called test.md with Hello World" |
| `vault_edit` | "Edit test.md and change Hello to Goodbye" |
| `vault_search` | "Search for files containing 'sorbet'" |
| `vault_grep` | "Use grep to find 'yuzu' in the vault" |
| `vault_delete` | "Delete the test.md file" |

### Reloading Plugin Without Restarting Obsidian

Use command palette:
```bash
osascript << 'EOF'
tell application "System Events"
    keystroke "p" using command down
    delay 0.5
    keystroke "reload app without saving"
    delay 0.5
    key code 36
end tell
EOF
```

Or toggle plugin in settings (slower but safer):
1. Cmd+, to open settings
2. Navigate to Community Plugins
3. Toggle Claudsidian off then on

### Screenshot Directory

Test screenshots are saved to `./test-screenshots/`. Example files:
- `screen-list-response.png` - vault_list activity accordion
- `screen-write-response.png` - vault_write with diff preview
- `screen-edit-response.png` - vault_edit with red/green diff + undo button

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
