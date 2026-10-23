// Tests for the SecretStorage helpers: detection, read/write of the AuthState JSON, sign-out.
import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import type { AuthState } from '../../src/api/auth-types';
import { readAuthSecret, type SecretStore, secretStoreOf, writeAuthSecret } from '../../src/obsidian/secrets';

function memoryStore(withDelete = true): SecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  const store: SecretStore & { map: Map<string, string> } = {
    map,
    getSecret: (id) => map.get(id) ?? null,
    setSecret: (id, v) => void map.set(id, v),
  };
  if (withDelete) store.deleteSecret = (id) => void map.delete(id);
  return store;
}

const auth: AuthState = { accessToken: 'a', refreshToken: 'r', expiresAt: 1, scopes: [], clientId: 'c' };

describe('secrets', () => {
  it('finds app.secretStorage only when it has get and set', () => {
    expect(secretStoreOf({} as App)).toBeNull();
    expect(secretStoreOf({ secretStorage: { getSecret: () => null } } as unknown as App)).toBeNull();
    const s = memoryStore();
    expect(secretStoreOf({ secretStorage: s } as unknown as App)).toBe(s);
  });

  it('round-trips the AuthState and deletes it on sign-out', () => {
    const s = memoryStore();
    writeAuthSecret(s, 'claudsidian-auth', auth);
    expect(readAuthSecret(s, 'claudsidian-auth')).toEqual(auth);
    writeAuthSecret(s, 'claudsidian-auth', null);
    expect(s.map.has('claudsidian-auth')).toBe(false);
    expect(readAuthSecret(s, 'claudsidian-auth')).toBeNull();
  });

  it('blanks the secret when deleteSecret is missing', () => {
    const s = memoryStore(false);
    writeAuthSecret(s, 'x', auth);
    writeAuthSecret(s, 'x', null);
    expect(s.map.get('x')).toBe('');
    expect(readAuthSecret(s, 'x')).toBeNull();
  });

  it('treats junk and token-less JSON as signed out', () => {
    const s = memoryStore();
    s.setSecret('x', 'not json');
    expect(readAuthSecret(s, 'x')).toBeNull();
    s.setSecret('x', JSON.stringify({ refreshToken: 'r' }));
    expect(readAuthSecret(s, 'x')).toBeNull();
  });
});
