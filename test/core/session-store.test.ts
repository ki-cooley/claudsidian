import { effect } from '@preact/signals';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { ControlResponseEvent, UserEvent,
  ControlRequestEvent,
  StreamJsonEvent,
  WireEventRow,
} from '../../src/api/types';
import { SessionStore, type LearnedDirs } from '../../src/core/session-store';
import type { PermissionItem, QuestionItem, UserItem } from '../../src/core/types';
import { DEFAULT_SETTINGS, type ClaudsidianSettings } from '../../src/settings';
import { createFakeClock, type FakeClock } from '../helpers/fake-clock';
import {
  FakeClient,
  assistantText,
  controlResponse,
  initEvent,
  permissionRequest,
  questionRequest,
  resultEvent,
  userText,
  wireSession,
} from '../helpers/fake-client';

const VAULT = '/Users/ki/workspace/projects/yes-chef';
const ACTIVE = DEFAULT_SETTINGS.polling.activeMs;
const IDLE = DEFAULT_SETTINGS.polling.idleMs;
const LIST = DEFAULT_SETTINGS.polling.listMs;

let client: FakeClient;
let clock: FakeClock;
let store: SessionStore;
let settings: ClaudsidianSettings;

function makeStore(): SessionStore {
  return new SessionStore({ client, settings: () => settings, clientId: 'client-1', timers: clock.timers });
}

/** History and poll reads of a session; the store's background init-cwd probes (limit 40, see probeCalls) are left out. */
function listEventCalls(id: string): string[] {
  return client.calls.filter((c) => c.startsWith(`listEvents ${id}`) && !c.includes('"limit":40'));
}

/** The init-cwd probes the store runs after a list refresh for bridge environments with no known directory. */
function probeCalls(): string[] {
  return client.calls.filter((c) => c.startsWith('listEvents ') && c.includes('"limit":40'));
}

/** The rows the store keeps for loadOlder rebuilds (private bookkeeping, read for the compaction tests). */
function storedRows(id: string): WireEventRow[] {
  const tracks = (store as unknown as { tracks: Map<string, { rows: WireEventRow[] }> }).tracks;
  return tracks.get(id)?.rows ?? [];
}

function streamEvent(event: Record<string, unknown>): StreamJsonEvent {
  return { type: 'stream_event', uuid: `uuid_s${++streamCounter}`, session_id: 'cse_test', parent_tool_use_id: null, event } as StreamJsonEvent;
}
let streamCounter = 0;

/** message_start, one streamed text block, and its final assistant row: the per-block shape Claude Code sends. */
function streamedText(messageId: string, text: string): StreamJsonEvent[] {
  return [
    streamEvent({ type: 'message_start', message: { id: messageId, role: 'assistant' } }),
    streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
    streamEvent({ type: 'content_block_stop', index: 0 }),
    assistantText(text, messageId),
    streamEvent({ type: 'message_stop' }),
  ];
}

beforeEach(() => {
  client = new FakeClient();
  clock = createFakeClock(1_700_000_000_000);
  settings = structuredClone(DEFAULT_SETTINGS);
  client.sessions = [
    wireSession({ id: 'cse_a', title: 'Menu work', last_event_at: '2026-10-10T12:00:00Z', worker_status: 'running' }),
    wireSession({ id: 'cse_b', title: 'Older', last_event_at: '2026-10-09T12:00:00Z' }),
    wireSession({ id: 'cse_c', title: 'Cloud one', environment_id: 'env_cloud', environment_kind: 'cloud', last_event_at: '2026-10-10T13:00:00Z' }),
    wireSession({ id: 'cse_d', title: 'Done', status: 'archived', last_event_at: '2026-10-01T12:00:00Z' }),
  ];
  store = makeStore();
});

