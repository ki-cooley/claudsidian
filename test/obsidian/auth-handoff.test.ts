// Mac-to-phone sign-in (src/obsidian/handoff.ts, Plugin.syncHandoff): the phone publishes a public key, the Mac
// seals a grant to it, only that phone opens it, and nothing readable lands in data.json.
import { afterEach, describe, expect, it } from 'vitest';
import { App, Platform } from 'obsidian';
import type { AuthState } from '../../src/api/auth-types';
import ClaudsidianPlugin from '../../src/main';
import { HANDOFF_KEY_SECRET_ID, ensureHandoffRequest, openHandoff, sealHandoff } from '../../src/obsidian/handoff';
import type { SecretStore } from '../../src/obsidian/secrets';
import { HANDOFF_TTL_MS } from '../../src/settings';

const GRANT: AuthState = { accessToken: 'A2', refreshToken: 'R2', expiresAt: 9e12, scopes: [], clientId: 'c', orgUuid: 'o' };

function store(): SecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getSecret: (id) => map.get(id) || null,
    setSecret: (id, v) => void map.set(id, v),
    deleteSecret: (id) => void map.delete(id),
  };
}

function device(mobile: boolean, secrets = store()) {
  const plugin = new ClaudsidianPlugin(new App(), { id: 'claudsidian', version: 'test' } as never);
  plugin.secrets = secrets;
  return { plugin, secrets };
}

/** Load as the given platform; Platform is global in the obsidian mock. */
async function load(d: ReturnType<typeof device>, mobile: boolean, data: unknown): Promise<unknown> {
  (Platform as { isMobile: boolean }).isMobile = mobile;
  await d.plugin.saveData(data);
  await d.plugin.loadSettings();
  return d.plugin.loadData();
}

afterEach(() => {
  (Platform as { isMobile: boolean }).isMobile = false;
});

describe('handoff crypto', () => {
  it('only the requesting device opens the box; another key cannot', async () => {
    const phone = store();
    const other = store();
    const req = ensureHandoffRequest(phone);
    ensureHandoffRequest(other);
    const sealed = sealHandoff(req, GRANT);
    expect(JSON.stringify(sealed)).not.toContain('R2');
    expect(openHandoff(phone, sealed).refreshToken).toBe('R2');
    expect(() => openHandoff(other, sealed)).toThrow();
    // another device's key cannot open it even when the id is forged onto the box
    expect(() => openHandoff(other, { ...sealed, device: JSON.parse(other.map.get(HANDOFF_KEY_SECRET_ID)!).device })).toThrow();
    // a flipped byte fails authentication
    const bytes = atob(sealed.box);
    const flipped = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    expect(() => openHandoff(phone, { ...sealed, box: flipped })).toThrow();
    // the same key is reused until the device signs in
    expect(ensureHandoffRequest(phone).publicKey).toBe(req.publicKey);
  });
});

describe('Plugin.syncHandoff', () => {
  it('signed-out phone publishes a key, the Mac seals to it, the phone opens it and clears everything', async () => {
    const phone = device(true);
    const data1 = (await load(phone, true, { version: 2 })) as { handoffRequest: { device: string } };
    expect(data1.handoffRequest?.device).toBeTruthy();
    expect(phone.secrets.map.has(HANDOFF_KEY_SECRET_ID)).toBe(true);

    const sealed = sealHandoff(phone.plugin.settings.handoffRequest!, GRANT);
    const data2 = (await load(phone, true, { ...data1, authHandoff: sealed })) as Record<string, unknown>;
    expect(JSON.parse(phone.secrets.map.get('claudsidian-auth')!).refreshToken).toBe('R2');
    expect(phone.secrets.map.has(HANDOFF_KEY_SECRET_ID)).toBe(false);
    expect(data2.authHandoff).toBeNull();
    expect(data2.handoffRequest).toBeNull();
    expect(JSON.stringify(data2)).not.toContain('R2');
  });

  it('desktop never opens or publishes; a box for another device is left alone', async () => {
    const phone = device(true);
    await load(phone, true, { version: 2 });
    const sealed = sealHandoff(phone.plugin.settings.handoffRequest!, GRANT);

    const mac = device(false);
    await load(mac, false, { version: 2, authHandoff: sealed });
    expect(mac.secrets.map.size).toBe(0);
    expect(mac.plugin.settings.authHandoff).not.toBeNull();

    const ipad = device(true);
    await load(ipad, true, { version: 2, authHandoff: sealed, handoffRequest: phone.plugin.settings.handoffRequest });
    expect(ipad.secrets.map.has('claudsidian-auth')).toBe(false);
    expect(ipad.plugin.settings.authHandoff).not.toBeNull();
  });

  it('an expired box is dropped unopened', async () => {
    const phone = device(true);
    await load(phone, true, { version: 2 });
    const sealed = sealHandoff(phone.plugin.settings.handoffRequest!, GRANT, Date.now() - HANDOFF_TTL_MS - 1);
    await load(phone, true, { version: 2, handoffRequest: phone.plugin.settings.handoffRequest, authHandoff: sealed });
    expect(phone.secrets.map.has('claudsidian-auth')).toBe(false);
    expect(phone.plugin.settings.authHandoff).toBeNull();
  });
});
