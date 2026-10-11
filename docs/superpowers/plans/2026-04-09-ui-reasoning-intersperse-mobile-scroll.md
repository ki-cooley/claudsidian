# UI Fixes: Interspersed Reasoning + Mobile Scroll

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two UI issues: (1) reasoning/thinking tokens render as one block at the top instead of interspersed chronologically with tool calls and text, and (2) mobile scroll locking/hanging.

**Architecture:** Reasoning becomes a first-class `ContentBlock` type (`'reasoning'`), rendered inline in the chronological flow alongside text blocks and activity groups. Mobile scroll fixed by eliminating double-RAF jank and extending the user-scroll debounce to handle iOS momentum.

**Tech Stack:** React, TypeScript, Obsidian plugin CSS

---

## Root Cause Analysis

### Reasoning not interspersed

`BackendProvider.onThinking()` (line 369) sets `currentBlockType = 'activity_group'` and pushes the thinking ID into `currentActivityGroup`. But thinking isn't a tool — it's its own content type. When the UI renders the interspersed layout, thinking activities end up inside `ActivityAccordion` alongside tool calls, rather than appearing as a distinct collapsible reasoning block in the chronological flow.

Additionally, in `AssistantToolMessageGroupItem.tsx` (line 274), reasoning is rendered **above** the interspersed content blocks even in the interspersed path — defeating the purpose.

**Fix:** Add `'reasoning'` as a `ContentBlock` type. Thinking gets its own block in the chronological flow, separate from tool activity groups. Each think→tools→text cycle produces: reasoning block → activity_group block → text block.

### Mobile scroll locking

1. Double `requestAnimationFrame` nesting in `Chat.tsx` (lines 180-184, 475-479) defers scroll by 2 frames (~33ms visible jank)
2. `USER_SCROLL_DEBOUNCE_MS = 150` in `useAutoScroll.ts` is too short for iOS momentum scrolling, which can continue for 500ms+ after finger lift — causing momentum + auto-scroll race conditions
3. `scrollTop` assignment can trigger synchronous layout in some WebView engines

## File Structure

```
Modified files:
├── src/types/chat.ts                                    # Add 'reasoning' ContentBlock type
├── src/core/backend/BackendProvider.ts                  # Emit reasoning contentBlocks
├── src/utils/chat/responseGenerator.ts                  # Merge reasoning contentBlocks
├── src/components/chat-view/InterspersedContent.tsx     # Render reasoning blocks inline
├── src/components/chat-view/AssistantToolMessageGroupItem.tsx  # Remove separate reasoning
├── src/components/chat-view/useAutoScroll.ts            # Fix debounce + scrollTo
├── src/components/chat-view/Chat.tsx                    # Remove double-RAF
└── styles.css                                           # Remove deprecated webkit property
```

---

### Task 1: Add reasoning ContentBlock type

**Files:**
- Modify: `src/types/chat.ts:69-71`

- [ ] **Step 1: Add reasoning to ContentBlock union**

In `src/types/chat.ts`, change the `ContentBlock` type from:

```typescript
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'activity_group'; activityIds: string[] }
```

to:

