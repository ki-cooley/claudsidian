/**
 * WebSocket Server
 *
 * Handles connections from the Obsidian plugin, routes messages,
 * and manages the bidirectional RPC protocol.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { runAgent } from './agent.js';
import { runMockAgent } from './mock-agent.js';
import { logger } from './utils.js';

const MOCK_MODE = process.env.MOCK_MODE === 'true';
import type {
  ClientMessage,
  ServerMessage,
  PromptMessage,
  RpcResponseMessage,
  CancelMessage,
  VaultBridge,
  SearchResult,
  FileInfo,
  GrepResult,
} from './protocol.js';

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';
const PORT = parseInt(process.env.PORT || '3001', 10);

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Handles a single WebSocket connection
 */
class ConnectionHandler {
  private pendingRpcs = new Map<string, PendingRpc>();
  private activeRequests = new Map<string, AbortController>();
  private lastActivity = Date.now();

  constructor(private ws: WebSocket) {
    ws.on('message', (data) => {
      this.lastActivity = Date.now();
      this.handleMessage(data.toString());
    });
    ws.on('close', () => this.cleanup());
    ws.on('error', (err) => logger.error('WebSocket error:', err));
  }

  /**
   * Check if the connection is still alive based on last message activity.
   * Uses application-level pings (not protocol-level) since Railway's proxy
   * doesn't forward WebSocket ping/pong frames.
   */
  checkAlive(): boolean {
    const inactiveMs = Date.now() - this.lastActivity;
    // Allow 90 seconds of inactivity (plugin sends app-level pings every 30s)
    if (inactiveMs > 90000) {
      logger.warn(`Connection inactive for ${Math.round(inactiveMs / 1000)}s, terminating`);
      this.ws.terminate();
      return false;
    }
    return true;
  }

