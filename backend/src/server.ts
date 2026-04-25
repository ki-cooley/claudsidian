/**
 * WebSocket Server
 *
 * Handles connections from the Obsidian plugin, routes messages,
 * and manages the bidirectional RPC protocol.
 *
 * Sessions decouple agent lifetime from WebSocket connections:
 * - Each prompt creates a Session that buffers all events
 * - If the client disconnects, the agent keeps running
 * - On reconnect, the client can resume and replay buffered events
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { runAgent } from './agent.js';
import { runMockAgent } from './mock-agent.js';
import { logger, AsyncQueue } from './utils.js';
import { SessionStore, Session, type RpcSender } from './session-store.js';

const MOCK_MODE = process.env.MOCK_MODE === 'true';
import type {
  ClientMessage,
  ServerMessage,
  AgentEvent,
  PromptMessage,
  RpcResponseMessage,
  CancelMessage,
  InterruptMessage,
  AsideMessage,
  SessionResumeMessage,
  SessionListMessage,
  SessionCancelMessage,
} from './protocol.js';

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';
const PORT = parseInt(process.env.PORT || '3001', 10);

interface PendingRpc {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Handles a single WebSocket connection.
 *
 * A connection may subscribe to multiple sessions. When the connection
 * closes, sessions continue running — only the live-streaming link is severed.
 */
class ConnectionHandler implements RpcSender {
  private pendingRpcs = new Map<string, PendingRpc>();
  private lastActivity = Date.now();

  /** sessionId -> unsubscribe function for live event streaming */
  private sessionSubs = new Map<string, () => void>();

  /** conversationId -> SDK session ID for multi-turn context */
  private static sdkSessions = new Map<string, string>();

  /** requestId -> input queue for streaming user messages (interrupts/asides) */
  private activeInputQueues = new Map<string, AsyncQueue<any>>();

  /** requestId -> session, so interrupt/aside can locate the session by the
   * id the client knows about (the prompt's `id`, not the server's session.id). */
  private requestSessions = new Map<string, Session>();

  constructor(
    private ws: WebSocket,
    private sessionStore: SessionStore,
  ) {
    ws.on('message', (data) => {
      this.lastActivity = Date.now();
      this.handleMessage(data.toString());
    });
    ws.on('close', () => this.cleanup());
    ws.on('error', (err) => logger.error('WebSocket error:', err));
  }