describe('SessionStore sessions list', () => {
  it('refreshSessions maps and sorts', async () => {
    await store.refreshSessions();
    expect(store.sessions.value.map((s) => s.id)).toEqual(['cse_c', 'cse_a', 'cse_b', 'cse_d']);
    const a = store.session('cse_a')!;
    expect(a.title).toBe('Menu work');
    expect(a.workerStatus).toBe('running');
    expect(a.environmentKind).toBe('bridge');
    expect(store.session('cse_d')!.archived).toBe(true);
    expect(store.sessionsError.value).toBeNull();
    expect(store.sessionsLoading.value).toBe(false);
  });

  it('sets the auth banner on 401 and the offline banner on network errors, and clears them on success', async () => {
    client.failNext = new ApiError({ status: 401, message: 'expired (HTTP 401)' });
    await store.refreshSessions();
    expect(store.sessionsError.value).toBe('expired (HTTP 401)');
    expect(store.banner.value).toEqual({ kind: 'auth', text: 'Signed out. Sign in to see your sessions.' });

    client.failNext = new ApiError({ status: 0, message: 'Network error: offline' });
    await store.refreshSessions();
    expect(store.banner.value).toEqual({ kind: 'offline', text: 'No connection. Retrying.' });

    await store.refreshSessions();
    expect(store.banner.value).toBeNull();
    expect(store.sessionsError.value).toBeNull();
  });

  it('polls the list on the list interval while visible and parks when hidden', async () => {
    store.startListPolling();
    expect(client.calls.filter((c) => c === 'listSessions')).toHaveLength(0);
    await clock.tick(LIST);
    expect(client.calls.filter((c) => c === 'listSessions')).toHaveLength(1);
    store.visible.value = false;
    await clock.tick(LIST * 3);
    expect(client.calls.filter((c) => c === 'listSessions')).toHaveLength(1);
    store.visible.value = true;
    await clock.flush();
    expect(client.calls.filter((c) => c === 'listSessions')).toHaveLength(2);
    store.stopListPolling();
    await clock.tick(LIST * 3);
    expect(client.calls.filter((c) => c === 'listSessions')).toHaveLength(2);
  });

  it('rename updates the title optimistically and archive marks the session archived', async () => {
    await store.refreshSessions();
    const renamed = store.rename('cse_b', 'Renamed');
    expect(store.session('cse_b')!.title).toBe('Renamed');
    await renamed;
    expect(client.calls).toContain('renameSession cse_b "Renamed"');
    expect(client.sessions.find((s) => s.id === 'cse_b')!.title).toBe('Renamed');
    await store.archive('cse_b');
    expect(client.calls).toContain('archiveSession cse_b');
    expect(store.session('cse_b')!.archived).toBe(true);
  });

  it('createSession posts config, then the permission mode and first message, then the title', async () => {
    const summary = await store.createSession({
      environmentId: 'env_mac',
      title: 'Prep list',
      firstMessage: 'hi there',
      model: 'claude-sonnet-5-5',
      permissionMode: 'auto',
    });
    expect(client.created).toHaveLength(1);
    const req = client.created[0]!;
    expect(req.environment_id).toBe('env_mac');
    expect(req.config).toEqual({ model: 'claude-sonnet-5-5' });
    expect(req.events).toEqual([]);
    expect(req.tags).toContain('claudsidian');
    expect(req.title).toBeUndefined();
    const sent = client.sentPayloads('cse_new_1');
    expect(sent.map((p) => p.type)).toEqual(['control_request', 'user']);
    expect((sent[0] as ControlRequestEvent).request).toEqual({ subtype: 'set_permission_mode', mode: 'auto' });
    const first = sent[1] as UserEvent;
    expect(first.message.content).toEqual([{ type: 'text', text: 'hi there' }]);
    expect(typeof first.uuid).toBe('string');
    expect(client.calls).toContain('renameSession cse_new_1 "Prep list"');
    expect(summary.id).toBe('cse_new_1');
    expect(summary.title).toBe('Prep list');
    expect(store.sessions.value.some((s) => s.id === 'cse_new_1')).toBe(true);
  });

  it('createSession omits the optional fields it was not given', async () => {
    await store.createSession({ environmentId: 'env_mac' });
    const req = client.created[0]!;
    expect(req).toEqual({ environment_id: 'env_mac', config: {}, events: [], tags: ['remote-control-app', 'claudsidian'] });
    expect(client.sentPayloads('cse_new_1')).toEqual([]);
    expect(client.calls.some((c) => c.startsWith('renameSession'))).toBe(false);
  });

  it('environments() re-runs signal effects when the environments endpoint lands', async () => {
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(store.environments().length);
    });
    client.environments = [{ environment_id: 'env_late', name: 'Mac:yes-chef:0001', kind: 'bridge', bridge_info: { directory: '/Users/kicooley-winters/workspace/projects/yes-chef', online: true } }];
    await store.refreshEnvironments();
    stop();
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBeGreaterThan(0);
  });

  it('a successful send clears the error banner left by a failed one', async () => {
    await store.open('cse_a');
    client.failNext = new ApiError({ status: 404, message: 'Injected 404 (HTTP 404)' });
    await expect(store.send('cse_a', 'first')).rejects.toBeInstanceOf(ApiError);
    expect(store.banner.value?.kind).toBe('error');
    await store.send('cse_a', 'second');
    expect(store.banner.value).toBeNull();
  });

  it('environments merges the environments endpoint with session-derived groups', async () => {
    client.environments = [
      {
        environment_id: 'env_mac',
        name: 'KisWorkComputer:yes-chef:8e72',
        kind: 'bridge',
        bridge_info: { machine_name: 'KisWorkComputer', directory: '/Users/kicooley-winters/workspace/projects/yes-chef', online: true },
      },
      { environment_id: 'env_off', name: 'OldMac.local:workspace:ef9f', kind: 'bridge', bridge_info: { directory: '/Users/x/workspace', online: false } },
      { environment_id: 'env_cloud_x', name: 'claude-code-default', kind: 'anthropic_cloud', bridge_info: null },
    ];
    await store.refreshEnvironments();
    await store.refreshSessions();
    const envs = store.environments();
    expect(envs[0]).toMatchObject({ id: 'env_mac', kind: 'bridge', label: 'yes-chef on KisWorkComputer', cwd: '/Users/kicooley-winters/workspace/projects/yes-chef', online: true });
    const off = envs.find((e) => e.id === 'env_off');
    expect(off).toMatchObject({ kind: 'bridge', label: 'workspace on OldMac (offline)', online: false, sessionCount: 0 });
    const cloud = envs.find((e) => e.id === 'env_cloud_x');
    expect(cloud).toMatchObject({ kind: 'cloud', label: 'claude-code-default' });
    expect(envs.findIndex((e) => e.id === 'env_off')).toBeGreaterThan(envs.findIndex((e) => e.id === 'env_mac'));
  });

  it('environments groups by environment and labels from cwd', async () => {
    client.push('cse_a', initEvent(VAULT));
    client.push('cse_c', initEvent('/home/user/repo'));
    await store.refreshSessions();
    await store.open('cse_a');
    await store.open('cse_c');
    const envs = store.environments();
    expect(envs).toEqual([
      { id: 'env_mac', kind: 'bridge', label: 'yes-chef (Mac)', cwd: VAULT, sessionCount: 2 },
      { id: 'env_cloud', kind: 'cloud', label: 'repo (cloud)', cwd: '/home/user/repo', sessionCount: 1 },
    ]);
  });

  it('environments falls back to the kind when no cwd is known', async () => {
    await store.refreshSessions();
    const envs = store.environments();
    expect(envs.map((e) => e.label)).toEqual(['Mac', 'cloud']);
    expect(envs[0]!.cwd).toBeUndefined();
  });
});

