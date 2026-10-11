import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/settings';

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
