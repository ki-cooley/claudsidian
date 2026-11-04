// The Mac-made sign-in for a phone (settings.authHandoff): adopted once by a mobile device with no sign-in.
import { afterEach, describe, expect, it } from 'vitest';
import { App, Platform } from 'obsidian';
import type { AuthState } from '../../src/api/auth-types';
import ClaudsidianPlugin from '../../src/main';
import { HANDOFF_TTL_MS } from '../../src/settings';

const GRANT: AuthState = { accessToken: 'A2', refreshToken: 'R2', expiresAt: 9e12, scopes: [], clientId: 'c', orgUuid: 'o' };

function setup(opts: { mobile: boolean; existing?: AuthState; at?: number }) {
  (Platform as { isMobile: boolean }).isMobile = opts.mobile;
  const secrets = new Map<string, string>();
  if (opts.existing) secrets.set('claudsidian-auth', JSON.stringify(opts.existing));
  const store = { getSecret: (id: string) => secrets.get(id) ?? null, setSecret: (id: string, v: string) => void secrets.set(id, v) };
  const plugin = new ClaudsidianPlugin(new App(), { id: 'claudsidian', version: 'test' } as never);
  plugin.secrets = store;
  void plugin.saveData({ version: 2, authHandoff: GRANT, authHandoffAt: opts.at ?? Date.now() });
  return { plugin, secrets };
}

afterEach(() => {
  (Platform as { isMobile: boolean }).isMobile = false;
});

describe('auth handoff', () => {
  it('a signed-out phone adopts it into SecretStorage and blanks it', async () => {
    const { plugin, secrets } = setup({ mobile: true });
    await plugin.loadSettings();
    expect(JSON.parse(secrets.get('claudsidian-auth')!).refreshToken).toBe('R2');
    expect(plugin.settings.authHandoff).toBeNull();
    expect((await plugin.loadData()) as { authHandoff: unknown }).toMatchObject({ authHandoff: null });
  });

  it('desktop and an already signed-in phone leave it for the device it was meant for', async () => {
    const mac = setup({ mobile: false });
    await mac.plugin.loadSettings();
    expect(mac.secrets.has('claudsidian-auth')).toBe(false);
    expect(mac.plugin.settings.authHandoff?.refreshToken).toBe('R2');

    const mine: AuthState = { ...GRANT, refreshToken: 'MINE' };
    const phone = setup({ mobile: true, existing: mine });
    await phone.plugin.loadSettings();
    expect(JSON.parse(phone.secrets.get('claudsidian-auth')!).refreshToken).toBe('MINE');
    expect(phone.plugin.settings.authHandoff?.refreshToken).toBe('R2');
  });

  it('an expired one is dropped, not adopted', async () => {
    const { plugin, secrets } = setup({ mobile: true, at: Date.now() - HANDOFF_TTL_MS - 1 });
    await plugin.loadSettings();
    expect(secrets.has('claudsidian-auth')).toBe(false);
    expect(plugin.settings.authHandoff).toBeNull();
  });
});
