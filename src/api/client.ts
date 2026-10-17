/**
 * CcrClient: the Remote Control controller API client (api.anthropic.com/v1/code/sessions).
 * One private request() applies headers, the retry policy, and error parsing; every public
 * method is a thin call to it. All HTTP goes through the injected HttpTransport.
 */
import type { CcrApi, ListEventsOptions } from './client-api';
import { ApiError, apiErrorFromResponse } from './errors';
import type { HttpRequest, HttpResponse, HttpTransport } from './http';
import type {
  CreateSessionRequest,
  SendEventsResult,
  StreamJsonEvent,
  WireEnvironment,
  WireEnvironmentList,
  WireEventList,
  WireEventRow,
  WireSession,
  WireSessionList,
} from './types';
import { log } from '../util/log';
import { realTimers, sleep, type TimerApi } from '../util/timers';
import { uuidv4 } from '../util/uuid';

export const ANTHROPIC_VERSION = '2023-06-01';
export const CCR_BETA = 'ccr-byoc-2025-07-29';
/** The environments endpoint rejects CCR_BETA; it wants its own beta value (docs/protocol.md). */
export const ENVIRONMENTS_BETA = 'environments-2025-11-01';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 5000;

export interface CcrClientOptions {
  /** API origin, read on every request so a settings change applies without a reload; a trailing slash is dropped. */
  baseUrl: string | (() => string);
  transport: HttpTransport;
  getAccessToken: () => Promise<string>; // throws ApiError(401) when signed out
  onUnauthorized?: () => Promise<boolean>; // refresh hook; true = retry once
  orgUuid: () => string | undefined;
  clientPlatform: () => string;
  userAgent: string; // "claudsidian/2.0.0"
  timers?: TimerApi; // default realTimers
  maxRetries?: number; // default 3 (5xx and network)
}

export function buildHeaders(
  token: string,
  opts: { orgUuid?: string; clientPlatform: string; userAgent: string; beta: boolean; betaValue?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-client-platform': opts.clientPlatform,
    'User-Agent': opts.userAgent,
  };
  if (opts.beta) headers['anthropic-beta'] = opts.betaValue ?? CCR_BETA;
  if (opts.orgUuid) headers['x-organization-uuid'] = opts.orgUuid;
  return headers;
}

type QueryValue = string | number | undefined;

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown; // JSON-serialised here, so transports always see a string
  beta?: boolean; // default true
  betaValue?: string; // overrides CCR_BETA when beta is on
  /** Non-2xx statuses that still count as success (409 on archive). */
  okStatuses?: number[];
}

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function sessionPath(id: string, suffix = ''): string {
  return `/v1/code/sessions/${encodeURIComponent(id)}${suffix}`;
}

export class CcrClient implements CcrApi {
  private readonly opts: CcrClientOptions;
  private readonly timers: TimerApi;
  private readonly maxRetries: number;
  /** Feature detection: the bare list call may reject the beta header; remembered for the client's lifetime. */
  private betaOnList = true;

  constructor(opts: CcrClientOptions) {
    this.opts = opts;
    this.timers = opts.timers ?? realTimers;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  // -------------------------------------------------------------------------
  // CcrApi
  // -------------------------------------------------------------------------

  async listSessions(): Promise<WireSession[]> {
    const out: WireSession[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await this.listSessionsPage(cursor);
      if (Array.isArray(page.data)) out.push(...page.data);
      const next = page.next_cursor ?? undefined;
      if (!next || seen.has(next)) break;
      seen.add(next);
      cursor = next;
    }
    return out;
  }

  async getSession(id: string): Promise<WireSession> {
    const res = await this.request('GET', sessionPath(id));
    return unwrapSession(this.requireJson<Record<string, unknown>>(res));
  }

  async renameSession(id: string, title: string): Promise<void> {
    await this.request('PUT', sessionPath(id), { body: { title } });
  }

  async archiveSession(id: string): Promise<void> {
    await this.request('POST', sessionPath(id, '/archive'), { body: {}, okStatuses: [409] });
  }

  async markRead(id: string, sequenceNum?: number): Promise<void> {
    const body = sequenceNum === undefined ? {} : { sequence_num: sequenceNum };
    await this.request('POST', sessionPath(id, '/mark_read'), { body });
  }

  async presence(id: string, clientId: string, connected: boolean): Promise<void> {
    const body = connected
      ? { client_id: clientId, connected_at: new Date(this.timers.now()).toISOString() }
      : { client_id: clientId, clear: true };
    await this.request('POST', sessionPath(id, '/client/presence'), { body });
  }

  async sendEvents(id: string, payloads: StreamJsonEvent[]): Promise<SendEventsResult> {
    // uuids are assigned once, before any retry, so a retried POST carries the same ids. User payloads carry the
    // session id like the web client's do; the body shape {events:[{payload}]} is the one claude.ai/code sends.
    const events = payloads.map((p) => {
      const payload: StreamJsonEvent = p.uuid ? { ...p } : { ...p, uuid: uuidv4() };
      if (payload.type === 'user' && !payload.session_id) payload.session_id = id;
      return { payload };
    });
    const res = await this.request('POST', sessionPath(id, '/events'), { body: { events } });
    const body = res.json<Partial<SendEventsResult>>();
    return { ...(body ?? {}), results: Array.isArray(body?.results) ? body.results : [] };
  }

  async listEvents(id: string, opts: ListEventsOptions = {}): Promise<WireEventRow[]> {
    const { limit = 200, sortOrder = 'asc', fromSequenceNum, page, afterId } = opts;
    const res = afterId
      ? await this.request('GET', `/v1/sessions/${encodeURIComponent(id)}/events`, { query: { limit, after_id: afterId } })
      : await this.request('GET', sessionPath(id, '/events'), {
          query: { limit, sort_order: sortOrder, from_sequence_num: fromSequenceNum, page },
        });
    const body = res.json<Partial<WireEventList> & { events?: WireEventRow[] }>();
    const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.events) ? body.events : [];
    return afterId ? rows.map(wrapBareEvent) : rows;
  }