describe('SessionStore open and poll', () => {
  it('open loads history ascending and starts polling', async () => {
    await store.refreshSessions();
    client.pushAll('cse_a', [initEvent(VAULT), userText('plan the menu'), assistantText('Here is a plan.'), resultEvent()]);
    const turnEnd = vi.fn();
    store.on('turn_end', turnEnd);

    await store.open('cse_a');

    expect(store.selectedId.value).toBe('cse_a');
    expect(listEventCalls('cse_a')[0]).toBe('listEvents cse_a {"limit":200,"sortOrder":"desc"}');
    const state = store.transcript('cse_a').value;
    expect(state.lastSeq).toBe(4);
    expect(state.turn).toBe('idle');
    expect(state.init?.cwd).toBe(VAULT);
    const kinds = state.items.map((i) => i.kind);
    expect(kinds.indexOf('user')).toBeLessThan(kinds.indexOf('assistant_text'));
    expect(kinds.indexOf('assistant_text')).toBeLessThan(kinds.indexOf('result'));
    expect(store.session('cse_a')!.cwd).toBe(VAULT);
    expect(client.presenceLog).toEqual([{ id: 'cse_a', clientId: 'client-1', connected: true }]);
    expect(client.marked).toEqual([{ id: 'cse_a', seq: 4 }]);
    expect(turnEnd).not.toHaveBeenCalled();

    await clock.tick(IDLE);
    expect(listEventCalls('cse_a')[1]).toBe('listEvents cse_a {"fromSequenceNum":5,"sortOrder":"asc","limit":200}');
  });

  it('retries the history load on the next poll when open fails', async () => {
    await store.refreshSessions();
    client.pushAll('cse_b', [userText('hello'), assistantText('Hi.'), resultEvent()]);
    client.failNext = new ApiError({ status: 503, message: 'busy (HTTP 503)' });
    await store.open('cse_b');
    expect(store.selectedId.value).toBe('cse_b');
    expect(store.transcript('cse_b').value.items).toHaveLength(0);
    expect(client.marked).toEqual([]);
    await clock.tick(IDLE);
    expect(listEventCalls('cse_b').at(-1)).toBe('listEvents cse_b {"limit":200,"sortOrder":"desc"}');
    expect(store.transcript('cse_b').value.lastSeq).toBe(3);
    expect(client.marked).toEqual([{ id: 'cse_b', seq: 3 }]);
    await clock.tick(IDLE);
    expect(listEventCalls('cse_b').at(-1)).toBe('listEvents cse_b {"fromSequenceNum":4,"sortOrder":"asc","limit":200}');
  });

  it('open works without init', async () => {
    await store.refreshSessions();
    client.pushAll('cse_b', [userText('hello'), assistantText('Hi.'), resultEvent()]);
    await store.open('cse_b');
    const state = store.transcript('cse_b').value;
    expect(state.init).toBeUndefined();
    expect(state.lastSeq).toBe(3);
    expect(state.items.some((i) => i.kind === 'assistant_text')).toBe(true);
    expect(store.session('cse_b')!.cwd).toBeUndefined();
    expect(store.environments().find((e) => e.id === 'env_mac')!.label).toBe('Mac');
    await clock.tick(IDLE);
    expect(listEventCalls('cse_b')).toHaveLength(2);
  });

  it('open on an empty session polls from sequence 0 and does not mark read', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    expect(store.transcript('cse_b').value.lastSeq).toBe(-1);
    expect(client.marked).toEqual([]);
    await clock.tick(IDLE);
    expect(listEventCalls('cse_b')[1]).toBe('listEvents cse_b {"fromSequenceNum":0,"sortOrder":"asc","limit":200}');
  });

  it('opening another session stops polling the first and clears its presence', async () => {
    await store.refreshSessions();
    await store.open('cse_a');
    await store.open('cse_b');
    expect(client.presenceLog).toEqual([
      { id: 'cse_a', clientId: 'client-1', connected: true },
      { id: 'cse_a', clientId: 'client-1', connected: false },
      { id: 'cse_b', clientId: 'client-1', connected: true },
    ]);
    const before = listEventCalls('cse_a').length;
    await clock.tick(IDLE * 2);
    expect(listEventCalls('cse_a')).toHaveLength(before);
    expect(listEventCalls('cse_b').length).toBeGreaterThan(1);
    store.close();
    expect(store.selectedId.value).toBeNull();
    await clock.flush();
    expect(client.presenceLog.at(-1)).toEqual({ id: 'cse_b', clientId: 'client-1', connected: false });
    const b = listEventCalls('cse_b').length;
    await clock.tick(IDLE * 2);
    expect(listEventCalls('cse_b')).toHaveLength(b);
  });

  it('poll applies new events and emits turn_end', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    const turnEnd = vi.fn();
    store.on('turn_end', turnEnd);
    client.pushAll('cse_b', [assistantText('Working on it.'), resultEvent()]);
    await clock.tick(IDLE);
    const state = store.transcript('cse_b').value;
    expect(state.items.map((i) => i.kind)).toEqual(['assistant_text', 'result']);
    expect(state.turn).toBe('idle');
    expect(turnEnd).toHaveBeenCalledTimes(1);
    expect(turnEnd).toHaveBeenCalledWith('cse_b', state);
    expect(client.marked.at(-1)).toEqual({ id: 'cse_b', seq: 2 });
    await clock.tick(IDLE);
    expect(turnEnd).toHaveBeenCalledTimes(1);
  });

  it('mode follows the turn: active while working, idle after the result', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    client.push('cse_b', assistantText('Still working'));
    await clock.tick(IDLE);
    const n = listEventCalls('cse_b').length;
    await clock.tick(ACTIVE);
    expect(listEventCalls('cse_b')).toHaveLength(n + 1);
    client.push('cse_b', resultEvent());
    await clock.tick(ACTIVE);
    const m = listEventCalls('cse_b').length;
    await clock.tick(IDLE - 1);
    expect(listEventCalls('cse_b')).toHaveLength(m);
    await clock.tick(1);
    expect(listEventCalls('cse_b')).toHaveLength(m + 1);
  });

  it('needs_input is emitted once per request', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    const needsInput = vi.fn();
    store.on('needs_input', needsInput);
    client.push('cse_b', permissionRequest('req_1', 'Bash', { command: 'npm test' }));
    await clock.tick(IDLE);
    expect(needsInput).toHaveBeenCalledTimes(1);
    expect(store.transcript('cse_b').value.turn).toBe('needs_input');
    await clock.tick(ACTIVE);
    await clock.tick(ACTIVE);
    expect(needsInput).toHaveBeenCalledTimes(1);
    client.push('cse_b', controlResponse('req_1', { behavior: 'allow' }));
    client.push('cse_b', permissionRequest('req_2', 'Edit', { file_path: 'x.md' }));
    await clock.tick(ACTIVE);
    expect(needsInput).toHaveBeenCalledTimes(2);
    await clock.tick(ACTIVE);
    expect(needsInput).toHaveBeenCalledTimes(2);
  });

  it('dedupes overlapping polls', async () => {
    await store.refreshSessions();
    client.pushAll('cse_a', [initEvent(VAULT), userText('go'), assistantText('one'), resultEvent()]);
    await store.open('cse_a');
    client.overlap = 2;
    client.pushAll('cse_a', [assistantText('two'), resultEvent()]);
    await clock.tick(IDLE);
    const count = (kind: string) => store.transcript('cse_a').value.items.filter((i) => i.kind === kind).length;
    expect(count('user')).toBe(1);
    expect(count('assistant_text')).toBe(2);
    expect(count('result')).toBe(2);
    expect(store.transcript('cse_a').value.lastSeq).toBe(6);
    // overlapping rows alone do not switch modes: the next poll still asks from lastSeq + 1
    client.push('cse_a', assistantText('three'));
    await clock.tick(IDLE);
    expect(listEventCalls('cse_a').at(-1)).toBe('listEvents cse_a {"fromSequenceNum":7,"sortOrder":"asc","limit":200}');
    expect(count('assistant_text')).toBe(3);
    expect(count('result')).toBe(2);
    await clock.tick(ACTIVE);
    expect(count('assistant_text')).toBe(3);
    expect(listEventCalls('cse_a').at(-1)).toBe('listEvents cse_a {"fromSequenceNum":8,"sortOrder":"asc","limit":200}');
  });

  it('switches to after_id polling when the server ignores from_sequence_num', async () => {
    await store.refreshSessions();
    client.ignoreFromSequenceNum = true;
    client.pushAll('cse_a', [userText('go'), assistantText('one'), resultEvent()]);
    await store.open('cse_a');
    const pushed = client.pushAll('cse_a', [assistantText('two'), resultEvent()]);
    await clock.tick(IDLE);
    const items = store.transcript('cse_a').value.items;
    expect(items.filter((i) => i.kind === 'assistant_text')).toHaveLength(2);
    expect(items.filter((i) => i.kind === 'user')).toHaveLength(1);
    await clock.tick(IDLE);
    const lastUuid = pushed[1]!.payload.uuid;
    expect(listEventCalls('cse_a').at(-1)).toBe(`listEvents cse_a {"afterId":"${lastUuid}","limit":500}`);
    expect(store.transcript('cse_a').value.items).toHaveLength(items.length);
    // the cursor moves with each applied row
    const next = client.push('cse_a', assistantText('three'));
    await clock.tick(IDLE);
    expect(store.transcript('cse_a').value.items.filter((i) => i.kind === 'assistant_text')).toHaveLength(3);
    await clock.tick(ACTIVE);
    expect(listEventCalls('cse_a').at(-1)).toBe(`listEvents cse_a {"afterId":"${next.payload.uuid}","limit":500}`);
    // and loadOlder has nothing to ask with
    expect(await store.loadOlder('cse_a')).toBe(false);
  });

  it('switches to after_id when an incremental poll brings nothing new', async () => {
    await store.refreshSessions();
    client.ignoreFromSequenceNum = true;
    client.pushAll('cse_b', [userText('go'), assistantText('one'), resultEvent()]);
    await store.open('cse_b');
    await clock.tick(IDLE); // the whole history comes back although nothing is new
    client.push('cse_b', assistantText('two'));
    await clock.tick(IDLE);
    expect(listEventCalls('cse_b').at(-1)).toMatch(/^listEvents cse_b \{"afterId":"[^"]+","limit":500\}$/);
    expect(store.transcript('cse_b').value.items.filter((i) => i.kind === 'assistant_text')).toHaveLength(2);
  });

  it('applies a burst of 120 rows between polls in after_id mode without losing any, and marks them read once the throttle window closes', async () => {
    await store.refreshSessions();
    client.ignoreFromSequenceNum = true;
    client.pushAll('cse_b', [userText('go'), assistantText('m0'), resultEvent()]);
    await store.open('cse_b');
    client.push('cse_b', assistantText('m1'));
    await clock.tick(IDLE); // switches
    for (let i = 2; i <= 121; i++) client.push('cse_b', assistantText(`m${i}`));
    await clock.tick(ACTIVE);
    const state = store.transcript('cse_b').value;
    const texts = state.items.filter((i) => i.kind === 'assistant_text').map((i) => (i as { text: string }).text);
    expect(texts).toHaveLength(122);
    expect(texts[0]).toBe('m0');
    expect(texts[121]).toBe('m121');
    expect(state.lastSeq).toBe(124);
    // mark_read is spaced two seconds apart while rows stream; the trailing post carries the newest seq
    expect(client.marked.at(-1)).toEqual({ id: 'cse_b', seq: 4 });
    await clock.tick(2000);
    expect(client.marked.at(-1)).toEqual({ id: 'cse_b', seq: 124 });
  });

  it('chains after_id pages in one poll while they come back full', async () => {
    await store.refreshSessions();
    client.ignoreFromSequenceNum = true;
    client.pushAll('cse_b', [userText('go'), assistantText('m0'), resultEvent()]);
    await store.open('cse_b');
    client.push('cse_b', assistantText('m1'));
    await clock.tick(IDLE);
    const before = listEventCalls('cse_b').length;
    for (let i = 2; i <= 1101; i++) client.push('cse_b', assistantText(`m${i}`));
    await clock.tick(ACTIVE);
    expect(listEventCalls('cse_b')).toHaveLength(before + 3); // 500 + 500 + 100
    expect(store.transcript('cse_b').value.items.filter((i) => i.kind === 'assistant_text')).toHaveLength(1102);
    expect(store.transcript('cse_b').value.lastSeq).toBe(1104);
  });

  it('open on a gone session shows the notice once and starts neither the poller nor presence', async () => {
    const notices: string[] = [];
    store = new SessionStore({ client, settings: () => settings, clientId: 'client-1', timers: clock.timers, onNotice: (t) => notices.push(t) });
    await store.refreshSessions();
    client.failNext = new ApiError({ status: 404, message: 'Session not found (HTTP 404)' });
    await store.open('cse_b');
    expect(store.banner.value).toEqual({ kind: 'error', text: 'Session not found. It may have been archived.' });
    expect(notices).toEqual(['Session not found. It may have been archived.']);
    expect(client.presenceLog).toEqual([]);
    const polls = listEventCalls('cse_b').length;
    await clock.tick(IDLE * 3 + 120_000);
    expect(listEventCalls('cse_b')).toHaveLength(polls);
    expect(client.presenceLog).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  it('poll survives a 401', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    client.push('cse_b', assistantText('after the hiccup'));
    client.failNext = new ApiError({ status: 401, message: 'expired (HTTP 401)' });
    await clock.tick(IDLE);
    expect(store.transcript('cse_b').value.items).toHaveLength(0);
    expect(store.banner.value).toBeNull();
    await clock.tick(IDLE);
    const texts = store.transcript('cse_b').value.items.filter((i) => i.kind === 'assistant_text');
    expect(texts).toHaveLength(1);
    expect(store.banner.value).toBeNull();
    await clock.tick(IDLE);
    expect(store.transcript('cse_b').value.items.filter((i) => i.kind === 'assistant_text')).toHaveLength(1);
  });

  it('shows the offline banner on network errors while polling and clears it on recovery', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    client.failNext = new ApiError({ status: 0, message: 'Network error: offline' });
    await clock.tick(IDLE);
    expect(store.banner.value).toEqual({ kind: 'offline', text: 'No connection. Retrying.' });
    expect(store.transcript('cse_b').value.turn).toBe('offline');
    await clock.tick(IDLE);
    expect(store.banner.value).toBeNull();
    expect(store.transcript('cse_b').value.turn).toBe('idle');
  });

  it('visible false parks the poller', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    const n = listEventCalls('cse_b').length;
    store.visible.value = false;
    client.push('cse_b', assistantText('while hidden'));
    await clock.tick(IDLE * 10);
    expect(listEventCalls('cse_b')).toHaveLength(n);
    expect(store.transcript('cse_b').value.items).toHaveLength(0);
    store.visible.value = true;
    await clock.flush();
    expect(listEventCalls('cse_b')).toHaveLength(n + 1);
    expect(store.transcript('cse_b').value.items).toHaveLength(1);
    expect(client.marked.at(-1)).toEqual({ id: 'cse_b', seq: 1 });
  });

  it('does not mark read while hidden, then marks once on resume', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    expect(client.marked).toEqual([]);
    store.visible.value = false;
    // a send while hidden kicks one background poll, which applies the echo without marking read
    client.echoSends = true;
    await store.send('cse_b', 'while hidden');
    await clock.flush();
    expect(store.transcript('cse_b').value.lastSeq).toBe(1);
    expect(store.transcript('cse_b').value.items.filter((i) => i.kind === 'user')).toHaveLength(1);
    expect(client.marked).toEqual([]);
    store.visible.value = true;
    await clock.flush();
    expect(client.marked).toEqual([{ id: 'cse_b', seq: 1 }]);
  });

  it('a 404 while polling stops the poller and presence and refreshes the list', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    const polls = listEventCalls('cse_b').length;
    const presence = client.presenceLog.length;
    const errors: string[] = [];
    store.on('error', (id) => errors.push(id));
    client.failNext = new ApiError({ status: 404, message: 'not found' });
    await clock.tick(IDLE);
    expect(errors).toEqual(['cse_b']);
    expect(store.banner.value).toEqual({ kind: 'error', text: 'Session not found. It may have been archived.' });
    await clock.tick(IDLE * 3 + 120_000);
    expect(listEventCalls('cse_b')).toHaveLength(polls + 1);
    expect(client.presenceLog).toHaveLength(presence);
  });

  it('re-announces presence every 60 seconds while open', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    expect(client.presenceLog).toHaveLength(1);
    await clock.tick(60_000);
    expect(client.presenceLog).toHaveLength(2);
    await clock.tick(60_000);
    expect(client.presenceLog).toHaveLength(3);
    store.dispose();
    await clock.flush();
    expect(client.presenceLog.at(-1)).toEqual({ id: 'cse_b', clientId: 'client-1', connected: false });
    await clock.tick(120_000);
    expect(client.presenceLog).toHaveLength(4);
  });

  it('loadOlder prepends older rows and returns false at the start of history', async () => {
    await store.refreshSessions();
    for (let i = 1; i <= 250; i++) client.push('cse_b', assistantText(`m${i}`));
    await store.open('cse_b');
    const state = store.transcript('cse_b').value;
    expect(state.items).toHaveLength(200);
    expect(state.lastSeq).toBe(250);
    expect((state.items[0] as { text: string }).text).toBe('m51');

    expect(await store.loadOlder('cse_b')).toBe(true);
    expect(listEventCalls('cse_b').at(-1)).toBe('listEvents cse_b {"fromSequenceNum":0,"sortOrder":"asc","limit":200}');
    const after = store.transcript('cse_b').value;
    expect(after.items).toHaveLength(250);
    expect((after.items[0] as { text: string }).text).toBe('m1');
    expect((after.items[249] as { text: string }).text).toBe('m250');
    expect(after.lastSeq).toBe(250);

    expect(await store.loadOlder('cse_b')).toBe(false);
    expect(store.transcript('cse_b').value.items).toHaveLength(250);
  });

  it('stores image rows without their base64 bodies and still counts the images on a rebuild', async () => {
    await store.refreshSessions();
    const big = 'A'.repeat(100_000);
    for (let i = 1; i <= 210; i++) client.push('cse_b', assistantText(`m${i}`));
    client.push('cse_b', {
      type: 'user',
      uuid: 'uuid_img',
      session_id: 'cse_b',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: 'this plate' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: big } }] },
    });
    await store.open('cse_b');
    const stored = storedRows('cse_b').find((r) => r.payload.uuid === 'uuid_img')!;
    const content = (stored.payload as UserEvent).message.content as { type: string; source?: { data: string } }[];
    expect(content[1]!.source!.data.length).toBeLessThan(64);
    expect(JSON.stringify(storedRows('cse_b'))).not.toContain(big);
    // the live row was not mutated
    expect(((client.events.get('cse_b')!.at(-1)!.payload as UserEvent).message.content as { source?: { data: string } }[])[1]!.source!.data).toBe(big);
    expect(await store.loadOlder('cse_b')).toBe(true);
    const user = store.transcript('cse_b').value.items.find((i) => i.kind === 'user') as { text: string; imageCount: number };
    expect(user).toMatchObject({ text: 'this plate', imageCount: 1 });
  });

  it('drops stream rows once their final assistant row applied and rebuilds the same transcript', async () => {
    await store.refreshSessions();
    for (let i = 1; i <= 205; i++) client.push('cse_b', assistantText(`m${i}`));
    client.pushAll('cse_b', [userText('go'), ...streamedText('msg_S1', 'First answer.'), resultEvent()]);
    await store.open('cse_b');
    const live = store.transcript('cse_b').value;
    expect(storedRows('cse_b').filter((r) => r.payload.type === 'stream_event').map((r) => (r.payload as { event: { type: string } }).event.type)).toEqual(['message_stop']);
    // a message still streaming keeps its rows until the final arrives
    const partial = streamedText('msg_S2', 'Second');
    client.pushAll('cse_b', partial.slice(0, 3));
    await clock.tick(IDLE);
    expect(storedRows('cse_b').filter((r) => r.payload.type === 'stream_event')).toHaveLength(4);
    expect(store.transcript('cse_b').value.items.at(-1)).toMatchObject({ kind: 'assistant_text', text: 'Second', partial: true });
    client.pushAll('cse_b', partial.slice(3));
    await clock.tick(ACTIVE);
    // the final retires its own partial rows and the earlier message's trailing message_stop
    expect(storedRows('cse_b').filter((r) => r.payload.type === 'stream_event').map((r) => (r.payload as { event: { type: string } }).event.type)).toEqual(['message_stop']);
    const streamed = store.transcript('cse_b').value;
    expect(streamed.items.at(-1)).toMatchObject({ kind: 'assistant_text', id: 'msg_S2:0', text: 'Second', partial: false });

    expect(await store.loadOlder('cse_b')).toBe(true);
    const rebuilt = store.transcript('cse_b').value;
    expect(rebuilt.items.slice(-5)).toEqual(live.items.slice(-4).concat(streamed.items.slice(-1)));
    expect(rebuilt.items.filter((i) => i.kind === 'assistant_text' && (i as { partial: boolean }).partial)).toHaveLength(0);
    expect(rebuilt.items.filter((i) => (i as { text?: string }).text === 'First answer.')).toHaveLength(1);
    expect(rebuilt.items).toHaveLength(205 + 1 + 1 + 1 + 1);
    expect(rebuilt.lastSeq).toBe(streamed.lastSeq);
  });

  it('loadOlder coalesces overlapping calls into one request', async () => {
    await store.refreshSessions();
    for (let i = 1; i <= 250; i++) client.push('cse_b', assistantText(`m${i}`));
    await store.open('cse_b');
    const before = listEventCalls('cse_b').length;
    const [a, b] = await Promise.all([store.loadOlder('cse_b'), store.loadOlder('cse_b')]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(listEventCalls('cse_b')).toHaveLength(before + 1);
    expect(store.transcript('cse_b').value.items).toHaveLength(250);
    expect(await store.loadOlder('cse_b')).toBe(false);
  });
});

