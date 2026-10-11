// Unit tests for AuthManager (src/api/auth.ts) against an inline recording transport.
import { describe, expect, it, vi } from 'vitest';
import { AuthManager } from '../../src/api/auth';
import type { AuthState } from '../../src/api/auth-types';
import { ApiError } from '../../src/api/errors';
import { makeResponse } from '../../src/api/http';
import type { HttpRequest, HttpResponse } from '../../src/api/http';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function deps(overrides: Partial<ConstructorParameters<typeof AuthManager>[0]> = {}) {
  let stored: AuthState | null = null;
  const calls: Call[] = [];
  const saves: (AuthState | null)[] = [];
  const transport = async (req: HttpRequest): Promise<HttpResponse> => {
    calls.push({
      url: req.url,
      method: req.method,
      body: typeof req.body === 'string' ? JSON.parse(req.body) : req.body,
      headers: req.headers ?? {},
    });
    if (req.url.endsWith('/token')) {
      return makeResponse(
        200,
        {},
        JSON.stringify({
          access_token: 'A2',
          refresh_token: 'R2',
          expires_in: 3600,
          scope: 'user:profile user:sessions:claude_code',
          organization: { uuid: 'org-9' },
        }),
      );
    }
    if (req.url.endsWith('/profile')) return makeResponse(200, {}, JSON.stringify({ organization: { uuid: 'org-9' } }));
    return makeResponse(404, {}, '');
  };
  const d = {
    transport,
    load: () => stored,
    save: async (s: AuthState | null) => {
      stored = s;
      saves.push(s);
    },
    tokenUrl: 'https://t/token',
    authorizeUrl: 'https://a/authorize',
    profileUrl: 'https://p/profile',
    timers: {
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
      clearTimeout: () => {},
      now: () => 1_000_000,
    },
    ...overrides,
  };
  return {
    d,
    calls,
    saves,
    get stored() {
      return stored;
    },
  };
}

