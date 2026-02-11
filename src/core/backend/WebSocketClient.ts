/**
 * WebSocket Client for Backend Communication
 *
 * Manages WebSocket connection to the backend server, handles message
 * routing, and provides event-based API for streaming responses and RPC.
 *
 * Mobile-compatible: Uses browser's native WebSocket API.
 */

import type {
	ClientMessage,
	ServerMessage,
	PromptMessage,
	AgentContext,
	RpcRequestMessage,
} from './protocol';

/**
 * Generate a random UUID (browser-compatible)
 */
function randomUUID(): string {
	// Use browser's crypto.randomUUID if available (modern browsers)
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	// Fallback for older browsers
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
		/[xy]/g,
		function (c) {
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		}
	);
}

export interface WebSocketClientConfig {
	url: string;
	token: string;
}

export interface StreamingHandlers {
	onTextDelta?: (text: string) => void;
	onToolStart?: (name: string, input: Record<string, unknown>) => void;
	onToolEnd?: (name: string, result: string) => void;
	onThinking?: (text: string) => void;
	onComplete?: (result: string) => void;
	onError?: (code: string, message: string) => void;
}

type EventHandler = (...args: unknown[]) => void;

export class WebSocketClient {
	private ws: WebSocket | null = null;
	private config: WebSocketClientConfig | null = null;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 5;
	private reconnectDelay = 1000;
	private activeHandlers = new Map<string, StreamingHandlers>();
	private pingInterval: number | null = null;
	private eventHandlers = new Map<string, Set<EventHandler>>();
	private pendingRpcs = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	private messageQueue: ClientMessage[] = [];
	private isConnecting = false;
	private pendingActivityIds: {
		toolName: string;
		filePath: string;
		activityId: string;
	}[] = [];

	/**
	 * Connect to the backend WebSocket server
	 */
	async connect(url: string, token: string): Promise<void> {
		if (this.isConnecting) {
			throw new Error('Connection already in progress');
		}

		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			return; // Already connected
		}

		this.config = { url, token };
		this.isConnecting = true;

