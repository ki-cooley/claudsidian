/**
 * AuthManager: owns the persisted OAuth state. Runs the PKCE sign-in (begin/complete),
 * hands out a fresh access token (refreshing when it expires within five minutes, one
 * refresh in flight at a time), signs out on a rejected refresh, and notifies subscribers.
 * Tokens never reach the log.
 */
import type { AuthApi } from './auth-api';
import type { AuthState } from './auth-types';
import { ApiError, apiErrorFromResponse } from './errors';
import type { HttpResponse, HttpTransport } from './http';
import { CLAUDE_CODE_CLIENT_ID, OAUTH_BETA, OAUTH_REDIRECT_URI, OAUTH_SCOPES, buildAuthorizeUrl, challengeS256, parsePastedCode, randomUrlSafe, OAUTH_USER_AGENT } from './oauth';
import { log } from '../util/log';
import { realTimers, type TimerApi } from '../util/timers';

export interface AuthDeps {
  transport: HttpTransport;
  load: () => AuthState | null;
  save: (s: AuthState | null) => Promise<void>;
  tokenUrl: string;
  authorizeUrl: string;
  profileUrl: string;
  clientId?: string;
  timers?: TimerApi;
}

/** Refresh when less than this remains on the access token. */
const REFRESH_MARGIN_MS = 300_000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  organization?: { uuid?: string };
  org_uuid?: string;
  account?: { uuid?: string; email_address?: string };
}

export class AuthManager implements AuthApi {
  private current: AuthState | null;
  private pending: { verifier: string; state: string } | null = null;
  private inflight: Promise<AuthState> | null = null;
  /** Bumped on every sign-out, so a token exchange that was in flight cannot sign the user back in. */
  private generation = 0;
  private readonly listeners = new Set<(state: AuthState | null) => void>();
  private readonly clientId: string;
  private readonly timers: TimerApi;

  constructor(private readonly deps: AuthDeps) {
    this.current = deps.load();
    this.clientId = deps.clientId ?? CLAUDE_CODE_CLIENT_ID;
    this.timers = deps.timers ?? realTimers;
  }

  get state(): AuthState | null {
    return this.current;
  }

  isSignedIn(): boolean {
    return this.current !== null;
  }

  orgUuid(): string | undefined {
    return this.current?.orgUuid;
  }

  async beginSignIn(): Promise<{ url: string; state: string }> {
    const verifier = randomUrlSafe();
    const state = randomUrlSafe();
    this.pending = { verifier, state };
    const url = buildAuthorizeUrl({
      authorizeUrl: this.deps.authorizeUrl,
      clientId: this.clientId,
      challenge: await challengeS256(verifier),
      state,
      scopes: OAUTH_SCOPES,
      redirectUri: OAUTH_REDIRECT_URI,
    });
    return { url, state };
  }

  async completeSignIn(pasted: string): Promise<AuthState> {
    const pending = this.pending;
    if (!pending) throw new ApiError({ status: 400, message: 'Sign-in was not started. Open claude.ai first.' });
    const parsed = parsePastedCode(pasted);
    if (!parsed) throw new ApiError({ status: 400, message: 'Paste the code shown by claude.ai.' });
    if (parsed.state !== undefined && parsed.state !== pending.state) {
      throw new ApiError({ status: 400, message: 'State mismatch: the code belongs to a different sign-in attempt. Start again.' });
    }
    const generation = this.generation;
    const res = await this.postToken({
      grant_type: 'authorization_code',
      code: parsed.code,
      state: pending.state,
      code_verifier: pending.verifier,
      client_id: this.clientId,
      redirect_uri: OAUTH_REDIRECT_URI,
    });
    if (generation !== this.generation) throw new ApiError({ status: 401, message: 'Signed out during sign-in' });
    if (res.status < 200 || res.status >= 300) throw apiErrorFromResponse(res.status, res.text, res.headers);
    const next = this.stateFromToken(res.json<TokenResponse>(), null);
    if (!next.orgUuid) next.orgUuid = await this.lookupOrgUuid(next.accessToken);
    if (generation !== this.generation) throw new ApiError({ status: 401, message: 'Signed out during sign-in' });
    this.pending = null;
    await this.commit(next);
    log.info('signed in', { orgUuid: next.orgUuid, scopes: next.scopes });
    return next;
  }

