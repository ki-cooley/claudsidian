/**
 * In-memory CcrApi for store and shell tests: sessions and event rows live in maps, every call is
 * recorded in `calls`, `failNext` makes the next call throw once, and `push` appends a row with the next
 * sequence number (as a string, like the wire). Also exports small builders for stream-json events.
 */
import type { CcrApi, ListEventsOptions } from '../../src/api/client-api';
import { ApiError } from '../../src/api/errors';
import type {
  AssistantEvent,
  ContentBlock,
  ControlRequestEvent,
  ControlResponseEvent,
  CreateSessionRequest,
  ResultEvent,
  SendEventsResult,
  StreamJsonEvent,
  SystemInitEvent,
  UserEvent,
  WireEnvironment,
  WireEventRow,
  WireSession,
} from '../../src/api/types';
import { userMessagePayload } from '../../src/api/payloads';

function seqOf(row: WireEventRow): number {
  const n = Number(row.sequence_num);
  return Number.isFinite(n) ? n : -1;
}

export class FakeClient implements CcrApi {
  sessions: WireSession[] = [];
  events = new Map<string, WireEventRow[]>();
  sent = new Map<string, StreamJsonEvent[]>();
  calls: string[] = [];
  failNext?: ApiError;
  /** Simulate a server that ignores from_sequence_num: incremental polls return the whole history. */
  ignoreFromSequenceNum = false;
  /** Rows at or below fromSequenceNum returned by each incremental poll (overlapping windows). */
  overlap = 0;
  /** When true, sendEvents also records each payload as an event row (the server echo). */
  echoSends = false;
  /** Optional gate awaited before every call (slow network, ordering tests). */
  delay?: () => Promise<void>;
  created: CreateSessionRequest[] = [];
  /** Environments returned by listEnvironments (empty by default, like a server without the endpoint). */
  environments: WireEnvironment[] = [];
  marked: { id: string; seq: number | undefined }[] = [];
  presenceLog: { id: string; clientId: string; connected: boolean }[] = [];
  private nextSeq = new Map<string, number>();
  private createdCount = 0;

  /** Append a payload as the next event row of a session. Sequence numbers start at 1 and arrive as strings. */
  push(sessionId: string, payload: StreamJsonEvent): WireEventRow {
    const rows = this.events.get(sessionId) ?? [];
    const last = rows.length ? seqOf(rows[rows.length - 1]!) + 1 : 1;
    const seq = Math.max(this.nextSeq.get(sessionId) ?? 1, last);
    const row: WireEventRow = {
      sequence_num: String(seq),
      payload,
      event_type: 'client_event',
      created_at: new Date(seq * 1000).toISOString(),
    };
    rows.push(row);
    this.events.set(sessionId, rows);
    this.nextSeq.set(sessionId, seq + 1);
    return row;
  }

  pushAll(sessionId: string, payloads: StreamJsonEvent[]): WireEventRow[] {
    return payloads.map((p) => this.push(sessionId, p));
  }

  sentPayloads(sessionId: string): StreamJsonEvent[] {
    return this.sent.get(sessionId) ?? [];
  }

  private async record(call: string): Promise<void> {
    this.calls.push(call);
    if (this.delay) await this.delay();
    const fail = this.failNext;
    if (fail) {
      this.failNext = undefined;
      throw fail;
    }
  }

  async listSessions(): Promise<WireSession[]> {
    await this.record('listSessions');
    return this.sessions.map((s) => ({ ...s }));
  }

  async getSession(id: string): Promise<WireSession> {
    await this.record(`getSession ${id}`);
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new ApiError({ status: 404, message: 'Session not found (HTTP 404)', errorType: 'not_found_error' });
    return { ...s };
  }

  async renameSession(id: string, title: string): Promise<void> {
    await this.record(`renameSession ${id} ${JSON.stringify(title)}`);
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new ApiError({ status: 404, message: 'Session not found (HTTP 404)' });
    s.title = title;
  }

  async archiveSession(id: string): Promise<void> {
    await this.record(`archiveSession ${id}`);
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new ApiError({ status: 404, message: 'Session not found (HTTP 404)' });
    s.status = 'archived';
  }

  async markRead(id: string, sequenceNum?: number): Promise<void> {
    await this.record(`markRead ${id}${sequenceNum === undefined ? '' : ` ${sequenceNum}`}`);
    this.marked.push({ id, seq: sequenceNum });
    const s = this.sessions.find((x) => x.id === id);
    if (s) s.unread = false;
  }

  async presence(id: string, clientId: string, connected: boolean): Promise<void> {
    await this.record(`presence ${id} ${connected ? 'connected' : 'clear'}`);
    this.presenceLog.push({ id, clientId, connected });
  }

  async sendEvents(id: string, payloads: StreamJsonEvent[]): Promise<SendEventsResult> {
    await this.record(`sendEvents ${id} ${payloads.map((p) => p.type).join(',')}`);
    const list = this.sent.get(id) ?? [];
    list.push(...payloads);
    this.sent.set(id, list);
    const results: SendEventsResult['results'] = [];
    for (const p of payloads) {
      if (this.echoSends) {
        const row = this.push(id, p);
        results.push({ event_id: String(p.uuid ?? ''), sequence_num: row.sequence_num, duplicate: false });
      } else {
        results.push({ event_id: String(p.uuid ?? ''), sequence_num: String(this.nextSeq.get(id) ?? 1), duplicate: false });
      }
    }
    return { results };
  }

