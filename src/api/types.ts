/**
 * Wire types for the Remote Control controller API (api.anthropic.com/v1/code/sessions)
 * and the Claude Code stream-json event vocabulary it relays.
 *
 * Unofficial API. Shapes verified against Claude Code 2.1.296 on 2026-10-10 and the vendored
 * reference in docs/reference/claude-rc-api-reference.md. Keep every optional field optional:
 * the server adds and drops fields without notice, so readers must tolerate extras and gaps.
 */

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface WireSession {
  id: string; // "cse_..." or "session_..."
  title?: string;
  status?: 'active' | 'archived' | string;
  status_bucket?: string; // working | completed | review_ready | failed | blocked | ...
  worker_status?: 'idle' | 'running' | 'requires_action' | string;
  connection_status?: 'connected' | 'connecting' | 'disconnected' | string;
  environment_id?: string;
  environment_kind?: 'bridge' | 'cloud' | string;
  config?: { model?: string; [k: string]: unknown };
  session_context?: { model?: string; effort_level?: string; permission_mode?: string; [k: string]: unknown };
  permission_mode?: string;
  created_at?: string;
  updated_at?: string;
  last_event_at?: string;
  user_message_count?: string | number;
  tags?: string[];
  unread?: boolean;
  origin?: string;
  parent_session_id?: string;
  post_turn_summary?: WirePostTurnSummary;
  external_metadata?: {
    post_turn_summary?: WirePostTurnSummary;
    context_usage?: { max_tokens?: number; used_tokens?: number };
    pending_action?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface WirePostTurnSummary {
  status_category?: string; // completed | review_ready | needs_action | failed | ...
  status_detail?: string;
  needs_action?: string;
  recent_action?: string;
}

export interface WireSessionList {
  data: WireSession[];
  next_cursor?: string | null;
  resume_token?: string;
}

export interface WireEventRow {
  sequence_num: string | number;
  payload: StreamJsonEvent;
  event_type?: string;
  source?: string;
  created_at?: string;
  [k: string]: unknown;
}

export interface WireEventList {
  data: WireEventRow[];
  next_page?: string | null;
  has_more?: boolean;
}

export interface CreateSessionRequest {
  environment_id: string;
  title?: string;
  session_context?: { model?: string; permission_mode?: string; effort_level?: string };
  events?: { payload: StreamJsonEvent }[];
  tags?: string[];
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Content blocks (Messages API)
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}
export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}
export interface UnknownBlock {
  type: string;
  [k: string]: unknown;
}
export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | UnknownBlock;

// ---------------------------------------------------------------------------
// stream-json events (payload.type)
// ---------------------------------------------------------------------------

export interface StreamJsonBase {
  uuid?: string;
  session_id?: string;
  timestamp?: string;
  parent_tool_use_id?: string | null;
}

export interface SystemInitEvent extends StreamJsonBase {
  type: 'system';
  subtype: 'init';
  cwd: string;
  model: string;
  permissionMode?: string;
  tools?: string[];
  slash_commands?: string[];
  effort?: string | null;
  capabilities?: string[];
  claude_code_version?: string;
  mcp_servers?: { name: string; status: string }[];
  [k: string]: unknown;
}

export interface SystemOtherEvent extends StreamJsonBase {
  type: 'system';
  subtype: string; // compact_boundary | permission_denied | api_retry | task_started | task_notification | status | ...
  [k: string]: unknown;
}

export interface UserEvent extends StreamJsonBase {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] };
  isSynthetic?: boolean;
  isMeta?: boolean;
  isReplay?: boolean;
  tool_use_result?: unknown;
  client_composed?: boolean;
  origin?: unknown;
  [k: string]: unknown;
}

export interface AssistantEvent extends StreamJsonBase {
  type: 'assistant';
  message: {
    id?: string;
    role: 'assistant';
    content: ContentBlock[];
    model?: string;
    stop_reason?: string | null;
    usage?: unknown;
  };
  error?: string;
  aborted?: boolean;
  agent_id?: string;
  [k: string]: unknown;
}

export interface ResultEvent extends StreamJsonBase {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | string;
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  result?: string;
  errors?: string[];
  permission_denials?: unknown[];
  stop_reason?: string | null;
  local_command?: string;
  [k: string]: unknown;
}

export type RawMessageStreamEvent =
  | { type: 'message_start'; message: { id: string; [k: string]: unknown } }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | {
      type: 'content_block_delta';
      index: number;
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'thinking_delta'; thinking: string }
        | { type: 'input_json_delta'; partial_json: string }
        | { type: string; [k: string]: unknown };
    }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: unknown; usage?: unknown }
  | { type: 'message_stop' }
  | { type: string; [k: string]: unknown };

export interface StreamEventEvent extends StreamJsonBase {
  type: 'stream_event';
  event: RawMessageStreamEvent;
}

export type PermissionUpdate = Record<string, unknown> & { type?: string; destination?: string };

export interface CanUseToolRequest {
  subtype: 'can_use_tool';
  tool_name: string;
  input: Record<string, unknown>;
  permission_suggestions?: PermissionUpdate[];
  blocked_path?: string;
  tool_use_id?: string;
  agent_id?: string;
  decision_reason?: string;
  description?: string;
  [k: string]: unknown;
}

export interface OtherControlRequest {
  subtype: string; // interrupt | set_model | set_permission_mode | request_user_dialog | side_question | ...
  [k: string]: unknown;
}

export interface ControlRequestEvent extends StreamJsonBase {
  type: 'control_request';
  request_id: string;
  request: CanUseToolRequest | OtherControlRequest;
}

export interface ControlResponseEvent extends StreamJsonBase {
  type: 'control_response';
  response: {
    subtype: 'success' | 'error';
    request_id: string;
    response?: unknown;
    error?: string;
  };
}

export interface OtherEvent extends StreamJsonBase {
  type: string;
  [k: string]: unknown;
}

export type StreamJsonEvent =
  | SystemInitEvent
  | SystemOtherEvent
  | UserEvent
  | AssistantEvent
  | ResultEvent
  | StreamEventEvent
  | ControlRequestEvent
  | ControlResponseEvent
  | OtherEvent;

/** Answer to a can_use_tool request (same shape as the Agent SDK's PermissionResult). */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export interface AskUserQuestionInput {
  questions: {
    question: string;
    header?: string;
    options: { label: string; description?: string; preview?: string }[];
    multiSelect?: boolean;
  }[];
  answers?: Record<string, string | string[]>;
  response?: string;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isSystemInit(e: StreamJsonEvent): e is SystemInitEvent {
  return e.type === 'system' && (e as SystemOtherEvent).subtype === 'init';
}
export function isUserEvent(e: StreamJsonEvent): e is UserEvent {
  return e.type === 'user';
}
export function isAssistantEvent(e: StreamJsonEvent): e is AssistantEvent {
  return e.type === 'assistant';
}
export function isResultEvent(e: StreamJsonEvent): e is ResultEvent {
  return e.type === 'result';
}
export function isStreamEvent(e: StreamJsonEvent): e is StreamEventEvent {
  return e.type === 'stream_event';
}
export function isControlRequest(e: StreamJsonEvent): e is ControlRequestEvent {
  return e.type === 'control_request';
}
export function isControlResponse(e: StreamJsonEvent): e is ControlResponseEvent {
  return e.type === 'control_response';
}
export function isCanUseTool(r: ControlRequestEvent['request']): r is CanUseToolRequest {
  return r.subtype === 'can_use_tool';
}