  /**
   * Create a session the way claude.ai/code does (verified 2026-10-10): config carries model and effort,
   * events is usually empty (the first message follows as a separate send), tags mark the client.
   * The response wraps the session in {session}; older shapes without the wrapper are accepted too.
   */
  async createSession(req: CreateSessionRequest): Promise<WireSession> {
    const config: Record<string, unknown> = { sources: [], outcomes: [], ...(req.config ?? {}) };
    const model = req.config?.model ?? req.session_context?.model;
    if (model) config.model = model;
    const effort = req.config?.effort_level ?? req.session_context?.effort_level;
    if (effort) config.effort_level = effort;
    const body: Record<string, unknown> = {
      environment_id: req.environment_id,
      config,
      events: req.events ?? [],
      tags: req.tags ?? ['remote-control-app'],
    };
    if (req.title) body.title = req.title;
    const res = await this.request('POST', '/v1/code/sessions', { body });
    return unwrapSession(this.requireJson<Record<string, unknown>>(res));
  }

  async listEnvironments(): Promise<WireEnvironment[]> {
    try {
      // The environments endpoint needs its own beta value, not CCR_BETA (docs/protocol.md).
      const res = await this.request('GET', '/v1/environments', { query: { limit: 100 }, betaValue: ENVIRONMENTS_BETA });
      const body = res.json<Partial<WireEnvironmentList>>();
      const list: unknown[] = Array.isArray(body?.environments) ? body.environments : Array.isArray(body?.data) ? body.data : [];
      return list.flatMap((e) => normalizeEnvironment(e) ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) throw err;
      log.warn('environments endpoint failed; using session-derived environments', {
        status: err instanceof ApiError ? err.status : undefined,
        message: messageOf(err),
      });
      return [];
    }
  }