  async getAccessToken(): Promise<string> {
    const s = this.current;
    if (!s) throw new ApiError({ status: 401, message: 'Not signed in' });
    if (s.expiresAt - this.timers.now() > REFRESH_MARGIN_MS) return s.accessToken;
    return (await this.refresh()).accessToken;
  }

  refresh(): Promise<AuthState> {
    if (this.inflight) return this.inflight;
    const run = this.doRefresh().finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async doRefresh(): Promise<AuthState> {
    const prev = this.current;
    if (!prev) throw new ApiError({ status: 401, message: 'Not signed in' });
    // Network errors propagate from the transport as ApiError(status 0); state is untouched.
    const generation = this.generation;
    const res = await this.postToken({ grant_type: 'refresh_token', refresh_token: prev.refreshToken, client_id: prev.clientId || this.clientId });
    // signOut() ran while the request was out: the response is stale, whatever it says.
    if (generation !== this.generation) throw new ApiError({ status: 401, message: 'Signed out during refresh' });
    if (res.status === 400 || res.status === 401) {
      const err = apiErrorFromResponse(res.status, res.text, res.headers);
      log.warn('token refresh rejected, signing out', { status: res.status, errorType: err.errorType });
      await this.commit(null);
      throw err;
    }
    if (res.status < 200 || res.status >= 300) throw apiErrorFromResponse(res.status, res.text, res.headers);
    const next = this.stateFromToken(res.json<TokenResponse>(), prev);
    next.refreshedAt = this.timers.now();
    await this.commit(next);
    return next;
  }

  async signOut(): Promise<void> {
    this.pending = null;
    this.generation += 1;
    await this.commit(null);
  }

  async setOrgUuid(uuid: string): Promise<void> {
    if (!this.current) return;
    await this.commit({ ...this.current, orgUuid: uuid });
  }

  onChange(cb: (state: AuthState | null) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private postToken(body: Record<string, string>): Promise<HttpResponse> {
    return this.deps.transport({
      method: 'POST',
      url: this.deps.tokenUrl,
      headers: { 'Content-Type': 'application/json', 'anthropic-beta': OAUTH_BETA, 'User-Agent': OAUTH_USER_AGENT },
      body,
    });
  }

  /** Map a token response onto AuthState, carrying forward fields the response omits. */
  private stateFromToken(body: TokenResponse | undefined, prev: AuthState | null): AuthState {
    const accessToken = body?.access_token;
    // The body is not attached: it can carry a refresh token, and errors are printed outside the redacting log.
    if (!accessToken) throw new ApiError({ status: 502, message: 'Token response had no access_token' });
    const expiresIn = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) ? body.expires_in : 0;
    const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : (prev?.scopes ?? []);
    const next: AuthState = {
      accessToken,
      refreshToken: body.refresh_token ?? prev?.refreshToken ?? '',
      expiresAt: this.timers.now() + expiresIn * 1000,
      scopes,
      clientId: prev?.clientId || this.clientId,
    };
    const orgUuid = body.organization?.uuid ?? body.org_uuid ?? prev?.orgUuid;
    if (orgUuid) next.orgUuid = orgUuid;
    const accountUuid = body.account?.uuid ?? prev?.accountUuid;
    if (accountUuid) next.accountUuid = accountUuid;
    const email = body.account?.email_address ?? prev?.email;
    if (email) next.email = email;
    if (prev?.refreshedAt !== undefined) next.refreshedAt = prev.refreshedAt;
    return next;
  }

  /** GET profileUrl for organization.uuid. Any failure yields undefined; the settings field is the fallback. */
  private async lookupOrgUuid(accessToken: string): Promise<string | undefined> {
    try {
      const res = await this.deps.transport({
        method: 'GET',
        url: this.deps.profileUrl,
        headers: { Authorization: `Bearer ${accessToken}`, 'anthropic-beta': OAUTH_BETA },
      });
      if (res.status < 200 || res.status >= 300) {
        log.warn('profile lookup failed', { status: res.status });
        return undefined;
      }
      const uuid = res.json<{ organization?: { uuid?: string } }>()?.organization?.uuid;
      return typeof uuid === 'string' && uuid ? uuid : undefined;
    } catch (err) {
      log.warn('profile lookup errored', { message: (err as Error)?.message });
      return undefined;
    }
  }

  private async commit(next: AuthState | null): Promise<void> {
    this.current = next;
    await this.deps.save(next);
    for (const cb of Array.from(this.listeners)) {
      try {
        cb(next);
      } catch (err) {
        log.error('auth listener threw', { message: (err as Error)?.message });
      }
    }
  }
}
