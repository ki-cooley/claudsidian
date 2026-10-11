/**
 * Domain model shared by the store, the reducer, and the UI. Everything here is plain data
 * (JSON-safe) so it can be snapshotted in tests and rendered without the API types.
 */
import type { ControlRequestEvent, PermissionUpdate, WireSession } from '../api/types';

export type TurnState = 'idle' | 'sending' | 'working' | 'needs_input' | 'offline' | 'error';

export interface SessionSummary {
  id: string;
  title: string;
  archived: boolean;
  workerStatus: string; // idle | running | requires_action | unknown
  connectionStatus: string; // connected | connecting | disconnected | unknown
  environmentId: string;
  environmentKind: string; // bridge | cloud | unknown
  model?: string;
  permissionMode?: string;
  createdAt?: number; // epoch ms
  lastEventAt?: number; // epoch ms
  unread: boolean;
  /** working directory from the session's init event, filled lazily by the store */
  cwd?: string;
  summary?: { category?: string; detail?: string; needsAction?: string; recentAction?: string };
  tags: string[];
  raw: WireSession;
}

export function toEpochMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

export function summarizeSession(w: WireSession, cwd?: string): SessionSummary {
  const pts = w.post_turn_summary ?? w.external_metadata?.post_turn_summary;
  return {
    id: w.id,
    title: (w.title ?? '').trim() || 'Untitled session',
    archived: w.status === 'archived',
    workerStatus: w.worker_status ?? 'unknown',
    connectionStatus: w.connection_status ?? 'unknown',
    environmentId: w.environment_id ?? '',
    environmentKind: w.environment_kind ?? 'unknown',
    model: w.session_context?.model ?? w.config?.model,
    permissionMode: w.session_context?.permission_mode ?? w.permission_mode,
    createdAt: toEpochMs(w.created_at),
    lastEventAt: toEpochMs(w.last_event_at ?? w.updated_at),
    unread: w.unread === true,
    cwd,
    summary: pts
      ? {
          category: pts.status_category,
          detail: pts.status_detail,
          needsAction: pts.needs_action,
          recentAction: pts.recent_action,
        }
      : undefined,
    tags: w.tags ?? [],
    raw: w,
  };
}

/** What the plugin captured from Obsidian at send time. */
export interface CapturedContext {
  vaultName: string;
  activeNote?: { path: string; cursorLine?: number };
  selection?: { text: string; fromLine: number; toLine: number; truncated: boolean };
  openNotes: string[];
  mentions: string[];
}

export interface OutgoingAttachment {
  kind: 'image';
  name: string;
  mediaType: string; // image/jpeg | image/png | image/webp | image/gif
  base64: string;
  width?: number;
  height?: number;
  bytes?: number;
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  imageCount: number;
  /** true for user events the host synthesised (tool results are NOT items, they attach to tools) */
  synthetic: boolean;
  ts?: number;
}

export interface AssistantTextItem {
  kind: 'assistant_text';
  id: string; // `${messageId}:${blockIndex}` or a uuid
  messageId?: string;
  text: string;
  partial: boolean;
  parentToolUseId?: string;
  ts?: number;
}

export interface ThinkingItem {
  kind: 'thinking';
  id: string;
  messageId?: string;
  text: string;
  partial: boolean;
  parentToolUseId?: string;
  ts?: number;
}

export interface ToolItem {
  kind: 'tool';
  id: string; // tool_use id
  name: string;
  input: Record<string, unknown>;
  /** partial JSON while streaming input_json_delta */
  inputPartial?: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  isError: boolean;
  parentToolUseId?: string;
  /** subagent (Agent tool) traffic nested under this call */
  children: TranscriptItem[];
  ts?: number;
}

export interface PermissionItem {
  kind: 'permission';
  id: string; // request_id
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
  blockedPath?: string;
  decisionReason?: string;
  toolUseId?: string;
  resolved?: 'allow' | 'deny';
  ts?: number;
}

export interface QuestionItem {
  kind: 'question';
  id: string; // request_id
  requestId: string;
  questions: {
    question: string;
    header?: string;
    options: { label: string; description?: string }[];
    multiSelect: boolean;
  }[];
  answers?: Record<string, string | string[]>;
  resolved: boolean;
  ts?: number;
}

export interface ResultItem {
  kind: 'result';
  id: string;
  subtype: string;
  isError: boolean;
  durationMs?: number;
  costUsd?: number;
  numTurns?: number;
  errors: string[];
  localCommand?: string;
  ts?: number;
}

export interface SystemItem {
  kind: 'system';
  id: string;
  subtype: string; // init | compact_boundary | permission_denied | api_retry | notice | ...
  text: string;
  ts?: number;
}

export interface ErrorItem {
  kind: 'error';
  id: string;
  text: string;
  ts?: number;
}

export type TranscriptItem =
  | UserItem
  | AssistantTextItem
  | ThinkingItem
  | ToolItem
  | PermissionItem
  | QuestionItem
  | ResultItem
  | SystemItem
  | ErrorItem;

export interface PendingControl {
  requestId: string;
  kind: 'permission' | 'question' | 'dialog';
  raw: ControlRequestEvent;
}

export interface SessionInit {
  cwd: string;
  model: string;
  permissionMode?: string;
  effort?: string | null;
  slashCommands: string[];
  tools: string[];
  claudeCodeVersion?: string;
}

/** Open stream_event message in one scope (top level or one subagent), kept by the reducer between polls. */
export interface StreamScope {
  /** message id from message_start; partial items are `${messageId}:${blockIndex}` */
  messageId: string;
  /** content block index -> item id (tool blocks use the tool_use id) */
  blocks: Record<number, string>;
  /** blocks of this message already received as final `assistant` content (they arrive one per event) */
  finalized?: number;
  /** messageId was invented because the window opened mid-stream (no message_start seen) */
  synthesized?: boolean;
}

export interface TranscriptState {
  items: TranscriptItem[];
  /** highest sequence_num applied; -1 before any event */
  lastSeq: number;
  turn: TurnState;
  pending: PendingControl[];
  init?: SessionInit;
  /** model and mode as last reported (init, set_model/set_permission_mode acks, /model output) */
  model?: string;
  permissionMode?: string;
  lastResult?: ResultItem;
  /** uuids of user events we sent and are waiting to see echoed */
  inFlightUserUuids: string[];
  /** streaming bookkeeping keyed by parent_tool_use_id ("" for the top level); owned by the reducer */
  streaming?: Record<string, StreamScope>;
}

export function createTranscript(): TranscriptState {
  return { items: [], lastSeq: -1, turn: 'idle', pending: [], inFlightUserUuids: [] };
}
