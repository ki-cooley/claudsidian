# Interruptions & Asides Implementation Plan

## Overview

Enable user interruptions and asides to in-flight agent turns using the Claude Agent SDK's streaming input pattern (async iterator). This allows the user to:

1. **Interrupt**: Cancel the current agent turn and start a new one
2. **Aside**: Inject a message mid-turn that the agent incorporates without canceling

## Current State

- Single-prompt-per-turn model: User sends prompt → Agent runs to completion → User sends next message
- Agent uses `query(prompt: AsyncGenerator)` but the generator is already exhausted before execution completes
- WebSocket protocol has no affordances for mid-turn messages (only `prompt`, `cancel`, `ping`)
- UI has a "stop" button but it only cancels via `CancelMessage` type

## Architecture Changes

### 1. Backend: Agent Model Update

**File: `backend/src/agent.ts`**

Change from single-prompt to streaming input pattern:

```typescript
// OLD: singlePrompt() generates one user message, then ends
async function* singlePrompt() {
  yield { type: 'user', message: userMessage, ... };
}

// NEW: inputStream is a queue that stays open for entire agent lifetime
// User can push new messages to it while agent is running
async function* inputStream() {
  for await (const message of inputQueue) {
    yield message;
  }
}
```

**Changes required:**
- Create an `inputQueue` (async iterable queue) that persists across the agent lifecycle
- Modify `query()` call to use `inputStream()` instead of `singlePrompt()`
- On initial prompt, add first user message to queue
- Expose method to push new messages to queue from server handlers

**Key insight:** The Agent SDK's streaming input pattern allows messages to be pushed asynchronously while the agent is mid-turn. The SDK will see new input, incorporate it, and continue execution.

### 2. Protocol Update

**File: `backend/src/protocol.ts`**

Add new client → server message types:

```typescript
// Client → Server
export interface InterruptMessage {
  type: 'interrupt';
  id: string;  // requestId/sessionId
  prompt?: string;  // optional: prompt for new turn
}

export interface AsideMessage {
  type: 'aside';
  id: string;  // requestId/sessionId
  message: string;  // message to inject
}

// Update ClientMessage union:
export type ClientMessage = 
  | PromptMessage
  | InterruptMessage
  | AsideMessage
  | RpcResponseMessage
  | CancelMessage
  | ...
```

No new server → client messages needed (interrupts use existing status messages).

### 3. Server: Connection Handler

**File: `backend/src/server.ts`**

Updates to `ConnectionHandler` class:

1. **Track active input queue per session:**
   ```typescript
   private activeInputQueues = new Map<string, AsyncQueue>();
   ```

2. **Handle interrupt and aside messages:**
   ```typescript
   case 'interrupt':
     this.handleInterrupt(msg);
     break;
   case 'aside':
     this.handleAside(msg);
     break;
   ```

3. **Implementation:**
   - `handleInterrupt(msg)`: Cancel session, optionally start new one
   - `handleAside(msg)`: Push message to active input queue

4. **Pass input queue to agent:**
   - Modify `runAgentForSession()` to pass the input queue to `runAgent()`
   - Agent receives queue, uses it for streaming input

### 4. Agent Execution Flow

**File: `backend/src/agent.ts`**

Update `runAgent()` signature:

```typescript
export async function* runAgent(
  prompt: string,
  bridge: VaultBridge,
  context?: AgentContext,
  signal?: AbortSignal,
  customSystemPrompt?: string,
  model?: string,
  images?: Array<{ mimeType: string; base64Data: string }>,
  resumeSessionId?: string,
  onSdkSessionId?: (id: string) => void,
  inputQueue?: AsyncQueue,  // NEW: streaming input queue
): AsyncGenerator<AgentEvent> {
  // ... existing setup ...
  
  // Build input stream from queue
  async function* inputStream() {
    if (!inputQueue) {
      // Single prompt mode (backward compatible)
      yield { type: 'user', message: userMessage, ... };
      return;
    }
    
    // Enqueue first prompt
    inputQueue.push(userMessage);
    
    // Listen for new messages pushed to queue during execution
    for await (const msg of inputQueue) {
      yield msg;
    }
  }
  
  const queryStream = query({
    prompt: inputStream(),  // Use streaming input
    options: { ... },
  });
  
  // ... rest of loop unchanged ...
}
```

### 5. UI: Chat Component

**File: `src/components/chat-view/ChatViewProvider.tsx` (or equivalent)**

Changes:

1. Update "stop" button to send `interrupt` instead of generic `cancel`
2. Add "aside" affordance (e.g., keyboard shortcut or button that appears during agent thinking)
3. When agent is running (`status === 'running'`):
   - Show aside input field or make input always-available
   - Send `AsideMessage` when user types while agent is running
   - Show indication that message is being injected mid-turn

## Implementation Plan

### Phase 1: Core Backend Scaffolding (Session 1)
- [ ] Create `AsyncQueue` utility class in `backend/src/utils.ts`
- [ ] Update `protocol.ts` with `InterruptMessage` and `AsideMessage` types
- [ ] Modify `runAgent()` signature to accept `inputQueue`
- [ ] Build `inputStream()` generator in agent.ts
- [ ] Update `query()` call to use streaming input

### Phase 2: Server Integration (Session 1-2)
- [ ] Track active input queues in `ConnectionHandler`
- [ ] Implement `handleInterrupt()` and `handleAside()` handlers
- [ ] Pass input queue from server to agent
- [ ] Test basic interrupt and aside flow

### Phase 3: UI Integration (Session 2+)
- [ ] Wire up UI affordances (button/shortcut for aside)
- [ ] Update stop button to send `interrupt`
- [ ] Display aside feedback (visual indication message was injected)
- [ ] Test end-to-end user experience

## Design Decisions

1. **AsyncQueue vs. Direct Message Passing:** AsyncQueue allows decoupling of message push (from server) from message consumption (in agent). Makes cancellation and cleanup easier.

2. **Backward Compatibility:** If no input queue is provided, fall back to single-prompt mode. Existing code paths unchanged.

3. **Interrupt vs. Aside Semantics:**
   - **Interrupt:** Cancels in-flight turn, aborts agent (same as current cancel button)
   - **Aside:** Preserves in-flight turn, injects message for agent to see and respond to
   
   This matches user mental model: "stop this and start over" vs. "add something I just thought of"

4. **Session Lifecycle:** One input queue per agent execution. On interrupt, create new session with new queue.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SDK may not support mid-turn input injection | Test with simple example first; check SDK docs for streaming input contract |
| Race conditions in input queue | Use thread-safe queue primitive (or lock-free if SDK supports it) |
| Tool execution during aside injection | SDK's tool loop handles this; async input doesn't break tool execution |
| User cancels session while aside is being processed | Session cancel signal propagates; agent stops cleanly |
| High context size if many asides during long turn | Aside messages are just text; no amplification of context (SDK handles truncation if needed) |

## Testing Strategy

1. **Unit tests:** AsyncQueue behavior, message handling
2. **Integration tests:** Interrupt and aside flow with mock agent
3. **End-to-end:** Full chat with real agent, manual interrupt/aside

## Future Enhancements

- Aside suggestions (auto-complete based on context)
- Multi-message asides (structured data)
- Undo/redo for injected messages
- Interrupt with fallback (continue with new direction vs. restart)
