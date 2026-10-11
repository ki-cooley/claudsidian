/**
 * FakeStore: SessionStoreApi over plain signals for UI tests. Every call lands in `calls`,
 * transcripts are set directly with setTranscript, respondPermission and answerQuestion mark the
 * item resolved the way the real store does, and `failNext` rejects the next mutating call.
 * Also exports builders for sessions, transcript items and whole transcript states.
 */
import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { PermissionResult, StreamJsonEvent } from '../../src/api/types';
import type {
  Banner,
  CreateSessionOptions,
  Environment,
  SendOptions,
  SessionStoreApi,
  StoreEvent,
} from '../../src/core/store-api';
import { markControlSent } from '../../src/core/transcript';
import {
  createTranscript,
  summarizeSession,
  type AssistantTextItem,
  type ErrorItem,
  type PendingControl,
  type PermissionItem,
  type QuestionItem,
  type ResultItem,
  type SessionSummary,
  type SystemItem,
  type ThinkingItem,
  type ToolItem,
  type TranscriptItem,
  type TranscriptState,
  type UserItem,
} from '../../src/core/types';
import { permissionRequest, questionRequest, wireSession } from './fake-client';

export interface RecordedCall {
  method: string;
  args: unknown[];
}

type Listener = (sessionId: string, state: TranscriptState) => void;

export class FakeStore implements SessionStoreApi {
  readonly sessions = signal<SessionSummary[]>([]);
  readonly sessionsLoading = signal(false);
  readonly sessionsError = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly banner = signal<Banner | null>(null);
  readonly visible = signal(true);

  readonly calls: RecordedCall[] = [];
  envs: Environment[] = [];
  /** the next mutating call rejects with this error */
  failNext: Error | null = null;
  /** what loadOlder resolves */
  olderAvailable = false;
  listPolling = false;
  disposed = false;
  private readonly transcripts = new Map<string, Signal<TranscriptState>>();
  private readonly listeners = new Map<StoreEvent, Set<Listener>>();
  private createdCount = 0;

  constructor(sessions: SessionSummary[] = []) {
    this.sessions.value = sessions;
  }

  // -- test helpers ------------------------------------------------------------

  setTranscript(sessionId: string, state: TranscriptState): void {
    this.signalFor(sessionId).value = state;
  }

  patchTranscript(sessionId: string, patch: Partial<TranscriptState>): void {
    const sig = this.signalFor(sessionId);
    sig.value = { ...sig.value, ...patch };
  }

