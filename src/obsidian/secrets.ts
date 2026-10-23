/**
 * The OAuth sign-in lives in Obsidian's SecretStorage (1.11.4+), not data.json: data.json travels with
 * Obsidian Sync and backups, SecretStorage stays on the device (desktop: Electron safeStorage, its key in
 * the macOS keychain; mobile: the native secure store). Older Obsidian has no SecretStorage, and the
 * sign-in stays in data.json as before.
 */
import type { App } from 'obsidian';
import type { AuthState } from '../api/auth-types';

export const DEFAULT_AUTH_SECRET_ID = 'claudsidian-auth';

/** The part of app.secretStorage the plugin uses; deleteSecret exists at runtime but is not in the typings. */
export interface SecretStore {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
  deleteSecret?(id: string): void;
}

export function secretStoreOf(app: App): SecretStore | null {
  const store = (app as unknown as { secretStorage?: Partial<SecretStore> }).secretStorage;
  return store && typeof store.getSecret === 'function' && typeof store.setSecret === 'function'
    ? (store as SecretStore)
    : null;
}

/** The AuthState stored under id, or null when absent, empty, or not an AuthState. */
export function readAuthSecret(store: SecretStore, id: string): AuthState | null {
  const raw = store.getSecret(id);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AuthState> | null;
    return v && typeof v.accessToken === 'string' && v.accessToken ? (v as AuthState) : null;
  } catch {
    return null;
  }
}

export function writeAuthSecret(store: SecretStore, id: string, state: AuthState | null): void {
  if (state) {
    store.setSecret(id, JSON.stringify(state));
  } else if (typeof store.deleteSecret === 'function') {
    store.deleteSecret(id);
  } else {
    store.setSecret(id, '');
  }
}
