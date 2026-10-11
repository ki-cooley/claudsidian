// Transcript reducer tests (Task A3): a table over every stream fixture plus the targeted
// behaviours the plan calls out. Rows are hand-built from the shapes in docs/protocol.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  applyEvents,
  findItem,
  markControlSent,
  markOffline,
  markSent,
} from '../../src/core/transcript';
import { editDiff, summarizeTool, toolCategory } from '../../src/core/tool-summary';
import { createTranscript } from '../../src/core/types';
import type {
  AssistantTextItem,
  PermissionItem,
  QuestionItem,
  ResultItem,
  SystemItem,
  ToolItem,
  TranscriptItem,
  TranscriptState,
  UserItem,
} from '../../src/core/types';
import type {
  ContentBlock,
  RawMessageStreamEvent,
  ResultEvent,
  StreamJsonEvent,
  UserEvent,
  WireEventRow,
} from '../../src/api/types';
import { userMessagePayload } from '../../src/api/payloads';

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

const SESSION = 'cse_019B9e41WcXsxvZmtvJK9SEB';
const VAULT = '/Users/kicooley-winters/workspace/projects/yes-chef';
let counter = 0;

function nextUuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function row(seq: number | string, payload: StreamJsonEvent): WireEventRow {
  const full = {
    uuid: nextUuid(),
    session_id: SESSION,
    timestamp: '2026-10-10T20:00:00.000Z',
    ...(payload as Record<string, unknown>),
  } as StreamJsonEvent;
  return { sequence_num: seq, payload: full, event_type: 'client_event', source: 'bridge' };
}

function init(cwd = VAULT): StreamJsonEvent {
  return {
    type: 'system',
    subtype: 'init',
    cwd,
    model: 'claude-opus-5-5',
    permissionMode: 'auto',
    tools: ['Read', 'Edit', 'Bash', 'Agent'],
    slash_commands: ['compact', 'context', 'effort'],
    effort: 'high',
    claude_code_version: '2.1.296',
  };
}

function user(text: string, extra: Partial<UserEvent> = {}): StreamJsonEvent {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    ...extra,
  } as StreamJsonEvent;
}

function userString(text: string, extra: Partial<UserEvent> = {}): StreamJsonEvent {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, ...extra } as StreamJsonEvent;
}

function toolResult(
  toolUseId: string,
  content: string | ContentBlock[],
  isError = false,
  extra: Partial<UserEvent> = {},
): StreamJsonEvent {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
    parent_tool_use_id: null,
    ...extra,
  } as StreamJsonEvent;
}

function assistant(id: string, blocks: ContentBlock[], extra: Record<string, unknown> = {}): StreamJsonEvent {
  return {
    type: 'assistant',
    message: { id, role: 'assistant', content: blocks, model: 'claude-opus-5-5', stop_reason: null },
    parent_tool_use_id: null,
    ...extra,
  } as StreamJsonEvent;
}

function text(t: string): ContentBlock {
  return { type: 'text', text: t };
}

function toolUse(id: string, name: string, input: Record<string, unknown>): ContentBlock {
  return { type: 'tool_use', id, name, input };
}

function stream(event: RawMessageStreamEvent, extra: Record<string, unknown> = {}): StreamJsonEvent {
  return { type: 'stream_event', event, parent_tool_use_id: null, ...extra } as StreamJsonEvent;
}

function result(extra: Partial<ResultEvent> = {}): StreamJsonEvent {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    duration_ms: 1234,
    total_cost_usd: 0.0123,
    ...extra,
  } as StreamJsonEvent;
}

function canUseTool(
  requestId: string,
  toolName: string,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): StreamJsonEvent {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'can_use_tool', tool_name: toolName, input, permission_suggestions: [], ...extra },
  };
}

function controlResponse(requestId: string, response?: unknown, subtype: 'success' | 'error' = 'success', error?: string) {
  return {
    type: 'control_response',
    response: { subtype, request_id: requestId, response, error },
  } as StreamJsonEvent;
}

function reduce(rows: WireEventRow[], from: TranscriptState = createTranscript()): TranscriptState {
  return applyEvents(from, rows);
}

function kinds(state: TranscriptState): string[] {
  return state.items.map((i) => i.kind);
}

function only<K extends TranscriptItem['kind']>(state: TranscriptState, kind: K): Extract<TranscriptItem, { kind: K }>[] {
  return state.items.filter((i): i is Extract<TranscriptItem, { kind: K }> => i.kind === kind);
}

// ---------------------------------------------------------------------------
// Fixture table
// ---------------------------------------------------------------------------

interface Fixture {
  name: string;
  rows: WireEventRow[];
  expect: { itemKinds: string[]; turn: string };
}

// jsdom replaces URL, so import.meta.url is not a file URL here; vitest provides __dirname.
const FIXTURE_DIR =
  typeof __dirname === 'string' ? resolve(__dirname, '../fixtures/streams') : resolve(process.cwd(), 'test/fixtures/streams');
const fixtureFiles = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('fixture streams', () => {
  it('ships every fixture the plan names', () => {
    expect(fixtureFiles).toEqual([
      'error-result.json',
      'per-block-assistant.json',
      'permission.json',
      'question.json',
      'simple-reply.json',
      'slash-command.json',
      'streaming-deltas.json',
      'string-user-content.json',
      'subagent.json',
      'tool-calls.json',
    ]);
  });

  it.each(fixtureFiles)('%s reduces to the expected item kinds and turn', (file) => {
    const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture;
    expect(fx.rows.length).toBeGreaterThanOrEqual(8);
    expect(fx.rows.length).toBeLessThanOrEqual(20);
    const state = reduce(fx.rows);
    expect(kinds(state)).toEqual(fx.expect.itemKinds);
    expect(state.turn).toBe(fx.expect.turn);
    const maxSeq = Math.max(...fx.rows.map((r) => Number(r.sequence_num)));
    expect(state.lastSeq).toBe(maxSeq);
    expect(state.pending).toEqual([]);
    expect(state.inFlightUserUuids).toEqual([]);
  });

  it.each(fixtureFiles)('%s is order-independent and idempotent', (file) => {
    const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture;
    const forward = reduce(fx.rows);
    const shuffled = [...fx.rows].reverse();
    const backward = reduce(shuffled);
    expect(backward).toEqual(forward);
    // a second poll that repeats the whole window changes nothing
    expect(reduce(fx.rows, forward)).toBe(forward);
  });
});