```typescript
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'activity_group'; activityIds: string[] }
  | { type: 'reasoning'; text: string }
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors related to ContentBlock

- [ ] **Step 3: Commit**

```bash
git add src/types/chat.ts
git commit -m "feat: add reasoning ContentBlock type for interspersed display"
```

---

### Task 2: Emit reasoning contentBlocks from BackendProvider

**Files:**
- Modify: `src/core/backend/BackendProvider.ts:206-232` (block tracking) and `369-404` (onThinking)

The key change: thinking gets its own block type instead of being lumped into `activity_group`. When thinking starts, flush any pending text or activity group. When thinking ends (tool or text starts), flush the reasoning block.

- [ ] **Step 1: Add reasoning block type and flush function**

In `BackendProvider.ts`, find the block tracking section (around line 207):

```typescript
let currentBlockType: 'text' | 'activity_group' | null = null;
let currentTextBlock = '';
let currentActivityGroup: string[] = [];
```

Change to:

```typescript
let currentBlockType: 'text' | 'activity_group' | 'reasoning' | null = null;
let currentTextBlock = '';
let currentActivityGroup: string[] = [];
let currentReasoningBlock = '';
```

After `flushActivityGroup` (around line 232), add:

```typescript
const flushReasoningBlock = () => {
	if (currentBlockType === 'reasoning' && currentReasoningBlock) {
		enqueueContentBlock({ type: 'reasoning', text: currentReasoningBlock });
		currentReasoningBlock = '';
	}
};
```

- [ ] **Step 2: Update onThinking to emit reasoning contentBlocks**

Replace the `onThinking` handler (lines 369-404) with:

```typescript
onThinking: (text: string) => {
	// Track block boundary: reasoning is its own block type
	if (currentBlockType !== 'reasoning') {
		flushTextBlock();
		flushActivityGroup();
		currentBlockType = 'reasoning';
		currentReasoningBlock = '';
	}

	// Start thinking activity tracking if needed
	if (!currentThinkingId) {
		currentThinkingId = `thinking-${requestId}-${Date.now()}`;
		thinkingStartTime = Date.now();
	}

	currentReasoningBlock += text;

	// Create thinking activity event (for activity list)
	const activity: ActivityEvent = {
		id: currentThinkingId,
		type: 'thinking',
		status: 'running',
		startTime: thinkingStartTime!,
		thinkingContent: text,
	};

	const chunk: LLMResponseStreaming = {
		id: requestId,
		object: 'chat.completion.chunk',
		model: 'backend',
		choices: [
			{
				delta: {
					reasoning: text,
					activity,
					contentBlock: { type: 'reasoning' as const, text: currentReasoningBlock },
				},
				finish_reason: null,
			},
		],
	};
	enqueueChunk(chunk);
},
```

- [ ] **Step 3: Update onToolStart to flush reasoning**

In `onToolStart` (line 265), change:

```typescript
onToolStart: (name: string, input: Record<string, unknown>) => {
	// Track block boundary: flush pending text when tool starts
	flushTextBlock();
	currentBlockType = 'activity_group';
```

to:

```typescript
onToolStart: (name: string, input: Record<string, unknown>) => {
	// Track block boundary: flush pending text/reasoning when tool starts
	flushTextBlock();
	flushReasoningBlock();
	currentBlockType = 'activity_group';
```

- [ ] **Step 4: Update onTextDelta to flush reasoning**

In `onTextDelta` (line 241), change:

```typescript
onTextDelta: (text: string) => {
	// Track block boundary: close pending activity group when text starts
	if (currentBlockType !== 'text') {
		flushActivityGroup();
```

to:

```typescript
onTextDelta: (text: string) => {
	// Track block boundary: close pending activity/reasoning when text starts
	if (currentBlockType !== 'text') {
		flushActivityGroup();
		flushReasoningBlock();
```

- [ ] **Step 5: Update onComplete to flush reasoning**

In `onComplete` (line 406-409), change:

```typescript
onComplete: (result: string) => {
	// Flush any pending content blocks for interspersed layout
	flushTextBlock();
	flushActivityGroup();
```

to:

```typescript
onComplete: (result: string) => {
	// Flush any pending content blocks for interspersed layout
	flushTextBlock();
	flushActivityGroup();
	flushReasoningBlock();
```

- [ ] **Step 6: Reset thinking state on block boundary**

After the `flushReasoningBlock` function, we need to reset the thinking tracking when reasoning is flushed. Update the `flushReasoningBlock`:

```typescript
const flushReasoningBlock = () => {
	if (currentBlockType === 'reasoning' && currentReasoningBlock) {
		enqueueContentBlock({ type: 'reasoning', text: currentReasoningBlock });
		currentReasoningBlock = '';
	}
	// Reset thinking ID so next thinking phase gets a new one
	if (currentThinkingId && currentBlockType === 'reasoning') {
		// Finalize the thinking activity
		const finalActivity: ActivityEvent = {
			id: currentThinkingId,
			type: 'thinking',
			status: 'complete',
			startTime: thinkingStartTime!,
			endTime: Date.now(),
			thinkingContent: '',
		};
		enqueueChunk({
			id: requestId,
			object: 'chat.completion.chunk',
			model: 'backend',
			choices: [{ delta: { activity: finalActivity }, finish_reason: null }],
		});
		currentThinkingId = null;
		thinkingStartTime = null;
	}
};
```

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean or only pre-existing errors

- [ ] **Step 8: Commit**

```bash
git add src/core/backend/BackendProvider.ts
git commit -m "feat: emit reasoning as ContentBlock for interspersed display"
```

---

### Task 3: Merge reasoning contentBlocks in responseGenerator

**Files:**
- Modify: `src/utils/chat/responseGenerator.ts:402-429`

- [ ] **Step 1: Add reasoning coalescing to mergeContentBlocks**

In `responseGenerator.ts`, find `mergeContentBlocks` (line 402). Change from:

```typescript
private mergeContentBlocks(
    prevBlocks?: ContentBlock[],
    newBlock?: ContentBlock,
  ): ContentBlock[] | undefined {
    if (!newBlock) return prevBlocks
    if (!prevBlocks) return [newBlock]

    const last = prevBlocks[prevBlocks.length - 1]

    // Coalesce adjacent text blocks
    if (newBlock.type === 'text' && last?.type === 'text') {
      return [
        ...prevBlocks.slice(0, -1),
        { type: 'text' as const, text: last.text + newBlock.text },
      ]
    }

    // Coalesce adjacent activity groups
    if (newBlock.type === 'activity_group' && last?.type === 'activity_group') {
      return [
        ...prevBlocks.slice(0, -1),
        { type: 'activity_group' as const, activityIds: [...last.activityIds, ...newBlock.activityIds] },
      ]
    }

    // Different type = new block
    return [...prevBlocks, newBlock]
  }
```

to:

```typescript
private mergeContentBlocks(
    prevBlocks?: ContentBlock[],
    newBlock?: ContentBlock,
  ): ContentBlock[] | undefined {
    if (!newBlock) return prevBlocks
    if (!prevBlocks) return [newBlock]

    const last = prevBlocks[prevBlocks.length - 1]

    // Coalesce adjacent text blocks
    if (newBlock.type === 'text' && last?.type === 'text') {
      return [
        ...prevBlocks.slice(0, -1),
        { type: 'text' as const, text: last.text + newBlock.text },
      ]
    }

    // Coalesce adjacent activity groups
    if (newBlock.type === 'activity_group' && last?.type === 'activity_group') {
      return [
        ...prevBlocks.slice(0, -1),
        { type: 'activity_group' as const, activityIds: [...last.activityIds, ...newBlock.activityIds] },
      ]
    }

    // Replace adjacent reasoning blocks (latest has full accumulated text)
    if (newBlock.type === 'reasoning' && last?.type === 'reasoning') {
      return [
        ...prevBlocks.slice(0, -1),
        newBlock,
      ]
    }

    // Different type = new block
    return [...prevBlocks, newBlock]
  }
```

Note: reasoning blocks are **replaced** (not appended) because the BackendProvider sends the full accumulated reasoning text in each contentBlock delta.

- [ ] **Step 2: Commit**

```bash
git add src/utils/chat/responseGenerator.ts
git commit -m "feat: coalesce reasoning contentBlocks in response merger"
```

---

### Task 4: Render reasoning blocks in InterspersedContent

**Files:**
- Modify: `src/components/chat-view/InterspersedContent.tsx:44-89`

- [ ] **Step 1: Add reasoning case to InterspersedContent**

In `InterspersedContent.tsx`, add an import for AssistantMessageReasoning:

```typescript
import AssistantMessageReasoning from './AssistantMessageReasoning'
```

Then in the `contentBlocks.map` switch statement (line 44), add a case after the `'text'` case:

```typescript
case 'reasoning':
  return (
    <AssistantMessageReasoning
      key={`reasoning-${idx}`}
      reasoning={block.text}
      isStreaming={isStreaming && isLastBlock}
    />
  )
```

The full switch should now be:

```typescript
switch (block.type) {
  case 'text':
    return (
      <div key={`text-${idx}`} className="smtcmp-chat-messages-assistant">
        <AssistantMessageContent
          content={block.text}
          contextMessages={contextMessages}
          handleApply={onApply}
          isApplying={isApplying}
        />
      </div>
    )

  case 'reasoning':
    return (
      <AssistantMessageReasoning
        key={`reasoning-${idx}`}
        reasoning={block.text}
        isStreaming={isStreaming && isLastBlock}
      />
    )

  case 'activity_group': {
    // ... existing activity_group code unchanged ...
  }

  default:
    return null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat-view/InterspersedContent.tsx
git commit -m "feat: render reasoning blocks inline in interspersed content"
```

---

### Task 5: Remove separate reasoning from interspersed path

**Files:**
- Modify: `src/components/chat-view/AssistantToolMessageGroupItem.tsx:268-291`

- [ ] **Step 1: Remove reasoning rendering above InterspersedContent**

In `AssistantToolMessageGroupItem.tsx`, the interspersed path (line 268-291) currently renders reasoning above the content blocks:

```tsx
{hasContentBlocks ? (
  messages.map((message) => {
    if (message.role === 'assistant' && message.contentBlocks && message.contentBlocks.length > 0) {
      return (
        <React.Fragment key={message.id}>
          {message.reasoning && (
            <AssistantMessageReasoning reasoning={message.reasoning} isStreaming={isStreaming} />
          )}
          {message.annotations && (
            <AssistantMessageAnnotations
              annotations={message.annotations}
            />
          )}
          <InterspersedContent
```

Remove the reasoning block — it's now rendered within InterspersedContent via the `'reasoning'` contentBlock. Change to:

```tsx
{hasContentBlocks ? (
  messages.map((message) => {
    if (message.role === 'assistant' && message.contentBlocks && message.contentBlocks.length > 0) {
      return (
        <React.Fragment key={message.id}>
          {message.annotations && (
            <AssistantMessageAnnotations
              annotations={message.annotations}
            />
          )}
          <InterspersedContent
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add src/components/chat-view/AssistantToolMessageGroupItem.tsx
git commit -m "fix: remove duplicate reasoning from interspersed layout"
```

---

### Task 6: Fix mobile scroll — remove double-RAF and extend debounce

**Files:**
- Modify: `src/components/chat-view/Chat.tsx:180-184, 475-479`
- Modify: `src/components/chat-view/useAutoScroll.ts:4`

- [ ] **Step 1: Remove double-RAF nesting in Chat.tsx**

In `Chat.tsx`, find the first double-RAF (around line 180):

```typescript
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    forceScrollToBottom()
  })
})
```

Replace with single RAF:

```typescript
requestAnimationFrame(() => forceScrollToBottom())
```

Find the second double-RAF (around line 475):

```typescript
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    forceScrollToBottom()
  })
})
```

Replace with single RAF:

```typescript
requestAnimationFrame(() => forceScrollToBottom())
```

- [ ] **Step 2: Extend scroll debounce for mobile momentum**

In `useAutoScroll.ts` line 4, change:

```typescript
const USER_SCROLL_DEBOUNCE_MS = 150
```

to:

```typescript
const USER_SCROLL_DEBOUNCE_MS = 400
```

This gives iOS momentum scrolling time to finish before auto-scroll re-engages. 400ms covers most momentum decay without feeling sluggish.

- [ ] **Step 3: Remove deprecated webkit-overflow-scrolling**

In `styles.css`, find (around line 144):

```css
-webkit-overflow-scrolling: touch;
```

Remove this line. All modern iOS versions (13+) use hardware-accelerated scrolling by default. This property is deprecated and can interfere with scroll event timing.

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-view/Chat.tsx src/components/chat-view/useAutoScroll.ts styles.css
git commit -m "fix: mobile scroll jank — remove double-RAF, extend momentum debounce"
```

---

### Task 7: Build and deploy to test vault

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Clean build, `main.js` updated

- [ ] **Step 2: Deploy to test vault**

```bash
cp main.js ~/yes-chef-test/.obsidian/plugins/claudsidian/
cp manifest.json ~/yes-chef-test/.obsidian/plugins/claudsidian/
cp styles.css ~/yes-chef-test/.obsidian/plugins/claudsidian/
```

- [ ] **Step 3: Visual test — reasoning interspersing**

Open yes-chef-test vault in Obsidian, open Claudsidian chat. Send a prompt that triggers tool use (e.g., "Search for sorbet recipes and summarize what you find"). Verify:
- Reasoning appears BEFORE tool calls (chronologically)
- Tool calls appear in activity accordion AFTER reasoning
- Text response appears AFTER tool calls
- If model thinks again mid-response, a second reasoning block appears in-place
- Reasoning blocks are collapsible

- [ ] **Step 4: Visual test — mobile scroll**

Open the same vault on Obsidian mobile (or resize to mobile width). Send a multi-tool prompt. Verify:
- Chat auto-scrolls smoothly as content streams
- No visible jank or jumping when new content appears
- Scrolling up to read, then new content arrives — stays at scroll position (doesn't jump)
- Keyboard open/close doesn't cause scroll lock

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify reasoning interspersing and mobile scroll fixes"
```

---

## Self-Review

**Spec coverage:**
- Reasoning interspersed with tool calls and text: Tasks 1-5
- Mobile scroll locking: Task 6
- Visual verification: Task 7

**Placeholder scan:** None found. All code shown in full.

**Type consistency:**
- `ContentBlock` union extended in Task 1, used in Tasks 2-5 — `'reasoning'` type consistent throughout
- `flushReasoningBlock()` defined in Task 2, called in Steps 3-5 of same task
- `AssistantMessageReasoning` component imported in Task 4, removed from duplicate render in Task 5
