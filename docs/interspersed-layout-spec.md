# Interspersed Activity Layout Spec

## Goal

Replace the current grouped activity layout (all activities at top, then text at bottom) with a chronologically interspersed layout like Cursor — text and activities appear in the order they happen during the agent's execution.

**Before** (current):
```
[Activity Accordion: 5 searches, 2 files]
  - search_cookbooks "braising"
  - vault_read "notes/braising.md"
  - search_cookbooks "Peterson sauces"
  - vault_read "notes/sauces.md"
  - vault_write "guides/braising-guide.md"
[Edit Diff: braising-guide.md +45 lines]
Here's what I found about braising techniques...
[full response text]
```

**After** (interspersed):
```
[Explored 2 searches]
  - search_cookbooks "braising"
  - search_cookbooks "Peterson sauces"

Here's what I found about braising techniques. The CIA Professional Chef
describes braising as...

[Read 2 files]
  - vault_read "notes/braising.md"
  - vault_read "notes/sauces.md"

Comparing these with Peterson's approach...

[Created braising-guide.md +45 lines]
  [diff block]

I've created a comprehensive braising guide combining both sources.
```

## Current Architecture

### Data Flow

```
Backend (agent.ts)
  → yields AgentEvent (text_delta | tool_start | tool_end | thinking | complete)
  → server.ts relays via WebSocket
  → WebSocketClient.ts receives, calls StreamingHandlers
  → BackendProvider.ts converts to LLMResponseStreaming chunks with delta.activity
  → responseGenerator.ts accumulates into ChatAssistantMessage
  → AssistantToolMessageGroupItem.tsx renders
```

### Current Data Model

```typescript
// types/chat.ts
type ChatAssistantMessage = {
  role: 'assistant'
  content: string              // Flat text string, no timing info
  activities?: ActivityEvent[] // Array of all activities, chronologically ordered
  reasoning?: string           // Extended thinking content
  annotations?: Annotation[]
  // ...
}
```

### Current Rendering (AssistantToolMessageGroupItem.tsx)

```
1. <ActivityAccordion activities={allActivities} />   // ALL activities grouped
2. <EditDiffBlocks editActivities={editActivities} /> // ALL edits grouped
3. {messages.map(m => <AssistantMessageContent />)}   // ALL text at bottom
```

### Key Problem

`content` is a flat `string` with no timing information. Activities have `startTime`/`endTime`, but text deltas don't. We can't tell where activities should be inserted relative to text because we don't know when each chunk of text was emitted.

## Proposed Data Model

### New Types (types/chat.ts)

```typescript
/**
 * A block of content in the chronological stream.
 * Text blocks coalesce adjacent text deltas.
 * Activity groups coalesce adjacent tool calls (e.g., 3 reads in a row).
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'activity_group'; activityIds: string[] }

export type ChatAssistantMessage = {
  role: 'assistant'
  content: string                // KEPT: computed from text blocks for backward compat
  contentBlocks?: ContentBlock[] // NEW: chronological sequence
  activities?: ActivityEvent[]   // KEPT: canonical activity storage (lookup by ID)
  reasoning?: string             // KEPT for backward compat
  annotations?: Annotation[]
  // ... rest unchanged
}
```

### Design Principles

1. **Adjacent text coalesces**: Multiple text deltas in a row merge into one `text` block
2. **Adjacent activities group**: Multiple tool calls in a row merge into one `activity_group` block (rendered as a mini-accordion)
3. **Boundaries create new blocks**: When a tool_start arrives after text, the current text block closes and an activity_group block opens. When text arrives after tool_end, the activity_group closes and a new text block opens.
4. **Backward compatible**: `contentBlocks` is optional. Old conversations without it use legacy rendering.
5. **`content` stays in sync**: Flat `content` string is always computed from text blocks for backward compat and search.

## Implementation

### 1. BackendProvider.ts Changes

Track the "current block type" during streaming to know when to start a new block vs append to the current one.

