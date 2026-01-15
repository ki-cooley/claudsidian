/**
 * Backend WebSocket Client Singleton
 *
 * Provides a shared WebSocketClient instance that can be accessed
 * by the main plugin and the LLM provider manager.
 */

import { WebSocketClient } from './WebSocketClient';

/**
 * Shared WebSocketClient instance
 */
export const webSocketClient = new WebSocketClient();

// Make it globally accessible for debugging
if (typeof window !== 'undefined') {
	(window as any).__claudsidianWsClient = webSocketClient;
}
