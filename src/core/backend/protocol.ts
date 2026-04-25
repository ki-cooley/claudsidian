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

export interface GrepResult {
	path: string;
	line: number;
	content: string;
	context?: string;
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

/** Cancel a session */
export interface SessionCancelMessage {
	type: 'session_cancel';
	sessionId: string;
}

/** Interrupt the current agent turn and optionally start a new one */
export interface InterruptMessage {
	type: 'interrupt';
	id: string;
	prompt?: string;
}

/** Inject a message into the current agent turn without canceling */
export interface AsideMessage {
	type: 'aside';
	id: string;
	message: string;
}

export type ClientMessage =
	| PromptMessage
	| RpcResponseMessage
	| CancelMessage
	| PingMessage
	| SessionResumeMessage
	| SessionListMessage
	| SessionCancelMessage
	| InterruptMessage
	| AsideMessage;

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
	method:
		| 'vault_read'
		| 'vault_write'
		| 'vault_edit'
		| 'vault_search'
		| 'vault_grep'
		| 'vault_glob'
		| 'vault_list'
		| 'vault_rename'
		| 'vault_delete';
	params: Record<string, unknown>;
}

/** Session was created for a prompt */
export interface SessionCreatedMessage {
	type: 'session_created';
	requestId: string;
	sessionId: string;
}

/** Agent event as stored in session buffer */
export interface SessionAgentEvent {
	type: 'text_delta' | 'tool_start' | 'tool_end' | 'thinking' | 'complete' | 'error';
	[key: string]: unknown;
}

/** Batch replay of buffered session events */
export interface SessionReplayMessage {
	type: 'session_replay';
	sessionId: string;
	conversationId: string;
	events: SessionAgentEvent[];
	isComplete: boolean;
}

/** Session info (response to session_list) */
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