// ---------------------------------------------------------------------------
// Targeted behaviours
// ---------------------------------------------------------------------------

describe('applyEvents', () => {
  it('attaches tool results and never renders them as bubbles', () => {
    const state = reduce([
      row(1, assistant('msg_01', [toolUse('toolu_01', 'Read', { file_path: `${VAULT}/menus/l10/menu.md` })])),
      row(2, toolResult('toolu_01', '# Latitude 10\n\nseven courses', false, { tool_use_result: { type: 'text' } })),
    ]);
    expect(state.items).toHaveLength(1);
    const tool = state.items[0] as ToolItem;
    expect(tool.kind).toBe('tool');
    expect(tool.status).toBe('done');
    expect(tool.isError).toBe(false);
    expect(tool.result).toBe('# Latitude 10\n\nseven courses');
    expect(only(state, 'user')).toHaveLength(0);

    const errored = reduce([
      row(1, assistant('msg_01', [toolUse('toolu_02', 'Bash', { command: 'npm test' })])),
      row(2, toolResult('toolu_02', [text('FAIL test/x.test.ts'), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }], true)),
    ]);
    const bash = errored.items[0] as ToolItem;
    expect(bash.status).toBe('error');
    expect(bash.isError).toBe(true);
    expect(bash.result).toBe('FAIL test/x.test.ts\n[image]');
    expect(only(errored, 'user')).toHaveLength(0);
  });

  it('drops a tool result whose tool call is outside the window', () => {
    const state = reduce([row(7, toolResult('toolu_missing', 'orphan'))]);
    expect(state.items).toEqual([]);
    expect(state.lastSeq).toBe(7);
  });

  it('accepts string content', () => {
    const state = reduce([row(1, userString('hello from the phone'))]);
    expect(state.items).toHaveLength(1);
    const item = state.items[0] as UserItem;
    expect(item.kind).toBe('user');
    expect(item.text).toBe('hello from the phone');
    expect(item.imageCount).toBe(0);
    expect(item.synthetic).toBe(false);
    expect(state.turn).toBe('working');
  });

  it('counts images and joins text blocks on block content', () => {
    const state = reduce([
      row(
        1,
        user('look at this', {
          message: {
            role: 'user',
            content: [
              text('look at this'),
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } },
              text('and this'),
            ],
          },
        }),
      ),
    ]);
    const item = state.items[0] as UserItem;
    expect(item.text).toBe('look at this\nand this');
    expect(item.imageCount).toBe(1);
  });

  it('coerces string sequence numbers', () => {
    const state = reduce([
      row('2', assistant('msg_01', [text('Hello')])),
      row('1', user('hi')),
    ]);
    expect(kinds(state)).toEqual(['user', 'assistant_text']);
    expect(state.lastSeq).toBe(2);
    expect(typeof state.lastSeq).toBe('number');
  });

  it('skips rows at or below lastSeq', () => {
    const first = reduce([row(1, user('hi')), row(2, assistant('msg_01', [text('Hello')]))]);
    expect(first.lastSeq).toBe(2);
    const second = reduce(
      [row(1, user('hi')), row(2, assistant('msg_01', [text('Hello')])), row(3, result())],
      first,
    );
    expect(kinds(second)).toEqual(['user', 'assistant_text', 'result']);
    expect(second.lastSeq).toBe(3);
    // a poll made only of rows we already have returns the same object
    expect(reduce([row(1, user('hi')), row(2, assistant('msg_01', [text('Hello')]))], second)).toBe(second);
    // duplicates inside one batch are applied once
    const dup = reduce([row(1, user('hi')), row(1, user('hi'))]);
    expect(dup.items).toHaveLength(1);
  });

  it('replaces partial text with the final assistant message', () => {
    const streaming = reduce([
      row(1, stream({ type: 'message_start', message: { id: 'msg_01', role: 'assistant' } })),
      row(2, stream({ type: 'content_block_start', index: 0, content_block: text('') })),
      row(3, stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } })),
      row(4, stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } })),
    ]);
    expect(streaming.turn).toBe('working');
    expect(streaming.items).toHaveLength(1);
    const partial = streaming.items[0] as AssistantTextItem;
    expect(partial.kind).toBe('assistant_text');
    expect(partial.id).toBe('msg_01:0');
    expect(partial.partial).toBe(true);
    expect(partial.text).toBe('Hello');

    const stopped = reduce([row(5, stream({ type: 'content_block_stop', index: 0 }))], streaming);
    expect((stopped.items[0] as AssistantTextItem).partial).toBe(false);

    const done = reduce(
      [row(6, stream({ type: 'message_stop' })), row(7, assistant('msg_01', [text('Hello')]))],
      stopped,
    );
    expect(done.items).toHaveLength(1);
    const final = done.items[0] as AssistantTextItem;
    expect(final.id).toBe('msg_01:0');
    expect(final.partial).toBe(false);
    expect(final.text).toBe('Hello');
    expect(final.messageId).toBe('msg_01');
    expect(final.ts).toBe(Date.parse('2026-10-10T20:00:00.000Z'));
  });

  it('builds streaming thinking and tool input, parsing the input on stop', () => {
    const state = reduce([
      row(1, stream({ type: 'message_start', message: { id: 'msg_02', role: 'assistant' } })),
      row(2, stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })),
      row(3, stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me look' } })),
      row(4, stream({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } })),
      row(5, stream({ type: 'content_block_stop', index: 0 })),
      row(6, stream({ type: 'content_block_start', index: 1, content_block: toolUse('toolu_09', 'Grep', {}) })),
      row(7, stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pattern": "dash' } })),
      row(8, stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'i"}' } })),
    ]);
    expect(kinds(state)).toEqual(['thinking', 'tool']);
    expect(state.items[0]).toMatchObject({ kind: 'thinking', id: 'msg_02:0', text: 'Let me look', partial: false });
    const running = state.items[1] as ToolItem;
    expect(running.id).toBe('toolu_09');
    expect(running.name).toBe('Grep');
    expect(running.status).toBe('running');
    expect(running.inputPartial).toBe('{"pattern": "dashi"}');

    const stopped = reduce([row(9, stream({ type: 'content_block_stop', index: 1 }))], state);
    const parsed = stopped.items[1] as ToolItem;
    expect(parsed.input).toEqual({ pattern: 'dashi' });
    expect(parsed.inputPartial).toBeUndefined();

    const finalised = reduce(
      [row(10, assistant('msg_02', [{ type: 'thinking', thinking: 'Let me look', signature: 'abc' }, toolUse('toolu_09', 'Grep', { pattern: 'dashi', path: 'components' })]))],
      stopped,
    );
    expect(kinds(finalised)).toEqual(['thinking', 'tool']);
    expect((finalised.items[1] as ToolItem).input).toEqual({ pattern: 'dashi', path: 'components' });
  });

  it('keeps one item per block when a message arrives one block per assistant event', () => {
    // Claude Code's shape: consecutive assistant events share message.id, each with a single block.
    const thinkThenText = reduce([
      row(1, assistant('msg_A', [{ type: 'thinking', thinking: 'Plan.', signature: 's' }])),
      row(2, assistant('msg_A', [text('Answer')])),
    ]);
    expect(kinds(thinkThenText)).toEqual(['thinking', 'assistant_text']);
    expect(thinkThenText.items.map((i) => i.id)).toEqual(['msg_A:0', 'msg_A:1']);
    expect(thinkThenText.items[0]).toMatchObject({ text: 'Plan.', partial: false });
    expect(thinkThenText.items[1]).toMatchObject({ text: 'Answer', partial: false });

    const textThenTool = reduce([
      row(1, assistant('msg_B', [text('Reading.')])),
      row(2, assistant('msg_B', [toolUse('toolu_B1', 'Read', { file_path: 'x.md' })])),
      row(3, toolResult('toolu_B1', 'contents')),
    ]);
    expect(kinds(textThenTool)).toEqual(['assistant_text', 'tool']);
    expect((textThenTool.items[1] as ToolItem).status).toBe('done');

    const twoThinking = reduce([
      row(1, assistant('msg_C', [{ type: 'thinking', thinking: 'One.', signature: 's' }])),
      row(2, assistant('msg_C', [{ type: 'thinking', thinking: 'Two.', signature: 's' }])),
      row(3, assistant('msg_C', [text('Done.')])),
    ]);
    expect(kinds(twoThinking)).toEqual(['thinking', 'thinking', 'assistant_text']);
    expect(twoThinking.items.map((i) => i.id)).toEqual(['msg_C:0', 'msg_C:1', 'msg_C:2']);

    // a new message id starts the block index over, even without a message_start
    const nextMessage = reduce([row(4, assistant('msg_D', [text('Next.')]))], twoThinking);
    expect(nextMessage.items[3]).toMatchObject({ kind: 'assistant_text', id: 'msg_D:0', text: 'Next.' });
  });

  it('matches per-block final events to their streamed partials', () => {
    const partials = [
      row(1, stream({ type: 'message_start', message: { id: 'msg_E', role: 'assistant' } })),
      row(2, stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })),
      row(3, stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan.' } })),
      row(4, stream({ type: 'content_block_stop', index: 0 })),
      row(5, stream({ type: 'content_block_start', index: 1, content_block: text('') })),
      row(6, stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Ans' } })),
    ];
    const finals = (from: number) => [
      row(from, assistant('msg_E', [{ type: 'thinking', thinking: 'Plan.', signature: 's' }])),
      row(from + 1, assistant('msg_E', [text('Answer')])),
    ];
    const expectOne = (state: TranscriptState) => {
      expect(kinds(state)).toEqual(['thinking', 'assistant_text']);
      expect(state.items[0]).toMatchObject({ id: 'msg_E:0', text: 'Plan.', partial: false });
      expect(state.items[1]).toMatchObject({ id: 'msg_E:1', text: 'Answer', partial: false });
    };
    // finals interleaved with the stream (each after its content_block_stop)
    expectOne(reduce([...partials, ...finals(7), row(9, stream({ type: 'content_block_stop', index: 1 })), row(10, stream({ type: 'message_stop' }))]));
    // finals after message_stop
    expectOne(reduce([...partials, row(7, stream({ type: 'content_block_stop', index: 1 })), row(8, stream({ type: 'message_stop' })), ...finals(9)]));
  });

  it('adopts the partials of a window that opens mid-stream', () => {
    // no message_start in the window: the partial carries a placeholder id until the final message names it
    const state = reduce([
      row(1, stream({ type: 'content_block_start', index: 0, content_block: text('') })),
      row(2, stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } })),
      row(3, stream({ type: 'content_block_stop', index: 0 })),
      row(4, stream({ type: 'message_stop' })),
    ]);
    expect(state.items).toHaveLength(1);
    expect((state.items[0] as AssistantTextItem).partial).toBe(false);
    expect(state.items[0]?.id).not.toBe('msg_F:0');
    const done = reduce([row(5, assistant('msg_F', [text('Partial text final')]))], state);
    expect(done.items).toHaveLength(1);
    expect(done.items[0]).toMatchObject({ kind: 'assistant_text', id: 'msg_F:0', text: 'Partial text final', partial: false });
    expect(done.turn).toBe('working');
  });

  it('adopts per-block partials by their stream index when the window opens inside a message', () => {
    // per-block-assistant.json from row 67: block 0 (thinking) and its final at 66 fall outside the window,
    // so the first row is content_block_start index 1. The final text at 70 is that block, not a new block 0.
    const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, 'per-block-assistant.json'), 'utf8')) as Fixture;
    const window = fx.rows.filter((r) => Number(r.sequence_num) >= 67);
    const state = reduce(window);
    expect(kinds(state)).toEqual(['assistant_text', 'tool', 'assistant_text', 'result']);
    const first = state.items[0] as AssistantTextItem;
    expect(first).toMatchObject({ id: 'msg_01Qx3rT8vL2nWp7yAe4bKu9D:1', text: 'Let me read the tare note.', partial: false });
    expect(only(state, 'assistant_text').filter((t) => t.text === first.text)).toHaveLength(1);
    const tool = state.items[1] as ToolItem;
    expect(tool).toMatchObject({ id: 'toolu_01Mn5pV0xN4qYr9aCg6dMw1F', name: 'Read', status: 'done' });
    expect(tool.input).toEqual({ file_path: `${VAULT}/components/tare.md` });
    expect(state.turn).toBe('idle');
    expect(state.streaming).toBeUndefined();
    expect(reduce([...window].reverse())).toEqual(state);

    // the same window cut one row later still adopts, now at the final text itself
    const later = reduce(fx.rows.filter((r) => Number(r.sequence_num) >= 68));
    expect(kinds(later)).toEqual(['assistant_text', 'tool', 'assistant_text', 'result']);
    expect(only(later, 'assistant_text').filter((t) => t.text === first.text)).toHaveLength(1);
  });

  it('a packed final still lines up with adopted partials by position', () => {
    // SDK shape: one assistant event with every block; the window opened at block 1
    const state = reduce([
      row(1, stream({ type: 'content_block_start', index: 1, content_block: text('') })),
      row(2, stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Ans' } })),
      row(3, assistant('msg_P', [{ type: 'thinking', thinking: 'Plan.', signature: 's' }, text('Answer')])),
    ]);
    expect(kinds(state)).toEqual(['assistant_text', 'thinking']);
    expect(state.items[0]).toMatchObject({ id: 'msg_P:1', text: 'Answer', partial: false });
    expect(state.items[1]).toMatchObject({ id: 'msg_P:0', text: 'Plan.' });
  });

  it('optimistic send is replaced by the echo', () => {
    const payload = userMessagePayload('what next?');
    const sent = markSent(createTranscript(), payload, 'what next?', 0);
    expect(sent.turn).toBe('sending');
    expect(sent.inFlightUserUuids).toEqual([payload.uuid]);
    expect(sent.items).toHaveLength(1);
    expect(sent.items[0]).toMatchObject({ kind: 'user', id: payload.uuid, text: 'what next?', imageCount: 0 });

    const echoed = reduce([row(5, { ...payload, timestamp: '2026-10-10T20:00:01.000Z' } as StreamJsonEvent)], sent);
    expect(echoed.items).toHaveLength(1);
    expect(echoed.items[0]).toMatchObject({ kind: 'user', id: payload.uuid, text: 'what next?' });
    expect(echoed.inFlightUserUuids).toEqual([]);
    expect(echoed.turn).toBe('working');
    expect(echoed.lastSeq).toBe(5);

    // an item sent before the one echoed keeps its place
    const second = userMessagePayload('and after?');
    const twoSent = markSent(markSent(createTranscript(), payload, 'what next?', 1), second, 'and after?', 0);
    const firstEcho = reduce([row(1, payload)], twoSent);
    expect(firstEcho.items.map((i) => i.id)).toEqual([payload.uuid, second.uuid]);
    expect(firstEcho.inFlightUserUuids).toEqual([second.uuid]);
  });

  it('permission request moves to needs_input and resolves on control_response', () => {
    const asked = reduce([
      row(1, user('clean the build dir')),
      row(2, assistant('msg_01', [toolUse('toolu_03', 'Bash', { command: 'rm -rf build' })])),
      row(
        3,
        canUseTool('req_01', 'Bash', { command: 'rm -rf build' }, {
          tool_use_id: 'toolu_03',
          blocked_path: '/Users/kicooley-winters/workspace/projects/yes-chef/build',
          decision_reason: 'destructive command',
          permission_suggestions: [{ type: 'addRules', destination: 'session' }],
        }),
      ),
    ]);
    expect(asked.turn).toBe('needs_input');
    expect(asked.pending).toHaveLength(1);
    expect(asked.pending[0]).toMatchObject({ requestId: 'req_01', kind: 'permission' });
    expect(kinds(asked)).toEqual(['user', 'tool', 'permission']);
    const perm = asked.items[2] as PermissionItem;
    expect(perm).toMatchObject({
      id: 'req_01',
      requestId: 'req_01',
      toolName: 'Bash',
      input: { command: 'rm -rf build' },
      toolUseId: 'toolu_03',
      decisionReason: 'destructive command',
    });
    expect(perm.blockedPath).toContain('/build');
    expect(perm.suggestions).toHaveLength(1);
    expect(perm.resolved).toBeUndefined();

    const denied = reduce([row(4, controlResponse('req_01', { behavior: 'deny', message: 'not now' }))], asked);
    expect((denied.items[2] as PermissionItem).resolved).toBe('deny');
    expect(denied.pending).toEqual([]);
    expect(denied.turn).toBe('working');

    const allowed = reduce([row(4, controlResponse('req_01', { behavior: 'allow', updatedInput: { command: 'rm -rf build' } }))], asked);
    expect((allowed.items[2] as PermissionItem).resolved).toBe('allow');

    const bare = reduce([row(4, controlResponse('req_01'))], asked);
    expect((bare.items[2] as PermissionItem).resolved).toBe('allow');

    // a duplicate request_id in a later poll adds nothing
    const again = reduce([row(3, canUseTool('req_01', 'Bash', { command: 'rm -rf build' }))], denied);
    expect(again).toBe(denied);
  });

  it('a tool_result for the pending permission resolves it as allowed', () => {
    // answered at the Mac terminal: no control_response reaches us, but the tool ran
    const asked = reduce([
      row(1, assistant('msg_01', [toolUse('toolu_03', 'Bash', { command: 'ls' })])),
      row(2, canUseTool('req_01', 'Bash', { command: 'ls' }, { tool_use_id: 'toolu_03' })),
    ]);
    expect(asked.turn).toBe('needs_input');
    const ran = reduce([row(3, toolResult('toolu_03', 'menu.md'))], asked);
    expect(ran.pending).toEqual([]);
    expect(ran.turn).toBe('working');
    expect((ran.items[1] as PermissionItem).resolved).toBe('allow');
    expect((ran.items[0] as ToolItem).status).toBe('done');
    // a result for another tool leaves the card pinned
    const other = reduce([row(3, toolResult('toolu_99', 'x'))], asked);
    expect(other.pending).toHaveLength(1);
    expect(other.turn).toBe('needs_input');
  });

  it('a permission_denied for the tool resolves the pending permission as denied', () => {
    const asked = reduce([row(1, canUseTool('req_01', 'Bash', { command: 'rm -rf build' }, { tool_use_id: 'toolu_03' }))]);
    const byId = reduce([row(2, { type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 'toolu_03' })], asked);
    expect(byId.pending).toEqual([]);
    expect((byId.items[0] as PermissionItem).resolved).toBe('deny');
    expect(kinds(byId)).toEqual(['permission', 'system']);
    expect(byId.turn).toBe('working');
    const byName = reduce([row(2, { type: 'system', subtype: 'permission_denied', tool_name: 'Bash' })], asked);
    expect((byName.items[0] as PermissionItem).resolved).toBe('deny');
    const otherTool = reduce([row(2, { type: 'system', subtype: 'permission_denied', tool_name: 'Edit', tool_use_id: 'toolu_04' })], asked);
    expect(otherTool.pending).toHaveLength(1);
    expect((otherTool.items[0] as PermissionItem).resolved).toBeUndefined();
  });

  it('question item parses AskUserQuestion input', () => {
    const input = {
      questions: [
        {
          question: 'Which wine for the dashi course?',
          header: 'Pairing',
          options: [
            { label: 'Riesling', description: 'off-dry, Mosel' },
            { label: 'Chenin', description: 'Savennieres' },
          ],
          multiSelect: false,
        },
        {
          question: 'Serve with?',
          options: [{ label: 'bread' }, { label: 'rice' }],
          multiSelect: true,
        },
      ],
    };
    const asked = reduce([
      row(1, assistant('msg_01', [toolUse('toolu_04', 'AskUserQuestion', input)])),
      row(2, canUseTool('req_02', 'AskUserQuestion', input, { tool_use_id: 'toolu_04' })),
    ]);
    expect(asked.turn).toBe('needs_input');
    expect(asked.pending[0]).toMatchObject({ requestId: 'req_02', kind: 'question' });
    expect(kinds(asked)).toEqual(['tool', 'question']);
    const q = asked.items[1] as QuestionItem;
    expect(q.id).toBe('req_02');
    expect(q.resolved).toBe(false);
    expect(q.questions).toHaveLength(2);
    expect(q.questions[0]).toEqual({
      question: 'Which wine for the dashi course?',
      header: 'Pairing',
      options: [
        { label: 'Riesling', description: 'off-dry, Mosel' },
        { label: 'Chenin', description: 'Savennieres' },
      ],
      multiSelect: false,
    });
    expect(q.questions[1]?.multiSelect).toBe(true);
    expect(q.questions[1]?.options).toEqual([{ label: 'bread' }, { label: 'rice' }]);

    const answered = reduce(
      [
        row(
          3,
          controlResponse('req_02', {
            behavior: 'allow',
            updatedInput: { ...input, answers: { 'Which wine for the dashi course?': 'Riesling', 'Serve with?': ['bread', 'rice'] } },
          }),
        ),
      ],
      asked,
    );
    const done = answered.items[1] as QuestionItem;
    expect(done.resolved).toBe(true);
    expect(done.answers).toEqual({ 'Which wine for the dashi course?': 'Riesling', 'Serve with?': ['bread', 'rice'] });
    expect(answered.pending).toEqual([]);
    expect(answered.turn).toBe('working');
  });

  it('tolerates a malformed AskUserQuestion input', () => {
    const state = reduce([row(1, canUseTool('req_03', 'AskUserQuestion', { questions: 'nope' }))]);
    const q = state.items[0] as QuestionItem;
    expect(q.kind).toBe('question');
    expect(q.questions).toEqual([]);
  });

  it('nests subagent traffic under the Agent tool call', () => {
    const parent = { parent_tool_use_id: 'toolu_agent' };
    const state = reduce([
      row(1, user('find every mention of kombu')),
      row(2, assistant('msg_01', [toolUse('toolu_agent', 'Agent', { description: 'Search kombu', prompt: 'grep for kombu', subagent_type: 'Explore' })])),
      row(3, assistant('msg_sub1', [text('Searching the vault.')], parent)),
      row(4, assistant('msg_sub1', [toolUse('toolu_sub_read', 'Grep', { pattern: 'kombu' })], parent)),
      row(5, toolResult('toolu_sub_read', 'components/dashi.md:3: kombu', false, parent)),
      row(6, assistant('msg_sub2', [text('Three files mention kombu.')], parent)),
      row(7, toolResult('toolu_agent', 'Three files mention kombu.')),
      row(8, assistant('msg_02', [text('Found three notes.')])),
      row(9, result()),
    ]);
    expect(kinds(state)).toEqual(['user', 'tool', 'assistant_text', 'result']);
    const agent = state.items[1] as ToolItem;
    expect(agent.id).toBe('toolu_agent');
    expect(agent.status).toBe('done');
    expect(agent.result).toBe('Three files mention kombu.');
    expect(agent.children.map((c) => c.kind)).toEqual(['assistant_text', 'tool', 'assistant_text']);
    const nested = agent.children[1] as ToolItem;
    expect(nested.status).toBe('done');
    expect(nested.result).toBe('components/dashi.md:3: kombu');
    expect(nested.parentToolUseId).toBe('toolu_agent');
    expect((agent.children[0] as AssistantTextItem).parentToolUseId).toBe('toolu_agent');

    expect(findItem(state, 'toolu_sub_read')).toBe(nested);
    expect(findItem(state, 'msg_sub2:0')).toMatchObject({ kind: 'assistant_text', text: 'Three files mention kombu.' });
    expect(findItem(state, 'nope')).toBeUndefined();
    expect(state.turn).toBe('idle');
  });

  it('creates a placeholder parent when subagent traffic arrives before its tool call', () => {
    const state = reduce([
      row(1, assistant('msg_sub1', [text('Working.')], { parent_tool_use_id: 'toolu_unknown' })),
    ]);
    expect(kinds(state)).toEqual(['tool']);
    const placeholder = state.items[0] as ToolItem;
    expect(placeholder.id).toBe('toolu_unknown');
    expect(placeholder.children).toHaveLength(1);
    // the real tool_use arriving later fills in name and input without dropping the children
    const filled = reduce([row(2, assistant('msg_01', [toolUse('toolu_unknown', 'Agent', { prompt: 'x' })]))], state);
    expect(filled.items).toHaveLength(1);
    expect((filled.items[0] as ToolItem).name).toBe('Agent');
    expect((filled.items[0] as ToolItem).children).toHaveLength(1);
  });

  it('result closes the turn and clears in-flight', () => {
    const payload = userMessagePayload('go');
    const sent = markSent(createTranscript(), payload, 'go', 0);
    const state = reduce(
      [
        row(1, stream({ type: 'message_start', message: { id: 'msg_01', role: 'assistant' } })),
        row(2, stream({ type: 'content_block_start', index: 0, content_block: text('') })),
        row(3, stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } })),
        row(4, result({ num_turns: 2, duration_ms: 4200, total_cost_usd: 0.05 })),
      ],
      sent,
    );
    expect(state.turn).toBe('idle');
    expect(state.inFlightUserUuids).toEqual([]);
    expect(state.lastResult).toBeDefined();
    const res = state.items[state.items.length - 1] as ResultItem;
    expect(res).toMatchObject({ kind: 'result', subtype: 'success', isError: false, durationMs: 4200, costUsd: 0.05, numTurns: 2, errors: [] });
    expect(state.lastResult).toBe(res);
    // partial text left open by an interrupted stream is finalised
    expect((state.items[1] as AssistantTextItem).partial).toBe(false);

    const errored = reduce([
      row(1, user('x')),
      row(2, result({ subtype: 'error_during_execution', is_error: true, errors: ['API rate limit'] })),
    ]);
    const err = errored.items[1] as ResultItem;
    expect(err.kind).toBe('result');
    expect(err.isError).toBe(true);
    expect(err.errors).toEqual(['API rate limit']);
    expect(errored.turn).toBe('idle');

    const max = reduce([row(1, result({ subtype: 'error_max_turns' }))]);
    expect((max.items[0] as ResultItem).isError).toBe(true);
  });

  it('a local_command result leaves pending requests and open streams alone', () => {
    const state = reduce([
      row(1, stream({ type: 'message_start', message: { id: 'msg_01', role: 'assistant' } })),
      row(2, stream({ type: 'content_block_start', index: 0, content_block: text('') })),
      row(3, stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Still' } })),
      row(4, canUseTool('req_01', 'Bash', { command: 'npm test' })),
      row(5, result({ num_turns: 0, local_command: '/cost' })),
    ]);
    expect(kinds(state)).toEqual(['assistant_text', 'permission', 'result']);
    expect(state.turn).toBe('needs_input');
    expect(state.pending.map((p) => p.requestId)).toEqual(['req_01']);
    expect((state.items[1] as PermissionItem).resolved).toBeUndefined();
    expect((state.items[0] as AssistantTextItem).partial).toBe(true);
    expect(state.lastResult?.localCommand).toBe('/cost');
    // a real result retires the request
    const closed = reduce([row(6, result())], state);
    expect(closed.turn).toBe('idle');
    expect(closed.pending).toEqual([]);
    expect((closed.items[1] as PermissionItem).resolved).toBe('deny');
  });

  it('starts a new turn on a user event after a result', () => {
    const state = reduce([
      row(1, user('first')),
      row(2, assistant('msg_01', [text('ok')])),
      row(3, result()),
    ]);
    expect(state.turn).toBe('idle');
    const next = reduce([row(4, user('second'))], state);
    expect(next.turn).toBe('working');
  });

  it('returns the same state object for unknown event types', () => {
    const base = reduce([row(1, init()), row(2, assistant('msg_01', [text('hi')]))]);
    const replay = applyEvent(base, row(2, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }));
    expect(replay).toBe(base);
    // at a new sequence number only lastSeq moves
    const bumped = applyEvent(base, row(3, { type: 'tool_progress', tool_use_id: 'toolu_01', elapsed_time_seconds: 3 }));
    expect(bumped.lastSeq).toBe(3);
    expect(bumped.items).toBe(base.items);
    expect(bumped.turn).toBe(base.turn);
    const batch = reduce([row(4, { type: 'tool_use_summary', summary: 'x' }), row(5, { type: 'auth_status' })], bumped);
    expect(batch.items).toBe(base.items);
    expect(batch.lastSeq).toBe(5);
    // malformed rows never throw
    expect(applyEvent(base, { sequence_num: 9, payload: undefined as unknown as StreamJsonEvent }).lastSeq).toBe(9);
    expect(applyEvent(base, { sequence_num: 'nan', payload: { type: 'user', message: { role: 'user', content: 'x' } } }).lastSeq).toBe(2);
  });

  it('records init and shows the start line only as the first event in the window', () => {
    const first = reduce([row(1, init()), row(2, user('hi'))]);
    expect(kinds(first)).toEqual(['system', 'user']);
    expect(first.items[0]).toMatchObject({ kind: 'system', subtype: 'init', text: 'Session started in yes-chef' });
    expect(first.init).toEqual({
      cwd: VAULT,
      model: 'claude-opus-5-5',
      permissionMode: 'auto',
      effort: 'high',
      slashCommands: ['compact', 'context', 'effort'],
      tools: ['Read', 'Edit', 'Bash', 'Agent'],
      claudeCodeVersion: '2.1.296',
    });
    expect(first.model).toBe('claude-opus-5-5');
    expect(first.permissionMode).toBe('auto');

    const later = reduce([row(1, user('hi')), row(2, init('/tmp/other'))]);
    expect(kinds(later)).toEqual(['user']);
    expect(later.init?.cwd).toBe('/tmp/other');

    // an optimistic send before any wire event does not hide the start line
    const optimistic = markSent(createTranscript(), userMessagePayload('x'), 'x', 0);
    expect(kinds(reduce([row(1, init())], optimistic))).toEqual(['user', 'system']);
  });

  it('renders muted system lines and ignores the rest', () => {
    const state = reduce([
      row(1, user('x')),
      row(2, { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 150000 } }),
      row(3, { type: 'system', subtype: 'permission_denied', tool_name: 'Bash', message: 'Permission denied: rm -rf /' }),
      row(4, { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 1000, error_status: 529 }),
      row(5, { type: 'system', subtype: 'status', status: 'compacting' }),
      row(6, { type: 'system', subtype: 'task_started', task_id: 't1', description: 'bg' }),
      row(7, { type: 'system', subtype: 'hook_started', hook_name: 'style-lint' }),
      row(8, { type: 'system', subtype: 'permission_denied', tool_name: 'Edit' }),
    ]);
    expect(kinds(state)).toEqual(['user', 'system', 'system', 'system', 'system']);
    const sys = only(state, 'system');
    expect(sys.map((s) => s.subtype)).toEqual(['compact_boundary', 'permission_denied', 'api_retry', 'permission_denied']);
    expect(sys.map((s) => s.text)).toEqual([
      'Context compacted',
      'Permission denied: rm -rf /',
      'Retrying API (attempt 2)',
      'Permission denied for Edit',
    ]);
    expect(state.turn).toBe('working');
  });

  it('hides command wrappers and shows "Ran /x" for local commands', () => {
    const state = reduce([
      row(1, user('/effort high')),
      row(
        2,
        userString('<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>high</command-args>', {
          isMeta: true,
        }),
      ),
      row(3, userString('<local-command-stdout></local-command-stdout>', { isMeta: true })),
      row(4, assistant('msg_01', [text('Set effort level to high (saved as your default for new sessions)')])),
      row(5, result({ num_turns: 0, local_command: '/effort' })),
      row(6, userString('<system-reminder>ignored</system-reminder>', { isSynthetic: true })),
      row(7, userString('<local-command-stdout>Context: 42% used</local-command-stdout>', { isMeta: true })),
      row(8, userString('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>', { isMeta: true })),
    ]);
    expect(kinds(state)).toEqual(['user', 'system', 'assistant_text', 'result', 'system', 'system']);
    expect((state.items[1] as SystemItem).text).toBe('Ran /effort high');
    expect((state.items[3] as ResultItem).localCommand).toBe('/effort');
    expect((state.items[4] as SystemItem).text).toBe('Context: 42% used');
    expect((state.items[5] as SystemItem).text).toBe('Ran /compact');
    // meta text that is not a wrapper still shows, flagged synthetic
    const peer = reduce([row(1, userString('Another Claude session sent a message: hello', { isMeta: true }))]);
    expect(peer.items[0]).toMatchObject({ kind: 'user', synthetic: true });
  });

  it('surfaces assistant errors and control_response errors as error items', () => {
    const state = reduce([
      row(1, user('x')),
      row(2, assistant('msg_01', [text('[Request interrupted by user]')], { aborted: true })),
      row(3, assistant('msg_02', [], { error: 'rate_limit' })),
      row(4, controlResponse('req_09', undefined, 'error', 'REPL bridge does not handle control_request subtype: apply_flag_settings')),
      row(5, controlResponse('req_10', {})),
    ]);
    expect(kinds(state)).toEqual(['user', 'assistant_text', 'error', 'error', 'error']);
    expect((state.items[2] as { text: string }).text).toBe('Request aborted');
    expect((state.items[3] as { text: string }).text).toContain('rate_limit');
    expect((state.items[4] as { text: string }).text).toBe('REPL bridge does not handle control_request subtype: apply_flag_settings');
  });

  it('ignores echoed control requests and treats dialogs as pending', () => {
    const state = reduce([
      row(1, { type: 'control_request', request_id: 'req_set', request: { subtype: 'set_model', model: 'claude-sonnet-5' } }),
      row(2, { type: 'control_request', request_id: 'req_int', request: { subtype: 'interrupt' } }),
      row(3, {
        type: 'control_request',
        request_id: 'req_dlg',
        request: { subtype: 'request_user_dialog', title: 'Sign in to MCP', message: 'Open the browser to continue' },
      }),
    ]);
    expect(kinds(state)).toEqual(['system']);
    expect((state.items[0] as SystemItem).text).toBe('Sign in to MCP: Open the browser to continue');
    expect(state.pending).toEqual([expect.objectContaining({ requestId: 'req_dlg', kind: 'dialog' })]);
    expect(state.turn).toBe('needs_input');
    const resolved = reduce([row(4, controlResponse('req_dlg', {}))], state);
    expect(resolved.pending).toEqual([]);
    expect(resolved.turn).toBe('working');
  });
});

