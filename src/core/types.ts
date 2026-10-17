/**
 * Domain model shared by the store, the reducer, and the UI. Everything here is plain data
 * (JSON-safe) so it can be snapshotted in tests and rendered without the API types.
 */
import type { ControlRequestEvent, PermissionUpdate, WireSession } from '../api/types';

export type TurnState = 'idle' | 'sending' | 'working' | 'needs_input' | 'offline' | 'error';

/** What a blocked session waits on, as far as the wire says (external_metadata.pending_action). */
export interface PendingSummary {
  /** question for AskUserQuestion, permission for any other can_use_tool request, other for the rest */
  kind: 'permission' | 'question' | 'other';
  toolName?: string;
  /** the question text, or the tool description, when the payload carries one */
  text?: string;
  requestId?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  archived: boolean;
  workerStatus: string; // idle | running | requires_action | unknown
  statusBucket?: string; // working | completed | review_ready | failed | blocked | ...
  connectionStatus: string; // connected | connecting | disconnected | unknown
  environmentId: string;
  environmentKind: string; // bridge | cloud | unknown
  model?: string;
  permissionMode?: string;
  createdAt?: number; // epoch ms
  lastEventAt?: number; // epoch ms
  /**
   * Epoch ms the list orders by: lastEventAt frozen at the last full re-sort (screen mount, manual refresh),
   * so a background poll does not shuffle rows under the reader. Absent on summaries built outside the store,
   * which then order by lastEventAt.
   */
  sortAt?: number;
  unread: boolean;
  /** working directory from the session's init event, filled lazily by the store and persisted across loads */
  cwd?: string;
  summary?: { category?: string; detail?: string; needsAction?: string; recentAction?: string };
  /** what the session is blocked on; the needs-you line prefers `pending.text` and falls back to summary.needsAction */
  pending?: PendingSummary;
  /** offline with a machine-generated title ("kisworkcomputer-zany-finch"): sorted last in its group, never "needs you" */
  quiet?: boolean;
  tags: string[];
  raw: WireSession;
}

/** Titles claude remote-control invents: three or more lowercase word or number runs joined by hyphens, no spaces. */
export const MACHINE_TITLE_RE = /^[a-z0-9]+(-[a-z0-9]+){2,}$/;

export function isQuietSession(title: string, connectionStatus: string): boolean {
  return connectionStatus !== 'connected' && MACHINE_TITLE_RE.test(title);
}

export function toEpochMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/**
 * external_metadata.pending_action, read defensively: the reference only says the details live there, and the
 * mock server sends {type, tool_name, request_id}. The question text is taken from the AskUserQuestion input
 * shape ({input: {questions: [{question}]}}) or a top-level question/description when present; unverified
 * against the live API, so readers keep summary.needsAction as the fallback.
 */
export function pendingOf(w: WireSession): PendingSummary | undefined {
  const pa: unknown = w.external_metadata?.pending_action;
  if (!isRecord(pa)) return undefined;
  const toolName = optStr(pa.tool_name) ?? optStr(pa.toolName);
  const input = isRecord(pa.input) ? pa.input : undefined;
  const questions: unknown = input?.questions ?? pa.questions;
  const first: unknown = Array.isArray(questions) ? questions[0] : undefined;
  const text = (isRecord(first) ? optStr(first.question) : undefined) ?? optStr(pa.question) ?? optStr(pa.description);
  const kind: PendingSummary['kind'] =
    toolName === 'AskUserQuestion' ? 'question' : toolName || pa.type === 'can_use_tool' ? 'permission' : 'other';
  const out: PendingSummary = { kind };
  if (toolName) out.toolName = toolName;
  if (text) out.text = text;
  const requestId = optStr(pa.request_id) ?? optStr(pa.requestId);
  if (requestId) out.requestId = requestId;
  return out;
}

export function summarizeSession(w: WireSession, cwd?: string): SessionSummary {
  const pts = w.post_turn_summary ?? w.external_metadata?.post_turn_summary;
  const title = (w.title ?? '').trim() || 'Untitled session';
  const connectionStatus = w.connection_status ?? 'unknown';
  return {
    id: w.id,
    title,
    archived: w.status === 'archived',
    workerStatus: w.worker_status ?? 'unknown',
    statusBucket: w.status_bucket,
    connectionStatus,
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
    pending: pendingOf(w),
    quiet: isQuietSession(title, connectionStatus),
    tags: w.tags ?? [],
    raw: w,
  };
}

function sameSummaryText(a: SessionSummary['summary'], b: SessionSummary['summary']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.category === b.category && a.detail === b.detail && a.needsAction === b.needsAction && a.recentAction === b.recentAction;
}

function samePending(a: PendingSummary | undefined, b: PendingSummary | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.toolName === b.toolName && a.text === b.text && a.requestId === b.requestId;
}

/** True when every field the session list renders or orders by is equal; `raw` is not compared. */
export function sameSummary(a: SessionSummary, b: SessionSummary): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.archived === b.archived &&
    a.workerStatus === b.workerStatus &&
    a.statusBucket === b.statusBucket &&
    a.connectionStatus === b.connectionStatus &&
    a.environmentId === b.environmentId &&
    a.environmentKind === b.environmentKind &&
    a.model === b.model &&
    a.permissionMode === b.permissionMode &&
    a.createdAt === b.createdAt &&
    a.lastEventAt === b.lastEventAt &&
    a.sortAt === b.sortAt &&
    a.unread === b.unread &&
    a.cwd === b.cwd &&
    a.quiet === b.quiet &&
    sameSummaryText(a.summary, b.summary) &&
    samePending(a.pending, b.pending) &&
    a.tags.length === b.tags.length &&
    a.tags.every((t, i) => t === b.tags[i])
  );
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
  /** sent from this client and not yet echoed by the server; rendered muted with a "Sending" label */
  pending?: boolean;
  /**
   * "Queued": accepted by the server and not echoed yet, or echoed mid-turn and not yet taken in by Claude (the
   * next top-level tool result or turn init clears it)
   */
  queued?: boolean;
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