  private async handleMessage(raw: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.send({ type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' });
      return;
    }

    logger.debug('Received message:', msg.type);

    switch (msg.type) {
      case 'prompt':
        await this.handlePrompt(msg);
        break;
      case 'rpc_response':
        this.handleRpcResponse(msg);
        break;
      case 'cancel':
        this.handleCancel(msg);
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
    }
  }

  private async handlePrompt(msg: PromptMessage) {
    const abortController = new AbortController();
    this.activeRequests.set(msg.id, abortController);

    logger.info(`Processing prompt request ${msg.id}`);

    try {
      // Create vault bridge that sends RPC requests to plugin
      const vaultBridge = this.createVaultBridge();

      // Use mock agent in mock mode, real agent otherwise
      const agentRunner = MOCK_MODE ? runMockAgent : runAgent;

      for await (const event of agentRunner(
        msg.prompt,
        vaultBridge,
        msg.context,
        abortController.signal,
        msg.systemPrompt,
        msg.model
      )) {
        if (abortController.signal.aborted) {
          logger.info(`Request ${msg.id} was cancelled`);
          break;
        }

        switch (event.type) {
          case 'text_delta':
            this.send({
              type: 'text_delta',
              requestId: msg.id,
              text: event.text,
            });
            break;
          case 'tool_start':
            this.send({
              type: 'tool_start',
              requestId: msg.id,
              toolName: event.name,
              toolInput: event.input,
            });
            break;
          case 'tool_end':
            this.send({
              type: 'tool_end',
              requestId: msg.id,
              toolName: event.name,
              result: event.result,
            });
            break;
          case 'thinking':
            this.send({
              type: 'thinking',
              requestId: msg.id,
              text: event.text,
            });
            break;
          case 'complete':
            this.send({
              type: 'complete',
              requestId: msg.id,
              result: event.result,
            });
            break;
          case 'error':
            this.send({
              type: 'error',
              requestId: msg.id,
              code: event.code,
              message: event.message,
            });
            break;
        }
      }

      logger.info(`Completed prompt request ${msg.id}`);
    } catch (err) {
      logger.error(`Error processing prompt ${msg.id}:`, err);
      this.send({
        type: 'error',
        requestId: msg.id,
        code: 'AGENT_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      // Safety net: always send a complete event so the client never hangs.
      // If the agent already sent one, the client handler was already deleted
      // and this is a harmless no-op.
      this.send({
        type: 'complete',
        requestId: msg.id,
        result: '',
      });
      this.activeRequests.delete(msg.id);
    }
  }

  private handleRpcResponse(msg: RpcResponseMessage) {
    const pending = this.pendingRpcs.get(msg.id);
    if (!pending) {
      logger.warn(`Received RPC response for unknown request: ${msg.id}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRpcs.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleCancel(msg: CancelMessage) {
    const controller = this.activeRequests.get(msg.id);
    if (controller) {
      logger.info(`Cancelling request ${msg.id}`);
      controller.abort();
    }
  }

  /**
   * Send RPC request to plugin and wait for response
   */
  async sendRpc<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    const id = randomUUID();
    const RPC_TIMEOUT = 30000; // 30 seconds

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRpcs.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, RPC_TIMEOUT);

      this.pendingRpcs.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      logger.debug(`Sending RPC request: ${method}`, params);
      this.send({ type: 'rpc_request', id, method: method as 'vault_read', params });
    });
  }

  private createVaultBridge(): VaultBridge {
    return {
      read: async (path: string): Promise<string> => {
        const result = await this.sendRpc<{ content: string }>(
          'vault_read',
          { path }
        );
        return result.content;
      },
      write: async (path: string, content: string): Promise<void> => {
        await this.sendRpc('vault_write', { path, content });
      },
      edit: async (path: string, oldString: string, newString: string): Promise<void> => {
        await this.sendRpc('vault_edit', { path, old_string: oldString, new_string: newString });
      },
      search: async (
        query: string,
        limit: number = 20
      ): Promise<SearchResult[]> => {
        return this.sendRpc<SearchResult[]>('vault_search', { query, limit });
      },
      grep: async (
        pattern: string,
        folder?: string,
        filePattern?: string,
        limit: number = 50
      ): Promise<GrepResult[]> => {
        return this.sendRpc<GrepResult[]>('vault_grep', {
          pattern,
          folder: folder || '',
          file_pattern: filePattern || '*.md',
          limit
        });
      },
      glob: async (pattern: string): Promise<string[]> => {
        return this.sendRpc<string[]>('vault_glob', { pattern });
      },
      list: async (folder: string): Promise<FileInfo[]> => {
        return this.sendRpc<FileInfo[]>('vault_list', { folder });
      },
      rename: async (oldPath: string, newPath: string): Promise<void> => {
        await this.sendRpc('vault_rename', { old_path: oldPath, new_path: newPath });
      },
      delete: async (path: string): Promise<void> => {
        await this.sendRpc('vault_delete', { path });
      },
    };
  }

  private send(msg: ServerMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private cleanup() {
    logger.info('Connection closed, cleaning up');

    // Cancel all pending RPCs
    for (const [id, pending] of this.pendingRpcs) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRpcs.clear();

    // Abort all active requests
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }
}

/**
 * Start the HTTP + WebSocket server
 */
export function startServer(): Server {
  const connections = new Map<WebSocket, ConnectionHandler>();

  // Create HTTP server for health checks
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Health check endpoint
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mock: MOCK_MODE }));
      return;
    }

    // 404 for other routes
    res.writeHead(404);
    res.end('Not Found');
  });

  // Create WebSocket server attached to HTTP server
  const wss = new WebSocketServer({ server: httpServer });

  // Heartbeat interval to detect dead connections
  const heartbeatInterval = setInterval(() => {
    for (const [ws, handler] of connections) {
      if (!handler.checkAlive()) {
        connections.delete(ws);
      }
    }
  }, 30000);

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Simple token auth via query param
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');

    if (token !== AUTH_TOKEN) {
      logger.warn('Unauthorized connection attempt');
      ws.close(4001, 'Unauthorized');
      return;
    }

    logger.info('Client connected');
    const handler = new ConnectionHandler(ws);
    connections.set(ws, handler);

    ws.on('close', () => {
      connections.delete(ws);
      logger.info('Client disconnected');
    });
  });

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  httpServer.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  return httpServer;
}