		return new Promise((resolve, reject) => {
			const wsUrl = `${url}?token=${encodeURIComponent(token)}`;

			try {
				this.ws = new WebSocket(wsUrl);
			} catch (error) {
				this.isConnecting = false;
				reject(error);
				return;
			}

			const onOpen = () => {
				console.log('[WebSocketClient] Connected to backend');
				this.reconnectAttempts = 0;
				this.isConnecting = false;
				this.startPingInterval();
				this.flushMessageQueue();
				this.emit('connect');
				cleanup();
				resolve();
			};

			const onError = (event: Event) => {
				console.error('[WebSocketClient] Connection error:', event);
				this.isConnecting = false;
				cleanup();
				reject(
					new Error(
						'Failed to connect to backend. Check URL and token.'
					)
				);
			};

			const onClose = (event: CloseEvent) => {
				console.log(
					'[WebSocketClient] Connection closed:',
					event.code,
					event.reason
				);
				this.isConnecting = false;
				cleanup();
				if (event.code !== 1000) {
					// Not a normal closure
					reject(new Error(`Connection closed: ${event.reason}`));
				}
			};

			const cleanup = () => {
				this.ws?.removeEventListener('open', onOpen);
				this.ws?.removeEventListener('error', onError);
				this.ws?.removeEventListener('close', onClose);
			};

			this.ws.addEventListener('open', onOpen);
			this.ws.addEventListener('error', onError);
			this.ws.addEventListener('close', onClose);

			// Set up permanent message and close handlers
			this.ws.addEventListener('message', this.handleMessage.bind(this));
			this.ws.addEventListener(
				'close',
				this.handleDisconnect.bind(this)
			);
		});
	}

	/**
	 * Disconnect from the backend
	 */
	disconnect(): void {
		this.stopPingInterval();
		if (this.ws) {
			this.ws.close(1000, 'Client disconnecting');
			this.ws = null;
		}
		this.config = null;
		this.activeHandlers.clear();
		this.pendingRpcs.clear();
		this.messageQueue = [];
	}

	/**
	 * Send a prompt to the agent and get streaming responses
	 */
	async sendPrompt(
		prompt: string,
		handlers: StreamingHandlers,
		context?: AgentContext,
		systemPrompt?: string,
		model?: string
	): Promise<string> {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error('Not connected to backend');
		}

		const id = randomUUID();
		this.activeHandlers.set(id, handlers);

		const message: PromptMessage = {
			type: 'prompt',
			id,
			prompt,
			context,
			systemPrompt,
			model,
		};

		this.send(message);
		return id;
	}

	/**
	 * Cancel an ongoing request
	 */
	cancelRequest(requestId: string): void {
		this.send({ type: 'cancel', id: requestId });
		this.activeHandlers.delete(requestId);
	}

	/**
	 * Send an RPC response back to the server
	 */
	sendRpcResponse(
		id: string,
		result?: unknown,
		error?: { code: string; message: string }
	): void {
		this.send({
			type: 'rpc_response',
			id,
			result,
			error,
		});
	}

	/**
	 * Emit a tool start event to all active handlers
	 * Note: In normal operation, tool_start/tool_end events come from the backend
	 * server over WebSocket, so this is mainly for testing or alternative flows.
	 */
	emitToolStart(toolName: string, toolInput: Record<string, unknown>): void {
		for (const handlers of this.activeHandlers.values()) {
			handlers.onToolStart?.(toolName, toolInput);
		}
	}

	/**
	 * Emit a tool end event to all active handlers
	 */
	emitToolEnd(toolName: string, result: string): void {
		for (const handlers of this.activeHandlers.values()) {
			handlers.onToolEnd?.(toolName, result);
		}
	}

	/**
	 * Track an activity ID from a tool_start event.
	 * This is consumed by the RPC handler to link edit snapshots to the correct activity.
	 */
	trackActivityStart(
		toolName: string,
		input: Record<string, unknown>,
		activityId: string
	): void {
		const filePath =
			(input.path as string) || (input.old_path as string) || '';
		this.pendingActivityIds.push({ toolName, filePath, activityId });
	}

	/**
	 * Consume the activity ID for a given RPC method and params.
	 * Returns the matching activity ID if found, otherwise undefined.
	 */
	consumeActivityId(
		method: string,
		params: Record<string, unknown>
	): string | undefined {
		const filePath =
			(params.path as string) || (params.old_path as string) || '';
		const idx = this.pendingActivityIds.findIndex(
			(a) => a.toolName === method && a.filePath === filePath
		);
		if (idx !== -1) {
			const { activityId } = this.pendingActivityIds[idx];
			this.pendingActivityIds.splice(idx, 1);
			return activityId;
		}
		return undefined;
	}

	/**
	 * Register an event handler
	 */
	on(event: string, handler: EventHandler): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, new Set());
		}
		this.eventHandlers.get(event)!.add(handler);
	}

	/**
	 * Unregister an event handler
	 */
	off(event: string, handler: EventHandler): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			handlers.delete(handler);
		}
	}

	/**
	 * Check if connected
	 */
	get isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	private handleMessage(event: MessageEvent): void {
		let msg: ServerMessage;
		try {
			msg = JSON.parse(event.data) as ServerMessage;
		} catch {
			console.error('[WebSocketClient] Invalid JSON from server');
			return;
		}

		switch (msg.type) {
			case 'text_delta': {
				const handler = this.activeHandlers.get(msg.requestId);
				handler?.onTextDelta?.(msg.text);
				break;
			}
			case 'tool_start': {
				const handler = this.activeHandlers.get(msg.requestId);
				handler?.onToolStart?.(msg.toolName, msg.toolInput);
				break;
			}
			case 'tool_end': {
				const handler = this.activeHandlers.get(msg.requestId);
				handler?.onToolEnd?.(msg.toolName, msg.result);
				break;
			}
			case 'thinking': {
				const handler = this.activeHandlers.get(msg.requestId);
				handler?.onThinking?.(msg.text);
				break;
			}
			case 'complete': {
				const handler = this.activeHandlers.get(msg.requestId);
				handler?.onComplete?.(msg.result);
				this.activeHandlers.delete(msg.requestId);
				break;
			}
			case 'error': {
				if (msg.requestId) {
					const handler = this.activeHandlers.get(msg.requestId);
					handler?.onError?.(msg.code, msg.message);
					this.activeHandlers.delete(msg.requestId);
				} else {
					this.emit('error', msg.code, msg.message);
				}
				break;
			}
			case 'rpc_request': {
				this.emit('rpc_request', msg);
				break;
			}
			case 'pong': {
				// Keepalive response, no action needed
				break;
			}
		}
	}

	private handleDisconnect(event: CloseEvent): void {
		console.log('[WebSocketClient] Disconnected:', event.code);
		this.stopPingInterval();
		this.emit('disconnect', event.code, event.reason);

		// Reject all pending RPCs
		for (const [id, pending] of this.pendingRpcs) {
			pending.reject(new Error('Connection closed'));
		}
		this.pendingRpcs.clear();

		// Attempt reconnection if not a normal closure
		if (event.code !== 1000 && this.config) {
			this.attemptReconnect();
		}
	}

	private attemptReconnect(): void {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error(
				'[WebSocketClient] Max reconnection attempts reached'
			);
			this.emit('error', 'MAX_RECONNECTS', 'Failed to reconnect');
			return;
		}

		this.reconnectAttempts++;
		const delay =
			this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
		console.log(
			`[WebSocketClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
		);

		setTimeout(async () => {
			if (this.config) {
				try {
					await this.connect(this.config.url, this.config.token);
				} catch (error) {
					console.error(
						'[WebSocketClient] Reconnection failed:',
						error
					);
					this.attemptReconnect();
				}
			}
		}, delay);
	}

	private send(msg: ClientMessage): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		} else {
			// Queue message for when connection is restored
			this.messageQueue.push(msg);
		}
	}

	private flushMessageQueue(): void {
		while (this.messageQueue.length > 0 && this.isConnected) {
			const msg = this.messageQueue.shift();
			if (msg) {
				this.ws!.send(JSON.stringify(msg));
			}
		}
	}

	private startPingInterval(): void {
		this.pingInterval = window.setInterval(() => {
			if (this.isConnected) {
				this.send({ type: 'ping' });
			}
		}, 25000); // Ping every 25 seconds (server timeout is 90s)
	}

	private stopPingInterval(): void {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}

	private emit(event: string, ...args: unknown[]): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(...args);
				} catch (error) {
					console.error(
						`[WebSocketClient] Error in ${event} handler:`,
						error
					);
				}
			}
		}
	}
}
