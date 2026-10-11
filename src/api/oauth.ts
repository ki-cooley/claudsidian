/**
 * OAuth PKCE helpers for the claude.ai manual-code flow: Claude Code's public client
 * constants, verifier and S256 challenge generation, the authorize URL, and parsing of
 * whatever the user pastes back ("code", "code#state", or the callback URL).
 * Pure functions, no state, no network. Uses WebCrypto (present in Electron, iOS WebKit, Node).
 */

export const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const OAUTH_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
export const OAUTH_SCOPES = ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code'];
export const OAUTH_BETA = 'oauth-2025-04-20';
/**
 * Cloudflare in front of the token endpoint answers 429 "Rate limited" (no request id, never
 * reaches the app) to browser-shaped and generic user agents; the SDK user agent Claude Code
 * sends gets through. Verified 2026-10-11 against platform.claude.com.
 */
export const OAUTH_USER_AGENT = 'anthropic-sdk-typescript/0.94.0 userOAuthProvider';

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Random base64url string; 32 bytes (the default) gives a 43-char PKCE verifier. */
export function randomUrlSafe(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

/** base64url(sha256(verifier)), RFC 7636 section 4.2. */
export async function challengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function buildAuthorizeUrl(p: {
  authorizeUrl: string;
  clientId: string;
  challenge: string;
  state: string;
  scopes: string[];
  redirectUri: string;
}): string {
  const url = new URL(p.authorizeUrl);
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('scope', p.scopes.join(' '));
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', p.state);
  return url.toString();
}

/** Accepts "code", "code#state", or a URL carrying ?code=&state=. Null when no code is present. */
export function parsePastedCode(input: string): { code: string; state?: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const code = u.searchParams.get('code')?.trim();
      const state = u.searchParams.get('state')?.trim();
      if (!code) return null;
      return state ? { code, state } : { code };
    } catch {
      return null;
    }
  }
  const hash = raw.indexOf('#');
  if (hash === -1) return { code: raw };
  const code = raw.slice(0, hash).trim();
  const state = raw.slice(hash + 1).trim();
  if (!code) return null;
  return state ? { code, state } : { code };
}
