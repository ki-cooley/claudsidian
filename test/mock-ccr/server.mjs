// Mock Remote Control controller server: the /v1/code/sessions surface, the OAuth token endpoint,
// scripted worker scenarios, fault injection, and an optional static dir for the browser harness.
// Node http only, no dependencies. Works as a CLI and as an import (startMockCcr).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ENVIRONMENTS, initEvent, isoAt, seedState, sessionObject } from './seed.mjs';
import { askTail, controlAck, permissionTail, scenarioFor, STEP_MS } from './scenarios.mjs';

const PAGE_SIZE = 3;
const MAX_REQUEST_LOG = 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
  'access-control-max-age': '600',
};

function envelope(type, message) {
  return { type: 'error', error: { type, message }, request_id: `req_${randomUUID().slice(0, 12)}` };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startMockCcr({ port = 0, staticDir, latencyMs = 0 } = {}) {
  let state = seedState();
  const timers = new Set();
  const waiters = new Map(); // request_id -> (response) => void
  const runs = new Map(); // session id -> { cancelled, queue: [] }
  const absStatic = staticDir ? path.resolve(staticDir) : undefined;

  // ---------------------------------------------------------------- event store

  function rowsOf(id) {
    return state.events.get(id);
  }

  function appendEvent(sessionId, payload, source = 'worker') {
    const rows = rowsOf(sessionId);
    if (!rows) throw new Error(`unknown session ${sessionId}`);
    const session = state.sessions.get(sessionId);
    const full = { ...payload, uuid: payload.uuid ?? randomUUID(), session_id: payload.session_id ?? sessionId };
    const row = {
      sequence_num: rows.length ? rows[rows.length - 1].sequence_num + 1 : 1,
      payload: full,
      event_type: full.type,
      source,
      created_at: new Date().toISOString(),
    };
    rows.push(row);
    session.last_event_at = row.created_at;
    session.updated_at = row.created_at;
    if (source === 'worker' && (full.type === 'assistant' || full.type === 'result' || full.type === 'control_request')) {
      session.unread = true;
    }
    if (source === 'client' && full.type === 'user') {
      session.user_message_count = String(Number(session.user_message_count ?? 0) + 1);
    }
    return row;
  }

  function schedule(ms, fn) {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  }

  function setWorker(session, workerStatus, bucket, summary) {
    session.worker_status = workerStatus;
    session.status_bucket = bucket;
    if (summary) session.external_metadata.post_turn_summary = summary;
  }

  // ---------------------------------------------------------------- scenario runner

  function runScenario(sessionId, steps, ctx = { responses: {} }) {
    const session = state.sessions.get(sessionId);
    const existing = runs.get(sessionId);
    if (existing && !existing.cancelled) {
      existing.queue.push({ steps, ctx });
      return;
    }
    const run = { cancelled: false, queue: [] };
    runs.set(sessionId, run);
    setWorker(session, 'running', 'working', { status_category: 'working', status_detail: 'Working', needs_action: '' });
    delete session.external_metadata.pending_action;

    const finish = () => {
      runs.delete(sessionId);
      const rows = rowsOf(sessionId);
      const last = rows[rows.length - 1]?.payload;
      const failed = last?.type === 'result' && last.is_error;
      setWorker(session, 'idle', failed ? 'failed' : 'completed', {
        status_category: failed ? 'failed' : 'completed',
        status_detail: failed ? (last.errors ?? []).join('; ') : 'Done',
        needs_action: '',
      });
      const next = run.queue.shift();
      if (next) runScenario(sessionId, next.steps, next.ctx);
    };

    const step = (i) => {
      if (run.cancelled) return;
      if (i >= steps.length) {
        finish();
        return;
      }
      const s = steps[i];
      schedule(s.afterMs ?? STEP_MS, () => {
        if (run.cancelled) return;
        const payload = typeof s.payload === 'function' ? s.payload(ctx) : s.payload;
        appendEvent(sessionId, payload, 'worker');
        if (s.waitFor) {
          const req = payload.request ?? {};
          setWorker(session, 'requires_action', 'blocked', {
            status_category: 'needs_action',
            status_detail: `Waiting on ${req.tool_name ?? req.subtype}`,
            needs_action: req.tool_name === 'AskUserQuestion' ? 'Answer the question' : `Allow ${req.tool_name ?? 'the tool'}`,
          });
          session.external_metadata.pending_action = { type: req.subtype, tool_name: req.tool_name, request_id: s.waitFor };
          state.openRequests.set(s.waitFor, sessionId);
          waiters.set(s.waitFor, (response) => {
            ctx.responses[s.waitFor] = response;
            delete session.external_metadata.pending_action;
            setWorker(session, 'running', 'working');
            step(i + 1);
          });
          return;
        }
        step(i + 1);
      });
    };
    step(0);
    return run;
  }

  function cancelRun(sessionId) {
    const run = runs.get(sessionId);
    if (!run) return false;
    run.cancelled = true;
    run.queue.length = 0;
    runs.delete(sessionId);
    return true;
  }

  /** Apply a posted payload to a session: echo, scenario, control handling. */
  function acceptPayload(sessionId, payload) {
    const session = state.sessions.get(sessionId);
    const full = { ...payload, uuid: payload.uuid ?? randomUUID() };
    if (full.type === 'user') {
      appendEvent(sessionId, full, 'client');
      runScenario(sessionId, scenarioFor(sessionId, full));
      return;
    }
    if (full.type === 'control_response') {
      appendEvent(sessionId, full, 'client');
      const requestId = full.response?.request_id;
      if (!requestId) return;
      const waiter = waiters.get(requestId);
      if (waiter) {
        waiters.delete(requestId);
        state.openRequests.delete(requestId);
        waiter(full.response);
        return;
      }
      if (state.openRequests.get(requestId) === sessionId) {
        // A seeded, never-answered request (cse_blocked): run the tail that fits its tool.
        state.openRequests.delete(requestId);
        const original = rowsOf(sessionId).find((r) => r.payload.type === 'control_request' && r.payload.request_id === requestId);
        const toolName = original?.payload.request?.tool_name;
        const tail = toolName === 'AskUserQuestion' ? askTail(sessionId, requestId) : permissionTail(sessionId, requestId);
        runScenario(sessionId, tail, { responses: { [requestId]: full.response } });
      }
      return;
    }
    if (full.type === 'control_request') {
      appendEvent(sessionId, full, 'client');
      const subtype = full.request?.subtype;
      const requestId = full.request_id;
      if (subtype === 'interrupt') {
        const wasRunning = cancelRun(sessionId);
        for (const [reqId, sid] of [...state.openRequests]) {
          if (sid === sessionId) {
            state.openRequests.delete(reqId);
            waiters.delete(reqId);
          }
        }
        delete session.external_metadata.pending_action;
        schedule(STEP_MS, () => {
          appendEvent(sessionId, controlAck(sessionId, requestId, true));
          if (wasRunning || session.worker_status !== 'idle') {
            appendEvent(sessionId, {
              type: 'result',
              subtype: 'success',
              is_error: false,
              num_turns: 1,
              duration_ms: 10,
              total_cost_usd: 0,
              stop_reason: 'interrupt',
              result: 'Interrupted by user',
            });
          }
          setWorker(session, 'idle', 'completed', { status_category: 'completed', status_detail: 'Interrupted', needs_action: '' });
        });
        return;
      }
      if (subtype === 'set_model') {
        const model = typeof full.request.model === 'string' ? full.request.model : session.session_context.model;
        session.session_context.model = model;
        session.config.model = model;
        schedule(STEP_MS, () => appendEvent(sessionId, controlAck(sessionId, requestId, true)));
        return;
      }
      if (subtype === 'set_permission_mode') {
        if (typeof full.request.mode === 'string') session.session_context.permission_mode = full.request.mode;
        schedule(STEP_MS, () => appendEvent(sessionId, controlAck(sessionId, requestId, true)));
        return;
      }
      schedule(STEP_MS, () =>
        appendEvent(sessionId, controlAck(sessionId, requestId, false, `REPL bridge does not handle control_request subtype: ${subtype}`)),
      );
      return;
    }
    appendEvent(sessionId, full, 'client');
  }

  // ---------------------------------------------------------------- http helpers

  function send(res, status, body, headers = {}) {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const h = { ...CORS, 'request-id': `req_${randomUUID().slice(0, 12)}`, ...headers };
    if (body !== undefined && typeof body !== 'string') h['content-type'] = 'application/json; charset=utf-8';
    const write = () => {
      res.writeHead(status, h);
      res.end(text);
    };
    if (latencyMs > 0) schedule(latencyMs, write);
    else write();
  }

  const sendError = (res, status, type, message, headers) => send(res, status, envelope(type, message), headers);

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) return resolve({});
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new SyntaxError('invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }

  function bearerOf(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    return m ? m[1].trim() : undefined;
  }

  function issueTokens() {
    state.tokenCounter += 1;
    const n = state.tokenCounter;
    state.tokens.add(`mock-access-${n}`);
    state.refreshTokens.add(`mock-refresh-${n}`);
    return {
      token_type: 'Bearer',
      access_token: `mock-access-${n}`,
      refresh_token: `mock-refresh-${n}`,
      expires_in: 3600,
      scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code',
      organization: { uuid: 'org-mock', name: 'Mock org' },
      account: { uuid: 'acct-mock', email_address: 'mock@example.com' },
    };
  }

  function publicState() {
    return {
      sessions: [...state.sessions.values()],
      eventCounts: Object.fromEntries([...state.events].map(([id, rows]) => [id, rows.length])),
      openRequests: Object.fromEntries(state.openRequests),
      running: [...runs.keys()],
      fault: state.fault,
      presence: Object.fromEntries(state.presence),
      issuedTokens: state.tokens.size,
      requests: state.requests.slice(-200),
    };
  }

  function resetState() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    waiters.clear();
    runs.clear();
    state = seedState();
  }

  // ---------------------------------------------------------------- routes

  async function handleAdmin(req, res, pathname) {
    if (pathname === '/__mock/reset' && req.method === 'POST') {
      resetState();
      return send(res, 200, { ok: true });
    }
    if (pathname === '/__mock/state' && req.method === 'GET') return send(res, 200, publicState());
    if (pathname === '/__mock/fault' && req.method === 'POST') {
      const body = await readBody(req);
      state.fault = body.once === undefined ? null : { once: body.once };
      return send(res, 200, { ok: true, fault: state.fault });
    }
    if (pathname === '/__mock/inject' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.sessionId || !state.sessions.has(body.sessionId)) return sendError(res, 404, 'not_found_error', 'unknown session');
      if (!body.payload || typeof body.payload !== 'object') return sendError(res, 400, 'invalid_request_error', 'payload required');
      const row = appendEvent(body.sessionId, body.payload, body.source ?? 'worker');
      return send(res, 200, { ok: true, sequence_num: String(row.sequence_num) });
    }
    return sendError(res, 404, 'not_found_error', `no admin route ${pathname}`);
  }

  async function handleOauthToken(req, res) {
    const body = await readBody(req);
    if (body.grant_type === 'authorization_code') {
      if (body.code !== 'good') return sendError(res, 400, 'invalid_grant', 'Invalid authorization code');
      return send(res, 200, issueTokens());
    }
    if (body.grant_type === 'refresh_token') {
      if (typeof body.refresh_token !== 'string' || !state.refreshTokens.has(body.refresh_token)) {
        return sendError(res, 400, 'invalid_grant', 'Invalid refresh token');
      }
      return send(res, 200, issueTokens());
    }
    return sendError(res, 400, 'invalid_request_error', `unsupported grant_type ${body.grant_type}`);
  }

  function applyFault(req, res) {
    const fault = state.fault;
    if (!fault) return false;
    state.fault = null;
    const once = fault.once;
    if (once === 'network') {
      req.socket.destroy();
      return true;
    }
    if (once === 401) sendError(res, 401, 'authentication_error', 'Injected 401: token expired');
    else if (once === 429) sendError(res, 429, 'rate_limit_error', 'Injected 429: slow down', { 'retry-after': '1' });
    else if (once === 500) sendError(res, 500, 'api_error', 'Injected 500: internal error');
    else if (typeof once === 'number') sendError(res, once, 'api_error', `Injected ${once}`);
    else return false;
    return true;
  }

  function listSessions(res, query) {
    const all = [...state.sessions.values()];
    const offset = query.cursor ? Number(String(query.cursor).replace(/^page-/, '')) || 0 : 0;
    const data = all.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + PAGE_SIZE;
    return send(res, 200, {
      data,
      next_cursor: nextOffset < all.length ? `page-${nextOffset}` : null,
      resume_token: 'mock-resume-token',
    });
  }

  function createSession(res, body) {
    if (!body.environment_id || typeof body.environment_id !== 'string') {
      return sendError(res, 400, 'invalid_request_error', 'environment_id is required');
    }
    state.newSessionCounter += 1;
    const id = `cse_new${state.newSessionCounter}`;
    const env = ENVIRONMENTS[body.environment_id] ?? { kind: 'bridge', cwd: '/Users/kicooley-winters/workspace' };
    const model = body.config?.model || body.session_context?.model || 'claude-opus-5-5';
    const session = sessionObject(id, {
      title: typeof body.title === 'string' && body.title ? body.title : 'New session',
      environmentId: body.environment_id,
      model,
      permissionMode: body.session_context?.permission_mode ?? 'auto',
      createdAt: new Date().toISOString(),
      userMessages: 0,
      statusBucket: 'working',
      workerStatus: 'running',
    });
    session.environment_kind = env.kind;
    if (Array.isArray(body.tags)) session.tags = [...session.tags, ...body.tags.filter((t) => typeof t === 'string')];
    state.sessions.set(id, session);
    state.events.set(id, []);
    appendEvent(id, initEvent(id, env.cwd, model, session.session_context.permission_mode), 'worker');
    setWorker(session, 'idle', 'completed');
    const events = Array.isArray(body.events) ? body.events : [];
    for (const e of events) if (e && e.payload && typeof e.payload === 'object') acceptPayload(id, e.payload);
    // The real API wraps the created session (verified 2026-10-10).
    return send(res, 200, { deduplicated: false, session });
  }

  /** GET /v1/environments: the bridge and cloud environments of the seed, shaped like the real endpoint. */
  function listEnvironments(res) {
    const environments = Object.entries(ENVIRONMENTS).map(([id, e]) => ({
      environment_id: id,
      name: e.kind === 'cloud' ? 'claude-code-default' : `MockMac:${path.basename(e.cwd)}:${id.slice(-4)}`,
      description: e.kind === 'cloud' ? '' : 'Bridge environment (MockMac)',
      state: 'active',
      kind: e.kind === 'cloud' ? 'anthropic_cloud' : 'bridge',
      created_at: isoAt(-86400),
      bridge_info:
        e.kind === 'cloud'
          ? null
          : { machine_name: 'MockMac', machine_id: 'mock-machine', directory: e.cwd, branch: 'HEAD', git_repo_url: null, online: id !== 'env_ws', max_sessions: 32, cli_version: '2.1.296' },
      is_ccr_default: false,
    }));
    return send(res, 200, { environments, has_more: false });
  }

  /** GET /v1/sessions/{id}/events?after_id=<uuid>: the web client's incremental poll. */
  function listEventsAfter(res, sessionId, query) {
    const rows = rowsOf(sessionId);
    if (!rows) return sendError(res, 404, 'not_found_error', `no session ${sessionId}`);
    const limit = Math.min(Math.max(Number(query.limit) || 500, 1), 1000);
    let start = 0;
    if (query.after_id) {
      const idx = rows.findIndex((r) => r.payload.uuid === query.after_id);
      start = idx >= 0 ? idx + 1 : rows.length;
    }
    const page = rows.slice(start, start + limit);
    return send(res, 200, { data: page.map((r) => ({ ...r, sequence_num: String(r.sequence_num) })), has_more: start + limit < rows.length });
  }

  function listEvents(res, sessionId, query) {
    const rows = rowsOf(sessionId);
    const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 1000);
    const sortOrder = query.sort_order === 'asc' ? 'asc' : 'desc';
    const from = query.from_sequence_num !== undefined ? Number(query.from_sequence_num) : undefined;
    let selected = Number.isFinite(from) ? rows.filter((r) => r.sequence_num >= from) : rows.slice();
    if (sortOrder === 'desc') selected = selected.reverse();
    const offset = query.page ? Number(query.page) || 0 : 0;
    const page = selected.slice(offset, offset + limit);
    const hasMore = offset + limit < selected.length;
    return send(res, 200, {
      data: page.map((r) => ({ ...r, sequence_num: String(r.sequence_num) })),
      next_page: hasMore ? String(offset + limit) : null,
      has_more: hasMore,
    });
  }

  async function handleSessions(req, res, pathname, query) {
    if (pathname === '/v1/code/sessions') {
      if (req.method === 'GET') return listSessions(res, query);
      if (req.method === 'POST') return createSession(res, await readBody(req));
      return sendError(res, 405, 'invalid_request_error', 'method not allowed');
    }
    const m = /^\/v1\/code\/sessions\/([^/]+)(\/.*)?$/.exec(pathname);
    if (!m) return sendError(res, 404, 'not_found_error', `no route ${pathname}`);
    const id = decodeURIComponent(m[1]);
    const sub = m[2] ?? '';
    const session = state.sessions.get(id);
    if (!session) return sendError(res, 404, 'not_found_error', `session ${id} not found`);

    if (sub === '') {
      if (req.method === 'GET') return send(res, 200, session);
      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (typeof body.title === 'string') session.title = body.title;
        session.updated_at = new Date().toISOString();
        return send(res, 200, { session });
      }
      return sendError(res, 405, 'invalid_request_error', 'method not allowed');
    }
    if (req.method === 'POST' && sub === '/archive') {
      await readBody(req);
      if (session.status === 'archived') return sendError(res, 409, 'invalid_request_error', 'session is already archived');
      cancelRun(id);
      session.status = 'archived';
      setWorker(session, 'idle', 'completed');
      session.updated_at = new Date().toISOString();
      return send(res, 200, session);
    }
    if (req.method === 'POST' && sub === '/mark_read') {
      const body = await readBody(req);
      session.unread = false;
      session.last_read_sequence_num = body.sequence_num !== undefined ? String(body.sequence_num) : undefined;
      return send(res, 200, {});
    }
    if (req.method === 'POST' && sub === '/client/presence') {
      const body = await readBody(req);
      if (typeof body.client_id !== 'string') return sendError(res, 400, 'invalid_request_error', 'client_id is required');
      if (body.clear) state.presence.delete(`${id}:${body.client_id}`);
      else state.presence.set(`${id}:${body.client_id}`, { connected_at: body.connected_at ?? new Date().toISOString() });
      return send(res, 200, {});
    }
    if (sub === '/events') {
      if (req.method === 'GET') return listEvents(res, id, query);
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (session.status === 'archived') return sendError(res, 409, 'invalid_request_error', 'session is archived');
        const events = Array.isArray(body.events) ? body.events : [];
        if (!events.length) return sendError(res, 400, 'invalid_request_error', 'events must be a non-empty array');
        for (const e of events) {
          if (!e || typeof e.payload !== 'object' || !e.payload) return sendError(res, 400, 'invalid_request_error', 'each event needs a payload');
        }
        const before = rowsOf(id).length;
        for (const e of events) acceptPayload(id, e.payload);
        const results = rowsOf(id)
          .slice(before)
          .filter((r) => r.source === 'client')
          .map((r) => ({ duplicate: false, event_id: r.payload.uuid, sequence_num: String(r.sequence_num) }));
        return send(res, 200, { attestation_feedback: null, results });
      }
    }
    return sendError(res, 404, 'not_found_error', `no route ${pathname}`);
  }

  async function serveStatic(res, pathname) {
    if (!absStatic) return sendError(res, 404, 'not_found_error', `no route ${pathname}`);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    let file = path.resolve(absStatic, rel || '.');
    if (file !== absStatic && !file.startsWith(absStatic + path.sep)) return sendError(res, 403, 'permission_error', 'outside static dir');
    try {
      let s = await stat(file);
      if (s.isDirectory()) {
        file = path.join(file, 'index.html');
        s = await stat(file);
      }
      const body = await readFile(file);
      res.writeHead(200, { ...CORS, 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': s.size });
      res.end(body);
    } catch {
      sendError(res, 404, 'not_found_error', `no file ${pathname}`);
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams);
    state.requests.push({ method: req.method, path: pathname, query, at: new Date().toISOString() });
    if (state.requests.length > MAX_REQUEST_LOG) state.requests.splice(0, state.requests.length - MAX_REQUEST_LOG);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (pathname.startsWith('/__mock/')) return handleAdmin(req, res, pathname);
    if (pathname === '/v1/oauth/token' && req.method === 'POST') return handleOauthToken(req, res);

    if (pathname.startsWith('/v1/') || pathname.startsWith('/api/')) {
      if (pathname.startsWith('/v1/code') && applyFault(req, res)) return;
      const token = bearerOf(req);
      if (!token) return sendError(res, 401, 'authentication_error', 'Missing bearer token');
      if (token === 'expired' || !state.tokens.has(token)) return sendError(res, 401, 'authentication_error', 'Invalid or expired token');
      if (pathname === '/api/oauth/profile') {
        return send(res, 200, { organization: { uuid: 'org-mock', name: 'Mock org' }, account: { uuid: 'acct-mock', email_address: 'mock@example.com' } });
      }
      if (pathname === '/v1/environments' && req.method === 'GET') return listEnvironments(res);
      if (pathname.startsWith('/v1/sessions/') && pathname.endsWith('/events') && req.method === 'GET') {
        return listEventsAfter(res, decodeURIComponent(pathname.slice('/v1/sessions/'.length, -'/events'.length)), query);
      }
      if (pathname.startsWith('/v1/code/sessions')) return handleSessions(req, res, pathname, query);
      return sendError(res, 404, 'not_found_error', `no route ${pathname}`);
    }
    return serveStatic(res, pathname);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.end();
      const status = err instanceof SyntaxError ? 400 : 500;
      sendError(res, status, status === 400 ? 'invalid_request_error' : 'api_error', err?.message ?? String(err));
    });
  });
  server.keepAliveTimeout = 1000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const actualPort = server.address().port;
  const url = `http://127.0.0.1:${actualPort}`;

  return {
    url,
    port: actualPort,
    get state() {
      return state;
    },
    inject(sessionId, payload, source = 'worker') {
      return appendEvent(sessionId, payload, source);
    },
    fault(spec) {
      state.fault = spec && spec.once !== undefined ? { once: spec.once } : null;
    },
    reset() {
      resetState();
    },
    close() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      });
    },
  };
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const out = { port: 0, staticDir: undefined, latencyMs: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]) || 0;
    else if (a === '--static') out.staticDir = argv[++i];
    else if (a === '--latency') out.latencyMs = Number(argv[++i]) || 0;
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7)) || 0;
    else if (a.startsWith('--static=')) out.staticDir = a.slice(9);
    else if (a.startsWith('--latency=')) out.latencyMs = Number(a.slice(10)) || 0;
  }
  return out;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  const mock = await startMockCcr(opts);
  process.stdout.write(`MOCK_CCR ${mock.url}\n`);
  const stop = () => mock.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