```typescript
// State added to createStreamGenerator():
let currentBlockType: 'text' | 'activity_group' | null = null;
let currentTextBlock: string = '';
let currentActivityGroup: string[] = [];

// Modified onTextDelta:
onTextDelta: (text: string) => {
  if (currentBlockType !== 'text') {
    // Close any pending activity group
    if (currentBlockType === 'activity_group' && currentActivityGroup.length > 0) {
      enqueueContentBlock({ type: 'activity_group', activityIds: [...currentActivityGroup] });
      currentActivityGroup = [];
    }
    currentBlockType = 'text';
    currentTextBlock = '';
  }
  currentTextBlock += text;
  // Don't emit text block yet — wait for boundary (tool_start or complete)
  // But DO emit the text delta for streaming display
  enqueueChunk({ delta: { content: text } });
}

// Modified onToolStart:
onToolStart: (name: string, input: Record<string, unknown>) => {
  if (currentBlockType === 'text' && currentTextBlock) {
    enqueueContentBlock({ type: 'text', text: currentTextBlock });
    currentTextBlock = '';
  }
  currentBlockType = 'activity_group';
  const activityId = `activity-${requestId}-${index}`;
  currentActivityGroup.push(activityId);
  // ... existing activity event emission
}

// Modified onComplete:
onComplete: (result: string) => {
  // Flush any pending blocks
  if (currentBlockType === 'text' && currentTextBlock) {
    enqueueContentBlock({ type: 'text', text: currentTextBlock });
  } else if (currentBlockType === 'activity_group' && currentActivityGroup.length > 0) {
    enqueueContentBlock({ type: 'activity_group', activityIds: [...currentActivityGroup] });
  }
  // ... existing complete logic
}
```

The `enqueueContentBlock` helper emits a chunk with `delta.contentBlock`:
```typescript
const enqueueContentBlock = (block: ContentBlock) => {
  enqueueChunk({
    id: requestId,
    object: 'chat.completion.chunk',
    model: 'backend',
    choices: [{ delta: { contentBlock: block }, finish_reason: null }],
  });
};
```

### 2. responseGenerator.ts Changes

Add `mergeContentBlocks` method alongside existing `mergeActivities`:

```typescript
private mergeContentBlocks(
  prevBlocks?: ContentBlock[],
  newBlock?: ContentBlock,
): ContentBlock[] | undefined {
  if (!newBlock) return prevBlocks;
  if (!prevBlocks) return [newBlock];

  const last = prevBlocks[prevBlocks.length - 1];

  // Coalesce adjacent text blocks
  if (newBlock.type === 'text' && last?.type === 'text') {
    return [
      ...prevBlocks.slice(0, -1),
      { type: 'text', text: last.text + newBlock.text },
    ];
  }

  // Coalesce adjacent activity groups
  if (newBlock.type === 'activity_group' && last?.type === 'activity_group') {
    return [
      ...prevBlocks.slice(0, -1),
      { type: 'activity_group', activityIds: [...last.activityIds, ...newBlock.activityIds] },
    ];
  }

  // Different type = new block
  return [...prevBlocks, newBlock];
}
```

In the chunk processing section (around line 283-298), add:
```typescript
contentBlocks: chunk.delta.contentBlock
  ? this.mergeContentBlocks(message.contentBlocks, chunk.delta.contentBlock)
  : message.contentBlocks,
```

Also compute flat `content` from text blocks:
```typescript
// After merging contentBlocks, recompute flat content:
content: message.contentBlocks
  ? message.contentBlocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
  : message.content + (content || ''),
```

### 3. LLM Response Types (types/llm/response.ts)

Add `contentBlock` to the delta type:
```typescript
interface StreamDelta {
  content?: string;
  activity?: ActivityEvent;
  contentBlock?: ContentBlock;  // NEW
  reasoning?: string;
  tool_calls?: ToolCallDelta[];
  // ...
}
```

### 4. New Component: InterspersedContent.tsx

```typescript
// ~/claudsidian/src/components/chat-view/InterspersedContent.tsx

import { useMemo } from 'react';
import type { ActivityEvent, ContentBlock } from '../../types/chat';
import type { ChatMessage } from '../../types/chat';
import ActivityAccordion from './ActivityAccordion';
import AssistantMessageContent from './AssistantMessageContent';
import EditDiffBlock from './EditDiffBlock';

interface InterspersedContentProps {
  contentBlocks: ContentBlock[];
  activities: ActivityEvent[];
  isStreaming: boolean;
  contextMessages: ChatMessage[];
  isApplying: boolean;
  onApply: (blockToApply: string, chatMessages: ChatMessage[]) => void;
}

export default function InterspersedContent({
  contentBlocks,
  activities,
  isStreaming,
  contextMessages,
  isApplying,
  onApply,
}: InterspersedContentProps) {
  // Build activity lookup map
  const activityMap = useMemo(
    () => new Map(activities.map((a) => [a.id, a])),
    [activities],
  );

  return (
    <div className="smtcmp-interspersed-content">
      {contentBlocks.map((block, idx) => {
        const isLastBlock = idx === contentBlocks.length - 1;

        switch (block.type) {
          case 'text':
            return (
              <AssistantMessageContent
                key={`text-${idx}`}
                content={block.text}
                contextMessages={contextMessages}
                handleApply={onApply}
                isApplying={isApplying}
              />
            );

          case 'activity_group': {
            const groupActivities = block.activityIds
              .map((id) => activityMap.get(id))
              .filter((a): a is ActivityEvent => a !== undefined);

            if (groupActivities.length === 0) return null;

            // Separate exploration from edit activities
            const exploration = groupActivities.filter(
              (a) =>
                a.type !== 'vault_write' &&
                a.type !== 'vault_edit' &&
                a.type !== 'vault_rename' &&
                a.type !== 'vault_delete',
            );
            const edits = groupActivities.filter(
              (a) =>
                a.type === 'vault_write' ||
                a.type === 'vault_edit' ||
                a.type === 'vault_rename' ||
                a.type === 'vault_delete',
            );

            return (
              <div key={`group-${idx}`} className="smtcmp-interspersed-group">
                {exploration.length > 0 && (
                  <ActivityAccordion
                    activities={exploration}
                    isStreaming={isStreaming && isLastBlock}
                  />
                )}
                {edits.map((edit) => (
                  <EditDiffBlock key={edit.id} activity={edit} />
                ))}
              </div>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
}
```