  checkAlive(): boolean {
    const inactiveMs = Date.now() - this.lastActivity;
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
        this.handlePrompt(msg);
        break;
      case 'rpc_response':
        this.handleRpcResponse(msg);
        break;
      case 'cancel':
        this.handleCancel(msg);
        break;
      case 'interrupt':
        this.handleInterrupt(msg);
        break;
      case 'aside':
        this.handleAside(msg);
        break;
      case 'session_resume':
        this.handleSessionResume(msg);
        break;
      case 'session_list':
        this.handleSessionList(msg);
        break;
      case 'session_cancel':
        this.handleSessionCancel(msg);
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Prompt → Session creation
  // --------------------------------------------------------------------------

  private handlePrompt(msg: PromptMessage) {
    const clientId = msg.clientId || 'anonymous';
    const conversationId = msg.conversationId || msg.id;

    // Create a session that outlives this connection
    const session = this.sessionStore.create({
      conversationId,
      clientId,
      prompt: msg.prompt,
      model: msg.model || '',
      sender: this,
    });

    // Tell the client about the session ID
    this.send({
      type: 'session_created',
      requestId: msg.id,
      sessionId: session.id,
    });

    // Index session by requestId so interrupt/aside (which the client sends
    // with the prompt's id, not session.id) can find it.
    this.requestSessions.set(msg.id, session);

    // Subscribe to live events — forward to client as ServerMessages
    const unsub = session.subscribe((event) => {
      this.sendAgentEvent(msg.id, event);
    });
    this.sessionSubs.set(session.id, unsub);

    // Start the agent in the background (don't await — runs independently)
    this.runAgentForSession(session, msg).catch((err) => {
      logger.error(`Agent runner failed for session ${session.id}:`, err);
    });

    logger.info(`Session ${session.id} started for prompt ${msg.id}`);
  }

  private async runAgentForSession(session: Session, msg: PromptMessage) {
    const agentRunner = MOCK_MODE ? runMockAgent : runAgent;
    const conversationId = msg.conversationId || msg.id;

    // Create an input queue for streaming input (interrupts/asides).
    // Keyed by requestId — that's the id the plugin sends back on
    // interrupt/aside, since session.id is opaque to it on first turn.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputQueue = new AsyncQueue<any>();
    this.activeInputQueues.set(msg.id, inputQueue);

    // Check for existing SDK session (multi-turn follow-up)
    const existingSdkSession = ConnectionHandler.sdkSessions.get(conversationId);

    if (existingSdkSession) {
      logger.info(`Multi-turn: resuming SDK session ${existingSdkSession} for conversation ${conversationId}`);
    }

    try {
      for await (const event of agentRunner(
        msg.prompt,
        session.bridge,
        msg.context,
        session.signal,
        msg.systemPrompt,
        msg.model,
        msg.images,
        existingSdkSession,  // resumeSessionId (undefined on first turn)
        (sdkId: string) => {
          // Capture SDK session ID from first assistant message
          ConnectionHandler.sdkSessions.set(conversationId, sdkId);
          logger.info(`Captured SDK session ${sdkId} for conversation ${conversationId}`);
        },
        inputQueue,  // Pass input queue for streaming input (interrupts/asides)
      )) {
        if (session.signal.aborted) {
          logger.info(`Session ${session.id} was cancelled`);
          break;
        }
        session.pushEvent(event);
      }

      // Ensure a complete event is in the buffer
      const hasComplete = session.events.some(e => e.type === 'complete');
      if (!hasComplete) {
        session.pushEvent({ type: 'complete', result: '' });
      }

      session.markComplete();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      session.pushEvent({ type: 'error', code: 'AGENT_ERROR', message: errMsg });
      session.markError(errMsg);
    } finally {
      // Clean up input queue and request mapping when session ends
      this.activeInputQueues.delete(msg.id);
      this.requestSessions.delete(msg.id);
      inputQueue.close();
    }
  }

  // --------------------------------------------------------------------------
  // Session resume / list / cancel
  // --------------------------------------------------------------------------

  private handleSessionResume(msg: SessionResumeMessage) {
    const session = this.sessionStore.get(msg.sessionId);
    if (!session) {
      this.send({ type: 'error', code: 'SESSION_NOT_FOUND', message: `Session ${msg.sessionId} not found or expired` });
      return;
    }

    logger.info(`Resuming session ${session.id} (${session.events.length} buffered events, status: ${session.status})`);

    // Send all buffered events as a batch
    this.send({
      type: 'session_replay',
      sessionId: session.id,
      conversationId: session.conversationId,
      events: session.events,
      isComplete: session.status !== 'running',
    });

    // If still running, subscribe to live events and reattach vault bridge
    if (session.status === 'running') {
      session.attachBridge(this);

      // Clean up any previous subscription for this session
      const prevUnsub = this.sessionSubs.get(session.id);
      if (prevUnsub) prevUnsub();

      const unsub = session.subscribe((event) => {
        // Use session.id as requestId for resumed sessions
        this.sendAgentEvent(session.id, event);
      });
      this.sessionSubs.set(session.id, unsub);
    }
  }

  private handleSessionList(msg: SessionListMessage) {
    const sessions = this.sessionStore.getByClientId(msg.clientId);
    for (const session of sessions) {
      const info = session.toInfo();
      this.send({
        type: 'session_info',
        ...info,
      });
    }
  }

  private handleSessionCancel(msg: SessionCancelMessage) {
    const session = this.sessionStore.get(msg.sessionId);
    if (session) {
      logger.info(`Cancelling session ${session.id}`);
      session.cancel();
    }
  }

  // --------------------------------------------------------------------------
  // RPC handling (vault bridge)
  // --------------------------------------------------------------------------

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
    // Legacy cancel by requestId — find session and cancel it
    // Also check if it matches a session ID directly
    const session = this.sessionStore.get(msg.id);
    if (session) {
      session.cancel();
    }
  }

