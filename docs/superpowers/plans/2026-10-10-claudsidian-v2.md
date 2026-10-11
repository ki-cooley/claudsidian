# Claudsidian v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Claudsidian v2, an Obsidian plugin for desktop and iPad that lists, opens, creates, and steers Ki's Claude Code Remote Control sessions, with the open note, selection, and cursor attached to every message automatically.

**Architecture:** A Preact UI hosted in an Obsidian `ItemView`; a pure transcript reducer over Claude Code stream-json events; an adaptive poller against `api.anthropic.com/v1/code/sessions` through Obsidian's `requestUrl` (no CORS, no streaming); OAuth PKCE sign-in with Claude Code's public client id; a `claude remote-control` server on the Mac rooted in the vault; no backend of ours.

**Tech Stack:** TypeScript 5.9 strict, esbuild 0.25 (CJS bundle, Preact JSX), Preact 10 + @preact/signals, vitest 3 + jsdom, Obsidian API 1.14 typings (minAppVersion 1.5.0), Node 22 for scripts, the mock server, and the e2e driver.

**Spec:** `docs/superpowers/specs/2026-10-10-claudsidian-v2-design.md`. Also read `docs/protocol.md` (what we rely on) and `docs/reference/claude-rc-api-reference.md` (the vendored unofficial reference). The contracts every task codes against already exist and compile: `src/api/types.ts`, `src/api/payloads.ts`, `src/api/errors.ts`, `src/api/http.ts`, `src/api/auth-types.ts`, `src/api/client-api.ts`, `src/api/auth-api.ts`, `src/core/types.ts`, `src/core/store-api.ts`, `src/ui/facade.ts`, `src/settings.ts`, `src/util/*.ts`, `test/mocks/obsidian.ts`.

## Global Constraints

- Plugin id `claudsidian`, name `Claudsidian`, `isDesktopOnly: false`, `minAppVersion` `1.5.0`, version `2.0.0`.
- Nothing under `src/` imports Node, Electron, or `fs`/`path`/`child_process` (eslint `no-restricted-imports` enforces it; the bundle runs inside the iOS WebView).
- Every HTTP call goes through an `HttpTransport` (`src/api/http.ts`). Production uses `obsidianTransport`; tests and the harness inject `fetchTransport` or an in-memory transport.
- Headers exactly as `docs/protocol.md`: `anthropic-version: 2023-06-01`, `anthropic-beta: ccr-byoc-2025-07-29`, `anthropic-client-platform` from settings (default `web_claude_ai`), `x-organization-uuid`, bearer token.
- Tokens are never logged or rendered. Use `log` from `src/util/log.ts` for diagnostics (it redacts).
- Styles use Obsidian CSS variables (`--background-primary`, `--background-secondary`, `--background-modifier-border`, `--text-normal`, `--text-muted`, `--text-accent`, `--interactive-accent`, `--font-ui-small`, `--font-ui-medium`, `--radius-m`, `--color-red`, `--color-orange`, `--color-green`). No hard-coded colours. Tap targets at least 44 px on mobile and 48 px in cooking mode.
- UI strings and docs contain no em dashes, no smart quotes, no ellipsis characters (the vault's lint hook rejects them).
- Before every commit: `npm run typecheck && npm run lint && npm test` green. Commit messages end with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- File ownership is strict (see the file map). A task may only add fields to a shared contract file when a field is missing, and must say so in its report.
- Component props and store calls use the exact names in `src/core/store-api.ts` and `src/ui/facade.ts`.

## Review Focus

1. A `user` event whose `message.content` is a plain string, or whose blocks are only `tool_result`s: no empty bubble; results attach to the matching tool item (Task A3 test `attaches tool results and never renders them as bubbles`, `accepts string content`).
2. `sequence_num` arriving as strings, out of order, or duplicated across a poll boundary: ordering and dedupe hold (Task A3 `coerces string sequence numbers`, Task A4 `dedupes overlapping polls`).
3. A session whose loaded history window has no `system/init` event: the UI works with unknown cwd and the context block falls back to the settings vault path (Task A4 `open works without init`, Task A5 `format without session cwd`).
4. A 401 during polling: exactly one refresh, the poll resumes, no duplicate items, no notice storm (Task A1 `refreshes once on 401`, Task A4 `poll survives a 401`).
5. iPad keyboard: the composer stays visible when the keyboard opens, `Enter` inserts a newline on mobile (send is a button), desktop `Enter` sends and `Shift+Enter` inserts a newline (Task B1 `composer enter behaviour`, Task B4 scenario `03-chat-send-reply` at the phone profile).

## File map (ownership)

| Task | Creates / owns |
|---|---|
| A1 Client | `src/api/client.ts`, `test/api/client.test.ts`, `test/helpers/memory-transport.ts` |
| A2 Auth | `src/api/oauth.ts`, `src/api/auth.ts`, `src/ui/modals/SignInModal.ts`, `test/api/oauth.test.ts`, `test/api/auth.test.ts`, `test/ui/sign-in-modal.test.ts` |
| A3 Reducer | `src/core/transcript.ts`, `src/core/tool-summary.ts`, `test/core/transcript.test.ts`, `test/fixtures/streams/*.json`, `test/fixtures/README.md` |
| A4 Store | `src/core/poller.ts`, `src/core/session-store.ts`, `test/core/poller.test.ts`, `test/core/session-store.test.ts`, `test/helpers/fake-client.ts` |
| A5 Context | `src/obsidian/context-capture.ts`, `src/core/context-format.ts`, `src/core/attachments.ts`, `src/core/slash-commands.ts`, `test/core/context-format.test.ts`, `test/core/attachments.test.ts`, `test/obsidian/context-capture.test.ts` |
| A6 Mock server | `test/mock-ccr/server.mjs`, `test/mock-ccr/scenarios.mjs`, `test/mock-ccr/seed.mjs`, `test/integration/client.integration.test.ts`, `test/mock-ccr/README.md` |
| A7 Settings tab | `src/ui/SettingsTab.ts`, `test/ui/settings-tab.test.ts` |
| A8 Scripts and docs | `scripts/install-to-vault.sh`, `scripts/dev.sh`, `scripts/version-bump.mjs`, `scripts/mac/claudsidian-rc.sh`, `scripts/mac/com.kicooley.claudsidian-rc.plist`, `scripts/mac/install-launchagent.sh`, `scripts/mac/uninstall-launchagent.sh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `docs/host-setup.md`, `docs/testing.md`, `README.md` |
| B1 Chat UI | `src/ui/components/chat/**`, `src/ui/components/common/**`, `src/styles/chat.css`, `src/styles/composer.css`, `src/styles/cards.css`, `test/ui/chat/*.test.tsx`, `test/helpers/fake-store.ts`, `test/helpers/fake-facade.ts` |
| B2 Sessions UI | `src/ui/components/sessions/**`, `src/styles/sessions.css`, `src/util/time.ts`, `test/ui/sessions/*.test.tsx`, `test/util/time.test.ts` |
| B3 Shell | `src/main.ts` (rewrite), `src/ui/ChatView.ts` (rewrite), `src/ui/components/Root.tsx` (rewrite), `src/ui/modals/QuickAskModal.ts`, `src/ui/modals/RenameModal.ts`, `src/ui/modals/NewSessionModal.ts` (if not a sheet), `src/obsidian/facade-impl.ts`, `src/obsidian/notifications.ts`, `src/styles/base.css` (rewrite), `src/styles/mobile.css`, `src/styles/cooking.css`, `src/styles/index.css` (imports), `test/ui/root.test.tsx`, `test/obsidian/facade-impl.test.ts` |
| B4 Harness | `e2e/harness/**`, `e2e/cdp/**`, `e2e/run.mjs`, `e2e/README.md` |

Shared and read-only for everyone except where noted: `src/api/types.ts`, `src/api/payloads.ts`, `src/api/errors.ts`, `src/api/http.ts`, `src/api/auth-types.ts`, `src/api/client-api.ts`, `src/api/auth-api.ts`, `src/core/types.ts`, `src/core/store-api.ts`, `src/ui/facade.ts`, `src/settings.ts`, `src/util/*`, `test/mocks/obsidian.ts` (A-tasks may add stubs to the mock additively).

---

## Wave A (parallel, independent)

### Task A1: CcrClient (controller API client)

**Files:**
- Create: `src/api/client.ts`
- Create: `test/helpers/memory-transport.ts`
- Test: `test/api/client.test.ts`

**Interfaces:**
- Consumes: `HttpTransport`, `HttpRequest`, `HttpResponse` from `src/api/http.ts`; `ApiError`, `apiErrorFromResponse` from `src/api/errors.ts`; wire types from `src/api/types.ts`; `CcrApi`, `ListEventsOptions` from `src/api/client-api.ts`; `TimerApi`, `realTimers`, `sleep` from `src/util/timers.ts`.
- Produces:

```ts
export interface CcrClientOptions {
  baseUrl: string;                       // no trailing slash
  transport: HttpTransport;
  getAccessToken: () => Promise<string>; // throws ApiError(401) when signed out
  onUnauthorized?: () => Promise<boolean>; // refresh hook; true = retry once
  orgUuid: () => string | undefined;
  clientPlatform: () => string;
  userAgent: string;                     // "claudsidian/2.0.0"
  timers?: TimerApi;                     // default realTimers
  maxRetries?: number;                   // default 3 (5xx and network)
}
export class CcrClient implements CcrApi { constructor(opts: CcrClientOptions) /* methods from CcrApi */ }
export function buildHeaders(token: string, opts: { orgUuid?: string; clientPlatform: string; userAgent: string; beta: boolean }): Record<string, string>;
```

Behaviour:
- `listSessions()` calls `GET {base}/v1/code/sessions`, follows `next_cursor` with `?cursor=<value>` until null or absent, concatenates `data`. If the first call returns 400 and the error message mentions `anthropic-beta`, retry once without the beta header and remember (`betaOnList = false`) for the client's lifetime.
- `listEvents(id, {limit=200, sortOrder='asc', fromSequenceNum, page})` builds the query string with only the provided keys; returns `data` (an array) or `events` or `[]`.
- `sendEvents(id, payloads)` posts `{session_id: id, events: payloads.map(p => ({payload: p.uuid ? p : {...p, uuid: uuidv4()}}))}`.
- `archiveSession` treats 409 as success. `markRead` accepts 200 and 204. `presence(id, clientId, connected)` posts `{client_id, connected_at: new Date(timers.now()).toISOString()}` or `{client_id, clear: true}`.
- Retry policy: 401 -> `onUnauthorized()` once, retry once with the new token; 429 -> wait `retryAfterMs ?? 5000` then retry once; 5xx or network (status 0) -> retry up to `maxRetries` with 1000, 2000, 4000 ms sleeps via `timers`; anything else -> throw `ApiError`.
- `memory-transport.ts` exports `createMemoryTransport(routes: Array<{ method; path: RegExp | string; reply: (req) => HttpResponse | Promise<HttpResponse> }>)` plus `calls: HttpRequest[]` for assertions, and `jsonResponse(status, body, headers?)`.

- [ ] **Step 1: Write the failing tests** (`test/api/client.test.ts`)

```ts
import { describe, expect, it, vi } from 'vitest';
import { CcrClient } from '../../src/api/client';
import { ApiError } from '../../src/api/errors';
import { createMemoryTransport, jsonResponse } from '../helpers/memory-transport';