  async listEnvironments(): Promise<WireEnvironment[]> {
    await this.record('listEnvironments');
    return this.environments.map((e) => ({ ...e }));
  }

  /** Environments only GET by id finds (not in the list), plus everything the list returns. */
  extraEnvironments: WireEnvironment[] = [];

  async getEnvironment(id: string): Promise<WireEnvironment | null> {
    await this.record(`getEnvironment ${id}`);
    const e = [...this.environments, ...this.extraEnvironments].find((x) => x.environment_id === id);
    return e ? { ...e } : null;
  }

  async listEvents(id: string, opts: ListEventsOptions = {}): Promise<WireEventRow[]> {
    await this.record(`listEvents ${id} ${JSON.stringify(opts)}`);
    const { limit = 200, sortOrder = 'asc', fromSequenceNum, afterId } = opts;
    let rows = [...(this.events.get(id) ?? [])].sort((a, b) => seqOf(a) - seqOf(b));
    if (afterId !== undefined) {
      // the web client's cursor: rows after the one whose payload.uuid matches (none when it is unknown)
      const idx = rows.findIndex((r) => r.payload.uuid === afterId);
      const start = idx >= 0 ? idx + 1 : rows.length;
      // the real endpoint answers with bare payloads, no sequence_num (verified 2026-10-16); the client wraps them
      return rows.slice(start, start + limit).map((r) => ({ sequence_num: '', payload: { ...r.payload } }));
    }
    if (fromSequenceNum !== undefined && !this.ignoreFromSequenceNum) {
      const from = Math.max(0, fromSequenceNum - this.overlap);
      rows = rows.filter((r) => seqOf(r) >= from);
    }
    if (sortOrder === 'desc') rows.reverse();
    return rows.slice(0, limit).map((r) => ({ ...r }));
  }

  async createSession(req: CreateSessionRequest): Promise<WireSession> {
    await this.record(`createSession ${req.environment_id}`);
    this.created.push(req);
    const id = `cse_new_${++this.createdCount}`;
    const model = req.config?.model ?? req.session_context?.model;
    const session = wireSession({
      id,
      title: req.title ?? '',
      environment_id: req.environment_id,
      session_context: model || req.session_context ? { ...(req.session_context ?? {}), ...(model ? { model } : {}) } : undefined,
      created_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
    });
    this.sessions.push(session);
    for (const e of req.events ?? []) this.push(id, e.payload);
    return { ...session };
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function wireSession(partial: Partial<WireSession> & { id: string }): WireSession {
  return {
    title: `Session ${partial.id}`,
    status: 'active',
    worker_status: 'idle',
    connection_status: 'connected',
    environment_id: 'env_mac',
    environment_kind: 'bridge',
    created_at: '2026-10-10T10:00:00Z',
    last_event_at: '2026-10-10T10:00:00Z',
    unread: false,
    ...partial,
  };
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36).padStart(6, '0')}`;
}

export function initEvent(cwd: string, extra: Partial<SystemInitEvent> = {}): SystemInitEvent {
  return {
    type: 'system',
    subtype: 'init',
    uuid: nextId('uuid'),
    session_id: 'cse_test',
    cwd,
    model: 'claude-sonnet-5-5',
    permissionMode: 'auto',
    tools: ['Read', 'Edit', 'Bash'],
    slash_commands: ['compact', 'clear'],
    ...extra,
  };
}

export function userText(text: string, uuid?: string): UserEvent {
  return userMessagePayload(text, uuid);
}

export function assistantText(text: string, messageId: string = nextId('msg')): AssistantEvent {
  return {
    type: 'assistant',
    uuid: nextId('uuid'),
    session_id: 'cse_test',
    parent_tool_use_id: null,
    message: { id: messageId, role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' },
  };
}

export function toolUse(
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  messageId: string = nextId('msg'),
): AssistantEvent {
  return {
    type: 'assistant',
    uuid: nextId('uuid'),
    session_id: 'cse_test',
    parent_tool_use_id: null,
    message: { id: messageId, role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name, input }] },
  };
}

export function toolResult(toolUseId: string, content: string | ContentBlock[], isError = false): UserEvent {
  return {
    type: 'user',
    uuid: nextId('uuid'),
    session_id: 'cse_test',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
  };
}

export function resultEvent(extra: Partial<ResultEvent> = {}): ResultEvent {
  return {
    type: 'result',
    subtype: 'success',
    uuid: nextId('uuid'),
    session_id: 'cse_test',
    is_error: false,
    num_turns: 1,
    duration_ms: 1200,
    total_cost_usd: 0.01,
    ...extra,
  };
}

export function permissionRequest(
  requestId: string,
  toolName: string,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): ControlRequestEvent {
  return {
    type: 'control_request',
    uuid: nextId('uuid'),
    session_id: 'cse_test',
    request_id: requestId,
    request: { subtype: 'can_use_tool', tool_name: toolName, input, permission_suggestions: [], ...extra },
  };
}

export function questionRequest(
  requestId: string,
  questions: { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect?: boolean }[],
): ControlRequestEvent {
  return permissionRequest(requestId, 'AskUserQuestion', { questions });
}

export function controlResponse(requestId: string, response: unknown = {}, subtype: 'success' | 'error' = 'success'): ControlResponseEvent {
  return {
    type: 'control_response',
    uuid: nextId('uuid'),
    session_id: 'cse_test',
    response: { subtype, request_id: requestId, response },
  };
}
