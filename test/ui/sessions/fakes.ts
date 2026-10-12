// Private test doubles for the sessions screen: a SessionStoreApi over plain signals and a
// recording PluginFacade. B1 owns the shared test/helpers/fake-store.ts and fake-facade.ts; once
// those land the sessions tests can import them instead.
import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { AuthApi } from '../../../src/api/auth-api';
import type { AuthState } from '../../../src/api/auth-types';
import type { ControlRequestEvent, PermissionResult, StreamJsonEvent, WireSession } from '../../../src/api/types';
import type {
  Banner,
  CreateSessionOptions,
  Environment,
  SendOptions,
  SessionStoreApi,
  StoreEvent,
} from '../../../src/core/store-api';
import {
  createTranscript,
  type CapturedContext,
  type PendingControl,
  type SessionSummary,
  type TranscriptState,
} from '../../../src/core/types';
import { DEFAULT_SETTINGS, type ClaudsidianSettings } from '../../../src/settings';
import type { PluginFacade } from '../../../src/ui/facade';

export function makeSession(over: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: over.id,
    archived: false,
    workerStatus: 'idle',
    connectionStatus: 'connected',
    environmentId: 'env_vault',
    environmentKind: 'bridge',
    unread: false,
    tags: [],
    raw: { id: over.id } as WireSession,
    ...over,
  };
}

/** A pending control the way the reducer records it: a can_use_tool request for `toolName` with `input`. */
export function makePending(kind: PendingControl['kind'], toolName: string, input: Record<string, unknown>, requestId = 'req_1'): PendingControl {
  const raw: ControlRequestEvent = {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'can_use_tool', tool_name: toolName, input },
  } as ControlRequestEvent;
  return { requestId, kind, raw };
}

export class FakeStore implements SessionStoreApi {
  readonly sessions: Signal<SessionSummary[]> = signal([]);
  readonly sessionsLoading: Signal<boolean> = signal(false);
  readonly sessionsError: Signal<string | null> = signal(null);
  readonly selectedId: Signal<string | null> = signal(null);
  readonly banner: Signal<Banner | null> = signal(null);
  readonly visible: Signal<boolean> = signal(true);
  calls: { name: string; args: unknown[] }[] = [];
  envs: Environment[] = [];
  /** When set, refreshEnvironments() records a call and replaces envs with its result (simulating the fetch). */
  envFetch: (() => Environment[]) | null = null;
  /** When set, refreshSessions() resolves only once the test resolves this (a slow fetch). */
  refreshGate: Promise<void> | null = null;
  createResult: SessionSummary | Error = makeSession({ id: 'cse_new' });
  archiveResult: Error | null = null;
  private transcripts = new Map<string, Signal<TranscriptState>>();

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
  }
  names(): string[] {
    return this.calls.map((c) => c.name);
  }
  transcript(sessionId: string): ReadonlySignal<TranscriptState> {
    let s = this.transcripts.get(sessionId);
    if (!s) {
      s = signal(createTranscript());
      this.transcripts.set(sessionId, s);
    }
    return s;
  }
  setTranscript(sessionId: string, state: TranscriptState): void {
    (this.transcript(sessionId) as Signal<TranscriptState>).value = state;
  }
  session(sessionId: string): SessionSummary | undefined {
    return this.sessions.value.find((s) => s.id === sessionId);
  }
  environments(): Environment[] {
    return this.envs;
  }
  async refreshSessions(opts?: { resort?: boolean }): Promise<void> {
    this.record('refreshSessions', opts);
    if (this.refreshGate) await this.refreshGate;
  }
  async refreshEnvironments(): Promise<void> {
    this.record('refreshEnvironments');
    if (this.envFetch) this.envs = this.envFetch();
  }
  startListPolling(): void {
    this.record('startListPolling');
  }
  stopListPolling(): void {
    this.record('stopListPolling');
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
    return false;
  }
  async send(sessionId: string, text: string, opts?: SendOptions): Promise<void> {
    this.record('send', sessionId, text, opts);
  }
  async sendRaw(sessionId: string, payload: StreamJsonEvent): Promise<void> {
    this.record('sendRaw', sessionId, payload);
  }
  async respondPermission(sessionId: string, requestId: string, result: PermissionResult): Promise<void> {
    this.record('respondPermission', sessionId, requestId, result);
  }
  async answerQuestion(
    sessionId: string,
    requestId: string,
    answers: Record<string, string | string[]>,
    response?: string,
  ): Promise<void> {
    this.record('answerQuestion', sessionId, requestId, answers, response);
  }
  async interrupt(sessionId: string): Promise<void> {
    this.record('interrupt', sessionId);
  }
  async setModel(sessionId: string, model: string): Promise<void> {
    this.record('setModel', sessionId, model);
  }
  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    this.record('setPermissionMode', sessionId, mode);
  }
  async rename(sessionId: string, title: string): Promise<void> {
    this.record('rename', sessionId, title);
  }
  async archive(sessionId: string): Promise<void> {
    this.record('archive', sessionId);
    if (this.archiveResult) throw this.archiveResult;
    this.sessions.value = this.sessions.value.map((s) => (s.id === sessionId ? { ...s, archived: true } : s));
  }
  async createSession(opts: CreateSessionOptions): Promise<SessionSummary> {
    this.record('createSession', opts);
    if (this.createResult instanceof Error) throw this.createResult;
    return this.createResult;
  }
  on(_event: StoreEvent, _cb: (sessionId: string, state: TranscriptState) => void): () => void {
    return () => {};
  }
  dispose(): void {
    this.record('dispose');
  }
}