### 5. AssistantToolMessageGroupItem.tsx Changes

Add conditional rendering based on `contentBlocks` presence:

```typescript
// Inside the render, replace the current 3-section layout:

// Check if ANY message in the group has contentBlocks
const hasContentBlocks = messages.some(
  (m) => m.role === 'assistant' && m.contentBlocks && m.contentBlocks.length > 0,
);

return (
  <div className="smtcmp-assistant-tool-message-group">
    {hasContentBlocks ? (
      // NEW: Interspersed layout
      messages.map((message) => {
        if (message.role === 'assistant' && message.contentBlocks) {
          return (
            <InterspersedContent
              key={message.id}
              contentBlocks={message.contentBlocks}
              activities={allActivities}
              isStreaming={isStreaming}
              contextMessages={contextMessages}
              isApplying={isApplying}
              onApply={onApply}
            />
          );
        }
        return null;
      })
    ) : (
      // LEGACY: Grouped layout for old conversations
      <>
        {allActivities.length > 0 && (
          <ActivityAccordion activities={allActivities} isStreaming={isStreaming} />
        )}
        {editActivities.length > 0 && (
          <div className="smtcmp-edit-blocks">
            {editActivities.map((activity) => (
              <EditDiffBlock key={activity.id} activity={activity} />
            ))}
          </div>
        )}
        {messages.map((message) => {
          if (message.role === 'assistant') {
            const displayContent = getDisplayContent(message.content || '', allActivities.length > 0);
            if (!displayContent) return null;
            return (
              <div key={message.id} className="smtcmp-chat-messages-assistant">
                <AssistantMessageContent
                  content={displayContent}
                  contextMessages={contextMessages}
                  handleApply={onApply}
                  isApplying={isApplying}
                />
              </div>
            );
          }
          return null;
        })}
      </>
    )}
    {messages.length > 0 && <AssistantToolMessageGroupActions messages={messages} />}
  </div>
);
```

## Backward Compatibility

- `contentBlocks` is **optional** on `ChatAssistantMessage`
- Old saved conversations have `contentBlocks: undefined` → legacy grouped rendering
- New conversations get `contentBlocks` populated during streaming → interspersed rendering
- Flat `content: string` is always kept in sync (computed from text blocks) for:
  - Search/filter functionality
  - Non-backend providers that don't emit contentBlock deltas
  - Any code that reads `message.content` directly
- No database migration needed

## Edge Cases

### Abort Mid-Stream
When the user clicks Stop:
- `onComplete` fires → flushes any pending content block
- Partially accumulated text block gets emitted as-is
- Activity groups with running activities render with the running state (timer keeps going until timeout)

### Empty Text Blocks
If `onToolStart` fires immediately after `onToolEnd` (back-to-back tools with no text in between), no empty text block is created — the activity groups just coalesce.

### Thinking Blocks
Thinking activities get their own `activity_group` block. They appear inline in the chronological flow, shown as a collapsible "Thought for Xs" item between text.

### Direct API Provider
When using direct API providers (OpenAI, Anthropic direct), `contentBlocks` won't be populated since those providers don't go through BackendProvider. They'll use the legacy grouped layout, which is fine.

### Multi-turn Agent
Each turn of the agent produces its own text and tools. Since `contentBlocks` accumulates across the entire response, multi-turn flows naturally produce:
```
[Turn 1 activities]
Turn 1 text...
[Turn 2 activities]
Turn 2 text...
```

