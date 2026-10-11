// Unit tests for the PKCE helpers in src/api/oauth.ts.
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_CLIENT_ID,
  OAUTH_BETA,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPES,
  buildAuthorizeUrl,
  challengeS256,
  parsePastedCode,
  randomUrlSafe,
} from '../../src/api/oauth';

describe('oauth helpers', () => {
  it('exports the Claude Code public client constants', () => {
    expect(CLAUDE_CODE_CLIENT_ID).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    expect(OAUTH_REDIRECT_URI).toBe('https://platform.claude.com/oauth/code/callback');
    expect(OAUTH_SCOPES).toEqual(['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code']);
    expect(OAUTH_BETA).toBe('oauth-2025-04-20');
  });

  it('makes a url-safe verifier of 43+ chars', () => {
    const v = randomUrlSafe();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(randomUrlSafe()).not.toBe(v);
  });

  it('honours the byte count', () => {
    expect(randomUrlSafe(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('computes the S256 challenge from RFC 7636 appendix B', async () => {
    expect(await challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('builds the authorize url with code=true and all params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        authorizeUrl: 'https://claude.ai/oauth/authorize',
        clientId: CLAUDE_CODE_CLIENT_ID,
        challenge: 'c',
        state: 's',
        scopes: ['a', 'b'],
        redirectUri: 'https://r',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
    expect(url.searchParams.get('code')).toBe('true');
    expect(url.searchParams.get('client_id')).toBe(CLAUDE_CODE_CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBe('c');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.searchParams.get('scope')).toBe('a b');
    expect(url.searchParams.get('redirect_uri')).toBe('https://r');
  });

  it('parses pasted codes in every shape', () => {
    expect(parsePastedCode('abc')).toEqual({ code: 'abc' });
    expect(parsePastedCode('  abc#st  ')).toEqual({ code: 'abc', state: 'st' });
    expect(parsePastedCode('https://platform.claude.com/oauth/code/callback?code=abc&state=st')).toEqual({
      code: 'abc',
      state: 'st',
    });
    expect(parsePastedCode('https://platform.claude.com/oauth/code/callback?code=abc')).toEqual({ code: 'abc' });
    expect(parsePastedCode('')).toBeNull();
    expect(parsePastedCode('   ')).toBeNull();
    expect(parsePastedCode('https://platform.claude.com/oauth/code/callback?state=st')).toBeNull();
  });
});