class FakeAuth implements AuthApi {
  state: AuthState | null = null;
  isSignedIn(): boolean {
    return this.state !== null;
  }
  async beginSignIn(): Promise<{ url: string; state: string }> {
    return { url: 'https://example.invalid/authorize', state: 's' };
  }
  async completeSignIn(): Promise<AuthState> {
    throw new Error('not in tests');
  }
  async getAccessToken(): Promise<string> {
    return 'fake';
  }
  async refresh(): Promise<AuthState> {
    throw new Error('not in tests');
  }
  async signOut(): Promise<void> {
    this.state = null;
  }
  orgUuid(): string | undefined {
    return undefined;
  }
  async setOrgUuid(): Promise<void> {}
  onChange(): () => void {
    return () => {};
  }
}

export class FakeFacade implements PluginFacade {
  isMobile = false;
  vaultName = 'yes-chef';
  version = 'test';
  auth: AuthApi = new FakeAuth();
  current: ClaudsidianSettings = structuredClone(DEFAULT_SETTINGS);
  opened: string[] = [];
  notices: string[] = [];
  signInCalls = 0;
  signInResult = true;

  settings(): ClaudsidianSettings {
    return this.current;
  }
  async saveSettings(patch: Partial<ClaudsidianSettings>): Promise<void> {
    this.current = { ...this.current, ...patch };
  }
  async renderMarkdown(markdown: string, el: HTMLElement): Promise<void> {
    el.textContent = markdown;
  }
  captureContext(mentions: string[]): CapturedContext {
    return { vaultName: this.vaultName, openNotes: [], mentions };
  }
  vaultFiles(): string[] {
    return [];
  }
  async openFile(): Promise<void> {}
  async insertAtCursor(): Promise<boolean> {
    return false;
  }
  async replaceSelection(): Promise<boolean> {
    return false;
  }
  async createNote(path: string): Promise<string> {
    return path;
  }
  async copyToClipboard(): Promise<void> {}
  openExternal(url: string): void {
    this.opened.push(url);
  }
  notice(text: string): void {
    this.notices.push(text);
  }
  async pickImages(): Promise<File[]> {
    return [];
  }
  async signIn(): Promise<boolean> {
    this.signInCalls += 1;
    return this.signInResult;
  }
  async setWakeLock(): Promise<void> {}
}