describe('local mutations', () => {
  it('markControlSent resolves a pending permission optimistically', () => {
    const asked = reduce([row(1, canUseTool('req_01', 'Bash', { command: 'ls' }))]);
    const sent = markControlSent(asked, 'req_01');
    expect(sent.pending).toEqual([]);
    expect(sent.turn).toBe('working');
    expect((sent.items[0] as PermissionItem).resolved).toBe('allow');
    const denied = markControlSent(asked, 'req_01', { behavior: 'deny', message: 'no' });
    expect((denied.items[0] as PermissionItem).resolved).toBe('deny');
    // the echo of our own response arriving later changes nothing further
    expect(reduce([row(2, controlResponse('req_01', { behavior: 'deny', message: 'no' }))], denied).items).toEqual(denied.items);
    expect(markControlSent(asked, 'req_unknown')).toBe(asked);
    const q = reduce([row(1, canUseTool('req_02', 'AskUserQuestion', { questions: [] }))]);
    expect((markControlSent(q, 'req_02').items[0] as QuestionItem).resolved).toBe(true);
  });

  it('markSent keeps needs_input while a request is pending', () => {
    const asked = reduce([row(1, canUseTool('req_01', 'Bash', { command: 'ls' }))]);
    const sent = markSent(asked, userMessagePayload('actually stop'), 'actually stop', 0);
    expect(sent.turn).toBe('needs_input');
    expect(kinds(sent)).toEqual(['permission', 'user']);
  });

  it('markOffline toggles and restores the derived turn', () => {
    const working = reduce([row(1, user('x')), row(2, assistant('msg_01', [text('hi')]))]);
    const off = markOffline(working, true);
    expect(off.turn).toBe('offline');
    expect(markOffline(off, true)).toBe(off);
    expect(markOffline(working, false)).toBe(working);
    expect(markOffline(off, false).turn).toBe('working');

    const idle = reduce([row(3, result())], working);
    expect(markOffline(markOffline(idle, true), false).turn).toBe('idle');

    const pending = reduce([row(4, canUseTool('req_01', 'Bash', { command: 'ls' }))], idle);
    expect(markOffline(markOffline(pending, true), false).turn).toBe('needs_input');

    const sending = markSent(idle, userMessagePayload('y'), 'y', 0);
    expect(markOffline(markOffline(sending, true), false).turn).toBe('sending');
    expect(markOffline(markOffline(createTranscript(), true), false).turn).toBe('idle');
  });
});