  /** One environment by id (same beta and shapes as the list); null when it is gone or unreadable. */
  async getEnvironment(id: string): Promise<WireEnvironment | null> {
    try {
      const res = await this.request('GET', `/v1/environments/${encodeURIComponent(id)}`, { betaValue: ENVIRONMENTS_BETA });
      return normalizeEnvironment(res.json<unknown>());
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) throw err;
      log.debug('environment lookup failed', { status: err instanceof ApiError ? err.status : undefined });
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async listSessionsPage(cursor?: string): Promise<WireSessionList> {
    const query: Record<string, QueryValue> = { limit: 100 };
    if (cursor) query.cursor = cursor;
    try {
      const res = await this.request('GET', '/v1/code/sessions', { query, beta: this.betaOnList });
      return res.json<WireSessionList>() ?? { data: [] };
    } catch (err) {
      if (!this.betaOnList || !isBetaRejection(err)) throw err;
      log.info('list sessions rejected the beta header; retrying without it for this client');
      this.betaOnList = false;
      const res = await this.request('GET', '/v1/code/sessions', { query, beta: false });
      return res.json<WireSessionList>() ?? { data: [] };
    }
  }

  private requireJson<T extends object>(res: HttpResponse): T {
    const body = res.json<T>();
    if (!body || typeof body !== 'object') {
      throw new ApiError({ status: res.status, message: `Empty or invalid JSON body (HTTP ${res.status})`, body: res.text });
    }
    return body;
  }

  /**
   * Retry policy: 401 -> onUnauthorized() once, retry with a fresh token; 429 -> wait retry-after
   * (default 5 s), retry once; 5xx or network (status 0) -> up to maxRetries with 1, 2, 4 s sleeps;
   * anything else throws ApiError.
   */
  private baseUrlOf(): string {
    const v = this.opts.baseUrl;
    return (typeof v === 'function' ? v() : v).replace(/\/+$/, '');
  }

  private async request(method: HttpRequest['method'], path: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const url = `${this.baseUrlOf()}${path}${buildQuery(opts.query)}`;
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const okStatuses = opts.okStatuses ?? [];
    let authRetried = false;
    let rateRetried = false;
    let failures = 0;

    for (;;) {
      const token = await this.opts.getAccessToken();
      const headers = buildHeaders(token, {
        orgUuid: this.opts.orgUuid(),
        clientPlatform: this.opts.clientPlatform(),
        userAgent: this.opts.userAgent,
        beta: opts.beta ?? true,
        betaValue: opts.betaValue,
      });
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      let res: HttpResponse;
      try {
        res = await this.opts.transport({ method, url, headers, body });
      } catch (err) {
        const apiErr =
          err instanceof ApiError ? err : new ApiError({ status: 0, message: `Network error: ${messageOf(err)}` });
        if (!apiErr.isNetwork || failures >= this.maxRetries) throw apiErr;
        log.debug(`network failure on ${method} ${path}, retry ${failures + 1}/${this.maxRetries}`);
        await sleep(backoffMs(failures++), this.timers);
        continue;
      }

      if ((res.status >= 200 && res.status < 300) || okStatuses.includes(res.status)) return res;

      const err = apiErrorFromResponse(res.status, res.text, res.headers);

      if (res.status === 401 && !authRetried && this.opts.onUnauthorized) {
        authRetried = true;
        log.debug(`401 on ${method} ${path}; asking for a token refresh`);
        if (await this.opts.onUnauthorized()) continue;
        throw err;
      }

      if (res.status === 429 && !rateRetried) {
        rateRetried = true;
        const waitMs = err.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
        log.debug(`429 on ${method} ${path}; waiting ${waitMs} ms`);
        await sleep(waitMs, this.timers);
        continue;
      }

      if (res.status >= 500 && failures < this.maxRetries) {
        log.debug(`${res.status} on ${method} ${path}, retry ${failures + 1}/${this.maxRetries}`);
        await sleep(backoffMs(failures++), this.timers);
        continue;
      }

      throw err;
    }
  }
}

/** Create and rename responses wrap the session in {session}; list and get return it bare. */
/** Create/rename answer `{session}`; GET answers `{response_shape}` (seen live 2026-10-11); some answer bare. */
function unwrapSession(body: Record<string, unknown>): WireSession {
  for (const key of ['session', 'response_shape']) {
    const inner = body[key];
    if (inner && typeof inner === 'object' && typeof (inner as WireSession).id === 'string') return inner as WireSession;
  }
  return body as unknown as WireSession;
}

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isBetaRejection(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /anthropic-beta/i.test(err.message);
}

/**
 * The after_id endpoint answers with bare stream-json payloads, not `{sequence_num, payload}` rows (verified
 * 2026-10-16), so its rows carry no sequence number; the store numbers them. Wrapped rows pass through.
 */
function wrapBareEvent(row: unknown): WireEventRow {
  const r = row as Record<string, unknown> | null;
  if (r && typeof r === 'object' && r.payload && typeof r.payload === 'object') return r as WireEventRow;
  const created = r && typeof r.created_at === 'string' ? r.created_at : undefined;
  return { sequence_num: '', payload: r as unknown as StreamJsonEvent, ...(created ? { created_at: created } : {}) };
}

/**
 * An environment in either shape the API uses. The web endpoint returns `{environment_id, kind, bridge_info}`;
 * the bearer-token `/v1/environments` returns `{id, type: "environment", config: {type: "bridge", machine_name,
 * directory, branch, git_repo_url}, metadata: {machine_id}, archived_at}` (verified 2026-10-16). Archived and
 * unrecognised entries are dropped.
 */
export function normalizeEnvironment(raw: unknown): WireEnvironment | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.environment_id === 'string') return e as WireEnvironment;
  if (typeof e.id !== 'string' || e.archived_at) return null;
  const config = (e.config && typeof e.config === 'object' ? e.config : {}) as Record<string, unknown>;
  const metadata = (e.metadata && typeof e.metadata === 'object' ? e.metadata : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const kind = str(e.kind) ?? str(config.type);
  const out: WireEnvironment = { environment_id: e.id };
  if (kind) out.kind = kind;
  if (str(e.name)) out.name = str(e.name);
  if (str(e.description)) out.description = str(e.description);
  if (str(e.state)) out.state = str(e.state);
  if (str(e.created_at)) out.created_at = str(e.created_at);
  if (kind === 'bridge') {
    out.bridge_info = {
      machine_name: str(config.machine_name),
      machine_id: str(metadata.machine_id),
      directory: str(config.directory),
      branch: str(config.branch),
      git_repo_url: str(config.git_repo_url) ?? null,
    };
  }
  return out;
}
