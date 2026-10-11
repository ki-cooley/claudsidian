// Settings the harness seeds into the plugin before onload: the mock server as the API, a fake signed-in state
// unless ?signedout=1, the mock vault path, and a fixed client id.
import { CLAUDE_CODE_CLIENT_ID, OAUTH_SCOPES } from '../../src/api/oauth';
import { DEFAULT_SETTINGS, type ClaudsidianSettings } from '../../src/settings';
import { VAULT_BASE_PATH } from './shim/files';

export const HARNESS_CLIENT_ID = 'harness-client-00000000-0000-4000-8000-000000000001';

export function seedSettings(params: URLSearchParams): ClaudsidianSettings & { clientId: string } {
  const origin = location.origin;
  const signedOut = params.get('signedout') === '1';
  const settings: ClaudsidianSettings & { clientId: string } = {
    ...structuredClone(DEFAULT_SETTINGS),
    apiBaseUrl: origin,
    oauthTokenUrl: `${origin}/v1/oauth/token`,
    vaultPathOnMac: VAULT_BASE_PATH,
    cookingMode: params.get('cooking') === '1',
    lastSessionId: params.get('session') ?? '',
    debugLog: params.get('debug') === '1',
    clientId: HARNESS_CLIENT_ID,
    auth: signedOut
      ? null
      : {
          accessToken: 'mock-access-1',
          refreshToken: 'mock-refresh-1',
          expiresAt: Date.now() + 3_600_000,
          scopes: [...OAUTH_SCOPES],
          clientId: CLAUDE_CODE_CLIENT_ID,
          orgUuid: 'org-mock',
          accountUuid: 'acct-mock',
          email: 'mock@example.com',
          refreshedAt: Date.now(),
        },
  };
  const polling = params.get('polling');
  if (polling === 'fast') settings.polling = { activeMs: 300, idleMs: 1000, listMs: 5000 };
  return settings;
}