describe('SessionStore sending', () => {
  it('send appends an optimistic item then the echo replaces it', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    await store.send('cse_b', 'hello', { contextText: '[Obsidian context]\nvault: yes-chef' });

    const sent = client.sentPayloads('cse_b');
    expect(sent).toHaveLength(1);
    const payload = sent[0] as UserEvent;
    expect(payload.type).toBe('user');
    expect(payload.message.content).toEqual([{ type: 'text', text: 'hello\n\n[Obsidian context]\nvault: yes-chef' }]);

    let state = store.transcript('cse_b').value;
    const users = state.items.filter((i) => i.kind === 'user');
    expect(users).toHaveLength(1);
    expect((users[0] as { text: string }).text).toBe('hello');
    expect(state.turn).toBe('sending');
    expect(state.inFlightUserUuids).toEqual([payload.uuid]);
    // the POST was accepted and no echo yet: queued (behind the turn or a question), not sending
    expect(users[0]).toMatchObject({ pending: true, queued: true });

    // the send kicked the poller into active mode; the echo arrives on the next poll
    client.push('cse_b', payload);
    await clock.tick(ACTIVE);
    state = store.transcript('cse_b').value;
    expect(state.items.filter((i) => i.kind === 'user')).toHaveLength(1);
    expect(state.items.find((i) => i.kind === 'user')).not.toHaveProperty('queued');
    expect(state.inFlightUserUuids).toEqual([]);
    expect(state.lastSeq).toBe(1);
  });

  it('send attaches images as base64 blocks and counts them on the item', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    await store.send('cse_b', 'look', {
      images: [{ kind: 'image', name: 'a.jpg', mediaType: 'image/jpeg', base64: 'QUJD' }],
    });
    const payload = client.sentPayloads('cse_b')[0] as UserEvent;
    expect(payload.message.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
    ]);
    const user = store.transcript('cse_b').value.items.find((i) => i.kind === 'user') as { imageCount: number };
    expect(user.imageCount).toBe(1);
  });

  it('send failure removes the optimistic item, sets the error banner, and rethrows', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    client.failNext = new ApiError({ status: 500, message: 'busy (HTTP 500)' });
    await expect(store.send('cse_b', 'hello')).rejects.toBeInstanceOf(ApiError);
    const state = store.transcript('cse_b').value;
    expect(state.items).toHaveLength(0);
    expect(state.turn).toBe('idle');
    expect(state.inFlightUserUuids).toEqual([]);
    expect(store.banner.value).toEqual({ kind: 'error', text: 'busy (HTTP 500)' });
  });

  it('respondPermission sends a control_response with the request id', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    client.push('cse_b', permissionRequest('req_1', 'Bash', { command: 'npm test' }));
    await clock.tick(IDLE);
    expect(store.transcript('cse_b').value.pending.map((p) => p.requestId)).toEqual(['req_1']);

    await store.respondPermission('cse_b', 'req_1', { behavior: 'allow', updatedPermissions: [] });

    const sent = client.sentPayloads('cse_b');
    expect(sent).toHaveLength(1);
    const payload = sent[0] as ControlResponseEvent;
    expect(payload.type).toBe('control_response');
    expect(payload.response.subtype).toBe('success');
    expect(payload.response.request_id).toBe('req_1');
    expect(payload.response.response).toEqual({ behavior: 'allow', updatedPermissions: [] });
    expect(typeof payload.uuid).toBe('string');
    const state = store.transcript('cse_b').value;
    expect(state.pending).toEqual([]);
    expect(state.turn).not.toBe('needs_input');
  });

  it('a Deny shows as denied as soon as it is sent', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    client.push('cse_b', permissionRequest('req_1', 'Bash', { command: 'npm publish' }));
    await clock.tick(IDLE);
    await store.respondPermission('cse_b', 'req_1', { behavior: 'deny', message: 'not that' });
    const state = store.transcript('cse_b').value;
    expect((state.items.find((i) => i.id === 'req_1') as PermissionItem).resolved).toBe('deny');
    expect(state.pending).toEqual([]);
    expect(state.turn).toBe('working');
  });

  it('answerQuestion builds updatedInput from the original questions', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    const questions = [
      { question: 'Which course?', header: 'Course', options: [{ label: 'Amuse' }, { label: 'Main' }], multiSelect: false },
    ];
    client.push('cse_b', questionRequest('req_q', questions));
    await clock.tick(IDLE);
    expect(store.transcript('cse_b').value.items.some((i) => i.kind === 'question')).toBe(true);

    await store.answerQuestion('cse_b', 'req_q', { 'Which course?': 'Main' }, 'make it light');

    const payload = client.sentPayloads('cse_b')[0] as ControlResponseEvent;
    expect(payload.response.request_id).toBe('req_q');
    expect(payload.response.response).toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Which course?': 'Main' }, response: 'make it light' },
    });
    expect(store.transcript('cse_b').value.pending).toEqual([]);
    const item = store.transcript('cse_b').value.items.find((i) => i.id === 'req_q') as QuestionItem;
    expect(item.resolved).toBe(true);
    expect(item.answers).toEqual({ 'Which course?': 'Main' });
  });

  it('interrupt, setModel and setPermissionMode send control requests', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    await store.interrupt('cse_b');
    await store.setModel('cse_b', 'claude-opus-5-5');
    await store.setPermissionMode('cse_b', 'acceptEdits');
    const sent = client.sentPayloads('cse_b') as { type: string; request_id: string; request: Record<string, unknown> }[];
    expect(sent.map((p) => p.type)).toEqual(['control_request', 'control_request', 'control_request']);
    expect(sent.map((p) => p.request)).toEqual([
      { subtype: 'interrupt' },
      { subtype: 'set_model', model: 'claude-opus-5-5' },
      { subtype: 'set_permission_mode', mode: 'acceptEdits' },
    ]);
    for (const p of sent) expect(typeof p.request_id).toBe('string');
    const state = store.transcript('cse_b').value;
    expect(state.model).toBe('claude-opus-5-5');
    expect(state.permissionMode).toBe('acceptEdits');
  });

  it('sendRaw queues the payload as given', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    await store.sendRaw('cse_b', { type: 'control_request', request_id: 'r1', request: { subtype: 'interrupt' } });
    expect(client.sentPayloads('cse_b')).toEqual([{ type: 'control_request', request_id: 'r1', request: { subtype: 'interrupt' } }]);
  });

  it('on returns an unsubscribe function', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    const cb = vi.fn();
    const off = store.on('turn_end', cb);
    off();
    client.pushAll('cse_b', [assistantText('x'), resultEvent()]);
    await clock.tick(IDLE);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('SessionStore learned directories', () => {
  function storeWithPersist(): LearnedDirs[] {
    const saved: LearnedDirs[] = [];
    store = new SessionStore({
      client,
      settings: () => settings,
      clientId: 'client-1',
      timers: clock.timers,
      persistLearned: (p) => {
        saved.push(p);
      },
    });
    return saved;
  }

  it('learns a session cwd and its environment directory from the init event and persists both', async () => {
    const saved = storeWithPersist();
    client.push('cse_b', initEvent(VAULT));
    await store.refreshSessions();
    await clock.flush();
    expect(saved).toEqual([]); // the probe went to cse_a (newest in env_mac), which has no rows
    await store.open('cse_b');
    await clock.flush();
    expect(store.session('cse_b')!.cwd).toBe(VAULT);
    expect(saved.at(-1)).toEqual({ environmentDirs: { env_mac: VAULT }, sessionCwds: { cse_b: VAULT } });
    expect(store.environments().find((e) => e.id === 'env_mac')).toMatchObject({ cwd: VAULT, label: 'yes-chef (Mac)' });
  });

  it('learns the cwd from an init that arrives over after_id polling (bare rows, no sequence numbers)', async () => {
    const saved = storeWithPersist();
    client.ignoreFromSequenceNum = true;
    client.pushAll('cse_b', [userText('go')]);
    await store.refreshSessions();
    await store.open('cse_b');
    await clock.tick(IDLE); // the server answers from the beginning: switch to after_id
    client.pushAll('cse_b', [initEvent(VAULT), assistantText('ok'), resultEvent()]);
    await clock.tick(IDLE);
    await clock.flush();
    const state = store.transcript('cse_b').value;
    expect(state.init?.cwd).toBe(VAULT);
    expect(state.items.filter((i) => i.kind === 'assistant_text')).toHaveLength(1);
    expect(state.turn).toBe('idle');
    expect(saved.at(-1)).toEqual({ environmentDirs: { env_mac: VAULT }, sessionCwds: { cse_b: VAULT } });
  });

  it('learns environment directories from the environments endpoint', async () => {
    const saved = storeWithPersist();
    client.environments = [
      { environment_id: 'env_mac', name: 'Mac:yes-chef:0001', kind: 'bridge', bridge_info: { directory: VAULT, online: true } },
    ];
    await store.refreshEnvironments();
    await clock.flush();
    expect(saved.at(-1)?.environmentDirs).toEqual({ env_mac: VAULT });
  });

  it('seeds cwds and environment directories from settings on a cold start and does not probe known environments', async () => {
    settings.sessionCwds = { cse_b: VAULT };
    settings.environmentDirs = { env_mac: VAULT };
    store = makeStore();
    await store.refreshSessions();
    await clock.flush();
    expect(store.session('cse_b')!.cwd).toBe(VAULT);
    expect(store.session('cse_a')!.cwd).toBeUndefined();
    expect(store.environments().find((e) => e.id === 'env_mac')).toMatchObject({ cwd: VAULT, label: 'yes-chef (Mac)' });
    expect(probeCalls()).toEqual([]);
  });

  it('learns an unlisted bridge environment directory from its own record (bridge init cwds are empty)', async () => {
    const saved = storeWithPersist();
    client.push('cse_a', initEvent(''));
    client.extraEnvironments = [{ environment_id: 'env_mac', kind: 'bridge', bridge_info: { directory: VAULT } }];
    await store.refreshSessions();
    await clock.flush();
    expect(probeCalls()).toEqual([]);
    expect(saved.at(-1)?.environmentDirs).toEqual({ env_mac: VAULT });
    expect(store.environments().find((e) => e.id === 'env_mac')!.cwd).toBe(VAULT);
  });

  it('probes the newest session of an unknown bridge environment for its init cwd after a refresh', async () => {
    const saved = storeWithPersist();
    client.push('cse_a', initEvent(VAULT));
    await store.refreshSessions();
    await clock.flush();
    expect(probeCalls()).toEqual(['listEvents cse_a {"limit":40,"sortOrder":"asc"}']);
    expect(store.session('cse_a')!.cwd).toBe(VAULT);
    expect(store.environments().find((e) => e.id === 'env_mac')!.cwd).toBe(VAULT);
    expect(saved.at(-1)).toEqual({ environmentDirs: { env_mac: VAULT }, sessionCwds: { cse_a: VAULT } });
  });

  it('probes at most three environments per refresh, newest first, and the same one not again within ten minutes', async () => {
    client.sessions = [];
    for (let i = 1; i <= 5; i++) {
      client.sessions.push(wireSession({ id: `cse_e${i}`, environment_id: `env_${i}`, last_event_at: `2026-10-0${i}T00:00:00Z` }));
    }
    store = makeStore();
    const probed = () => probeCalls().map((c) => c.split(' ')[1]);
    await store.refreshSessions();
    await clock.flush();
    expect(probed()).toEqual(['cse_e5', 'cse_e4', 'cse_e3']);
    await store.refreshSessions();
    await clock.flush();
    expect(probed()).toEqual(['cse_e5', 'cse_e4', 'cse_e3', 'cse_e2', 'cse_e1']);
    await store.refreshSessions();
    await clock.flush();
    expect(probed()).toHaveLength(5); // every environment is cooling down
    await clock.tick(600_000);
    await store.refreshSessions();
    await clock.flush();
    expect(probed()).toHaveLength(8);
  });
});

describe('SessionStore stable list order', () => {
  const ids = () => store.sessions.value.map((s) => s.id);

  it('keeps the previous relative order when only activity times change, and resorts on demand', async () => {
    await store.refreshSessions();
    expect(ids()).toEqual(['cse_c', 'cse_a', 'cse_b', 'cse_d']);
    client.sessions.find((s) => s.id === 'cse_b')!.last_event_at = '2026-10-11T12:00:00Z';
    await store.refreshSessions();
    expect(ids()).toEqual(['cse_c', 'cse_a', 'cse_b', 'cse_d']);
    await store.refreshSessions({ resort: true });
    expect(ids()).toEqual(['cse_b', 'cse_c', 'cse_a', 'cse_d']);
  });

  it('inserts a session new to the list above every existing row, whatever its activity time', async () => {
    await store.refreshSessions();
    client.sessions.push(wireSession({ id: 'cse_new', title: 'Fresh', last_event_at: '2026-10-01T00:00:00Z' }));
    await store.refreshSessions();
    expect(ids()).toEqual(['cse_new', 'cse_c', 'cse_a', 'cse_b', 'cse_d']);
    await store.refreshSessions({ resort: true });
    expect(ids()).toEqual(['cse_c', 'cse_a', 'cse_b', 'cse_d', 'cse_new']);
  });

  it('re-places a row by its own activity time when its rank changes', async () => {
    await store.refreshSessions();
    const b = client.sessions.find((s) => s.id === 'cse_b')!;
    b.last_event_at = '2026-10-11T12:00:00Z';
    b.worker_status = 'requires_action';
    await store.refreshSessions();
    expect(store.session('cse_b')!.sortAt).toBe(Date.parse('2026-10-11T12:00:00Z'));
    expect(ids()).toEqual(['cse_b', 'cse_c', 'cse_a', 'cse_d']);
  });

  it('does not republish the sessions signal when nothing rendered changed, and keeps untouched rows by identity', async () => {
    await store.refreshSessions();
    const before = store.sessions.value;
    let writes = 0;
    const stop = store.sessions.subscribe(() => {
      writes += 1;
    });
    await store.refreshSessions();
    expect(store.sessions.value).toBe(before);
    expect(writes).toBe(1);
    client.sessions.find((s) => s.id === 'cse_b')!.title = 'Older, renamed';
    await store.refreshSessions();
    expect(writes).toBe(2);
    expect(store.session('cse_b')!.title).toBe('Older, renamed');
    expect(store.sessions.value.find((s) => s.id === 'cse_a')).toBe(before.find((s) => s.id === 'cse_a'));
    stop();
  });

  it('sessionsLoading is true for the first load only, never for a later poll', async () => {
    const seen: boolean[] = [];
    const stop = store.sessionsLoading.subscribe((v) => seen.push(v));
    await store.refreshSessions();
    expect(seen).toEqual([false, true, false]);
    await store.refreshSessions();
    await store.refreshSessions({ resort: true });
    expect(seen).toEqual([false, true, false]);
    stop();
  });
});

describe('SessionStore mark_read throttle', () => {
  it('posts at most once per two seconds while rows stream and at once when the turn ends', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    client.push('cse_b', assistantText('m1'));
    await clock.tick(IDLE);
    expect(client.marked.map((m) => m.seq)).toEqual([1]);
    for (let i = 2; i <= 11; i++) {
      client.push('cse_b', assistantText(`m${i}`));
      await clock.tick(ACTIVE);
    }
    // ten 700 ms ticks: trailing posts at +2 s, +4 s and +6 s only, each with the newest seq at that moment
    expect(client.marked.map((m) => m.seq)).toEqual([1, 3, 6, 9]);
    client.push('cse_b', resultEvent());
    await clock.tick(ACTIVE);
    expect(client.marked.map((m) => m.seq)).toEqual([1, 3, 6, 9, 12]);
    await clock.tick(5000);
    expect(client.marked).toHaveLength(5);
  });

  it('sends the trailing mark_read when the session is closed before the window closes', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    client.push('cse_b', assistantText('m1'));
    await clock.tick(IDLE);
    client.push('cse_b', assistantText('m2'));
    await clock.tick(ACTIVE);
    expect(client.marked.map((m) => m.seq)).toEqual([1]);
    store.close();
    await clock.flush();
    expect(client.marked.map((m) => m.seq)).toEqual([1, 2]);
    await clock.tick(5000);
    expect(client.marked).toHaveLength(2);
  });
});

