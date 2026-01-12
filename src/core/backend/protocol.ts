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
