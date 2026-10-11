// Private test doubles for the shell tests (Root, Notifications, ObsidianFacade): a SessionStoreApi over
// plain signals with an emit() for store events, an AuthApi whose state can be flipped, and a recording
// PluginFacade. B1 owns the shared test/helpers/fake-store.ts and fake-facade.ts; once those land the
// shell tests can import them instead.
import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import type { AuthApi } from '../../src/api/auth-api';
import type { AuthState } from '../../src/api/auth-types';
import type { PermissionResult, StreamJsonEvent, WireSession } from '../../src/api/types';
import type {
  Banner,
  CreateSessionOptions,
  Environment,
  SendOptions,
  SessionStoreApi,
  StoreEvent,
} from '../../src/core/store-api';
import { createTranscript, type CapturedContext, type SessionSummary, type TranscriptState } from '../../src/core/types';
import { DEFAULT_SETTINGS, type ClaudsidianSettings } from '../../src/settings';
import type { PluginFacade } from '../../src/ui/facade';

export const SIGNED_IN: AuthState = {
  accessToken: 'sk-ant-oat01-TESTACCESS',
  refreshToken: 'sk-ant-ort01-TESTREFRESH',
  expiresAt: 9e12,
  scopes: [],
  clientId: 'cid',
  orgUuid: '12345678-aaaa-bbbb-cccc-dddddddddddd',
  email: 'k@x',
};

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

type Listener = (sessionId: string, state: TranscriptState) => void;

export class FakeStore implements SessionStoreApi {
  readonly sessions: Signal<SessionSummary[]> = signal([]);
  readonly sessionsLoading: Signal<boolean> = signal(false);
  readonly sessionsError: Signal<string | null> = signal(null);
  readonly selectedId: Signal<string | null> = signal(null);
  readonly banner: Signal<Banner | null> = signal(null);
  readonly visible: Signal<boolean> = signal(true);
  calls: { name: string; args: unknown[] }[] = [];
  envs: Environment[] = [];
  private readonly transcripts = new Map<string, Signal<TranscriptState>>();
  private readonly listeners = new Map<StoreEvent, Set<Listener>>();

  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
  }
  names(): string[] {
    return this.calls.map((c) => c.name);
  }
  /** Fire a store event the way SessionStore does from its poller. */
  emit(event: StoreEvent, sessionId: string, state: TranscriptState = createTranscript()): void {
    for (const cb of this.listeners.get(event) ?? []) cb(sessionId, state);
  }
  listenerCount(event: StoreEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }
  setTranscript(sessionId: string, state: TranscriptState): void {
    (this.transcript(sessionId) as Signal<TranscriptState>).value = state;
  }

  transcript(sessionId: string): ReadonlySignal<TranscriptState> {
    let s = this.transcripts.get(sessionId);
    if (!s) {
      s = signal(createTranscript());
      this.transcripts.set(sessionId, s);
    }
    return s;
  }
  session(sessionId: string): SessionSummary | undefined {
    return this.sessions.value.find((s) => s.id === sessionId);
  }
  environments(): Environment[] {
    return this.envs;
  }
  async refreshSessions(): Promise<void> {
    this.record('refreshSessions');
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
  }
  async createSession(opts: CreateSessionOptions): Promise<SessionSummary> {
    this.record('createSession', opts);
    return makeSession({ id: 'cse_new', environmentId: opts.environmentId, title: opts.title ?? 'cse_new' });
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
    this.listeners.clear();
  }
}

export class FakeAuth implements AuthApi {
  state: AuthState | null;
  private readonly listeners = new Set<(s: AuthState | null) => void>();
  constructor(state: AuthState | null = null) {
    this.state = state;
  }
  /** Flip the auth state and notify subscribers, as AuthManager.commit does. */
  set(state: AuthState | null): void {
    this.state = state;
    for (const cb of [...this.listeners]) cb(state);
  }
  isSignedIn(): boolean {
    return this.state !== null;
  }
  async beginSignIn(): Promise<{ url: string; state: string }> {
    return { url: 'https://example.invalid/authorize', state: 's' };
  }
  async completeSignIn(): Promise<AuthState> {
    this.set(SIGNED_IN);
    return SIGNED_IN;
  }
  async getAccessToken(): Promise<string> {
    return 'fake';
  }
  async refresh(): Promise<AuthState> {
    throw new Error('not in tests');
  }
  async signOut(): Promise<void> {
    this.set(null);
  }
  orgUuid(): string | undefined {
    return this.state?.orgUuid;
  }
  async setOrgUuid(): Promise<void> {}
  onChange(cb: (s: AuthState | null) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export class FakeFacade implements PluginFacade {
  isMobile = false;
  vaultName = 'yes-chef';
  version = 'test';
  auth: FakeAuth;
  current: ClaudsidianSettings = structuredClone(DEFAULT_SETTINGS);
  opened: string[] = [];
  notices: string[] = [];
  signInCalls = 0;
  signInResult = true;

  constructor(auth: FakeAuth = new FakeAuth(SIGNED_IN)) {
    this.auth = auth;
  }
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
    if (this.signInResult) this.auth.set(SIGNED_IN);
    return this.signInResult;
  }
  async setWakeLock(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// jsdom helpers
// ---------------------------------------------------------------------------

export function mount(tree: ComponentChild): { root: HTMLElement; unmount: () => void } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  act(() => {
    render(tree, root);
  });
  return {
    root,
    unmount: () => {
      act(() => {
        render(null, root);
      });
      root.remove();
    },
  };
}

export function click(el: Element | null | undefined): void {
  if (!el) throw new Error('click target missing');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