const timers = { setTimeout: (fn: () => void) => { fn(); return 0; }, clearTimeout: () => {}, now: () => 1_700_000_000_000 };
function client(transport: ReturnType<typeof createMemoryTransport>, extra = {}) {
  return new CcrClient({ baseUrl: 'https://api.test', transport: transport.transport, getAccessToken: async () => 'tok',
    orgUuid: () => 'org-1', clientPlatform: () => 'web_claude_ai', userAgent: 'claudsidian/test', timers, ...extra });
}

describe('CcrClient', () => {
  it('sends the required headers on every call', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /\/v1\/code\/sessions$/, reply: () => jsonResponse(200, { data: [] }) }]);
    await client(t).listSessions();
    const h = t.calls[0]!.headers!;
    expect(h['Authorization']).toBe('Bearer tok');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-beta']).toBe('ccr-byoc-2025-07-29');
    expect(h['anthropic-client-platform']).toBe('web_claude_ai');
    expect(h['x-organization-uuid']).toBe('org-1');
  });

  it('follows next_cursor when listing sessions', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /\/v1\/code\/sessions/, reply: (req) =>
      req.url.includes('cursor=c2') ? jsonResponse(200, { data: [{ id: 'b' }], next_cursor: null }) : jsonResponse(200, { data: [{ id: 'a' }], next_cursor: 'c2' }) }]);
    const sessions = await client(t).listSessions();
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('wraps outgoing events in payload and adds a uuid', async () => {
    const t = createMemoryTransport([{ method: 'POST', path: /\/events$/, reply: () => jsonResponse(200, {}) }]);
    await client(t).sendEvents('cse_1', [{ type: 'user', message: { role: 'user', content: 'hi' } }]);
    const body = JSON.parse(t.calls[0]!.body as string);
    expect(body.session_id).toBe('cse_1');
    expect(body.events[0].payload.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refreshes once on 401 and retries', async () => {
    let tokens = ['expired', 'fresh'];
    const t = createMemoryTransport([{ method: 'GET', path: /sessions\/cse_1$/, reply: (req) =>
      req.headers!['Authorization'] === 'Bearer fresh' ? jsonResponse(200, { id: 'cse_1' }) : jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'expired' } }) }]);
    const onUnauthorized = vi.fn(async () => { tokens = ['fresh']; return true; });
    const c = client(t, { getAccessToken: async () => tokens[0], onUnauthorized });
    expect((await c.getSession('cse_1')).id).toBe('cse_1');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(t.calls.length).toBe(2);
  });

  it('honours retry-after on 429 then succeeds', async () => {
    let n = 0;
    const t = createMemoryTransport([{ method: 'GET', path: /sessions\/cse_1$/, reply: () => (n++ === 0 ? jsonResponse(429, {}, { 'retry-after': '1' }) : jsonResponse(200, { id: 'cse_1' })) }]);
    expect((await client(t).getSession('cse_1')).id).toBe('cse_1');
  });

  it('retries 5xx up to three times then throws ApiError', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /sessions\/cse_1$/, reply: () => jsonResponse(503, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }) }]);
    await expect(client(t).getSession('cse_1')).rejects.toBeInstanceOf(ApiError);
    expect(t.calls.length).toBe(4);
  });

  it('treats 409 on archive as success', async () => {
    const t = createMemoryTransport([{ method: 'POST', path: /archive$/, reply: () => jsonResponse(409, {}) }]);
    await expect(client(t).archiveSession('cse_1')).resolves.toBeUndefined();
  });

  it('builds the events query from the options given', async () => {
    const t = createMemoryTransport([{ method: 'GET', path: /\/events/, reply: () => jsonResponse(200, { data: [{ sequence_num: '3', payload: { type: 'result' } }] }) }]);
    const rows = await client(t).listEvents('cse_1', { fromSequenceNum: 3, sortOrder: 'asc', limit: 50 });
    expect(t.calls[0]!.url).toContain('from_sequence_num=3');
    expect(t.calls[0]!.url).toContain('sort_order=asc');
    expect(t.calls[0]!.url).toContain('limit=50');
    expect(rows[0]!.payload.type).toBe('result');
  });

  it('drops the beta header for the list call when the server rejects it', async () => {
    let n = 0;
    const t = createMemoryTransport([{ method: 'GET', path: /\/v1\/code\/sessions$/, reply: (req) =>
      n++ === 0 && req.headers!['anthropic-beta'] ? jsonResponse(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Unexpected anthropic-beta' } }) : jsonResponse(200, { data: [] }) }]);
    const c = client(t);
    await c.listSessions();
    await c.listSessions();
    expect(t.calls[2]!.headers!['anthropic-beta']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**: `npx vitest run test/api/client.test.ts` (fails: module not found).
- [ ] **Step 3: Implement `test/helpers/memory-transport.ts` and `src/api/client.ts`** to the behaviour above. Keep one private `request<T>(method, path, {query, body, beta})` that applies headers, the retry policy, and error parsing; every public method is a thin call to it.
- [ ] **Step 4: Run the tests until green**: `npx vitest run test/api/client.test.ts`.
- [ ] **Step 5: Checks and commit**: `npm run typecheck && npm run lint && npm test`, then `git add src/api/client.ts test/helpers/memory-transport.ts test/api/client.test.ts && git commit -m "Add CcrClient for the Remote Control controller API"` (with the Co-Authored-By trailer).

### Task A2: OAuth PKCE, AuthManager, SignInModal

**Files:**
- Create: `src/api/oauth.ts`, `src/api/auth.ts`, `src/ui/modals/SignInModal.ts`
- Test: `test/api/oauth.test.ts`, `test/api/auth.test.ts`, `test/ui/sign-in-modal.test.ts`

**Interfaces:**
- Consumes: `AuthState` (`src/api/auth-types.ts`), `AuthApi` (`src/api/auth-api.ts`), `HttpTransport` (`src/api/http.ts`), `ApiError`, `apiErrorFromResponse`, `TimerApi`.
- Produces:

```ts
// src/api/oauth.ts
export const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const OAUTH_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
export const OAUTH_SCOPES = ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code'];
export const OAUTH_BETA = 'oauth-2025-04-20';
export function randomUrlSafe(bytes?: number): string;                 // base64url, default 32 bytes
export async function challengeS256(verifier: string): Promise<string>;  // base64url(sha256(verifier)) via crypto.subtle
export function buildAuthorizeUrl(p: { authorizeUrl: string; clientId: string; challenge: string; state: string; scopes: string[]; redirectUri: string }): string;
export function parsePastedCode(input: string): { code: string; state?: string } | null;  // "code", "code#state", URL with ?code=&state=
// src/api/auth.ts
export interface AuthDeps { transport: HttpTransport; load: () => AuthState | null; save: (s: AuthState | null) => Promise<void>;
  tokenUrl: string; authorizeUrl: string; profileUrl: string; clientId?: string; timers?: TimerApi }
export class AuthManager implements AuthApi { constructor(deps: AuthDeps) }
// src/ui/modals/SignInModal.ts
export class SignInModal extends Modal { constructor(app: App, auth: AuthApi, onDone?: (signedIn: boolean) => void) }
```

Behaviour:
- `beginSignIn()` stores `{verifier, state}` in memory, returns the URL. `completeSignIn(pasted)` parses, rejects a mismatched state with `ApiError(400, 'State mismatch...')`, posts `{grant_type:'authorization_code', code, state, code_verifier, client_id, redirect_uri}` with header `anthropic-beta: oauth-2025-04-20` and `Content-Type: application/json` to `tokenUrl`, maps the response (`access_token`, `refresh_token`, `expires_in` seconds, `scope` space-separated, optional `organization.uuid` or `org_uuid`, `account.uuid`, `account.email_address`) into `AuthState`, then when `orgUuid` is still unknown calls `GET profileUrl` with the bearer token and reads `organization.uuid` (ignore failures), saves, notifies.
- `getAccessToken()` returns the stored token when `expiresAt - now > 300_000`; otherwise `refresh()`. Signed out -> throw `ApiError({status: 401, message: 'Not signed in'})`.
- `refresh()` posts `{grant_type:'refresh_token', refresh_token, client_id}`; concurrent callers share one in-flight promise; a 400/401 from the token endpoint clears state (signed out) and rethrows; network errors keep the old state and rethrow.
- `signOut()` saves null and notifies. `onChange` returns an unsubscribe.
- `SignInModal`: title "Sign in to Claude", a paragraph explaining the three steps, a button "Open claude.ai" (`window.open(url)`), a read-only text field with the URL plus a "Copy" button, a text field "Paste the code here", a "Finish sign-in" button that calls `completeSignIn` and shows the thrown error's message under the field (never closes on error), and `onDone(true)` then `close()` on success. The modal calls `beginSignIn()` in `onOpen`.

- [ ] **Step 1: Write the failing tests**

`test/api/oauth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAuthorizeUrl, challengeS256, parsePastedCode, randomUrlSafe, CLAUDE_CODE_CLIENT_ID } from '../../src/api/oauth';

describe('oauth helpers', () => {
  it('makes a url-safe verifier of 43+ chars', () => {
    const v = randomUrlSafe();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(randomUrlSafe()).not.toBe(v);
  });
  it('computes the S256 challenge from RFC 7636 appendix B', async () => {
    expect(await challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('builds the authorize url with code=true and all params', () => {
    const url = new URL(buildAuthorizeUrl({ authorizeUrl: 'https://claude.ai/oauth/authorize', clientId: CLAUDE_CODE_CLIENT_ID, challenge: 'c', state: 's', scopes: ['a', 'b'], redirectUri: 'https://r' }));
    expect(url.searchParams.get('code')).toBe('true');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('a b');
    expect(url.searchParams.get('redirect_uri')).toBe('https://r');
  });
  it('parses pasted codes in every shape', () => {
    expect(parsePastedCode('abc')).toEqual({ code: 'abc' });
    expect(parsePastedCode('  abc#st  ')).toEqual({ code: 'abc', state: 'st' });
    expect(parsePastedCode('https://platform.claude.com/oauth/code/callback?code=abc&state=st')).toEqual({ code: 'abc', state: 'st' });
    expect(parsePastedCode('')).toBeNull();
  });
});
```

`test/api/auth.test.ts` (use `createMemoryTransport` from Task A1's helper if present; otherwise an inline transport that records calls):

```ts
import { describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../../src/api/auth';
import type { AuthState } from '../../src/api/auth-types';
import { makeResponse } from '../../src/api/http';

function deps(overrides: Partial<ConstructorParameters<typeof AuthManager>[0]> = {}) {
  let stored: AuthState | null = null;
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const transport = async (req: { url: string; body?: unknown; headers?: Record<string, string> }) => {
    calls.push({ url: req.url, body: typeof req.body === 'string' ? JSON.parse(req.body) : req.body, headers: req.headers ?? {} });
    if (req.url.endsWith('/token')) return makeResponse(200, {}, JSON.stringify({ access_token: 'A2', refresh_token: 'R2', expires_in: 3600, scope: 'user:profile user:sessions:claude_code', organization: { uuid: 'org-9' } }));
    if (req.url.endsWith('/profile')) return makeResponse(200, {}, JSON.stringify({ organization: { uuid: 'org-9' } }));
    return makeResponse(404, {}, '');
  };
  const d = { transport, load: () => stored, save: async (s: AuthState | null) => { stored = s; }, tokenUrl: 'https://t/token', authorizeUrl: 'https://a/authorize', profileUrl: 'https://p/profile',
    timers: { setTimeout: (fn: () => void) => { fn(); return 0; }, clearTimeout: () => {}, now: () => 1_000_000 }, ...overrides };
  return { d, calls, get stored() { return stored; } };
}

describe('AuthManager', () => {
  it('completes sign-in: exchanges the code with the verifier and persists state', async () => {
    const { d, calls } = deps();
    const auth = new AuthManager(d);
    const { state } = await auth.beginSignIn();
    const s = await auth.completeSignIn(`code-1#${state}`);
    expect(s.accessToken).toBe('A2');
    expect(s.orgUuid).toBe('org-9');
    expect(s.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(calls[0]!.body).toMatchObject({ grant_type: 'authorization_code', code: 'code-1', state });
    expect(calls[0]!.headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(auth.isSignedIn()).toBe(true);
  });
  it('rejects a state mismatch without calling the token endpoint', async () => {
    const { d, calls } = deps();
    const auth = new AuthManager(d);
    await auth.beginSignIn();
    await expect(auth.completeSignIn('code#wrong')).rejects.toThrow(/state/i);
    expect(calls.length).toBe(0);
  });
  it('refreshes when the token expires within five minutes and shares one in-flight refresh', async () => {
    const { d, calls } = deps({ load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 1_000_000 + 60_000, scopes: [], clientId: 'c', orgUuid: 'org-9' }) });
    const auth = new AuthManager(d);
    const [t1, t2] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    expect(t1).toBe('A2'); expect(t2).toBe('A2');
    expect(calls.filter((c) => c.url.endsWith('/token')).length).toBe(1);
    expect(calls[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'R1' });
  });
  it('signs out when the refresh is rejected', async () => {
    const { d } = deps({ load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, scopes: [], clientId: 'c' }),
      transport: async () => makeResponse(400, {}, JSON.stringify({ error: { type: 'invalid_grant', message: 'bad' } })) });
    const auth = new AuthManager(d);
    const cb = vi.fn();
    auth.onChange(cb);
    await expect(auth.getAccessToken()).rejects.toThrow();
    expect(auth.isSignedIn()).toBe(false);
    expect(cb).toHaveBeenCalledWith(null);
  });
});
```

`test/ui/sign-in-modal.test.ts`: construct `SignInModal` with a fake `AuthApi` whose `completeSignIn` rejects with `new Error('invalid_grant: bad code')` on first call and resolves on the second; call `open()`; assert the modal's content has an input and a button; simulate the click with a bad code and assert the error text appears and the modal is still open; then a good code and assert `onDone(true)` was called.

- [ ] **Step 2: Run the tests to see them fail**: `npx vitest run test/api/oauth.test.ts test/api/auth.test.ts test/ui/sign-in-modal.test.ts`.
- [ ] **Step 3: Implement** `src/api/oauth.ts`, `src/api/auth.ts`, `src/ui/modals/SignInModal.ts`. Use `crypto.subtle.digest('SHA-256', ...)` and `crypto.getRandomValues` (both exist in Obsidian desktop and iOS and in jsdom via Node's webcrypto; if `crypto.subtle` is missing in the test environment, `test/setup.ts` may assign `globalThis.crypto = (await import('node:crypto')).webcrypto`).
- [ ] **Step 4: Run the tests until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Add OAuth PKCE sign-in, AuthManager, and SignInModal"`.

### Task A3: Transcript reducer and fixtures

**Files:**
- Create: `src/core/transcript.ts`, `src/core/tool-summary.ts`
- Create: `test/fixtures/streams/simple-reply.json`, `tool-calls.json`, `streaming-deltas.json`, `permission.json`, `question.json`, `error-result.json`, `subagent.json`, `slash-command.json`, `string-user-content.json`, `test/fixtures/README.md`
- Test: `test/core/transcript.test.ts`

**Interfaces:**
- Consumes: `src/api/types.ts` (events and guards), `src/core/types.ts` (TranscriptState, TranscriptItem, PendingControl, SessionInit, createTranscript).
- Produces:

```ts
// src/core/transcript.ts
export function applyEvent(state: TranscriptState, row: WireEventRow): TranscriptState;  // pure; returns the same object when nothing changed
export function applyEvents(state: TranscriptState, rows: WireEventRow[]): TranscriptState; // sorts by seq, skips seq <= lastSeq
export function markSent(state: TranscriptState, payload: UserEvent, textForDisplay: string, imageCount: number): TranscriptState; // optimistic user item, turn 'sending', remembers uuid
export function markControlSent(state: TranscriptState, requestId: string): TranscriptState; // resolves pending locally (optimistic)
export function markOffline(state: TranscriptState, offline: boolean): TranscriptState;
export function findItem(state: TranscriptState, id: string): TranscriptItem | undefined; // searches nested children too
// src/core/tool-summary.ts
export function summarizeTool(name: string, input: Record<string, unknown>): string;  // "Read menus/x.md", "Bash: npm test", "Edit recipes/tare.md"
export function toolCategory(name: string): 'read' | 'write' | 'shell' | 'search' | 'agent' | 'web' | 'mcp' | 'other';
export function editDiff(input: Record<string, unknown>): { path: string; oldText: string; newText: string } | null; // Edit / Write / MultiEdit
```

Reducer rules (all in the spec section 5 and `docs/protocol.md`):
- `system/init` -> `state.init` (cwd, model, permissionMode, effort, slashCommands, tools, claudeCodeVersion), `state.model`, `state.permissionMode`; also a `system` item "Session started in <cwd>" only when it is the first event in the window.
- `system/compact_boundary` -> system item "Context compacted". `system/permission_denied` -> system item with the message. `system/api_retry` -> system item "Retrying API (attempt n)". Other `system` subtypes -> no item.
- `user`: if `message.content` is a string, it is a user item. If blocks contain any `tool_result`, attach each to the tool item with that `tool_use_id` (`status` done or error, `result` as text: string content as-is, block arrays joined by text blocks; non-text noted as "[image]"), and create no user item. Otherwise a user item with text from text blocks and `imageCount` from image blocks. If `payload.uuid` is in `inFlightUserUuids`, replace the optimistic item (same id) instead of appending and remove the uuid. `isMeta` or `isSynthetic` events whose text starts with `<` (command wrappers like `<command-name>`) are hidden unless `local_command` echo is useful: render `<command-name>/x</command-name>` wrappers as a system item "Ran /x". A user event after `result` starts a new turn (turn -> working).
- `assistant`: for each block: `text` -> assistant_text item (id `${message.id}:${index}`, partial false, replacing any partial item with the same id), `thinking`/`redacted_thinking` -> thinking item, `tool_use` -> tool item (status running) unless one with that id exists (then update name/input, clear inputPartial). When `parent_tool_use_id` is set, the items go into `children` of that tool item (create a placeholder tool item if missing). `aborted` or `error` on the event -> an error item with the error text. Turn -> working.
- `stream_event`: `message_start` records the message id; `content_block_start` creates the partial item (text/thinking/tool) with id `${messageId}:${index}`; `content_block_delta` appends (`text_delta` to text, `thinking_delta` to thinking, `input_json_delta` to `inputPartial`); `content_block_stop` marks `partial: false` for text and thinking, and parses `inputPartial` into `input` for tools when it is valid JSON. Turn -> working.
- `result`: result item; `turn` -> idle; `lastResult`; a `local_command` result also sets nothing else. Clear `inFlightUserUuids`. If `is_error` or subtype starts with `error_`, the item is an error-flavoured result (still kind `result`).
- `control_request` `can_use_tool`: `tool_name === 'AskUserQuestion'` -> question item; else permission item; push to `pending`; turn -> needs_input. `request_user_dialog` or `side_question` -> pending `dialog` plus a system item with the request's text fields. Other subtypes (set_model and friends echoed by the server) -> no item.
- `control_response`: resolve the pending item with that `request_id` (permission `resolved` from the response body's `behavior` when present, else 'allow'; question `resolved` true); remove from `pending`; if `pending` is empty and the last item is not a result, turn -> working. `subtype === 'error'` -> error item with the server's text.
- Unknown types -> no change (same state object).
- Every row updates `lastSeq` to max(lastSeq, seq). Rows with seq <= lastSeq are skipped by `applyEvents`.

Fixture format: `{ "name": "...", "rows": WireEventRow[], "expect": { "itemKinds": [...], "turn": "idle" } }` so the tests can be table-driven; hand-write them from `docs/protocol.md` shapes (real `uuid`s, `session_id`, `timestamp`, `parent_tool_use_id`), 8 to 20 rows each. The README explains how to record real fixtures later (`GET .../events` dumped to a file with tokens stripped).

- [ ] **Step 1: Write the failing tests** (`test/core/transcript.test.ts`): a table-driven test over every fixture (`itemKinds` and `turn` match), plus targeted tests: `attaches tool results and never renders them as bubbles` (after tool_use + tool_result, items has one tool item with status done and result text, zero user items), `accepts string content`, `coerces string sequence numbers` (rows with `sequence_num: "2"`, `"1"` applied through `applyEvents` end up ordered and `lastSeq === 2`), `skips rows at or below lastSeq`, `replaces partial text with the final assistant message` (deltas then assistant with same message id -> one text item, `partial false`, full text), `optimistic send is replaced by the echo` (`markSent` then user echo with the same uuid -> one user item, no duplicate), `permission request moves to needs_input and resolves on control_response`, `question item parses AskUserQuestion input`, `nests subagent traffic under the Agent tool call`, `result closes the turn and clears in-flight`, `returns the same state object for unknown event types`, `summarizeTool covers Read, Edit, Write, Bash, Grep, Glob, Agent, WebFetch, mcp__x__y`.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Write the fixtures, then implement `tool-summary.ts` and `transcript.ts`.** Keep the reducer in small functions per event type; immutable updates (copy the items array and the touched item); nested children updated by path.
- [ ] **Step 4: Run the tests until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Add the transcript reducer with stream fixtures"`.

### Task A4: Poller and SessionStore

**Files:**
- Create: `src/core/poller.ts`, `src/core/session-store.ts`, `test/helpers/fake-client.ts`
- Test: `test/core/poller.test.ts`, `test/core/session-store.test.ts`

**Interfaces:**
- Consumes: `CcrApi` (`src/api/client-api.ts`), reducer functions from `src/core/transcript.ts` (Task A3; if not merged yet, code against the signatures in Task A3 and use a stub in tests), `summarizeSession`, types, `src/core/store-api.ts`, `src/api/payloads.ts`, `@preact/signals`, `TimerApi`.
- Produces:

```ts
// src/core/poller.ts
export type PollMode = 'active' | 'idle' | 'background';
export interface PollerOptions { run: () => Promise<void>; intervalMs: (mode: PollMode) => number; onError?: (err: unknown) => void; timers?: TimerApi; maxBackoffMs?: number /* 30000 */ }
export class Poller { constructor(opts: PollerOptions); start(): void; stop(): void; setMode(mode: PollMode): void; kick(): void /* run now, reset backoff */; readonly mode: PollMode; readonly running: boolean }
// src/core/session-store.ts
export interface SessionStoreDeps { client: CcrApi; settings: () => ClaudsidianSettings; clientId: string; timers?: TimerApi; onNotice?: (text: string) => void }
export class SessionStore implements SessionStoreApi { constructor(deps: SessionStoreDeps) }
// test/helpers/fake-client.ts
export class FakeClient implements CcrApi { sessions: WireSession[]; events: Map<string, WireEventRow[]>; sent: Map<string, StreamJsonEvent[]>; calls: string[]; failNext?: ApiError; push(sessionId, payload): void /* appends with next seq */ }
```

Behaviour:
- Poller: `start()` schedules `run` after `intervalMs(mode)`; each completed run schedules the next; errors call `onError` and double the delay (cap `maxBackoffMs`), success resets it; `setMode('background')` cancels the timer (no runs until a mode change or `kick`); `setMode` to a faster mode reschedules immediately with the new interval; `stop()` cancels; `kick()` runs now (if not already running) and resets backoff. Overlapping runs never happen.
- Store: `refreshSessions()` lists, maps with `summarizeSession` (keeping any cached `cwd`), sorts by `lastEventAt` desc, sets `sessions`; errors set `sessionsError` (message) and, for `ApiError.isAuth`, the banner `{kind:'auth', text:'Signed out. Sign in to see your sessions.'}`; for `isNetwork` the banner `{kind:'offline', text:'No connection. Retrying.'}`; a success clears those banners.
- `open(id)`: sets `selectedId`; if the transcript is empty, loads `listEvents(id, {limit: 200, sortOrder: 'desc'})`, reverses into ascending order, applies; starts the per-session Poller (mode from the transcript's turn: working/needs_input/sending -> active, else idle; background when `visible` is false); announces presence; marks read when visible; caches `cwd` from init.
- Each poll: `listEvents(id, {fromSequenceNum: lastSeq + 1, sortOrder: 'asc', limit: 200})`; apply; after applying, if any new `result` arrived emit `turn_end`, if the turn became `needs_input` emit `needs_input`; mark read when visible; mode follows the turn. If the server returns rows with seq <= lastSeq (ignored `from_sequence_num`), switch that session to the fallback `{sortOrder:'desc', limit: 50}` strategy for the rest of the session (reverse and apply; the reducer dedupes).
- `send(id, text, {images, contextText})`: builds blocks (text = `text` + (contextText ? `\n\n` + contextText : ''), then image blocks), `userMessagePayload`, `markSent` (display text = `text`, not the context), `sendEvents`, then `poller.setMode('active')` and `kick()`. On error: revert the optimistic item (remove it), set the banner `{kind:'error', text}` and rethrow.
- `respondPermission` / `answerQuestion` / `interrupt` / `setModel` / `setPermissionMode` build payloads from `src/api/payloads.ts`, send, `markControlSent` where applicable, kick. `answerQuestion` builds `updatedInput: { questions: <original questions from the item>, answers, ...(response ? {response} : {}) }` and `behavior: 'allow'`.
- `createSession(opts)`: `client.createSession({environment_id, title, session_context: {model?, permission_mode?}, events: firstMessage ? [{payload: userMessagePayload(firstMessage)}] : undefined})`, then refresh and return the summary. `rename`/`archive` call the client then refresh (optimistic title update first).
- `environments()`: group non-archived sessions by `environmentId`; `label` = last path segment of the cwd of any session in the group (`"yes-chef"`) plus kind (`"yes-chef (Mac)"` for bridge, `"cloud"` otherwise), `cwd`, `sessionCount`.
- `visible` signal: setting false moves the active poller to background and stops list polling; true kicks both.
- `loadOlder(id)`: `listEvents(id, {sortOrder: 'desc', limit: 200, page?})` using the smallest loaded seq: request `fromSequenceNum: max(0, firstSeq - 200)` with asc order and apply only rows with seq < firstSeq by prepending through a dedicated `prependEvents` path (implement in the store by rebuilding: `applyEvents(createTranscript(), olderRows.concat(existingRows))`). Returns false when no older rows came back.
- `dispose()` stops everything and clears presence.

- [ ] **Step 1: Write the failing tests.** `test/core/poller.test.ts` with fake timers (a manual `TimerApi` that collects callbacks and a `tick(ms)` helper): schedules at the mode interval; backs off on error (1x, 2x, 4x, cap); background stops; kick runs immediately and resets backoff; no overlapping runs when `run` is slow. `test/core/session-store.test.ts` with `FakeClient`: `refreshSessions maps and sorts`; `open loads history ascending and starts polling`; `open works without init`; `send appends an optimistic item then the echo replaces it`; `poll applies new events and emits turn_end`; `needs_input is emitted once per request`; `dedupes overlapping polls` (fake client returns an overlapping window; item count stays correct); `poll survives a 401` (FakeClient throws `ApiError(401)` once; the next poll succeeds; the banner is not set); `respondPermission sends a control_response with the request id`; `createSession posts the environment and first message`; `environments groups by environment and labels from cwd`; `visible false parks the poller`.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Implement** `poller.ts`, `fake-client.ts`, `session-store.ts`.
- [ ] **Step 4: Run the tests until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Add the session store and adaptive poller"`.

### Task A5: Context capture, context formatting, attachments, slash commands

**Files:**
- Create: `src/obsidian/context-capture.ts`, `src/core/context-format.ts`, `src/core/attachments.ts`, `src/core/slash-commands.ts`
- Test: `test/core/context-format.test.ts`, `test/core/attachments.test.ts`, `test/obsidian/context-capture.test.ts`

**Interfaces:**
- Consumes: `CapturedContext`, `OutgoingAttachment` (`src/core/types.ts`), `ContextSettings` (`src/settings.ts`), `ImageBlock` (`src/api/types.ts`), Obsidian `App`, `MarkdownView`, `TFile`, `Plugin`.
- Produces:

```ts
// src/core/context-format.ts
export function formatContextBlock(ctx: CapturedContext, opts: { vaultPathOnMac: string; sessionCwd?: string }): string; // '' when nothing to say
export function composeOutgoingText(userText: string, contextBlock: string): string; // userText + '\n\n' + block, or userText
// src/obsidian/context-capture.ts
export class ContextCapture { constructor(app: App, opts: { ownViewType: string }); install(plugin: Plugin): void; /* registers active-leaf-change */ readonly lastMarkdownView: MarkdownView | null; capture(settings: ContextSettings, mentions: string[]): CapturedContext; openMarkdownPaths(): string[] }
// src/core/attachments.ts
export async function prepareImage(file: Blob & { name?: string }, opts?: { maxEdge?: number /*1568*/; quality?: number /*0.85*/ }): Promise<OutgoingAttachment>;
export function attachmentsToBlocks(atts: OutgoingAttachment[]): ImageBlock[];
export function blobToBase64(blob: Blob): Promise<string>;
// src/core/slash-commands.ts
export interface SlashCommand { name: string; args?: string; description: string }
export const REMOTE_SLASH_COMMANDS: SlashCommand[]; // compact, clear, context, usage, recap, model <name>, effort <level>, fast, rename <title>, mcp, autocompact <size>
export function isSlashCommand(text: string): boolean;
export function filterSlashCommands(query: string): SlashCommand[];
```

Behaviour:
- `formatContextBlock` writes the block from the spec section 6, omitting lines whose data is missing; the `vault:` line carries the absolute path only when `sessionCwd` is undefined or differs from `vaultPathOnMac`; the selection is fenced with `"""` lines and ends with `[truncated]` when `truncated`.
- `ContextCapture.capture`: active note = `lastMarkdownView.file.path` (updated on `active-leaf-change` whenever the new leaf's view is a `MarkdownView`; the chat view never counts); selection from `editor.getSelection()` with `listSelections()[0]` for the line range (1-based, inclusive), truncated to `maxSelectionChars`; cursor line = `editor.getCursor().line + 1` when there is no selection and `includeCursor`; open notes from `openMarkdownPaths()` minus the active path, capped at `maxOpenNotes`; honours every `include*` flag and `enabled`.
- `prepareImage`: decode with `createImageBitmap` (fallback `new Image()` + object URL), scale so the long edge is at most `maxEdge`, draw to a canvas, export `image/jpeg` at `quality` (keep `image/png` when the source is PNG and smaller than 1 MB after scaling), return base64 without the data-url prefix, `width`, `height`, `bytes`. In jsdom, canvas is unavailable: the test mocks `createImageBitmap` and `HTMLCanvasElement.prototype.toBlob`.

- [ ] **Step 1: Write the failing tests.** `context-format.test.ts`: full block with everything; nothing -> ''; relative paths when `sessionCwd === vaultPathOnMac`; absolute vault line when `sessionCwd` differs; `format without session cwd` keeps the absolute path; truncated selection marker; `composeOutgoingText` joins with a blank line. `context-capture.test.ts` (with `test/mocks/obsidian.ts`): uses a fake `MarkdownView` with `file.path` and an editor returning a selection; respects flags; ignores the chat leaf; caps open notes. `attachments.test.ts`: `attachmentsToBlocks` shape; `blobToBase64` round trip; `prepareImage` downscale maths via the mocked canvas (a 4000x3000 input becomes 1568x1176). `slash-commands`: `isSlashCommand('/model x')` true, `'/ not'` false, `filterSlashCommands('mo')` returns model.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Implement the four modules.**
- [ ] **Step 4: Run the tests until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Add Obsidian context capture, formatting, image attachments, slash commands"`.

### Task A6: Mock Remote Control server and integration tests

**Files:**
- Create: `test/mock-ccr/server.mjs`, `test/mock-ccr/scenarios.mjs`, `test/mock-ccr/seed.mjs`, `test/mock-ccr/README.md`
- Test: `test/integration/client.integration.test.ts` (`// @vitest-environment node` at the top)

**Interfaces:**
- Consumes: `docs/protocol.md` shapes; `CcrClient` from Task A1 (if absent, the integration test is written against `CcrApi` and skipped with `describe.skip` until `src/api/client.ts` exists; leave a note); `fetchTransport` from `src/api/http.ts`.
- Produces: `node test/mock-ccr/server.mjs [--port N] [--static DIR] [--latency MS]` printing `MOCK_CCR http://127.0.0.1:N`; a programmatic export `startMockCcr({port, staticDir, latencyMs}) -> { url, close(), state, inject(sessionId, payload) }` (ESM; the file works both as CLI and import).

Behaviour (no dependencies, Node `http` only):
- Auth: every `/v1/...` request needs `Authorization: Bearer <token>`; tokens issued by the mock are `mock-access-<n>`; a request with `Bearer expired` returns 401 with the Anthropic envelope. `POST /v1/oauth/token`: `authorization_code` with `code === 'good'` -> tokens; otherwise 400 `invalid_grant`; `refresh_token` -> new tokens. `GET /api/oauth/profile` -> `{organization: {uuid: 'org-mock'}}`.
- Sessions (seeded by `seed.mjs`): `cse_vault` (bridge, cwd `/Users/kicooley-winters/workspace/projects/yes-chef`, idle, with a full history: init, a user message, an assistant reply, a result), `cse_ws` (bridge, cwd `/Users/kicooley-winters/workspace`, running, unread), `cse_cloud` (cloud kind), `cse_blocked` (bridge, `worker_status: requires_action`, history ending in an unanswered `can_use_tool` for Bash), `cse_old` (archived). `GET /v1/code/sessions` supports `?cursor=` pagination (page size 3); `GET/PUT /v1/code/sessions/{id}`, `/archive` (409 the second time), `/mark_read`, `/client/presence`, `GET /events` (`limit`, `sort_order`, `from_sequence_num`), `POST /events`, `POST /v1/code/sessions` (creates `cse_new<n>` in the given environment with an init event and, if `events` carries a user message, runs the scenario for it).
- Scenarios (`scenarios.mjs`), chosen by the text of each posted user message, each a list of `{afterMs, payload}` appended with increasing `sequence_num` and server-side `uuid`s, after echoing the user event first:
  - default: `stream_event` message_start, three `content_block_delta` text deltas, `assistant` text `Echo: <text>`, `result` success (`total_cost_usd: 0.01`, `duration_ms`).
  - starts with `tools`: assistant `tool_use` Read `{file_path: 'menus/latitude 10/menu.md'}`, user `tool_result` (`"# Menu\n..."`), assistant `tool_use` Edit `{file_path, old_string, new_string}`, user tool_result `"ok"`, assistant text, result.
  - starts with `perm`: `control_request` can_use_tool Bash `{command: 'rm -rf /tmp/x'}` with `permission_suggestions: [{type:'addRules', rules:[{toolName:'Bash', ruleContent:'rm -rf /tmp/*'}], behavior:'allow', destination:'localSettings'}]`; the server waits for a `control_response` with that `request_id`, then assistant text `Allowed, done.` or `Denied: <message>`, then result.
  - starts with `ask`: `control_request` can_use_tool AskUserQuestion with two questions (one multiSelect); after the response, assistant text listing the answers, result.
  - starts with `error`: assistant text, then `result` `error_during_execution` with `errors: ['boom']`, `is_error: true`.
  - starts with `slow`: ten `tool_progress` events 500 ms apart, then assistant text and result.
  - starts with `/`: user echo only, then a synthetic assistant text `Set model to x` and a `result` with `local_command`.
  - contains an image block: assistant text `I see 1 image (WxH)` using the block count.
- Admin: `POST /__mock/reset`, `GET /__mock/state`, `POST /__mock/fault` body `{once: 401|429|500|'network'}` applied to the next `/v1/code` request, `POST /__mock/inject` body `{sessionId, payload}`.
- `--static DIR` serves files from DIR at `/` (for the harness page), with `index.html` default.

- [ ] **Step 1: Write the failing integration test**: start the server on port 0 (random), build a `CcrClient` with `fetchTransport`, `getAccessToken: async () => 'mock-access-1'` (the seed issues it), assert: `listSessions()` returns five sessions across two pages; `listEvents('cse_vault', {sortOrder:'asc'})` begins with `system/init` and ends with `result`; `sendEvents('cse_vault', [userMessagePayload('hello')])` followed by polling `listEvents` with `fromSequenceNum` until a `result` arrives yields an assistant text `Echo: hello` within 3 s; `perm one` scenario blocks until a `permissionResponsePayload` is sent; `createSession` creates a session that appears in the list; the `401 once` fault makes the client refresh (count `onUnauthorized` calls) and still succeed.
- [ ] **Step 2: Run the test to see it fail.**
- [ ] **Step 3: Implement the server, scenarios, seed, README.**
- [ ] **Step 4: Run the test until green** (`npx vitest run test/integration`).
- [ ] **Step 5: Checks and commit**: `git commit -m "Add the mock Remote Control server and client integration tests"`.

### Task A7: Settings tab

**Files:**
- Create: `src/ui/SettingsTab.ts`
- Test: `test/ui/settings-tab.test.ts`

**Interfaces:**
- Consumes: `ClaudsidianSettings`, `DEFAULT_SETTINGS` (`src/settings.ts`); `AuthApi`; `SignInModal` (Task A2 signature `new SignInModal(app, auth, onDone)`); Obsidian `PluginSettingTab`, `Setting`, `Notice`.
- Produces:

```ts
export interface SettingsTabDeps { auth: AuthApi; getSettings: () => ClaudsidianSettings; save: (patch: Partial<ClaudsidianSettings>) => Promise<void>; environments: () => { id: string; label: string }[]; openSignIn: () => void; onChanged?: () => void }
export class ClaudsidianSettingTab extends PluginSettingTab { constructor(app: App, plugin: Plugin, deps: SettingsTabDeps); display(): void }
```

Sections and controls (each `Setting` with name and one-line description): **Account** (status line "Signed in as <email> (org <uuid first 8>)" or "Signed out"; button Sign in / Sign out; text field "Organization uuid" shown only when signed in and `orgUuid` is empty); **Mac host** (Vault path on the Mac; Default environment dropdown from `environments()` plus "First available"); **Defaults for new sessions** (model text field with placeholder "server default", permission mode dropdown default/acceptEdits/plan/auto); **Context** (enabled, active note, selection, cursor, open notes toggles; max selection chars slider 500..20000 step 500; max open notes slider 0..20); **Polling** (active ms 300..5000, idle ms 1000..30000, list ms 5000..120000); **Cooking mode** (default on toggle, font scale slider 1.0..1.6 step 0.1, quick replies textarea one per line); **Notifications** (toggle); **Display** (show costs, show thinking, show subagent traffic); **Advanced** (API base URL, client platform dropdown of the four values, debug log toggle, "Reset to defaults" button with a confirming second click).

- [ ] **Step 1: Write the failing test**: render the tab with fakes; assert the account line reads "Signed out" and the button text is "Sign in" when `auth.state` is null; with a state, "Signed in as k@x (org 12345678)" and "Sign out"; toggling cooking mode calls `save({cookingMode: true})`; the quick replies textarea round-trips lines; the reset button requires two clicks before saving defaults.
- [ ] **Step 2: Run the test to see it fail.**
- [ ] **Step 3: Implement the tab.**
- [ ] **Step 4: Run the test until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Add the settings tab"`.

### Task A8: Scripts, host setup, CI, release, docs

**Files:**
- Create: `scripts/install-to-vault.sh`, `scripts/dev.sh`, `scripts/version-bump.mjs`, `scripts/mac/claudsidian-rc.sh`, `scripts/mac/com.kicooley.claudsidian-rc.plist`, `scripts/mac/install-launchagent.sh`, `scripts/mac/uninstall-launchagent.sh`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `docs/host-setup.md`, `docs/testing.md`, `README.md`

**Interfaces:** none in code. `npm run install:vault` and `npm version` already point at these scripts (see `package.json`).

Behaviour:
- `install-to-vault.sh [--vault PATH]`: default vault `/Users/kicooley-winters/workspace/projects/yes-chef`; refuses when `main.js` is missing ("run npm run build first"); copies `main.js manifest.json styles.css` into `<vault>/.obsidian/plugins/claudsidian/`, creating the folder; prints what it did; exit non-zero on failure.
- `dev.sh`: `CLAUDSIDIAN_VAULT=<vault> node esbuild.config.mjs` (watch with auto-install).
- `version-bump.mjs`: reads `npm_package_version`, writes `manifest.json.version` and adds `versions.json[version] = manifest.minAppVersion`.
- `claudsidian-rc.sh`: resolves `claude` from `~/.local/bin/claude` then PATH; `cd "$VAULT"`; `exec claude remote-control --name "${RC_NAME:-yes-chef}" --permission-mode "${RC_PERMISSION_MODE:-auto}" --capacity "${RC_CAPACITY:-8}"`; before exec, checks `claude auth status` (or `claude --version`) and prints the three preconditions from the spec section 9 when it fails. Flags must be checked against `claude remote-control --help` on a logged-in shell; if `--capacity` or `--permission-mode` are rejected, drop them and document it.
- The plist: label `com.kicooley.claudsidian-rc`, `ProgramArguments` `[/bin/bash, <abs path to claudsidian-rc.sh>]`, `WorkingDirectory` the vault, `EnvironmentVariables` with `PATH=/Users/kicooley-winters/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` and `HOME`, `RunAtLoad true`, `KeepAlive true`, `ThrottleInterval 15`, `StandardOutPath` and `StandardErrorPath` `~/Library/Logs/claudsidian-rc.log`. The installer substitutes the absolute script path and vault into the plist (`sed`), copies it to `~/Library/LaunchAgents/`, runs `launchctl bootout gui/$(id -u)/com.kicooley.claudsidian-rc 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kicooley.claudsidian-rc.plist`, and tails the log for 5 s. The uninstaller boots it out and removes the plist.
- `ci.yml`: on pull_request and push to main: Node 22, `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, upload `main.js`/`styles.css` as artifacts. `release.yml`: on push to main and tags: build and `gh release create` with `manifest.json main.js styles.css` using the tag or `<version>-<sha>` (mirror the v1 workflow in `~/workspace/projects/claudsidian/.github/workflows/release.yml`, which BRAT already consumes).
- `docs/host-setup.md`: the Mac side: sign in (`claude auth login`), accept Remote Control once interactively (`claude remote-control` in the vault, Ctrl-C), install the LaunchAgent, verify in claude.ai/code, logs, how to stop, how new sessions get created from the plugin, caveat that `/effort` persists machine-wide.
- `docs/testing.md`: the five layers from the spec section 10 with the exact commands (`npm test`, `npm run mock-ccr`, `node e2e/run.mjs`, the Obsidian second-instance recipe, the live smoke checklist as a checkbox list).
- `README.md`: what it is, screenshots placeholder list, install (BRAT or vault copy), sign-in steps, how context works, cooking mode, settings overview, privacy note, unofficial-API caveat, development commands, license MIT.

- [ ] **Step 1: Write a shell test** `test/scripts/install-to-vault.test.ts` (`// @vitest-environment node`) that runs `bash scripts/install-to-vault.sh --vault <tmpdir>` with a fake `main.js` present and asserts the three files land, and that it exits 1 with the "build first" message when `main.js` is absent (run with `cwd` set to a temp copy of the repo root containing just the script and the files).
- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Write the scripts, workflows, and docs.** `bash -n` every script; `plutil -lint` the plist.
- [ ] **Step 4: Run the test until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Add install scripts, Mac host LaunchAgent, CI, release workflow, docs"`.

---

## Wave B (parallel, after Wave A is committed)

Wave B codes against the real Wave A modules. Tests use fakes (`test/helpers/fake-store.ts` implements `SessionStoreApi` over plain signals; `test/helpers/fake-facade.ts` implements `PluginFacade` with recording stubs). B1 owns both helper files; B2 and B3 use them (if B1 has not landed, write a minimal private copy under your own test folder and note it).

### Task B1: Chat screen

**Files:**
- Create: `src/ui/components/chat/ChatScreen.tsx`, `ChatHeader.tsx`, `Transcript.tsx`, `Composer.tsx`, `ContextChips.tsx`, `QuickReplies.tsx`, `use-scroll-pin.ts`, `items/UserMessage.tsx`, `items/AssistantText.tsx`, `items/ThinkingBlock.tsx`, `items/ToolCard.tsx`, `items/PermissionCard.tsx`, `items/QuestionCard.tsx`, `items/ResultFooter.tsx`, `items/SystemLine.tsx`, `items/ErrorLine.tsx`
- Create: `src/ui/components/common/Markdown.tsx`, `Icon.tsx`, `Button.tsx`, `Sheet.tsx`, `Banner.tsx`, `SuggestPopup.tsx`, `Spinner.tsx`
- Create: `src/styles/chat.css`, `src/styles/composer.css`, `src/styles/cards.css`
- Create: `test/helpers/fake-store.ts`, `test/helpers/fake-facade.ts`
- Test: `test/ui/chat/composer.test.tsx`, `test/ui/chat/permission-card.test.tsx`, `test/ui/chat/question-card.test.tsx`, `test/ui/chat/transcript.test.tsx`, `test/ui/chat/chat-screen.test.tsx`, `test/ui/chat/scroll-pin.test.ts`

**Interfaces:**
- Consumes: `SessionStoreApi`, `Environment`, `Banner` (`src/core/store-api.ts`); `PluginFacade` (`src/ui/facade.ts`); `TranscriptState`, `TranscriptItem` and friends (`src/core/types.ts`); `summarizeTool`, `toolCategory`, `editDiff` (`src/core/tool-summary.ts`); `formatContextBlock`, `composeOutgoingText` (`src/core/context-format.ts`); `prepareImage` (`src/core/attachments.ts`); `filterSlashCommands`, `isSlashCommand` (`src/core/slash-commands.ts`); `@preact/signals` (`useSignal`, `useComputed`, `.value`), Obsidian `setIcon` (through `Icon.tsx` only).
- Produces:

```tsx
export interface ChatScreenProps { store: SessionStoreApi; facade: PluginFacade; sessionId: string; onBack: () => void; onRename: () => void; onArchive: () => void }
export function ChatScreen(props: ChatScreenProps): JSX.Element;
export interface ComposerProps { facade: PluginFacade; working: boolean; disabled: boolean; cooking: boolean; draft: string; onDraftChange: (v: string) => void;
  onSend: (text: string, extras: { mentions: string[]; images: OutgoingAttachment[] }) => Promise<void>; onStop: () => void; onContextPreview: (mentions: string[]) => void }
export function Composer(props: ComposerProps): JSX.Element;
export interface ContextChipsProps { context: CapturedContext | null; enabled: ContextToggles; onToggle: (key: keyof ContextToggles) => void }
export type ContextToggles = { note: boolean; selection: boolean; cursor: boolean; open: boolean; mentions: boolean };
export function PermissionCard(p: { item: PermissionItem; cooking: boolean; onAllow: (remember: boolean) => void; onDeny: (message?: string) => void }): JSX.Element;
export function QuestionCard(p: { item: QuestionItem; cooking: boolean; onSubmit: (answers: Record<string, string | string[]>, response?: string) => void }): JSX.Element;
export function ToolCard(p: { item: ToolItem; facade: PluginFacade; compact: boolean; showSubagents: boolean }): JSX.Element;
export function Markdown(p: { source: string; facade: PluginFacade; sourcePath?: string }): JSX.Element; // renders via facade.renderMarkdown into a ref div; throttles to 10 renders/s while the source keeps changing
export function shouldPin(scrollTop: number, scrollHeight: number, clientHeight: number, threshold?: number /*80*/): boolean;
export function Banner(p: { banner: Banner | null }): JSX.Element | null;
export function SuggestPopup<T>(p: { items: T[]; render: (t: T) => string; onPick: (t: T) => void; onClose: () => void; anchor?: HTMLElement }): JSX.Element;
```

Behaviour:
- `ChatScreen` reads `store.transcript(sessionId).value`, `store.session(sessionId)`, `store.banner.value`, `facade.settings()` (cooking mode, showThinking, showCosts, showSubagentTraffic, quickReplies, context toggles). Layout: header, banner, transcript (scrolling region), pinned pending cards (unresolved permission/question items render above the composer, not only inline), context chips, composer, quick replies (cooking mode only).
- Header: back button, title (tap -> `onRename`), status pill from `state.turn` and the session's `connectionStatus` ("Working", "Needs you", "Idle", "Mac offline" when the connection status is not `connected`), chips for model and permission mode, overflow menu (`Sheet`): Rename, Model (prompt list: `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, plus "custom" text), Permission mode (default, acceptEdits, plan, auto), Effort (sends `/effort <level>` as a message), Open in claude.ai (`facade.openExternal('https://claude.ai/code/' + sessionId)`), Toggle cooking mode (`facade.saveSettings({cookingMode})`), Archive (`onArchive`).
- Composer: auto-growing textarea (max 40 vh), `Enter` sends on desktop and inserts a newline when `facade.isMobile`; `Shift+Enter` always inserts a newline; a Send button (disabled when empty and no images) that becomes Stop (calls `onStop`) while `working`; `@` opens `SuggestPopup` over `facade.vaultFiles()` filtered by the token after `@` (case-insensitive substring, max 8, basename first) and inserts `@<path> `, collecting mentions; `/` at position 0 opens the slash popup from `filterSlashCommands`; an attach button calls `facade.pickImages()` then `prepareImage` for each (thumbnail row with remove buttons, limit 4); paste of image files from the clipboard on desktop does the same; drafts persist through `onDraftChange`.
- Sending: `ChatScreen` builds the context from `facade.captureContext(mentions)` filtered by the chip toggles (chips default from settings; toggles are per screen instance), formats with `formatContextBlock(ctx, { vaultPathOnMac: settings.vaultPathOnMac, sessionCwd: state.init?.cwd })`, then `store.send(sessionId, text, { images, contextText })`. Slash commands (`isSlashCommand(text)`) send without context. Quick replies send their text without context.
- Transcript: renders items in order; `user` as a right-aligned bubble with an image count badge; `assistant_text` through `Markdown` (partial items get a blinking caret class); `thinking` collapsed with a "Thinking" toggle, hidden when `showThinking` is off; `tool` as `ToolCard` (compact in cooking mode); `permission`/`question` inline cards (resolved ones collapse to one line); `result` as `ResultFooter` (duration, cost when `showCosts`, error list); `system` muted line; `error` red line. The scrolling container uses `shouldPin` on scroll to decide auto-scroll; when not pinned and new items arrive, a "Jump to latest" pill appears. Each assistant text has a hover/long-press action row: Copy (`facade.copyToClipboard`), Insert at cursor (`facade.insertAtCursor`), New note (`facade.createNote('Claude/<title>.md', text)` then `facade.openFile`).
- `PermissionCard`: title from `summarizeTool`, body by tool: Bash -> command in a code block; Edit -> old/new blocks from `editDiff`; Write -> path and first 20 lines; others -> pretty JSON (collapsed over 12 lines). Buttons: Allow; Allow and remember (only when `item.suggestions.length > 0`; passes `remember=true` and the caller echoes the suggestions); Deny (reveals an optional reason field and a confirm). In cooking mode the buttons are full-width and 56 px tall.
- `QuestionCard`: for each question, the header and text, options as toggle buttons (single or multi), an "Other" text field; "Send answers" is enabled once every question has an answer; `onSubmit(answers)` where multi-select answers join with ", ".
- `ToolCard`: one line with a category icon, `summarizeTool`, status (spinner, check, cross); expands to show the input (specialised like the permission card) and the result (`pre`, 4000 chars then "Show more"); children render nested and collapsed when `showSubagents` is false (a "n subagent events" line instead).

- [ ] **Step 1: Write the failing tests.** `composer.test.tsx`: `composer enter behaviour` (desktop Enter calls `onSend`; mobile Enter inserts a newline and does not send; Shift+Enter inserts a newline on both); send button disabled when empty; typing `@men` shows the popup with matches from `facade.vaultFiles()` and picking inserts `@menus/latitude 10/menu.md `; typing `/mo` shows the slash popup; Stop appears when `working`. `permission-card.test.tsx`: Bash command rendered; Allow calls `onAllow(false)`; remember button absent without suggestions and calls `onAllow(true)` with them; Deny with a reason calls `onDeny('reason')`. `question-card.test.tsx`: builds the answers record, multi-select joins, submit disabled until complete, "Other" text used verbatim. `transcript.test.tsx`: renders one element per item kind; tool results shown inside the tool card; thinking hidden when `showThinking` is false; pending cards pinned above the composer. `chat-screen.test.tsx`: sending appends the context block (fake facade returns a context with an active note and selection; assert the `contextText` passed to the fake store contains `active note:` and the selection); a slash command sends with no context; header shows "Needs you" when the transcript turn is `needs_input`; "Mac offline" when the session's `connectionStatus` is `disconnected`. `scroll-pin.test.ts`: `shouldPin` thresholds.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Implement the components and styles.** Load the `frontend-design` skill before styling; keep the look quiet and native to Obsidian: the accent colour only on primary actions and the working indicator; cards use `--background-secondary` with `--radius-m`; type scale from Obsidian's `--font-ui-*` variables; cooking mode scales via a CSS variable `--claudsidian-scale` set on the root.
- [ ] **Step 4: Run the tests until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Add the chat screen: transcript, composer, context chips, permission and question cards"`.

### Task B2: Sessions screen

**Files:**
- Create: `src/ui/components/sessions/SessionsScreen.tsx`, `SessionGroup.tsx`, `SessionRow.tsx`, `StatusDot.tsx`, `NewSessionSheet.tsx`, `EmptyState.tsx`, `SignedOutCard.tsx`
- Create: `src/styles/sessions.css`, `src/util/time.ts`
- Test: `test/ui/sessions/sessions-screen.test.tsx`, `test/ui/sessions/new-session-sheet.test.tsx`, `test/util/time.test.ts`

**Interfaces:**
- Consumes: `SessionStoreApi`, `Environment`, `CreateSessionOptions`; `PluginFacade`; `SessionSummary`; `Sheet`, `Button`, `Icon`, `Spinner`, `Banner` from `src/ui/components/common/` (Task B1; if absent at the time, create private equivalents under `src/ui/components/sessions/` and note it).
- Produces:

```tsx
export interface SessionsScreenProps { store: SessionStoreApi; facade: PluginFacade; onOpen: (id: string) => void; onRename: (id: string) => void; onArchive: (id: string) => void }
export function SessionsScreen(props: SessionsScreenProps): JSX.Element;
export function groupSessions(sessions: SessionSummary[], vaultPathOnMac: string, showArchived: boolean): { title: string; sessions: SessionSummary[] }[]; // "This vault", "Other local", "Cloud", "Archived"
export function NewSessionSheet(p: { store: SessionStoreApi; facade: PluginFacade; onCreated: (id: string) => void; onClose: () => void }): JSX.Element;
export function SignedOutCard(p: { facade: PluginFacade }): JSX.Element;
export function relativeTime(epochMs: number | undefined, now: number): string; // "just now", "4m", "3h", "yesterday", "Oct 3", "" for undefined
export function statusOf(s: SessionSummary): 'working' | 'needs_you' | 'idle' | 'offline';
```

Behaviour:
- `statusOf`: `connectionStatus !== 'connected'` -> offline; `workerStatus === 'requires_action'` or `summary.needsAction` non-empty -> needs_you; `workerStatus === 'running'` -> working; else idle.
- `groupSessions`: "This vault" when `cwd` starts with `vaultPathOnMac` (or when cwd is unknown and the environment's label matches the vault folder name); other `bridge` sessions -> "Other local"; everything else -> "Cloud"; archived sessions only in "Archived" when `showArchived`. Within a group, needs_you first, then by `lastEventAt` desc.
- Screen: a toolbar with "New" (opens `NewSessionSheet`), a refresh button (`store.refreshSessions()`), a "Show archived" toggle; `Banner`; groups; `EmptyState` when there are no sessions; `Spinner` while `sessionsLoading` and the list is empty. Rows: `StatusDot`, title (bold when unread), relative time, one summary line (`needsAction` first, then `detail` or `recentAction`), a trailing "..." button opening a `Sheet` with Rename, Archive, Open in claude.ai (`facade.openExternal`). Tapping a row calls `onOpen(id)`. On mount: `store.refreshSessions()` and `store.startListPolling()`; on unmount `stopListPolling()`.
- `NewSessionSheet`: environment select from `store.environments()` (bridge environments first; preselect `settings.defaultEnvironmentId`, else the environment whose `cwd` equals `settings.vaultPathOnMac`, else the first bridge one); title input; first message textarea (optional); model input with placeholder "server default" prefilled from `settings.defaultModel`; permission mode select from `settings.defaultPermissionMode`; Create button calls `store.createSession` then `onCreated(id)`; errors render the message under the button; no environments -> an explanation that the Mac server is not running with a link to the host doc text.
- `SignedOutCard`: a short explanation and a "Sign in" button calling `facade.signIn()`.

- [ ] **Step 1: Write the failing tests.** `time.test.ts`: the five formats. `sessions-screen.test.tsx`: grouping with three sessions (vault cwd, workspace cwd, cloud) plus an archived one hidden by default; a `requires_action` session renders "Needs you" first in its group; tapping a row calls `onOpen`; the "..." sheet calls `onRename`/`onArchive`; refresh calls `store.refreshSessions`; mount starts list polling. `new-session-sheet.test.tsx`: preselects the vault environment; Create calls `store.createSession` with `{environmentId, title, firstMessage, model, permissionMode}` and then `onCreated`; a rejected create shows the error text.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Implement the components, styles, and `time.ts`.**
- [ ] **Step 4: Run the tests until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Add the sessions screen and new session sheet"`.

### Task B3: Shell: plugin entry, view host, facade implementation, modals, notifications, base styles

**Files:**
- Rewrite: `src/main.ts`, `src/ui/ChatView.ts`, `src/ui/components/Root.tsx`, `src/styles/base.css`, `src/styles/index.css`
- Create: `src/obsidian/facade-impl.ts`, `src/obsidian/notifications.ts`, `src/ui/modals/QuickAskModal.ts`, `src/ui/modals/RenameModal.ts`, `src/ui/modals/ConfirmModal.ts`, `src/styles/mobile.css`, `src/styles/cooking.css`
- Test: `test/ui/root.test.tsx`, `test/obsidian/facade-impl.test.ts`, `test/obsidian/notifications.test.ts`

**Interfaces:**
- Consumes: everything from Wave A (`CcrClient`, `AuthManager`, `SessionStore`, `ContextCapture`, `ClaudsidianSettingTab`, `SignInModal`), `ChatScreen` (B1), `SessionsScreen`, `NewSessionSheet`, `SignedOutCard` (B2), `PluginFacade`, `obsidianTransport`.
- Produces:

```ts
export default class ClaudsidianPlugin extends Plugin { settings; auth: AuthManager; client: CcrClient; store: SessionStore; capture: ContextCapture; activateView(sessionId?: string): Promise<WorkspaceLeaf | null>; saveSettings(patch?): Promise<void> }
export class ObsidianFacade implements PluginFacade { constructor(plugin: ClaudsidianPlugin, component: Component) }
export function Root(p: { store: SessionStoreApi; facade: PluginFacade; onRename: (id: string) => void; onArchive: (id: string) => void }): JSX.Element;
export class QuickAskModal extends Modal { constructor(app: App, plugin: ClaudsidianPlugin, selection: string) }
export class RenameModal extends Modal { constructor(app: App, initial: string, onSubmit: (title: string) => void) }
export class ConfirmModal extends Modal { constructor(app: App, text: string, confirmLabel: string, onConfirm: () => void) }
export class Notifications { constructor(store: SessionStoreApi, opts: { enabled: () => boolean; isViewVisible: () => boolean; sessionTitle: (id: string) => string; notice: (text: string) => void }); dispose(): void }
```

Behaviour:
- `main.ts` composition: `AuthManager` with `load: () => this.settings.auth`, `save: async (s) => { this.settings.auth = s; await this.saveSettings(); }`, URLs from settings, `transport: obsidianTransport`. `CcrClient` with `getAccessToken: () => this.auth.getAccessToken()`, `onUnauthorized: async () => { try { await this.auth.refresh(); return true; } catch { return false; } }`, `orgUuid`, `clientPlatform`, `userAgent: 'claudsidian/' + manifest.version`. `SessionStore` with `clientId` persisted in settings? Use `settings.lastSessionId`'s sibling: add `clientId` to settings if missing (additive change to `src/settings.ts`: `clientId: string` default `''`; generate with `uuidv4()` on first load and save). Commands: `open`, `new-session` (open view then show the sheet via a store-adjacent signal `plugin.ui.showNewSession.value = true`), `ask-selection` (editorCallback: selection -> `QuickAskModal`), `send-current-note` (sends "Look at this note." with the context forced to the active note), `insert-last-reply` (last assistant text of the selected session at the cursor), `toggle-cooking`, `sign-in`, `sign-out`. Editor menu item "Ask Claude about selection" when a selection exists. Protocol handler `claudsidian` (`obsidian://claudsidian?session=<id>` -> `activateView(id)` then `store.open(id)`). Ribbon: `addRibbonIcon('bot', ...)` keeping the element; a `.claudsidian-ribbon-dot` child toggled when `store.on('needs_input')` fires and cleared when that session is opened. Settings tab from Task A7 with `openSignIn` opening `SignInModal`. `onunload`: `store.dispose()`, notifications dispose, detach leaves of the view type.
- `ChatView`: builds `ObsidianFacade(plugin, this)`; renders `<Root>`; `onOpen` sets `store.visible.value = true` and opens `settings.lastSessionId` when set and the session exists; `onClose` sets `visible` false and calls `store.close()`; registers `document` `visibilitychange` (hidden -> visible false) and `workspace.on('layout-change')` (visible = the leaf is the active leaf in its split or the view is shown on mobile: `this.containerEl.isShown()`); toggles classes `is-mobile` (`Platform.isMobile`), `is-phone` (`Platform.isPhone`), `is-cooking` on `contentEl`; applies `--claudsidian-scale` from `settings.cookingFontScale` when cooking; calls `facade.setWakeLock(cooking && visible)`.
- `Root`: a `signedIn` signal updated via `facade.auth.onChange`; signed out -> `SignedOutCard`; otherwise `selectedId` null -> `SessionsScreen` (with the new-session sheet toggled by a signal exposed as `plugin.ui.showNewSession`), else `ChatScreen`; `onBack` -> `store.close()`; `onRename` -> `RenameModal` then `store.rename`; `onArchive` -> `ConfirmModal` then `store.archive` and `store.close()` when it was the open session; persists `lastSessionId` on open.
- `ObsidianFacade`: `renderMarkdown` -> `MarkdownRenderer.render(app, md, el, sourcePath ?? '', component)`; `captureContext` -> `plugin.capture.capture(settings.context, mentions)`; `vaultFiles` -> markdown file paths sorted; `openFile` -> `workspace.openLinkText(path, '', false)`; `insertAtCursor` -> active `MarkdownView` editor `replaceRange(text, cursor)` (false when no editor); `replaceSelection`; `createNote` -> `vault.create(uniquePath, content)` returning the path (suffix ` 2`, ` 3` on collisions); `copyToClipboard` -> `navigator.clipboard.writeText` with a textarea fallback; `openExternal` -> `window.open(url, '_blank')`; `notice` -> `new Notice(text, timeoutMs)`; `pickImages` -> hidden `<input type="file" accept="image/*" multiple>`; `signIn` -> `SignInModal` resolving its `onDone`; `setWakeLock` -> `navigator.wakeLock?.request('screen')`, releasing on false, swallowing errors.
- `Notifications`: subscribes to `turn_end` ("<title>: finished") and `needs_input` ("<title>: needs you") and shows a notice only when `enabled()` and not `isViewVisible()`; dedupes the same session+event within 5 s.
- Styles: `base.css` (root flex layout, scale variable, spacing tokens), `mobile.css` (`.is-mobile`: larger paddings, composer sticky at the bottom with `padding-bottom: env(safe-area-inset-bottom)`, hide hover-only actions and show long-press/row actions instead), `cooking.css` (`.is-cooking`: `font-size: calc(var(--font-ui-medium) * var(--claudsidian-scale))`, 48 px targets, quick replies row, compact tool lines). `index.css` imports base, sessions, chat, composer, cards, mobile, cooking.

- [ ] **Step 1: Write the failing tests.** `root.test.tsx`: signed out renders `SignedOutCard`; signed in with no selection renders the sessions screen; with a selection renders the chat screen; sign-in change re-renders. `facade-impl.test.ts` (with `test/mocks/obsidian.ts`): `createNote` picks a unique path; `insertAtCursor` returns false without an editor; `vaultFiles` returns sorted paths. `notifications.test.ts`: fires a notice only when hidden and enabled; dedupes within 5 s.
- [ ] **Step 2: Run the tests to see them fail.**
- [ ] **Step 3: Implement**, then `npm run build` and load the plugin in a throwaway vault if one is reachable (`scripts/install-to-vault.sh --vault <path>`); otherwise rely on the harness (Task B4).
- [ ] **Step 4: Run the tests until green.**
- [ ] **Step 5: Checks and commit**: `git commit -m "Wire the plugin shell: entry, view host, facade, modals, notifications"`.

### Task B4: Browser e2e harness

**Files:**
- Create: `e2e/harness/obsidian-shim.ts`, `e2e/harness/index.html`, `e2e/harness/harness.css`, `e2e/harness/main.ts`, `e2e/harness/build.mjs`, `e2e/cdp/driver.mjs`, `e2e/cdp/scenarios/01-signed-out.mjs`, `02-sessions-list.mjs`, `03-chat-send-reply.mjs`, `04-tools.mjs`, `05-permission.mjs`, `06-question.mjs`, `07-new-session.mjs`, `08-cooking-mode.mjs`, `09-error-banner.mjs`, `e2e/run.mjs`, `e2e/README.md`

**Interfaces:**
- Consumes: the plugin entry `src/main.ts` (default export), `src/styles/index.css`, `test/mocks/dom-helpers.ts` (`installDomHelpers`), the mock server `test/mock-ccr/server.mjs` (`startMockCcr`), Playwright (`playwright` devDependency; browsers in `.pw-browsers`, env `PLAYWRIGHT_BROWSERS_PATH`).
- Produces: `node e2e/run.mjs [--profile ipad-landscape|ipad-portrait|phone|desktop-sidebar|all] [--scenario NN] [--browser playwright|chrome] [--headed]` writing `e2e/out/<scenario>-<profile>.png` and `e2e/out/report.json` (`[{scenario, profile, ok, steps: [{name, ok, detail}]}]`), exit code 1 on any failure.

Behaviour:
- `obsidian-shim.ts` implements, with the same names as the real module, what `src/` imports: `Plugin`, `ItemView`, `Modal` (renders into a `.modal-container` overlay in the page), `Notice` (toast in `#notices`), `PluginSettingTab`, `Setting` and its components (real inputs), `Platform` (from `?platform=mobile|desktop`), `MarkdownRenderer.render` (via `marked`, sanitising by rendering into a detached element and copying text nodes and basic tags), `requestUrl` (via `fetch` to the given URL; returns `{status, headers, text, json}`; never throws on status when `throw` is false), `normalizePath`, `setIcon` (inserts the icon name as a `data-icon` attribute and a small glyph), `TFile`, `TFolder`, `WorkspaceLeaf`, `Workspace` with `getActiveViewOfType(MarkdownView)` returning the harness editor (a `textarea` wrapper exposing `getSelection`, `listSelections`, `getCursor`, `replaceRange`, `replaceSelection`, `getLine`, `lineCount`) and `on('active-leaf-change')`, `Vault` with three fake markdown files, `App`, `Component`, `Events`, `Menu`, `AbstractInputSuggest`, `MarkdownView`, `moment`-like helper. `installDomHelpers()` runs at import.
- `index.html` lays out a left editor pane (a sample note with a preselected range and buttons "Select lines 3-5", "Clear selection", "Switch note") and a right pane `#sidebar` sized by `?profile=` (`ipad-landscape` 420 px wide sidebar in a 1194x834 page, `ipad-portrait` full width 834x1194 with the editor hidden behind a tab, `phone` 390x844 full width, `desktop-sidebar` 420 px in 1440x900). `main.ts` constructs `App`, `ClaudsidianPlugin(app, manifest)`, calls `onload()`, seeds settings (`apiBaseUrl` = page origin, `auth` = a fake signed-in state unless `?signedout=1`, `vaultPathOnMac` = the mock vault path, `clientId`), opens the view into `#sidebar`, and exposes `window.__claudsidian = { app, plugin, view, store: plugin.store }`.
- `build.mjs`: esbuild bundle of `e2e/harness/main.ts` with `alias: { obsidian: './e2e/harness/obsidian-shim.ts' }`, `format: 'esm'`, `platform: 'browser'`, `jsxImportSource: 'preact'`, CSS of `src/styles/index.css` and `harness.css`, output `e2e/harness/dist/`.
- `driver.mjs`: one `Driver` class over Playwright's page when available (`driver.click(sel)`, `type(sel, text)`, `press(key)`, `waitFor(sel|fn, ms)`, `eval(fn)`, `screenshot(name)`, `setProfile(profile)`) and the same methods over raw CDP (`Runtime.evaluate`, `Input.dispatchKeyEvent`, `Page.captureScreenshot`, `Emulation.setDeviceMetricsOverride`) when `--browser chrome`: open a tab with `GET http://127.0.0.1:9222/json/new?<url>` and close it with `/json/close/<id>` at the end, always, including on failure.
- Scenarios (each exports `async function run(d, ctx)` and uses `ctx.mock` to reset or inject): 01 signed out shows the sign-in card and the modal opens with a URL field; 02 the sessions list shows the three groups with the vault session first and the blocked session marked "Needs you"; 03 open the vault session, type "hello", send, the user bubble appears immediately, "Echo: hello" arrives within 5 s, the context chips showed the active note and the message sent carried `[Obsidian context]` (assert via `ctx.mock.state`); 04 "tools one" shows two tool cards that expand to show input and result; 05 "perm one" shows a permission card, Allow sends a control_response and "Allowed, done." arrives; 06 "ask one" shows a question card, answering sends the answers and the reply lists them; 07 New session sheet creates a session in the vault environment and opens it; 08 toggle cooking mode: quick replies visible, tap targets at least 48 px, screenshot; 09 `POST /__mock/fault {once: 'network'}` then a send shows the error banner and recovers.
- `run.mjs` runs the chosen scenarios across the chosen profiles, prints a summary table, writes `report.json` and screenshots. `e2e/README.md` documents flags, profiles, and how to add a scenario.

- [ ] **Step 1: Write `e2e/run.mjs` with scenario 01 only and run it** (`node e2e/run.mjs --scenario 01 --profile phone`): it fails until the shim and build exist.
- [ ] **Step 2: Implement the shim, page, build, driver.** Get scenario 01 green on Playwright (`PLAYWRIGHT_BROWSERS_PATH=.pw-browsers`).
- [ ] **Step 3: Add scenarios 02 to 09**, running each as it lands. When a scenario exposes a plugin bug, record it in `e2e/out/report.json` and in your report; do not patch files outside `e2e/` (Wave C fixes them).
- [ ] **Step 4: Run everything across all profiles**: `node e2e/run.mjs --profile all`.
- [ ] **Step 5: Checks and commit**: `git commit -m "Add the browser e2e harness with an Obsidian shim and CDP driver"`.

---

## Wave C (integration, review, ship; orchestrator-driven)

### Task C1: Integrate
- [ ] `npm run check` on the merged tree; fix mismatches between tasks (names, props, missing exports) with the smallest edits; rerun.
- [ ] `node e2e/run.mjs --profile all`; fix every plugin bug the report lists; rerun until green.
- [ ] Review each screenshot (all four profiles) and fix layout defects: overflow, unreadable contrast in dark and light, tap targets, keyboard overlap at the phone profile.
- [ ] Commit: `git commit -m "Integrate waves A and B; harness green on all profiles"`.

### Task C2: Review
- [ ] Three reviewers over the whole tree: correctness (reducer and store edge cases, polling races, token refresh), security and privacy (token handling, markdown rendering of untrusted content, no secrets in logs, CSP-safe DOM), mobile UX (iOS WebView constraints: no `window.prompt`, clipboard fallbacks, file picker, wake lock, safe areas). Each reports findings with file and line; fix the confirmed ones; rerun `npm run check` and the harness.

### Task C3: Real Obsidian
- [ ] Try a second Obsidian instance: `/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=<scratch>/obsidian-profile --remote-debugging-port=9333` with a throwaway vault seeded with the plugin (the profile's `obsidian.json` lists the vault as open). Through CDP: enable the plugin, open the view, `app.emulateMobile(true)`, screenshot, run scenario 03 against the mock server by pointing `apiBaseUrl` at it. If the second instance refuses to start, record why in `docs/testing.md` and rely on the harness.

### Task C4: Host and live smoke
- [ ] Verify `claude remote-control --help` flags on a logged-in shell (ask Ki to run `claude remote-control --help` or read `~/.claude/debug` logs) and correct `scripts/mac/claudsidian-rc.sh`.
- [ ] Install the plugin into the yes-chef vault (`npm run build && npm run install:vault`) and ask Ki for the one-time sign-in in desktop Obsidian.
- [ ] Run the live checklist from `docs/testing.md`; fix what fails; record the verified request and response shapes in `docs/protocol.md` ("verified" notes) and update fixtures from real event dumps with tokens stripped.

### Task C5: Ship
- [ ] Push the `v1` branch of the old repo, then force-push `main` from this repo to `ki-cooley/claudsidian`; confirm the release workflow produced a release with the three files; confirm BRAT sees it.
- [ ] Rename directories: `projects/claudsidian` -> `projects/claudsidian-v1`, `projects/claudsidian-v2` -> `projects/claudsidian`; update the memory file and the yes-chef task list.

## Self-review notes

- Spec coverage: section 4 (A1, A2, A4, A6), 5 (A3), 6 (A5, B1), 7 (B1, B2, B3), 8 (B3), 9 (A8), 10 (A6, B4, C3, C4), 11 (A2, B1 Markdown through Obsidian's renderer, log redaction), 12 (A1 feature detection, A4 fallback polling, B2 environment-less state).
- Names used across tasks match the contract files; where a task needs a field the contracts lack (`clientId` in settings), the plan says to add it additively and report it.
- Review Focus items are pinned to A3, A4, A5, A1, B1, and B4 tests.
