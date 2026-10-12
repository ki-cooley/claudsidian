import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MAX_SESSION_CWDS, migrateSettings } from '../src/settings';

describe('migrateSettings', () => {
  it('returns defaults for null (fresh install)', () => {
    expect(migrateSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('discards v1 Smart Composer data wholesale', () => {
    const v1 = { version: 13, providers: [{ type: 'backend', backendUrl: 'wss://x' }], chatModelId: 'backend-agent' };
    const out = migrateSettings(v1);
    expect(out).toEqual(DEFAULT_SETTINGS);
    expect((out as unknown as Record<string, unknown>).providers).toBeUndefined();
  });

  it('keeps known v2 keys, merges nested objects, drops unknown keys', () => {
    const out = migrateSettings({
      version: 2,
      cookingMode: true,
      context: { maxSelectionChars: 999 },
      polling: { activeMs: 500 },
      bogus: 1,
      quickReplies: ['ok', 42],
    });
    expect(out.cookingMode).toBe(true);
    expect(out.context.maxSelectionChars).toBe(999);
    expect(out.context.includeSelection).toBe(true);
    expect(out.polling).toEqual({ activeMs: 500, idleMs: 4000, listMs: 30000 });
    expect(out.quickReplies).toEqual(['ok']);
    expect((out as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('keeps auth only when it has an access token', () => {
    const auth = { accessToken: 'a', refreshToken: 'r', expiresAt: 1, scopes: [], clientId: 'c' };
    expect(migrateSettings({ version: 2, auth }).auth).toEqual(auth);
    expect(migrateSettings({ version: 2, auth: { refreshToken: 'r' } }).auth).toBeNull();
  });

  it('ignores wrong-typed scalars', () => {
    const out = migrateSettings({ version: 2, cookingMode: 'yes', vaultPathOnMac: 7 });
    expect(out.cookingMode).toBe(false);
    expect(out.vaultPathOnMac).toBe(DEFAULT_SETTINGS.vaultPathOnMac);
  });
  it('rewrites the legacy edge-gated token host to the working one', () => {
    expect(migrateSettings({ version: 2, oauthTokenUrl: 'https://platform.claude.com/v1/oauth/token' }).oauthTokenUrl).toBe(DEFAULT_SETTINGS.oauthTokenUrl);
    expect(migrateSettings({ version: 2, oauthTokenUrl: 'https://console.anthropic.com/v1/oauth/token' }).oauthTokenUrl).toBe(DEFAULT_SETTINGS.oauthTokenUrl);
    expect(DEFAULT_SETTINGS.oauthTokenUrl).toBe('https://api.anthropic.com/v1/oauth/token');
  });

  it('keeps a user-set token host that is not a known legacy default', () => {
    expect(migrateSettings({ version: 2, oauthTokenUrl: 'https://my-proxy.example/v1/oauth/token' }).oauthTokenUrl).toBe('https://my-proxy.example/v1/oauth/token');
  });
});

describe('migrateSettings learned directories', () => {
  it('keeps the string entries of environmentDirs and sessionCwds and drops the rest', () => {
    const out = migrateSettings({
      version: 2,
      environmentDirs: { env_a: '/x', env_b: 3, env_c: '' },
      sessionCwds: { cse_1: '/y', cse_2: null },
    });
    expect(out.environmentDirs).toEqual({ env_a: '/x' });
    expect(out.sessionCwds).toEqual({ cse_1: '/y' });
  });

  it('keeps only the newest MAX_SESSION_CWDS session cwds (last entries win)', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_SESSION_CWDS + 5; i++) many[`cse_${i}`] = `/d${i}`;
    const out = migrateSettings({ version: 2, sessionCwds: many });
    expect(Object.keys(out.sessionCwds)).toHaveLength(MAX_SESSION_CWDS);
    expect(out.sessionCwds.cse_4).toBeUndefined();
    expect(out.sessionCwds.cse_5).toBe('/d5');
    expect(out.sessionCwds[`cse_${MAX_SESSION_CWDS + 4}`]).toBe(`/d${MAX_SESSION_CWDS + 4}`);
  });

  it('starts both maps empty on a fresh install and when the stored value is not an object', () => {
    expect(migrateSettings(null).environmentDirs).toEqual({});
    expect(migrateSettings({ version: 2, environmentDirs: 'nope', sessionCwds: ['a'] })).toMatchObject({ environmentDirs: {}, sessionCwds: {} });
  });
});
