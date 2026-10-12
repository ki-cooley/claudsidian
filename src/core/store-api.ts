/**
 * The store the UI talks to. Implemented by SessionStore (src/core/session-store.ts).
 * All reactive state is exposed as @preact/signals so components re-render on change.
 */
import type { Signal, ReadonlySignal } from '@preact/signals';
import type { PermissionResult, StreamJsonEvent } from '../api/types';
import type { OutgoingAttachment, SessionSummary, TranscriptState } from './types';

export interface Environment {
  id: string;
  kind: string; // bridge | cloud | unknown
  /** "yes-chef (Mac)" style label derived from the cwd of sessions in it */
  label: string;
  /**
   * The environment's working directory: bridge_info.directory from the environments endpoint, else the
   * directory learned from one of its sessions' init events (persisted, so it is known on a cold start).
   */
  cwd?: string;
  sessionCount: number;
  /** false when the machine's remote-control server is offline (from the environments endpoint) */
  online?: boolean;
}

export interface Banner {
  kind: 'offline' | 'auth' | 'error' | 'info';
  text: string;
  /** optional one-tap action */
  action?: { label: string; run: () => void };
}

export interface CreateSessionOptions {
  environmentId: string;
  title?: string;
  firstMessage?: string;
  model?: string;
  permissionMode?: string;
}

export interface SendOptions {
  images?: OutgoingAttachment[];
  /** already formatted "[Obsidian context] ..." block; appended after a blank line */
  contextText?: string;
}

export interface RefreshOptions {
  /**
   * Order every row by last activity again. Without it a refresh keeps the previous relative order of rows
   * whose rank did not change, so a background poll never shuffles the list under the reader. The sessions
   * screen passes it on mount and on a manual refresh.
   */
  resort?: boolean;
}

export type StoreEvent = 'turn_end' | 'needs_input' | 'error';

export interface SessionStoreApi {
  readonly sessions: ReadonlySignal<SessionSummary[]>;
  /** true only while the first list load is in flight (the list is empty); background polls never set it */
  readonly sessionsLoading: ReadonlySignal<boolean>;
  readonly sessionsError: ReadonlySignal<string | null>;
  readonly selectedId: ReadonlySignal<string | null>;
  readonly banner: ReadonlySignal<Banner | null>;
  readonly visible: Signal<boolean>;

  /** Transcript signal for a session (created empty on first access). */
  transcript(sessionId: string): ReadonlySignal<TranscriptState>;
  session(sessionId: string): SessionSummary | undefined;
  environments(): Environment[];

  /** Refresh the list; `sessions` is republished only when a rendered field or the order changed. */
  refreshSessions(opts?: RefreshOptions): Promise<void>;
  /** Fetch the environments endpoint so environments() can label machines and show offline ones. Optional for fakes. */
  refreshEnvironments?(): Promise<void>;
  startListPolling(): void;
  stopListPolling(): void;

  /** Select a session: load recent history, start polling, announce presence, mark read. */
  open(sessionId: string): Promise<void>;
  /** Deselect: stop polling, clear presence, drop an error banner that belonged to the session. */
  close(): void;
  /** Older history before the first loaded event. Resolves false when there is nothing more. */
  loadOlder(sessionId: string): Promise<boolean>;
  /** Clear the current banner (the banner's own close control). Optional for fakes. */
  dismissBanner?(): void;

  send(sessionId: string, text: string, opts?: SendOptions): Promise<void>;
  sendRaw(sessionId: string, payload: StreamJsonEvent): Promise<void>;
  respondPermission(sessionId: string, requestId: string, result: PermissionResult): Promise<void>;
  answerQuestion(
    sessionId: string,
    requestId: string,
    answers: Record<string, string | string[]>,
    response?: string,
  ): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  setModel(sessionId: string, model: string): Promise<void>;
  setPermissionMode(sessionId: string, mode: string): Promise<void>;

  rename(sessionId: string, title: string): Promise<void>;
  archive(sessionId: string): Promise<void>;
  createSession(opts: CreateSessionOptions): Promise<SessionSummary>;

  on(event: StoreEvent, cb: (sessionId: string, state: TranscriptState) => void): () => void;
  dispose(): void;
}