describe('tool-summary', () => {
  it('summarizeTool covers Read, Edit, Write, Bash, Grep, Glob, Agent, WebFetch, mcp__x__y', () => {
    expect(summarizeTool('Read', { file_path: `${VAULT}/menus/x.md` }, VAULT)).toBe('Read menus/x.md');
    expect(summarizeTool('Read', { file_path: `${VAULT}/menus/x.md` })).toBe(`Read ${VAULT}/menus/x.md`);
    expect(summarizeTool('Read', { file_path: 'menus/x.md', offset: 10, limit: 40 })).toBe('Read menus/x.md (lines 10-49)');
    expect(summarizeTool('Edit', { file_path: `${VAULT}/recipes/tare.md`, old_string: 'a', new_string: 'b' }, VAULT)).toBe('Edit recipes/tare.md');
    expect(summarizeTool('MultiEdit', { file_path: 'recipes/tare.md', edits: [{}, {}, {}] })).toBe('Edit recipes/tare.md (3 edits)');
    expect(summarizeTool('Write', { file_path: 'notes/new.md', content: '# hi' })).toBe('Write notes/new.md');
    expect(summarizeTool('NotebookEdit', { notebook_path: 'x.ipynb', new_source: '' })).toBe('Edit x.ipynb');
    expect(summarizeTool('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Bash: npm test');
    expect(summarizeTool('Bash', { command: 'cd x &&\nnpm test\nnpm run lint' })).toBe('Bash: cd x && (+2 lines)');
    expect(summarizeTool('Bash', {})).toBe('Bash');
    expect(summarizeTool('Grep', { pattern: 'kombu', path: 'components' })).toBe('Grep "kombu" in components');
    expect(summarizeTool('Grep', { pattern: 'kombu' })).toBe('Grep "kombu"');
    expect(summarizeTool('Glob', { pattern: '**/*.md' })).toBe('Glob **/*.md');
    expect(summarizeTool('Glob', { pattern: '*.md', path: `${VAULT}/menus` }, VAULT)).toBe('Glob *.md in menus');
    expect(summarizeTool('Agent', { description: 'Search kombu', prompt: 'long prompt', subagent_type: 'Explore' })).toBe('Agent: Search kombu');
    expect(summarizeTool('Agent', { prompt: 'long prompt', subagent_type: 'Explore' })).toBe('Agent (Explore)');
    expect(summarizeTool('Task', { description: 'Old name' })).toBe('Agent: Old name');
    expect(summarizeTool('WebFetch', { url: 'https://example.com/a', prompt: 'x' })).toBe('Fetch https://example.com/a');
    expect(summarizeTool('WebSearch', { query: 'mosel riesling 2024' })).toBe('Search "mosel riesling 2024"');
    expect(summarizeTool('mcp__memory__store_memory', { content: 'x' })).toBe('memory: store_memory');
    expect(summarizeTool('mcp__wine-tracker__search_wines', {})).toBe('wine-tracker: search_wines');
    expect(summarizeTool('TodoWrite', { todos: [{ content: 'a' }, { content: 'b' }] })).toBe('Update todos (2)');
    expect(summarizeTool('AskUserQuestion', { questions: [] })).toBe('Ask a question');
    expect(summarizeTool('Skill', { skill: 'reel' })).toBe('Skill: reel');
    expect(summarizeTool('SomethingNew', { path: 'a/b' })).toBe('SomethingNew a/b');
    expect(summarizeTool('SomethingElse', {})).toBe('SomethingElse');
  });

  it('toolCategory maps the built-in tools', () => {
    expect(toolCategory('Read')).toBe('read');
    expect(toolCategory('NotebookRead')).toBe('read');
    expect(toolCategory('Edit')).toBe('write');
    expect(toolCategory('MultiEdit')).toBe('write');
    expect(toolCategory('Write')).toBe('write');
    expect(toolCategory('NotebookEdit')).toBe('write');
    expect(toolCategory('Bash')).toBe('shell');
    expect(toolCategory('BashOutput')).toBe('shell');
    expect(toolCategory('KillShell')).toBe('shell');
    expect(toolCategory('Grep')).toBe('search');
    expect(toolCategory('Glob')).toBe('search');
    expect(toolCategory('Agent')).toBe('agent');
    expect(toolCategory('Task')).toBe('agent');
    expect(toolCategory('WebFetch')).toBe('web');
    expect(toolCategory('WebSearch')).toBe('web');
    expect(toolCategory('mcp__memory__store_memory')).toBe('mcp');
    expect(toolCategory('TodoWrite')).toBe('other');
    expect(toolCategory('AskUserQuestion')).toBe('other');
  });

  it('editDiff reads Edit, Write, MultiEdit and NotebookEdit inputs', () => {
    expect(editDiff({ file_path: 'a.md', old_string: 'old', new_string: 'new' })).toEqual({ path: 'a.md', oldText: 'old', newText: 'new' });
    expect(editDiff({ file_path: 'a.md', content: '# new file' })).toEqual({ path: 'a.md', oldText: '', newText: '# new file' });
    expect(
      editDiff({
        file_path: 'a.md',
        edits: [
          { old_string: 'one', new_string: 'uno' },
          { old_string: 'two', new_string: 'dos' },
        ],
      }),
    ).toEqual({ path: 'a.md', oldText: 'one\n\ntwo', newText: 'uno\n\ndos' });
    expect(editDiff({ notebook_path: 'n.ipynb', new_source: 'print(1)' })).toEqual({ path: 'n.ipynb', oldText: '', newText: 'print(1)' });
    expect(editDiff({ command: 'ls' })).toBeNull();
    expect(editDiff({ file_path: 'a.md' })).toBeNull();
    expect(editDiff({})).toBeNull();
  });
});