describe('AuthManager', () => {
  it('starts signed out and throws ApiError 401 from getAccessToken', async () => {
    const { d } = deps();
    const auth = new AuthManager(d);
    expect(auth.isSignedIn()).toBe(false);
    expect(auth.state).toBeNull();
    expect(auth.orgUuid()).toBeUndefined();
    const err = await auth.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('beginSignIn returns an authorize url carrying the state and a S256 challenge', async () => {
    const { d } = deps();
    const auth = new AuthManager(d);
    const { url, state } = await auth.beginSignIn();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://a/authorize');
    expect(u.searchParams.get('state')).toBe(state);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    expect(u.searchParams.get('redirect_uri')).toBe('https://platform.claude.com/oauth/code/callback');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('completes sign-in: exchanges the code with the verifier and persists state', async () => {
    const { d, calls, saves } = deps();
    const auth = new AuthManager(d);
    const cb = vi.fn();
    auth.onChange(cb);
    const { state } = await auth.beginSignIn();
    const s = await auth.completeSignIn(`code-1#${state}`);
    expect(s.accessToken).toBe('A2');
    expect(s.refreshToken).toBe('R2');
    expect(s.orgUuid).toBe('org-9');
    expect(s.scopes).toEqual(['user:profile', 'user:sessions:claude_code']);
    expect(s.clientId).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    expect(s.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(calls.length).toBe(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://t/token');
    expect(calls[0]!.body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code-1',
      state,
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      redirect_uri: 'https://platform.claude.com/oauth/code/callback',
    });
    expect((calls[0]!.body as { code_verifier: string }).code_verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(calls[0]!.headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(calls[0]!.headers['Content-Type'] ?? calls[0]!.headers['content-type']).toBe('application/json');
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.state).toEqual(s);
    expect(auth.orgUuid()).toBe('org-9');
    expect(saves).toEqual([s]);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(s);
  });

  it('accepts a bare code when the paste carries no state', async () => {
    const { d, calls } = deps();
    const auth = new AuthManager(d);
    await auth.beginSignIn();
    const s = await auth.completeSignIn('code-2');
    expect(s.accessToken).toBe('A2');
    expect(calls[0]!.body).toMatchObject({ grant_type: 'authorization_code', code: 'code-2' });
  });

  it('falls back to the profile endpoint for the org uuid and tolerates its failure', async () => {
    const base = deps();
    const calls = base.calls;
    const transport = async (req: HttpRequest): Promise<HttpResponse> => {
      calls.push({ url: req.url, method: req.method, body: req.body, headers: req.headers ?? {} });
      if (req.url.endsWith('/token')) {
        return makeResponse(
          200,
          {},
          JSON.stringify({ access_token: 'A3', refresh_token: 'R3', expires_in: 10, account: { uuid: 'acc-1', email_address: 'k@x' } }),
        );
      }
      if (req.url.endsWith('/profile')) return makeResponse(200, {}, JSON.stringify({ organization: { uuid: 'org-p' } }));
      return makeResponse(404, {}, '');
    };
    const auth = new AuthManager({ ...base.d, transport });
    await auth.beginSignIn();
    const s = await auth.completeSignIn('c');
    expect(s.orgUuid).toBe('org-p');
    expect(s.accountUuid).toBe('acc-1');
    expect(s.email).toBe('k@x');
    expect(s.scopes).toEqual([]);
    const profile = calls.find((c) => c.url.endsWith('/profile'))!;
    expect(profile.method).toBe('GET');
    expect(profile.headers['Authorization'] ?? profile.headers['authorization']).toBe('Bearer A3');

    const failing = async (req: HttpRequest): Promise<HttpResponse> => {
      if (req.url.endsWith('/token')) {
        return makeResponse(200, {}, JSON.stringify({ access_token: 'A4', refresh_token: 'R4', expires_in: 10 }));
      }
      throw new ApiError({ status: 0, message: 'Network error: offline' });
    };
    const auth2 = new AuthManager({ ...deps().d, transport: failing });
    await auth2.beginSignIn();
    const s2 = await auth2.completeSignIn('c');
    expect(s2.accessToken).toBe('A4');
    expect(s2.orgUuid).toBeUndefined();
    expect(auth2.isSignedIn()).toBe(true);
  });

  it('rejects a state mismatch without calling the token endpoint', async () => {
    const { d, calls } = deps();
    const auth = new AuthManager(d);
    await auth.beginSignIn();
    const err = await auth.completeSignIn('code#wrong').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toMatch(/state/i);
    expect(calls.length).toBe(0);
    expect(auth.isSignedIn()).toBe(false);
  });

  it('rejects an empty paste and a completeSignIn without beginSignIn', async () => {
    const { d, calls } = deps();
    const auth = new AuthManager(d);
    await expect(auth.completeSignIn('code')).rejects.toBeInstanceOf(ApiError);
    await auth.beginSignIn();
    await expect(auth.completeSignIn('   ')).rejects.toBeInstanceOf(ApiError);
    expect(calls.length).toBe(0);
  });

  it('surfaces the token endpoint error verbatim and stays signed out', async () => {
    const { d } = deps({
      transport: async () =>
        makeResponse(400, {}, JSON.stringify({ error: { type: 'invalid_grant', message: 'Invalid authorization code' } })),
    });
    const auth = new AuthManager(d);
    await auth.beginSignIn();
    const err = await auth.completeSignIn('bad').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).errorType).toBe('invalid_grant');
    expect((err as ApiError).message).toContain('Invalid authorization code');
    expect(auth.isSignedIn()).toBe(false);
  });

  it('returns the stored token when it is still good for more than five minutes', async () => {
    const { d, calls } = deps({
      load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 1_000_000 + 300_001, scopes: [], clientId: 'c' }),
    });
    const auth = new AuthManager(d);
    expect(auth.isSignedIn()).toBe(true);
    expect(await auth.getAccessToken()).toBe('A1');
    expect(calls.length).toBe(0);
  });

  it('refreshes when the token expires within five minutes and shares one in-flight refresh', async () => {
    const { d, calls } = deps({
      load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 1_000_000 + 60_000, scopes: [], clientId: 'c', orgUuid: 'org-9' }),
    });
    const auth = new AuthManager(d);
    const cb = vi.fn();
    auth.onChange(cb);
    const [t1, t2] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    expect(t1).toBe('A2');
    expect(t2).toBe('A2');
    expect(calls.filter((c) => c.url.endsWith('/token')).length).toBe(1);
    expect(calls[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'R1', client_id: 'c' });
    expect(calls[0]!.headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(auth.state?.refreshToken).toBe('R2');
    expect(auth.state?.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(auth.state?.refreshedAt).toBe(1_000_000);
    expect(auth.state?.orgUuid).toBe('org-9');
    expect(cb).toHaveBeenCalledTimes(1);
    // no profile lookup when the org uuid is already known
    expect(calls.some((c) => c.url.endsWith('/profile'))).toBe(false);
  });

  it('keeps the previous refresh token when the response omits one', async () => {
    const { d } = deps({
      load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, scopes: ['x'], clientId: 'c' }),
      transport: async () => makeResponse(200, {}, JSON.stringify({ access_token: 'A5', expires_in: 100 })),
    });
    const auth = new AuthManager(d);
    const s = await auth.refresh();
    expect(s.accessToken).toBe('A5');
    expect(s.refreshToken).toBe('R1');
    expect(s.scopes).toEqual(['x']);
  });

  it('signs out when the refresh is rejected', async () => {
    const { d, saves } = deps({
      load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, scopes: [], clientId: 'c' }),
      transport: async () => makeResponse(400, {}, JSON.stringify({ error: { type: 'invalid_grant', message: 'bad' } })),
    });
    const auth = new AuthManager(d);
    const cb = vi.fn();
    auth.onChange(cb);
    await expect(auth.getAccessToken()).rejects.toThrow();
    expect(auth.isSignedIn()).toBe(false);
    expect(auth.state).toBeNull();
    expect(cb).toHaveBeenCalledWith(null);
    expect(saves).toEqual([null]);
  });

  it('also signs out on a 401 from the token endpoint', async () => {
    const { d } = deps({
      load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, scopes: [], clientId: 'c' }),
      transport: async () => makeResponse(401, {}, ''),
    });
    const auth = new AuthManager(d);
    await expect(auth.refresh()).rejects.toBeInstanceOf(ApiError);
    expect(auth.isSignedIn()).toBe(false);
  });

  it('keeps the old state on a network error or a 5xx and rethrows', async () => {
    const stored: AuthState = { accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, scopes: [], clientId: 'c' };
    const { d, saves } = deps({
      load: () => stored,
      transport: async () => {
        throw new ApiError({ status: 0, message: 'Network error: offline' });
      },
    });
    const auth = new AuthManager(d);
    const cb = vi.fn();
    auth.onChange(cb);
    const err = await auth.refresh().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.state).toEqual(stored);
    expect(saves).toEqual([]);
    expect(cb).not.toHaveBeenCalled();

    const { d: d5 } = deps({ load: () => stored, transport: async () => makeResponse(503, {}, 'down') });
    const auth5 = new AuthManager(d5);
    await expect(auth5.refresh()).rejects.toBeInstanceOf(ApiError);
    expect(auth5.isSignedIn()).toBe(true);
  });

  it('allows a new refresh after a failed one', async () => {
    let fail = true;
    const { d } = deps({
      load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, scopes: [], clientId: 'c' }),
      transport: async () => {
        if (fail) throw new ApiError({ status: 0, message: 'Network error' });
        return makeResponse(200, {}, JSON.stringify({ access_token: 'A6', refresh_token: 'R6', expires_in: 10 }));
      },
    });
    const auth = new AuthManager(d);
    await expect(auth.refresh()).rejects.toThrow();
    fail = false;
    expect((await auth.refresh()).accessToken).toBe('A6');
  });

  it('refresh while signed out throws ApiError 401', async () => {
    const { d, calls } = deps();
    const auth = new AuthManager(d);
    const err = await auth.refresh().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(calls.length).toBe(0);
  });

  it('signOut saves null, notifies, and unsubscribe stops notifications', async () => {
    const { d, saves } = deps({
      load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 0, scopes: [], clientId: 'c' }),
    });
    const auth = new AuthManager(d);
    const cb = vi.fn();
    const off = auth.onChange(cb);
    await auth.signOut();
    expect(auth.isSignedIn()).toBe(false);
    expect(saves).toEqual([null]);
    expect(cb).toHaveBeenCalledWith(null);
    off();
    await auth.signOut();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('setOrgUuid persists the uuid onto the current state and notifies', async () => {
    const { d, saves } = deps({
      load: () => ({ accessToken: 'A1', refreshToken: 'R1', expiresAt: 9e12, scopes: [], clientId: 'c' }),
    });
    const auth = new AuthManager(d);
    const cb = vi.fn();
    auth.onChange(cb);
    await auth.setOrgUuid('org-manual');
    expect(auth.orgUuid()).toBe('org-manual');
    expect(saves[0]?.orgUuid).toBe('org-manual');
    expect(saves[0]?.accessToken).toBe('A1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('setOrgUuid while signed out is a no-op', async () => {
    const { d, saves } = deps();
    const auth = new AuthManager(d);
    await auth.setOrgUuid('org-x');
    expect(auth.orgUuid()).toBeUndefined();
    expect(saves).toEqual([]);
  });

  it('uses a custom client id when given', async () => {
    const { d, calls } = deps({ clientId: 'custom-client' });
    const auth = new AuthManager(d);
    const { url, state } = await auth.beginSignIn();
    expect(new URL(url).searchParams.get('client_id')).toBe('custom-client');
    const s = await auth.completeSignIn(`c#${state}`);
    expect(calls[0]!.body).toMatchObject({ client_id: 'custom-client' });
    expect(s.clientId).toBe('custom-client');
  });
});
