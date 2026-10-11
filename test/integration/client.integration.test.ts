// @vitest-environment node
// Integration tests: the real CcrClient over fetchTransport against the in-process mock Remote Control server.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CcrClient } from '../../src/api/client';
import { fetchTransport } from '../../src/api/http';
import { permissionResponsePayload, userMessagePayload } from '../../src/api/payloads';
import type { ControlRequestEvent, StreamJsonEvent, WireEventRow } from '../../src/api/types';
import { startMockCcr, type MockCcr } from '../mock-ccr/server.mjs';

let mock: MockCcr;

beforeAll(async () => {
  mock = await startMockCcr({ port: 0 });
});

afterAll(async () => {
  await mock.close();
});

function makeClient(extra: Partial<ConstructorParameters<typeof CcrClient>[0]> = {}): CcrClient {
  return new CcrClient({
    baseUrl: mock.url,
    transport: fetchTransport,
    getAccessToken: async () => 'mock-access-1',
    orgUuid: () => 'org-mock',
    clientPlatform: () => 'web_claude_ai',
    userAgent: 'claudsidian/test',
    ...extra,
  });
}

function seq(row: WireEventRow): number {
  return Number(row.sequence_num);
}

function assistantTexts(rows: WireEventRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const p = row.payload;
    if (p.type !== 'assistant') continue;
    const content = (p as { message?: { content?: { type: string; text?: string }[] } }).message?.content ?? [];
    for (const block of content) if (block.type === 'text' && block.text) out.push(block.text);
  }
  return out;
}