## CSS Styling

Add minimal styling for the interspersed layout:

```css
.smtcmp-interspersed-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.smtcmp-interspersed-group {
  margin: 4px 0;
}
```

The existing `ActivityAccordion` and `EditDiffBlock` styles work as-is since they're self-contained components.

## E2E Testing Instructions (CDP)

### Prerequisites
- Obsidian running with test vault (`~/yes-chef-test/`)
- Backend running (`cd ~/claudsidian/backend && npm run dev`)
- Plugin built and installed (`cd ~/claudsidian && node esbuild.config.mjs production`)
- CDP port 9222 open on Obsidian

### Test 1: Basic Interspersed Layout
1. Open new chat via `app.commands.executeCommandById('claudsidian:open-new-chat')`
2. Send: "What are the mother sauces? Create a note about them."
3. **Expected**: Response shows interleaved:
   - `[Explored 1 search]` (search_cookbooks)
   - Text paragraph explaining mother sauces
   - `[Created mother-sauces.md +N lines]` with diff
   - Text paragraph confirming creation
4. **Verify**: Activities appear between text, NOT all grouped at top

### Test 2: Multi-Tool Interspersed
1. Send: "Compare braising in Peterson vs CIA Pro Chef, then create a comparison note"
2. **Expected**: Multiple activity groups interspersed:
   - `[Explored 2 searches]`
   - Text comparing the sources
   - `[Read 1 file]` (if it reads existing notes)
   - More text
   - `[Created comparison.md]`
   - Final text
3. **Verify**: Each activity group appears at the chronological point it was executed

### Test 3: Backward Compat - Old Conversation
1. Load an existing conversation that was created before the feature
2. **Expected**: Legacy grouped layout (all activities at top, text at bottom)
3. **Verify**: No errors, no visual regression

### Test 4: Streaming Behavior
1. Send a complex query and observe during streaming
2. **Expected**:
   - Activity accordion appears inline as tools start
   - Text streams below each activity group
   - New activity groups appear between text paragraphs
3. **Verify**: No layout jumps or flashing during streaming

### Test 5: Stop Mid-Stream
1. Send complex query, click Stop after 2-3 tool calls
2. **Expected**: Partial content renders correctly — whatever blocks were completed show up
3. **Verify**: No stuck spinners, no blank areas

### Test 6: Thinking Interspersed
1. Send a complex query that triggers extended thinking
2. **Expected**: "Thought for Xs" appears inline in the chronological flow
3. **Verify**: Thinking block is between text, not just in the top accordion

### UI Visual Verification
For each test, verify:
- [ ] Activity groups have proper accordion expand/collapse
- [ ] Edit diffs show green/red highlighting correctly
- [ ] Clickable file links work (`[[filename]]` opens in editor)
- [ ] Timer shows and stops correctly on activity items
- [ ] Text rendering (markdown, code blocks, citations) is unchanged
- [ ] No duplicate activities (check activity IDs)
- [ ] Undo button works on edit activities

### CDP Quick Eval Script Pattern
```javascript
// In CDP console (ws://127.0.0.1:9222/devtools/page/{TARGET_ID}):
// Check if interspersed content is rendered
const blocks = document.querySelectorAll('.smtcmp-interspersed-content');
console.log('Interspersed containers:', blocks.length);

// Check block ordering
const content = document.querySelector('.smtcmp-interspersed-content');
if (content) {
  const children = Array.from(content.children);
  children.forEach((child, i) => {
    const isActivity = child.classList.contains('smtcmp-interspersed-group');
    const isText = child.classList.contains('smtcmp-chat-messages-assistant');
    console.log(`Block ${i}: ${isActivity ? 'ACTIVITY' : isText ? 'TEXT' : 'OTHER'}`);
  });
}
```

## Files to Modify

| File | Action |
|------|--------|
| `src/types/chat.ts` | Add `ContentBlock` type, add `contentBlocks?` to `ChatAssistantMessage` |
| `src/types/llm/response.ts` | Add `contentBlock?: ContentBlock` to stream delta |
| `src/core/backend/BackendProvider.ts` | Track block boundaries, emit `contentBlock` deltas |
| `src/utils/chat/responseGenerator.ts` | Add `mergeContentBlocks()`, compute flat `content` |
| `src/components/chat-view/InterspersedContent.tsx` | NEW: interspersed renderer component |
| `src/components/chat-view/AssistantToolMessageGroupItem.tsx` | Conditional: contentBlocks → interspersed, else legacy |
| `src/styles.css` | Add `.smtcmp-interspersed-content` and `.smtcmp-interspersed-group` styles |
