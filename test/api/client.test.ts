import { describe, expect, it, vi } from 'vitest';
import { CcrClient, buildHeaders, type CcrClientOptions } from '../../src/api/client';
import { ApiError } from '../../src/api/errors';
import { createMemoryTransport, jsonResponse } from '../helpers/memory-transport';

const timers = {
  setTimeout: (fn: () => void) => {
    fn();
    return 0;
  },
  clearTimeout: () => {},
  now: () => 1_700_000_000_000,
};

function client(transport: ReturnType<typeof createMemoryTransport>, extra: Partial<CcrClientOptions> = {}) {
  return new CcrClient({
    baseUrl: () => 'https://api.test',
    transport: transport.transport,
    getAccessToken: async () => 'tok',
    orgUuid: () => 'org-1',
    clientPlatform: () => 'web_claude_ai',
    userAgent: 'claudsidian/test',
    timers,
    ...extra,
  });
}

const errorBody = (type: string, message: string) => ({ type: 'error', error: { type, message } });

describe('CcrClient', () => {
  it('sends the required headers on every call', async () => {
    const t = createMemoryTransport([
      { method: 'GET', path: /\/v1\/code\/sessions$/, reply: () => jsonResponse(200, { data: [] }) },
    ]);
    await client(t).listSessions();
    const h = t.calls[0]!.headers!;
    expect(h['Authorization']).toBe('Bearer tok');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-beta']).toBe('ccr-byoc-2025-07-29');
    expect(h['anthropic-client-platform']).toBe('web_claude_ai');
    expect(h['x-organization-uuid']).toBe('org-1');
    expect(h['User-Agent']).toBe('claudsidian/test');
    expect(t.calls[0]!.url).toBe('https://api.test/v1/code/sessions?limit=100');
  });

  it('omits the org header when no org is known', () => {
    const h = buildHeaders('tok', { clientPlatform: 'ios', userAgent: 'ua', beta: false });
    expect(h['x-organization-uuid']).toBeUndefined();
    expect(h['anthropic-beta']).toBeUndefined();
    expect(h['anthropic-client-platform']).toBe('ios');
  });

  it('follows next_cursor when listing sessions', async () => {
    const t = createMemoryTransport([
      {
        method: 'GET',
        path: /\/v1\/code\/sessions/,
        reply: (req) =>
          req.url.includes('cursor=c2')
            ? jsonResponse(200, { data: [{ id: 'b' }], next_cursor: null })
            : jsonResponse(200, { data: [{ id: 'a' }], next_cursor: 'c2' }),
      },
    ]);
    const sessions = await client(t).listSessions();
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(t.calls.length).toBe(2);
  });

  it('wraps outgoing events in payload and adds a uuid', async () => {
    const t = createMemoryTransport([{ method: 'POST', path: /\/events$/, reply: () => jsonResponse(200, {}) }]);
    await client(t).sendEvents('cse_1', [
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'user', uuid: 'keep-me', message: { role: 'user', content: 'again' } },
    ]);
    expect(t.calls[0]!.url).toBe('https://api.test/v1/code/sessions/cse_1/events');
    const body = JSON.parse(t.calls[0]!.body as string);
    expect(body.session_id).toBeUndefined();
    expect(body.events[0].payload.session_id).toBe('cse_1');
    expect(body.events).toHaveLength(2);
    expect(body.events[0].payload.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.events[0].payload.type).toBe('user');
    expect(body.events[1].payload.uuid).toBe('keep-me');
    expect(t.calls[0]!.headers!['Content-Type']).toBe('application/json');
  });

  it('refreshes once on 401 and retries', async () => {
    let tokens = ['expired', 'fresh'];
    const t = createMemoryTransport([
      {
        method: 'GET',
        path: /sessions\/cse_1$/,
        reply: (req) =>
          req.headers!['Authorization'] === 'Bearer fresh'
            ? jsonResponse(200, { id: 'cse_1' })
            : jsonResponse(401, errorBody('authentication_error', 'expired')),
      },
    ]);
    const onUnauthorized = vi.fn(async () => {
      tokens = ['fresh'];
      return true;
    });
    const c = client(t, { getAccessToken: async () => tokens[0]!, onUnauthorized });
    expect((await c.getSession('cse_1')).id).toBe('cse_1');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(t.calls.length).toBe(2);
  });

  it('throws the 401 when the refresh hook declines or is absent', async () => {
    const t = createMemoryTransport([
      { method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(401, errorBody('authentication_error', 'nope')) },
    ]);
    const onUnauthorized = vi.fn(async () => false);
    await expect(client(t, { onUnauthorized }).getSession('cse_1')).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(t.calls.length).toBe(1);

    await expect(client(t).getSession('cse_1')).rejects.toMatchObject({ status: 401, isAuth: true });
    expect(t.calls.length).toBe(2);
  });

  it('does not refresh twice when the retried call is also a 401', async () => {
    const t = createMemoryTransport([
      { method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(401, errorBody('authentication_error', 'still bad')) },
    ]);
    const onUnauthorized = vi.fn(async () => true);
    await expect(client(t, { onUnauthorized }).getSession('cse_1')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(t.calls.length).toBe(2);
  });

  it('honours retry-after on 429 then succeeds', async () => {
    let n = 0;
    const waits: number[] = [];
    const t = createMemoryTransport([
      {
        method: 'GET',
        path: /sessions\/cse_1$/,
        reply: () => (n++ === 0 ? jsonResponse(429, {}, { 'retry-after': '1' }) : jsonResponse(200, { id: 'cse_1' })),
      },
    ]);
    const c = client(t, {
      timers: {
        ...timers,
        setTimeout: (fn: () => void, ms: number) => {
          waits.push(ms);
          fn();
          return 0;
        },
      },
    });
    expect((await c.getSession('cse_1')).id).toBe('cse_1');
    expect(waits).toEqual([1000]);
    expect(t.calls.length).toBe(2);
  });

  it('waits 5 s on 429 without retry-after and gives up after one retry', async () => {
    const waits: number[] = [];
    const t = createMemoryTransport([
      { method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(429, errorBody('rate_limit_error', 'slow down')) },
    ]);
    const c = client(t, {
      timers: {
        ...timers,
        setTimeout: (fn: () => void, ms: number) => {
          waits.push(ms);
          fn();
          return 0;
        },
      },
    });
    await expect(c.getSession('cse_1')).rejects.toMatchObject({ status: 429, isRateLimited: true });
    expect(waits).toEqual([5000]);
    expect(t.calls.length).toBe(2);
  });

  it('retries 5xx up to three times then throws ApiError', async () => {
    const waits: number[] = [];
    const t = createMemoryTransport([
      { method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(503, errorBody('overloaded_error', 'busy')) },
    ]);
    const c = client(t, {
      timers: {
        ...timers,
        setTimeout: (fn: () => void, ms: number) => {
          waits.push(ms);
          fn();
          return 0;
        },
      },
    });
    await expect(c.getSession('cse_1')).rejects.toBeInstanceOf(ApiError);
    expect(t.calls.length).toBe(4);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it('respects a custom maxRetries', async () => {
    const t = createMemoryTransport([
      { method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(500, errorBody('api_error', 'boom')) },
    ]);
    await expect(client(t, { maxRetries: 1 }).getSession('cse_1')).rejects.toMatchObject({ status: 500 });
    expect(t.calls.length).toBe(2);
  });

  it('retries network failures (status 0) and succeeds when the network returns', async () => {
    let n = 0;
    const t = createMemoryTransport([
      {
        method: 'GET',
        path: /sessions\/cse_1$/,
        reply: () => {
          if (n++ < 2) throw new ApiError({ status: 0, message: 'Network error: offline' });
          return jsonResponse(200, { id: 'cse_1' });
        },
      },
    ]);
    expect((await client(t).getSession('cse_1')).id).toBe('cse_1');
    expect(t.calls.length).toBe(3);
  });

  it('throws ApiError on anything else without retrying', async () => {
    const t = createMemoryTransport([
      { method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(403, errorBody('permission_error', 'trusted devices')) },
    ]);
    const err = await client(t).getSession('cse_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toContain('trusted devices');
    expect(t.calls.length).toBe(1);
  });

  it('propagates a signed-out getAccessToken without touching the network', async () => {
    const t = createMemoryTransport([]);
    const c = client(t, {
      getAccessToken: async () => {
        throw new ApiError({ status: 401, message: 'Signed out' });
      },
    });
    await expect(c.listSessions()).rejects.toMatchObject({ status: 401 });
    expect(t.calls.length).toBe(0);
  });

  it('treats 409 on archive as success', async () => {
    const t = createMemoryTransport([{ method: 'POST', path: /archive$/, reply: () => jsonResponse(409, {}) }]);
    await expect(client(t).archiveSession('cse_1')).resolves.toBeUndefined();
    expect(t.calls[0]!.url).toBe('https://api.test/v1/code/sessions/cse_1/archive');
    expect(JSON.parse(t.calls[0]!.body as string)).toEqual({});
  });

  it('renames with PUT and a title body', async () => {
    const t = createMemoryTransport([{ method: 'PUT', path: /sessions\/cse_1$/, reply: () => jsonResponse(200, { id: 'cse_1' }) }]);
    await client(t).renameSession('cse_1', 'Dinner prep');
    expect(JSON.parse(t.calls[0]!.body as string)).toEqual({ title: 'Dinner prep' });
  });

  it('marks read with and without a sequence number, accepting 200 and 204', async () => {
    let n = 0;
    const t = createMemoryTransport([
      { method: 'POST', path: /mark_read$/, reply: () => (n++ === 0 ? jsonResponse(204) : jsonResponse(200, {})) },
    ]);
    const c = client(t);
    await expect(c.markRead('cse_1')).resolves.toBeUndefined();
    await expect(c.markRead('cse_1', 42)).resolves.toBeUndefined();
    expect(JSON.parse(t.calls[0]!.body as string)).toEqual({});
    expect(JSON.parse(t.calls[1]!.body as string)).toEqual({ sequence_num: 42 });
  });

  it('posts presence with connected_at from the injected clock, or clear', async () => {
    const t = createMemoryTransport([{ method: 'POST', path: /client\/presence$/, reply: () => jsonResponse(200, {}) }]);
    const c = client(t);
    await c.presence('cse_1', 'client-abc', true);
    await c.presence('cse_1', 'client-abc', false);
    expect(JSON.parse(t.calls[0]!.body as string)).toEqual({
      client_id: 'client-abc',
      connected_at: new Date(1_700_000_000_000).toISOString(),
    });
    expect(JSON.parse(t.calls[1]!.body as string)).toEqual({ client_id: 'client-abc', clear: true });
  });

  it('creates a session and returns the wire object', async () => {
    const t = createMemoryTransport([
      { method: 'POST', path: /\/v1\/code\/sessions$/, reply: () => jsonResponse(200, { id: 'cse_new', title: 'x' }) },
    ]);
    const s = await client(t).createSession({ environment_id: 'env_1', title: 'x' });
    expect(s.id).toBe('cse_new');
    expect(JSON.parse(t.calls[0]!.body as string)).toEqual({
      environment_id: 'env_1',
      title: 'x',
      config: { sources: [], outcomes: [] },
      events: [],
      tags: ['remote-control-app'],
    });
  });

  it('throws ApiError when a 2xx body is not a JSON object', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(200) }]);
    await expect(client(t).getSession('cse_1')).rejects.toBeInstanceOf(ApiError);
  });

  it('builds the events query from the options given', async () => {
    const t = createMemoryTransport([
      {
        method: 'GET',
        path: /\/events/,
        reply: () => jsonResponse(200, { data: [{ sequence_num: '3', payload: { type: 'result' } }] }),
      },
    ]);
    const rows = await client(t).listEvents('cse_1', { fromSequenceNum: 3, sortOrder: 'asc', limit: 50 });
    expect(t.calls[0]!.url).toContain('from_sequence_num=3');
    expect(t.calls[0]!.url).toContain('sort_order=asc');
    expect(t.calls[0]!.url).toContain('limit=50');
    expect(t.calls[0]!.url).not.toContain('page=');
    expect(rows[0]!.payload.type).toBe('result');
  });

  it('defaults the events query to limit 200 ascending and tolerates odd bodies', async () => {
    let n = 0;
    const t = createMemoryTransport([
      {
        method: 'GET',
        path: /\/events/,
        reply: () => {
          n++;
          if (n === 1) return jsonResponse(200, { events: [{ sequence_num: 1, payload: { type: 'result' } }] });
          if (n === 2) return jsonResponse(200, {});
          return jsonResponse(200);
        },
      },
    ]);
    const c = client(t);
    const first = await c.listEvents('cse_1');
    expect(t.calls[0]!.url).toContain('limit=200');
    expect(t.calls[0]!.url).toContain('sort_order=asc');
    expect(t.calls[0]!.url).not.toContain('from_sequence_num');
    expect(first).toHaveLength(1);
    expect(await c.listEvents('cse_1', { page: 'p2', sortOrder: 'desc' })).toEqual([]);
    expect(t.calls[1]!.url).toContain('page=p2');
    expect(t.calls[1]!.url).toContain('sort_order=desc');
    expect(await c.listEvents('cse_1')).toEqual([]);
  });

  it('encodes session ids in paths', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /\/v1\/code\/sessions\/.+$/, reply: () => jsonResponse(200, { id: 'a/b' }) }]);
    await client(t).getSession('a/b');
    expect(t.calls[0]!.url).toBe('https://api.test/v1/code/sessions/a%2Fb');
  });

  it('drops the beta header for the list call when the server rejects it', async () => {
    let n = 0;
    const t = createMemoryTransport([
      {
        method: 'GET',
        path: /\/v1\/code\/sessions$/,
        reply: (req) =>
          n++ === 0 && req.headers!['anthropic-beta']
            ? jsonResponse(400, errorBody('invalid_request_error', 'Unexpected anthropic-beta'))
            : jsonResponse(200, { data: [] }),
      },
    ]);
    const c = client(t);
    await c.listSessions();
    await c.listSessions();
    expect(t.calls.length).toBe(3);
    expect(t.calls[0]!.headers!['anthropic-beta']).toBe('ccr-byoc-2025-07-29');
    expect(t.calls[1]!.headers!['anthropic-beta']).toBeUndefined();
    expect(t.calls[2]!.headers!['anthropic-beta']).toBeUndefined();
  });

  it('keeps the beta header on per-session calls after the list fallback', async () => {
    let n = 0;
    const t = createMemoryTransport([
      {
        method: 'GET',
        path: /\/v1\/code\/sessions$/,
        reply: (req) =>
          n++ === 0 && req.headers!['anthropic-beta']
            ? jsonResponse(400, errorBody('invalid_request_error', 'anthropic-beta not allowed'))
            : jsonResponse(200, { data: [] }),
      },
      { method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(200, { id: 'cse_1' }) },
    ]);
    const c = client(t);
    await c.listSessions();
    await c.getSession('cse_1');
    expect(t.calls[2]!.headers!['anthropic-beta']).toBe('ccr-byoc-2025-07-29');
  });

  it('surfaces an unrelated 400 on the list call verbatim', async () => {
    const t = createMemoryTransport([
      { method: 'GET', path: /\/v1\/code\/sessions$/, reply: () => jsonResponse(400, errorBody('invalid_request_error', 'bad cursor')) },
    ]);
    await expect(client(t).listSessions()).rejects.toMatchObject({ status: 400, message: 'bad cursor (HTTP 400)' });
    expect(t.calls.length).toBe(1);
  });

  it('strips a trailing slash from the base url', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /\/v1\/code\/sessions$/, reply: () => jsonResponse(200, { data: [] }) }]);
    await client(t, { baseUrl: 'https://api.test/' }).listSessions();
    expect(t.calls[0]!.url).toBe('https://api.test/v1/code/sessions?limit=100');
  });
  it('creates a session the way claude.ai/code does and unwraps the session wrapper', async () => {
    const t = createMemoryTransport([{ method: 'POST', path: /\/v1\/code\/sessions$/, reply: () => jsonResponse(200, { deduplicated: false, session: { id: 'cse_new', title: '' } }) }]);
    const s = await client(t).createSession({ environment_id: 'env_1', config: { model: 'claude-opus-5-5' }, tags: ['claudsidian'] });
    expect(s.id).toBe('cse_new');
    const body = JSON.parse(t.calls[0]!.body as string);
    expect(body).toEqual({ environment_id: 'env_1', config: { sources: [], outcomes: [], model: 'claude-opus-5-5' }, events: [], tags: ['claudsidian'] });
  });

  it('maps session_context into config and defaults tags', async () => {
    const t = createMemoryTransport([{ method: 'POST', path: /\/v1\/code\/sessions$/, reply: () => jsonResponse(200, { id: 'cse_bare' }) }]);
    const s = await client(t).createSession({ environment_id: 'env_1', session_context: { model: 'm', effort_level: 'high' } });
    expect(s.id).toBe('cse_bare');
    const body = JSON.parse(t.calls[0]!.body as string);
    expect(body.config).toEqual({ sources: [], outcomes: [], model: 'm', effort_level: 'high' });
    expect(body.tags).toEqual(['remote-control-app']);
  });

  it('returns the per-event results of a send', async () => {
    const t = createMemoryTransport([{ method: 'POST', path: /\/events$/, reply: () => jsonResponse(200, { attestation_feedback: null, results: [{ duplicate: false, event_id: 'u1', sequence_num: '7' }] }) }]);
    const r = await client(t).sendEvents('cse_1', [{ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hi' } }]);
    expect(r.results).toEqual([{ duplicate: false, event_id: 'u1', sequence_num: '7' }]);
  });

  it('wraps the bare payloads the after_id endpoint returns into rows without a sequence number', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /\/v1\/sessions\/cse_1\/events$/, reply: () => jsonResponse(200, { data: [{ type: 'system', subtype: 'init', uuid: 'u2', cwd: '/vault', created_at: '2026-10-16T00:00:00Z' }], has_more: false }) }]);
    const rows = await client(t).listEvents('cse_1', { afterId: 'u1', limit: 500 });
    expect(rows).toEqual([{ sequence_num: '', created_at: '2026-10-16T00:00:00Z', payload: { type: 'system', subtype: 'init', uuid: 'u2', cwd: '/vault', created_at: '2026-10-16T00:00:00Z' } }]);
  });

  it('polls incrementally with after_id on the /v1/sessions path', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /\/v1\/sessions\/cse_1\/events$/, reply: () => jsonResponse(200, { data: [{ sequence_num: '9', payload: { type: 'result' } }], has_more: false }) }]);
    const rows = await client(t).listEvents('cse_1', { afterId: 'abc', limit: 500 });
    expect(t.calls[0]!.url).toContain('/v1/sessions/cse_1/events?limit=500&after_id=abc');
    expect(rows[0]!.payload.type).toBe('result');
  });

  it('reads the bearer-token environment shape (id, config.type, config.directory) and drops archived ones', async () => {
    const env = (id: string, archived: string | null) => ({
      id,
      type: 'environment',
      name: 'Mac:yes-chef:92ad',
      state: 'active',
      archived_at: archived,
      config: { type: 'bridge', machine_name: 'Mac.local', directory: '/Users/ki/yes-chef', branch: 'main', git_repo_url: 'https://example.test/r.git' },
      metadata: { machine_id: 'm1', worker_type: 'claude_code' },
    });
    const t = createMemoryTransport([
      { method: 'GET', path: /\/v1\/environments$/, reply: () => jsonResponse(200, { data: [env('env_1', null), env('env_2', '2026-10-01T00:00:00Z')], has_more: false }) },
      { method: 'GET', path: /\/v1\/environments\/env_1$/, reply: () => jsonResponse(200, env('env_1', null)) },
      { method: 'GET', path: /\/v1\/environments\/env_gone$/, reply: () => jsonResponse(404, { type: 'error', error: { type: 'not_found_error', message: 'Environment env_gone not found.' } }) },
    ]);
    const c = client(t);
    const list = await c.listEnvironments();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ environment_id: 'env_1', kind: 'bridge', name: 'Mac:yes-chef:92ad', bridge_info: { directory: '/Users/ki/yes-chef', machine_name: 'Mac.local' } });
    expect((await c.getEnvironment('env_1'))?.bridge_info?.directory).toBe('/Users/ki/yes-chef');
    expect(t.calls.at(-1)!.headers!['anthropic-beta']).toBe('environments-2025-11-01');
    expect(await c.getEnvironment('env_gone')).toBeNull();
  });

  it('lists environments and falls back to an empty list when the endpoint is missing', async () => {
    const ok = createMemoryTransport([{ method: 'GET', path: /\/v1\/environments$/, reply: () => jsonResponse(200, { environments: [{ environment_id: 'env_1', kind: 'bridge', name: 'Mac:yes-chef:1234' }], has_more: false }) }]);
    expect((await client(ok).listEnvironments()).map((e) => e.environment_id)).toEqual(['env_1']);
    expect(ok.calls[0]!.url).toBe('https://api.test/v1/environments?limit=100');
    expect(ok.calls[0]!.headers!['anthropic-beta']).toBe('environments-2025-11-01');
    const missing = createMemoryTransport([{ method: 'GET', path: /\/v1\/environments$/, reply: () => jsonResponse(404, { type: 'error', error: { type: 'not_found_error', message: 'nope' } }) }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await client(missing).listEnvironments()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatchObject({ status: 404 });
    warn.mockRestore();
    const signedOut = createMemoryTransport([{ method: 'GET', path: /\/v1\/environments$/, reply: () => jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'expired' } }) }]);
    await expect(client(signedOut).listEnvironments()).rejects.toBeInstanceOf(ApiError);
  });

  it('unwraps the response_shape envelope the live GET uses', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /\/v1\/code\/sessions\/cse_1$/, reply: () => jsonResponse(200, { response_shape: { id: 'cse_1', title: 'wrapped', status: 'active' } }) }]);
    const s = await client(t).getSession('cse_1');
    expect(s.id).toBe('cse_1');
    expect(s.title).toBe('wrapped');
  });
});

describe('CcrClient base URL', () => {
  it('reads the base URL on every request, so a settings change applies without a new client', async () => {
    const t = createMemoryTransport([
      { method: 'GET', path: /\/v1\/code\/sessions$/, reply: () => jsonResponse(200, { data: [] }) },
    ]);
    let base = 'https://api.test';
    const c = client(t, { baseUrl: () => base });
    await c.listSessions();
    base = 'http://localhost:3999/';
    await c.listSessions();
    expect(t.calls.map((x) => x.url)).toEqual([
      'https://api.test/v1/code/sessions?limit=100',
      'http://localhost:3999/v1/code/sessions?limit=100',
    ]);
  });
});
