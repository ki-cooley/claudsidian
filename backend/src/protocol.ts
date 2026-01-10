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

/** Keepalive ping */
export interface PingMessage {
  type: 'ping';
}

export type ClientMessage =
  | PromptMessage
  | RpcResponseMessage
  | CancelMessage
  | PingMessage;

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
  | PongMessage;

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