  private handleInterrupt(msg: InterruptMessage) {
    // Interrupt: cancel current session (looked up by requestId) and
    // optionally start a new one. The plugin sends interrupt with the
    // prompt's id; we map that to the underlying Session here.
    const session = this.requestSessions.get(msg.id);
    if (session) {
      logger.info(`Interrupting session ${session.id} (requestId=${msg.id})`);
      const queue = this.activeInputQueues.get(msg.id);
      if (queue) queue.close();
      this.activeInputQueues.delete(msg.id);
      this.requestSessions.delete(msg.id);
      session.cancel();

      // If a prompt is provided, start a new session
      if (msg.prompt) {
        logger.info(`Starting new session after interrupt with prompt`);
        const newPromptMsg: PromptMessage = {
          type: 'prompt',
          id: randomUUID(),
          prompt: msg.prompt,
          clientId: session.clientId,
          conversationId: session.conversationId,
        };
        this.handlePrompt(newPromptMsg);
      }
    } else {
      logger.warn(`Interrupt: session for requestId ${msg.id} not found`);
    }
  }

  private handleAside(msg: AsideMessage) {
    // Aside: inject a message into the ongoing agent turn.
    // Looked up by requestId (the prompt's id), which is what the plugin
    // tracks for in-flight turns.
    const inputQueue = this.activeInputQueues.get(msg.id);
    if (!inputQueue) {
      logger.warn(`Aside: no active input queue for requestId ${msg.id}`);
      return;
    }

    logger.info(`Injecting aside for requestId ${msg.id}: "${msg.message.substring(0, 50)}..."`);

    // Push the aside as a new user message
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asideMessage: any = {
      type: 'user' as const,
      message: {
        role: 'user',
        content: msg.message,
      },
      parent_tool_use_id: null,
      session_id: '',
    };
    inputQueue.push(asideMessage);
  }

  /** Send RPC request to plugin and wait for response (implements RpcSender) */
  async sendRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Client disconnected — vault operations unavailable');
    }

    const id = randomUUID();
    const RPC_TIMEOUT = 60000;

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

  // --------------------------------------------------------------------------
  // Sending
  // --------------------------------------------------------------------------

  /** Convert an AgentEvent to a ServerMessage and send it */
  private sendAgentEvent(requestId: string, event: AgentEvent) {
    switch (event.type) {
      case 'text_delta':
        this.send({ type: 'text_delta', requestId, text: event.text });
        break;
      case 'tool_start':
        this.send({ type: 'tool_start', requestId, toolName: event.name, toolInput: event.input });
        break;
      case 'tool_end':
        this.send({ type: 'tool_end', requestId, toolName: event.name, result: event.result });
        break;
      case 'thinking':
        this.send({ type: 'thinking', requestId, text: event.text });
        break;
      case 'complete':
        this.send({ type: 'complete', requestId, result: event.result });
        break;
      case 'error':
        this.send({ type: 'error', requestId, code: event.code, message: event.message });
        break;
    }
  }

  private send(msg: ServerMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // --------------------------------------------------------------------------
  // Cleanup on disconnect
  // --------------------------------------------------------------------------

  private cleanup() {
    logger.info('Connection closed, cleaning up');

    // Reject all pending RPCs (in-flight vault operations)
    for (const [id, pending] of this.pendingRpcs) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRpcs.clear();

    // Unsubscribe from all sessions and detach their vault bridges.
    // Sessions themselves keep running — only the live-streaming link is severed.
    for (const [sessionId, unsub] of this.sessionSubs) {
      unsub();
      const session = this.sessionStore.get(sessionId);
      if (session && session.status === 'running') {
        session.detachBridge();
        logger.info(`Session ${sessionId} detached from connection (still running)`);
      }
    }
    this.sessionSubs.clear();
  }
}

/**
 * Start the HTTP + WebSocket server
 */
export function startServer(): Server {
  const connections = new Map<WebSocket, ConnectionHandler>();
  const sessionStore = new SessionStore();

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        mock: MOCK_MODE,
        sessions: sessionStore.size,
      }));
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  const wss = new WebSocketServer({ server: httpServer });

  const heartbeatInterval = setInterval(() => {
    for (const [ws, handler] of connections) {
      if (!handler.checkAlive()) {
        connections.delete(ws);
      }
    }
  }, 30000);

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');

    if (token !== AUTH_TOKEN) {
      logger.warn('Unauthorized connection attempt');
      ws.close(4001, 'Unauthorized');
      return;
    }

    logger.info('Client connected');
    const handler = new ConnectionHandler(ws, sessionStore);
    connections.set(ws, handler);

    ws.on('close', () => {
      connections.delete(ws);
      logger.info('Client disconnected');
    });
  });

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    sessionStore.destroy();
  });

  httpServer.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  return httpServer;
}
