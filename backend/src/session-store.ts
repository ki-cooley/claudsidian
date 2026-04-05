/**
 * Session Store
 *
 * Manages server-side sessions that outlive WebSocket connections.
 * Each prompt creates a session that buffers all agent events.
 * Sessions persist in memory with a 24h TTL.
 */

import { randomUUID } from 'crypto';
import type { AgentEvent, VaultBridge, SearchResult, FileInfo, GrepResult } from './protocol.js';
import { logger } from './utils.js';

// ============================================================================
// RPC Sender interface — connection-agnostic way to send vault RPCs
// ============================================================================

export interface RpcSender {
  sendRpc<T>(method: string, params: Record<string, unknown>): Promise<T>;
}

// ============================================================================
// Detachable Vault Bridge — can be disconnected/reconnected to different clients
// ============================================================================

export class DetachableVaultBridge implements VaultBridge {
  private sender: RpcSender | null;

  constructor(sender: RpcSender) {
    this.sender = sender;
  }

  get isConnected(): boolean {
    return this.sender !== null;
  }

  detach(): void {
    this.sender = null;
  }

  attach(sender: RpcSender): void {
    this.sender = sender;
  }

  private ensureConnected(): RpcSender {
    if (!this.sender) {
      throw new Error('Client disconnected — vault operations unavailable. Continue with text response only.');
    }
    return this.sender;
  }

  async read(path: string): Promise<string> {
    const sender = this.ensureConnected();
    const result = await sender.sendRpc<{ content: string }>('vault_read', { path });
    return result.content;
  }

  async write(path: string, content: string): Promise<void> {
    const sender = this.ensureConnected();
    await sender.sendRpc('vault_write', { path, content });
  }

  async edit(path: string, oldString: string, newString: string): Promise<void> {
    const sender = this.ensureConnected();
    await sender.sendRpc('vault_edit', { path, old_string: oldString, new_string: newString });
  }

  async search(query: string, limit: number = 20): Promise<SearchResult[]> {
    const sender = this.ensureConnected();
    return sender.sendRpc<SearchResult[]>('vault_search', { query, limit });
  }

  async grep(pattern: string, folder?: string, filePattern?: string, limit: number = 50): Promise<GrepResult[]> {
    const sender = this.ensureConnected();
    return sender.sendRpc<GrepResult[]>('vault_grep', {
      pattern,
      folder: folder || '',
      file_pattern: filePattern || '*.md',
      limit,
    });
  }

  async glob(pattern: string): Promise<string[]> {
    const sender = this.ensureConnected();
    return sender.sendRpc<string[]>('vault_glob', { pattern });
  }

  async list(folder: string): Promise<FileInfo[]> {
    const sender = this.ensureConnected();
    return sender.sendRpc<FileInfo[]>('vault_list', { folder });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const sender = this.ensureConnected();
    await sender.sendRpc('vault_rename', { old_path: oldPath, new_path: newPath });
  }

  async delete(path: string): Promise<void> {
    const sender = this.ensureConnected();
    await sender.sendRpc('vault_delete', { path });
  }
}

// ============================================================================
// Session
// ============================================================================

export type SessionStatus = 'running' | 'complete' | 'error';

type SessionEventCallback = (event: AgentEvent) => void;

export class Session {
  readonly id: string;
  readonly conversationId: string;
  readonly clientId: string;
  readonly prompt: string;
  readonly model: string;
  readonly createdAt: number;

  status: SessionStatus = 'running';
  events: AgentEvent[] = [];
  completedAt?: number;
  error?: string;

  readonly bridge: DetachableVaultBridge;
  private subscribers = new Set<SessionEventCallback>();
  private abortController = new AbortController();

  constructor(params: {
    conversationId: string;
    clientId: string;
    prompt: string;
    model: string;
    sender: RpcSender;
  }) {
    this.id = randomUUID();
    this.conversationId = params.conversationId;
    this.clientId = params.clientId;
    this.prompt = params.prompt;
    this.model = params.model;
    this.createdAt = Date.now();
    this.bridge = new DetachableVaultBridge(params.sender);
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /** Push an event — buffers it AND notifies subscribers */
  pushEvent(event: AgentEvent): void {
    this.events.push(event);
    for (const cb of this.subscribers) {
      try {
        cb(event);
      } catch (err) {
        logger.error(`Session ${this.id} subscriber error:`, err);
      }
    }
  }

  /** Subscribe to live events. Returns unsubscribe function. */
  subscribe(callback: SessionEventCallback): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  markComplete(): void {
    this.status = 'complete';
    this.completedAt = Date.now();
    logger.info(`Session ${this.id} completed (${this.events.length} events)`);
  }

  markError(message: string): void {
    this.status = 'error';
    this.completedAt = Date.now();
    this.error = message;
    logger.error(`Session ${this.id} error: ${message}`);
  }

  cancel(): void {
    this.abortController.abort();
  }

  detachBridge(): void {
    this.bridge.detach();
  }

  attachBridge(sender: RpcSender): void {
    this.bridge.attach(sender);
  }

  toInfo(): SessionInfo {
    return {
      sessionId: this.id,
      conversationId: this.conversationId,
      status: this.status,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
      eventCount: this.events.length,
    };
  }
}

export interface SessionInfo {
  sessionId: string;
  conversationId: string;
  status: SessionStatus;
  createdAt: number;
  completedAt?: number;
  eventCount: number;
}

// ============================================================================
// Session Store
// ============================================================================

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

export class SessionStore {
  private sessions = new Map<string, Session>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
    // Allow the timer to not block process exit
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  create(params: {
    conversationId: string;
    clientId: string;
    prompt: string;
    model: string;
    sender: RpcSender;
  }): Session {
    const session = new Session(params);
    this.sessions.set(session.id, session);
    logger.info(`Session ${session.id} created for client ${params.clientId}, conversation ${params.conversationId}`);
    return session;
  }

  get(id: string): Session | null {
    return this.sessions.get(id) || null;
  }

  getByClientId(clientId: string): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.clientId === clientId);
  }

  remove(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.cancel();
      this.sessions.delete(id);
    }
  }

  /** Remove expired sessions */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      const age = now - session.createdAt;
      if (age > SESSION_TTL) {
        session.cancel();
        this.sessions.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      logger.info(`Cleaned up ${removed} expired sessions (${this.sessions.size} remaining)`);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) {
      session.cancel();
    }
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }
}
