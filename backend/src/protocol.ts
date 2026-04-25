/**
 * WebSocket Protocol Types
 *
 * Defines the bidirectional message types for communication between
 * the backend server and the Obsidian plugin.
 */

// ============================================================================
// Shared Types
// ============================================================================

export interface SearchResult {
  path: string;
  snippet: string;
  score?: number;
}

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'folder';
}

export interface AgentContext {
  currentFile?: string;
  selection?: string;
}

// ============================================================================
// Client → Server Messages
// ============================================================================

/** Send a prompt to the agent */
export interface PromptMessage {
  type: 'prompt';
  id: string;
  prompt: string;
  context?: AgentContext;
  /** Custom system prompt to prepend to the agent's base system prompt */
  systemPrompt?: string;
  /** Model to use for this request (e.g., 'claude-opus-4-5-20250514') */
  model?: string;
  /** Images to include as multimodal content */
  images?: Array<{ mimeType: string; base64Data: string }>;
  /** Client workspace ID (enables session persistence across reconnects) */
  clientId?: string;
  /** Conversation ID in client's chat history */
  conversationId?: string;
}

/** Response to an RPC request from server */
export interface RpcResponseMessage {
  type: 'rpc_response';
  id: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

/** Cancel ongoing agent operation */
export interface CancelMessage {
  type: 'cancel';
  id: string;
}

/** Interrupt ongoing agent turn (cancel and optionally start new one) */
export interface InterruptMessage {
  type: 'interrupt';
  id: string;
  prompt?: string;  // Optional: if provided, start new turn with this prompt
}

/** Inject a message into ongoing agent turn (aside) */
export interface AsideMessage {
  type: 'aside';
  id: string;
  message: string;  // Message to inject mid-turn
}

/** Keepalive ping */
export interface PingMessage {
  type: 'ping';
}

/** Resume a previously created session */
export interface SessionResumeMessage {
  type: 'session_resume';
  sessionId: string;
  clientId: string;
}

/** List sessions for a client */
export interface SessionListMessage {
  type: 'session_list';
  clientId: string;
}

/** Cancel a session (even if not connected to it) */
export interface SessionCancelMessage {
  type: 'session_cancel';
  sessionId: string;
}

export type ClientMessage =
  | PromptMessage
  | RpcResponseMessage
  | CancelMessage
  | InterruptMessage
  | AsideMessage
  | PingMessage
  | SessionResumeMessage
  | SessionListMessage
  | SessionCancelMessage;

// ============================================================================
// Server → Client Messages
// ============================================================================

/** Streaming text from agent */
export interface TextDeltaMessage {
  type: 'text_delta';
  requestId: string;
  text: string;
}

/** Agent is using a tool */
export interface ToolStartMessage {
  type: 'tool_start';
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/** Tool finished */
export interface ToolEndMessage {
  type: 'tool_end';
  requestId: string;
  toolName: string;
  result: string;
}

/** Agent thinking (for transparency) */
export interface ThinkingMessage {
  type: 'thinking';
  requestId: string;
  text: string;
}

/** Agent finished */
export interface CompleteMessage {
  type: 'complete';
  requestId: string;
  result: string;
}

/** Error occurred */
export interface ErrorMessage {
  type: 'error';
  requestId?: string;
  code: string;
  message: string;
}

/** RPC request - server asking plugin to perform vault operation */
export interface RpcRequestMessage {
  type: 'rpc_request';
  id: string;
  method: 'vault_read' | 'vault_write' | 'vault_edit' | 'vault_search' | 'vault_grep' | 'vault_glob' | 'vault_list' | 'vault_rename' | 'vault_delete';
  params: Record<string, unknown>;
}

/** Session was created for a prompt */
export interface SessionCreatedMessage {
  type: 'session_created';
  requestId: string;
  sessionId: string;
}

/** Batch replay of buffered session events */
export interface SessionReplayMessage {
  type: 'session_replay';
  sessionId: string;
  conversationId: string;
  events: AgentEvent[];
  isComplete: boolean;
}

/** Session info (response to session_list, one per session) */
export interface SessionInfoMessage {
  type: 'session_info';
  sessionId: string;
  conversationId: string;
  status: 'running' | 'complete' | 'error';
  createdAt: number;
  completedAt?: number;
  eventCount: number;
}

/** Keepalive response */
export interface PongMessage {
  type: 'pong';
}

export type ServerMessage =
  | TextDeltaMessage
  | ToolStartMessage
  | ToolEndMessage
  | ThinkingMessage
  | CompleteMessage
  | ErrorMessage
  | RpcRequestMessage
  | PongMessage
  | SessionCreatedMessage
  | SessionReplayMessage
  | SessionInfoMessage;

// ============================================================================
// Agent Events (internal)
// ============================================================================

export type AgentEventType =
  | 'text_delta'
  | 'tool_start'
  | 'tool_end'
  | 'thinking'
  | 'complete'
  | 'error';

export interface BaseAgentEvent {
  type: AgentEventType;
}

export interface TextDeltaEvent extends BaseAgentEvent {
  type: 'text_delta';
  text: string;
}

export interface ToolStartEvent extends BaseAgentEvent {
  type: 'tool_start';
  name: string;
  input: Record<string, unknown>;
}

export interface ToolEndEvent extends BaseAgentEvent {
  type: 'tool_end';
  name: string;
  result: string;
}

export interface ThinkingEvent extends BaseAgentEvent {
  type: 'thinking';
  text: string;
}

export interface CompleteEvent extends BaseAgentEvent {
  type: 'complete';
  result: string;
}

export interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  code: string;
  message: string;
}

export type AgentEvent =
  | TextDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | ThinkingEvent
  | CompleteEvent
  | ErrorEvent;

// ============================================================================
// Vault Bridge Interface
// ============================================================================

export interface GrepResult {
  path: string;
  line: number;
  content: string;
  context?: string;
}

export interface VaultBridge {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  edit(path: string, oldString: string, newString: string): Promise<void>;
  search(query: string, limit?: number): Promise<SearchResult[]>;
  grep(pattern: string, folder?: string, filePattern?: string, limit?: number): Promise<GrepResult[]>;
  glob(pattern: string): Promise<string[]>;
  list(folder: string): Promise<FileInfo[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  delete(path: string): Promise<void>;
}