  callsTo(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  lastSend(): { sessionId: string; text: string; opts: SendOptions | undefined } | undefined {
    const args = this.callsTo('send').at(-1);
    if (!args) return undefined;
    return { sessionId: args[0] as string, text: args[1] as string, opts: args[2] as SendOptions | undefined };
  }

  emit(event: StoreEvent, sessionId: string): void {
    for (const cb of this.listeners.get(event) ?? []) cb(sessionId, this.signalFor(sessionId).value);
  }

  // -- SessionStoreApi ---------------------------------------------------------

  transcript(sessionId: string): ReadonlySignal<TranscriptState> {
    return this.signalFor(sessionId);
  }

  session(sessionId: string): SessionSummary | undefined {
    return this.sessions.value.find((s) => s.id === sessionId);
  }

  environments(): Environment[] {
    return [...this.envs];
  }

  async refreshSessions(): Promise<void> {
    this.record('refreshSessions');
  }

  startListPolling(): void {
    this.record('startListPolling');
    this.listPolling = true;
  }

  stopListPolling(): void {
    this.record('stopListPolling');
    this.listPolling = false;
  }

  async open(sessionId: string): Promise<void> {
    this.record('open', sessionId);
    this.selectedId.value = sessionId;
  }

  close(): void {
    this.record('close');
    this.selectedId.value = null;
  }

  async loadOlder(sessionId: string): Promise<boolean> {
    this.record('loadOlder', sessionId);
    return this.olderAvailable;
  }

  async send(sessionId: string, text: string, opts?: SendOptions): Promise<void> {
    this.record('send', sessionId, text, opts);
    this.maybeFail();
    const sig = this.signalFor(sessionId);
    const item: UserItem = {
      kind: 'user',
      id: `sent-${this.calls.length}`,
      text,
      imageCount: opts?.images?.length ?? 0,
      synthetic: false,
    };
    sig.value = { ...sig.value, items: [...sig.value.items, item], turn: 'sending' };
  }

  async sendRaw(sessionId: string, payload: StreamJsonEvent): Promise<void> {
    this.record('sendRaw', sessionId, payload);
    this.maybeFail();
  }

  async respondPermission(sessionId: string, requestId: string, result: PermissionResult): Promise<void> {
    this.record('respondPermission', sessionId, requestId, result);
    this.maybeFail();
    const sig = this.signalFor(sessionId);
    sig.value = markControlSent(sig.value, requestId, result);
  }

  async answerQuestion(
    sessionId: string,
    requestId: string,
    answers: Record<string, string | string[]>,
    response?: string,
  ): Promise<void> {
    this.record('answerQuestion', sessionId, requestId, answers, response);
    this.maybeFail();
    const sig = this.signalFor(sessionId);
    sig.value = markControlSent(sig.value, requestId, { behavior: 'allow', updatedInput: { answers } });
  }

  async interrupt(sessionId: string): Promise<void> {
    this.record('interrupt', sessionId);
    this.maybeFail();
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    this.record('setModel', sessionId, model);
    this.maybeFail();
    this.patchTranscript(sessionId, { model });
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    this.record('setPermissionMode', sessionId, mode);
    this.maybeFail();
    this.patchTranscript(sessionId, { permissionMode: mode });
  }

  async rename(sessionId: string, title: string): Promise<void> {
    this.record('rename', sessionId, title);
    this.maybeFail();
    this.sessions.value = this.sessions.value.map((s) => (s.id === sessionId ? { ...s, title } : s));
  }

  async archive(sessionId: string): Promise<void> {
    this.record('archive', sessionId);
    this.maybeFail();
    this.sessions.value = this.sessions.value.map((s) => (s.id === sessionId ? { ...s, archived: true } : s));
  }

  async createSession(opts: CreateSessionOptions): Promise<SessionSummary> {
    this.record('createSession', opts);
    this.maybeFail();
    const created = fakeSession({
      id: `cse_new_${++this.createdCount}`,
      title: opts.title ?? 'Untitled session',
      environmentId: opts.environmentId,
      model: opts.model,
      permissionMode: opts.permissionMode,
    });
    this.sessions.value = [created, ...this.sessions.value];
    return created;
  }

  on(event: StoreEvent, cb: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(cb);
    this.listeners.set(event, set);
    return () => {
      set.delete(cb);
    };
  }

  dispose(): void {
    this.record('dispose');
    this.disposed = true;
    this.listeners.clear();
  }

  // -- internals ---------------------------------------------------------------

  private signalFor(sessionId: string): Signal<TranscriptState> {
    let sig = this.transcripts.get(sessionId);
    if (!sig) {
      sig = signal(createTranscript());
      this.transcripts.set(sessionId, sig);
    }
    return sig;
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  private maybeFail(): void {
    const err = this.failNext;
    if (err) {
      this.failNext = null;
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** A SessionSummary with sensible defaults (connected bridge session in env_mac). */
export function fakeSession(partial: Partial<SessionSummary> & { id: string }): SessionSummary {
  const base = summarizeSession(wireSession({ id: partial.id, title: partial.title ?? `Session ${partial.id}` }));
  return { ...base, ...partial };
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

type Questions = QuestionItem['questions'];

/** Transcript item builders. Ids are unique per call; pass `id` in extra to pin one. */
export const items = {
  user(text: string, extra: Partial<UserItem> = {}): UserItem {
    return { kind: 'user', id: nextId('user'), text, imageCount: 0, synthetic: false, ...extra };
  },
  assistant(text: string, extra: Partial<AssistantTextItem> = {}): AssistantTextItem {
    return { kind: 'assistant_text', id: nextId('msg'), text, partial: false, ...extra };
  },
  thinking(text: string, extra: Partial<ThinkingItem> = {}): ThinkingItem {
    return { kind: 'thinking', id: nextId('think'), text, partial: false, ...extra };
  },
  tool(name: string, input: Record<string, unknown>, extra: Partial<ToolItem> = {}): ToolItem {
    return { kind: 'tool', id: nextId('toolu'), name, input, status: 'done', isError: false, children: [], ...extra };
  },
  permission(toolName: string, input: Record<string, unknown>, extra: Partial<PermissionItem> = {}): PermissionItem {
    const id = extra.id ?? nextId('req');
    return { kind: 'permission', id, requestId: id, toolName, input, suggestions: [], ...extra };
  },
  question(questions: Questions, extra: Partial<QuestionItem> = {}): QuestionItem {
    const id = extra.id ?? nextId('req');
    return { kind: 'question', id, requestId: id, questions, resolved: false, ...extra };
  },
  result(extra: Partial<ResultItem> = {}): ResultItem {
    return {
      kind: 'result',
      id: nextId('result'),
      subtype: 'success',
      isError: false,
      durationMs: 1200,
      costUsd: 0.01,
      numTurns: 1,
      errors: [],
      ...extra,
    };
  },
  system(text: string, subtype = 'notice', extra: Partial<SystemItem> = {}): SystemItem {
    return { kind: 'system', id: nextId('sys'), subtype, text, ...extra };
  },
  error(text: string, extra: Partial<ErrorItem> = {}): ErrorItem {
    return { kind: 'error', id: nextId('err'), text, ...extra };
  },
};

function pendingFor(item: TranscriptItem): PendingControl | undefined {
  if (item.kind === 'permission' && !item.resolved) {
    return { requestId: item.requestId, kind: 'permission', raw: permissionRequest(item.requestId, item.toolName, item.input) };
  }
  if (item.kind === 'question' && !item.resolved) {
    return { requestId: item.requestId, kind: 'question', raw: questionRequest(item.requestId, item.questions) };
  }
  return undefined;
}

/** A transcript state over the given items; pending and turn follow the unresolved cards unless overridden. */
export function transcriptWith(list: TranscriptItem[], extra: Partial<TranscriptState> = {}): TranscriptState {
  const pending = list.map(pendingFor).filter((p): p is PendingControl => p !== undefined);
  const last = list[list.length - 1];
  const turn = pending.length > 0 ? 'needs_input' : !last || last.kind === 'result' ? 'idle' : 'working';
  return { ...createTranscript(), items: list, lastSeq: list.length, turn, pending, ...extra };
}
