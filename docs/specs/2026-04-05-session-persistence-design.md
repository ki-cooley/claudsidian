# Session Persistence Design

## Problem

When a user closes Obsidian (or switches devices) while an agent response is in-flight, the response is lost. The WebSocket disconnects, the backend aborts the agent, and nothing is recoverable. Users also can't run multiple conversations simultaneously.

## V1: Server-Side Event Buffering + Reconnect

### Session Model

Each prompt creates a server-side **Session** that outlives the WebSocket connection:

```
Session {
  id: string                    // server-assigned UUID
  conversationId: string        // client's conversation ID
  clientId: string              // workspace identifier (shared across devices via Obsidian Sync)
  status: running | complete | error
  events: AgentEvent[]          // ALL events buffered
  createdAt, completedAt
}
```

Sessions stored in-memory with 24h TTL. Lost on server restart (acceptable for V1).

### Protocol Additions

**Client -> Server:**
- `session_resume { sessionId, clientId }` — replay buffered events
- `session_list { clientId }` — list active/completed sessions
- `session_cancel { sessionId }` — abort a running session

**Server -> Client:**
- `session_created { requestId, sessionId }` — first event after prompt
- `session_replay { sessionId, events[], isComplete, conversationId }` — batch replay
- `session_info { sessionId, status, conversationId, createdAt, completedAt, eventCount }` — list response

**Existing `prompt` extended with:** `clientId?, conversationId?`

### Agent Lifecycle on Disconnect

1. Connection drops -> vault bridge switches to "disconnected" mode
2. All vault RPCs immediately reject with `CLIENT_DISCONNECTED`
3. Agent sees errors, finishes text response (can't do more vault ops)
4. Events continue buffering in Session
5. Session marked complete when agent finishes

### Reconnect Flow

1. Client sends `session_resume { sessionId }`
2. Server sends `session_replay { events[], isComplete }`
3. If still running: live events continue streaming after replay
4. If complete: client has full response, removes pending session marker

### Client-Side Persistence

- `clientId` stored in vault at `.claude/client-id` (shared across devices)
- Pending sessions tracked in `.smartcomposer/pending-sessions.json`
- On plugin load: read pending sessions, connect, resume each
- On session complete: remove from pending sessions, save messages to conversation

### Multi-Session Support

- `StreamStateManager` extended to hold Map<conversationId, stream> (was single stream)
- WebSocket already multiplexes by requestId — no changes needed
- Each conversation independently tracks its pending sessionId

## V2: Cached Reads + Queued Writes (Future)

### Read Cache
- Every `vault_read` result cached in the Session (path -> content)
- On disconnect, `vault_read` falls back to cache instead of failing
- Agent can continue reading files from cache

### Write Queue
- `vault_write`, `vault_edit`, `vault_rename`, `vault_delete` queued as PendingEdits
- On reconnect, pending edits sent to client for review
- User can apply/discard each edit individually

### PendingEdit Model
```
PendingEdit {
  type: write | edit | rename | delete
  path: string
  content?: string
  oldString?: string
  newString?: string
  newPath?: string
  timestamp: number
}
```

### Edit Review UI
- On reconnect, show pending edits in a review panel
- Each edit shows diff preview
- Apply/discard buttons per edit
- Apply-all option

## Implementation Scope

**V1 (this PR):** Session model, event buffering, reconnect protocol, multi-session StreamStateManager, pending session persistence, plugin-level recovery on load.

**V2 (future PR):** Read cache, write queue, pending edit protocol, edit review UI.