/** Poll listEvents with fromSequenceNum until `done` sees the accumulated rows as complete, or time runs out. */
async function pollUntil(
  client: CcrClient,
  sessionId: string,
  done: (rows: WireEventRow[]) => boolean,
  opts: { timeoutMs?: number; from?: number } = {},
): Promise<WireEventRow[]> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const deadline = Date.now() + timeoutMs;
  const rows: WireEventRow[] = [];
  let from = opts.from ?? 1;
  while (Date.now() < deadline) {
    const page = await client.listEvents(sessionId, { sortOrder: 'asc', fromSequenceNum: from, limit: 200 });
    for (const row of page) {
      if (seq(row) >= from) {
        rows.push(row);
        from = seq(row) + 1;
      }
    }
    if (done(rows)) return rows;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting on ${sessionId} (${rows.length} rows)`);
}

const hasResult = (rows: WireEventRow[]): boolean => rows.some((r) => r.payload.type === 'result');

describe('CcrClient against the mock Remote Control server', () => {
  it('lists five seeded sessions across two pages', async () => {
    const sessions = await makeClient().listSessions();
    expect(sessions.map((s) => s.id).sort()).toEqual(['cse_blocked', 'cse_cloud', 'cse_old', 'cse_vault', 'cse_ws']);
    const listCalls = mock.state.requests.filter((r) => r.method === 'GET' && r.path === '/v1/code/sessions');
    expect(listCalls.length).toBe(2);
    expect(listCalls[1]?.query.cursor).toBeTruthy();
  });

  it('returns the vault history from init to result in ascending order', async () => {
    const rows = await makeClient().listEvents('cse_vault', { sortOrder: 'asc' });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const first = rows[0]!.payload as StreamJsonEvent & { subtype?: string };
    expect(first.type).toBe('system');
    expect(first.subtype).toBe('init');
    expect(rows[rows.length - 1]!.payload.type).toBe('result');
    const nums = rows.map(seq);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    expect(typeof rows[0]!.sequence_num).toBe('string');
  });

  it('echoes a sent message and replies with Echo within 3 s', async () => {
    const client = makeClient();
    const before = await client.listEvents('cse_vault', { sortOrder: 'asc' });
    const from = seq(before[before.length - 1]!) + 1;
    const msg = userMessagePayload('hello');
    await client.sendEvents('cse_vault', [msg]);
    const rows = await pollUntil(client, 'cse_vault', hasResult, { from, timeoutMs: 3000 });
    expect(rows[0]!.payload.type).toBe('user');
    expect(rows[0]!.payload.uuid).toBe(msg.uuid);
    expect(assistantTexts(rows)).toContain('Echo: hello');
    expect(rows.some((r) => r.payload.type === 'stream_event')).toBe(true);
    const result = rows.find((r) => r.payload.type === 'result')!.payload as { subtype: string; total_cost_usd: number };
    expect(result.subtype).toBe('success');
    expect(result.total_cost_usd).toBe(0.01);
  });

  it('blocks the perm scenario until a permission response arrives', async () => {
    const client = makeClient();
    const before = await client.listEvents('cse_vault', { sortOrder: 'asc' });
    const from = seq(before[before.length - 1]!) + 1;
    await client.sendEvents('cse_vault', [userMessagePayload('perm one')]);
    const rows = await pollUntil(client, 'cse_vault', (rs) => rs.some((r) => r.payload.type === 'control_request'), {
      from,
    });
    const req = rows.find((r) => r.payload.type === 'control_request')!.payload as ControlRequestEvent;
    expect(req.request.subtype).toBe('can_use_tool');
    expect((req.request as { tool_name?: string }).tool_name).toBe('Bash');
    expect((await client.getSession('cse_vault')).worker_status).toBe('requires_action');

    await new Promise((r) => setTimeout(r, 300));
    const stillWaiting = await client.listEvents('cse_vault', { sortOrder: 'asc', fromSequenceNum: from });
    expect(hasResult(stillWaiting)).toBe(false);

    await client.sendEvents('cse_vault', [permissionResponsePayload(req.request_id, { behavior: 'allow' })]);
    const after = await pollUntil(client, 'cse_vault', hasResult, { from });
    expect(assistantTexts(after)).toContain('Allowed, done.');
    expect((await client.getSession('cse_vault')).worker_status).toBe('idle');
  });

  it('creates a session that then appears in the list', async () => {
    const client = makeClient();
    const created = await client.createSession({
      environment_id: 'env_vault',
      title: 'Integration created',
      session_context: { model: 'claude-sonnet-4-5', permission_mode: 'acceptEdits' },
      events: [{ payload: userMessagePayload('first message') }],
    });
    expect(created.id).toMatch(/^cse_new\d+$/);
    expect(created.title).toBe('Integration created');
    expect(created.environment_id).toBe('env_vault');
    const ids = (await client.listSessions()).map((s) => s.id);
    expect(ids).toContain(created.id);
    const rows = await pollUntil(client, created.id, hasResult);
    const init = rows[0]!.payload as { type: string; subtype?: string; cwd?: string };
    expect(init.type).toBe('system');
    expect(init.subtype).toBe('init');
    expect(init.cwd).toBe('/Users/kicooley-winters/workspace/projects/yes-chef');
    expect(assistantTexts(rows)).toContain('Echo: first message');
  });

  it('refreshes once on an injected 401 and still succeeds', async () => {
    const onUnauthorized = vi.fn(async () => true);
    const client = makeClient({ onUnauthorized });
    mock.fault({ once: 401 });
    const session = await client.getSession('cse_vault');
    expect(session.id).toBe('cse_vault');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired bearer with the Anthropic envelope', async () => {
    const res = await fetch(`${mock.url}/v1/code/sessions`, { headers: { authorization: 'Bearer expired' } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { type: string; error: { type: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('authentication_error');
  });

  it('issues tokens for a good code and rejects a bad one', async () => {
    const good = await fetch(`${mock.url}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: 'good', code_verifier: 'v', client_id: 'c' }),
    });
    expect(good.status).toBe(200);
    const tokens = (await good.json()) as { access_token: string; refresh_token: string; organization: { uuid: string } };
    expect(tokens.access_token).toMatch(/^mock-access-\d+$/);
    expect(tokens.organization.uuid).toBe('org-mock');

    const bad = await fetch(`${mock.url}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: 'nope', code_verifier: 'v', client_id: 'c' }),
    });
    expect(bad.status).toBe(400);
    const err = (await bad.json()) as { error: { type: string } };
    expect(err.error.type).toBe('invalid_grant');

    const profile = await fetch(`${mock.url}/api/oauth/profile`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(((await profile.json()) as { organization: { uuid: string } }).organization.uuid).toBe('org-mock');
  });

  it('archives once with 200 and treats the second archive as done', async () => {
    const client = makeClient();
    await client.archiveSession('cse_cloud');
    await expect(client.archiveSession('cse_cloud')).resolves.toBeUndefined();
    expect((await client.getSession('cse_cloud')).status).toBe('archived');
  });

  it('injects events programmatically', async () => {
    const client = makeClient();
    const before = await client.listEvents('cse_ws', { sortOrder: 'asc' });
    const from = seq(before[before.length - 1]!) + 1;
    mock.inject('cse_ws', { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Injected' }] } });
    const rows = await client.listEvents('cse_ws', { sortOrder: 'asc', fromSequenceNum: from });
    expect(assistantTexts(rows)).toEqual(['Injected']);
    expect(rows[0]!.payload.uuid).toBeTruthy();
  });
});