describe('SessionStore pending user messages and banners', () => {
  it('marks the optimistic user item pending until the server echo replaces it', async () => {
    await store.refreshSessions();
    await store.open('cse_b');
    await store.send('cse_b', 'hello');
    const sent = store.transcript('cse_b').value.items.find((i) => i.kind === 'user') as UserItem;
    expect(sent.pending).toBe(true);
    const payload = client.sentPayloads('cse_b')[0] as UserEvent;
    client.push('cse_b', payload);
    await clock.tick(ACTIVE);
    const users = store.transcript('cse_b').value.items.filter((i) => i.kind === 'user') as UserItem[];
    expect(users).toHaveLength(1);
    expect(users[0]!.id).toBe(payload.uuid);
    expect(users[0]!.pending).toBeFalsy();
  });

  it('close drops the error banner of the session it came from, and dismissBanner clears any banner', async () => {
    await store.refreshSessions();
    client.failNext = new ApiError({ status: 404, message: 'Session not found (HTTP 404)' });
    await store.open('cse_b');
    expect(store.banner.value?.kind).toBe('error');
    store.close();
    expect(store.banner.value).toBeNull();
    store.banner.value = { kind: 'info', text: 'hello' };
    store.dismissBanner();
    expect(store.banner.value).toBeNull();
  });
});
