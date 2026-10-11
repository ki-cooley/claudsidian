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
  StreamJsonEvent,
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
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 5000;

export interface CcrClientOptions {
  baseUrl: string; // no trailing slash
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
  opts: { orgUuid?: string; clientPlatform: string; userAgent: string; beta: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-client-platform': opts.clientPlatform,
    'User-Agent': opts.userAgent,
  };
  if (opts.beta) headers['anthropic-beta'] = CCR_BETA;
  if (opts.orgUuid) headers['x-organization-uuid'] = opts.orgUuid;
  return headers;
}

type QueryValue = string | number | undefined;

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown; // JSON-serialised here, so transports always see a string
  beta?: boolean; // default true
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
  private readonly baseUrl: string;
  /** Feature detection: the bare list call may reject the beta header; remembered for the client's lifetime. */
  private betaOnList = true;

  constructor(opts: CcrClientOptions) {
    this.opts = opts;
    this.timers = opts.timers ?? realTimers;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
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
    return this.requireJson<WireSession>(res);
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

  async sendEvents(id: string, payloads: StreamJsonEvent[]): Promise<void> {
    // uuids are assigned once, before any retry, so a retried POST carries the same ids.
    const events = payloads.map((p) => ({ payload: p.uuid ? p : { ...p, uuid: uuidv4() } }));
    await this.request('POST', sessionPath(id, '/events'), { body: { session_id: id, events } });
  }

  async listEvents(id: string, opts: ListEventsOptions = {}): Promise<WireEventRow[]> {
    const { limit = 200, sortOrder = 'asc', fromSequenceNum, page } = opts;
    const res = await this.request('GET', sessionPath(id, '/events'), {
      query: { limit, sort_order: sortOrder, from_sequence_num: fromSequenceNum, page },
    });
    const body = res.json<Partial<WireEventList> & { events?: WireEventRow[] }>();
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.events)) return body.events;
    return [];
  }

  async createSession(req: CreateSessionRequest): Promise<WireSession> {
    const res = await this.request('POST', '/v1/code/sessions', { body: req });
    return this.requireJson<WireSession>(res);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async listSessionsPage(cursor?: string): Promise<WireSessionList> {
    const query = cursor ? { cursor } : undefined;
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
  private async request(method: HttpRequest['method'], path: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const url = `${this.baseUrl}${path}${buildQuery(opts.query)}`;
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

function backoffMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isBetaRejection(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /anthropic-beta/i.test(err.message);
}
