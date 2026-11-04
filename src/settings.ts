import type { AuthState } from './api/auth-types';
import type { HandoffRequest, SealedHandoff } from './obsidian/handoff';

export type ClientPlatform = 'web_claude_ai' | 'ios' | 'android' | 'desktop_app';
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';

export interface ContextSettings {
  enabled: boolean;
  includeActiveNote: boolean;
  includeSelection: boolean;
  includeCursor: boolean;
  includeOpenNotes: boolean;
  maxSelectionChars: number;
  maxOpenNotes: number;
}

export interface PollingSettings {
  activeMs: number;
  idleMs: number;
  listMs: number;
}

export interface ClaudsidianSettings {
  version: 2;
  apiBaseUrl: string;
  oauthTokenUrl: string;
  oauthAuthorizeUrl: string;
  clientPlatform: ClientPlatform;
  vaultPathOnMac: string;
  defaultEnvironmentId: string;
  defaultModel: string;
  defaultPermissionMode: PermissionMode;
  context: ContextSettings;
  polling: PollingSettings;
  cookingMode: boolean;
  cookingFontScale: number;
  quickReplies: string[];
  notifications: boolean;
  showCosts: boolean;
  showThinking: boolean;
  showSubagentTraffic: boolean;
  debugLog: boolean;
  /** Only on Obsidian without SecretStorage; otherwise null here and the sign-in lives in the secret below. */
  auth: AuthState | null;
  /** SecretStorage id holding the sign-in (AuthState JSON) on this device. */
  authSecretId: string;
  /**
   * Mac-to-phone sign-in (src/obsidian/handoff.ts). A signed-out phone or iPad publishes a public key here
   * (handoffRequest; its private key stays in its SecretStorage); "Sign in a phone or iPad from this Mac" writes a
   * grant encrypted to that key (authHandoff), which only that device can open. Nothing readable is synced.
   */
  handoffRequest: HandoffRequest | null;
  authHandoff: SealedHandoff | null;
  /** last opened session id, restored on view open */
  lastSessionId: string;
  /** per-install uuid sent with presence; generated on first load */
  clientId: string;
  /**
   * environment id -> working directory, learned from init events and the environments endpoint. Lets
   * "This vault" form on a cold start, before any session has been opened.
   */
  environmentDirs: Record<string, string>;
  /** session id -> init cwd, oldest first; the store keeps the newest MAX_SESSION_CWDS entries */
  sessionCwds: Record<string, string>;
  /** the sessions list shows "This vault" only (default) or every session */
  listScope: 'vault' | 'all';
  /** sessions run elsewhere that the person filed under "This vault" from the row menu */
  vaultSessionIds: string[];
}

/** How many session cwds data.json keeps (the newest); older sessions fall back to their environment's directory. */
export const MAX_SESSION_CWDS = 200;
/** A sealed sign-in from the Mac (authHandoff) is dropped after this long unopened. */
export const HANDOFF_TTL_MS = 60 * 60 * 1000;

export const DEFAULT_SETTINGS: ClaudsidianSettings = {
  version: 2,
  apiBaseUrl: 'https://api.anthropic.com',
  oauthTokenUrl: 'https://api.anthropic.com/v1/oauth/token',
  oauthAuthorizeUrl: 'https://claude.ai/oauth/authorize',
  clientPlatform: 'web_claude_ai',
  vaultPathOnMac: '/Users/kicooley-winters/workspace/projects/yes-chef',
  defaultEnvironmentId: '',
  defaultModel: '',
  defaultPermissionMode: 'auto',
  context: {
    enabled: true,
    includeActiveNote: true,
    includeSelection: true,
    includeCursor: true,
    includeOpenNotes: true,
    maxSelectionChars: 4000,
    maxOpenNotes: 10,
  },
  polling: { activeMs: 700, idleMs: 4000, listMs: 30000 },
  cookingMode: false,
  cookingFontScale: 1.2,
  quickReplies: ['yes', 'go ahead', 'stop', 'what next?'],
  notifications: true,
  showCosts: false,
  showThinking: true,
  showSubagentTraffic: false,
  debugLog: false,
  auth: null,
  authSecretId: 'claudsidian-auth',
  handoffRequest: null,
  authHandoff: null,
  lastSessionId: '',
  clientId: '',
  environmentDirs: {},
  sessionCwds: {},
  listScope: 'vault',
  vaultSessionIds: [],
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The string -> non-empty string entries of v, in their stored order; anything else is dropped. */
function stringMap(v: unknown, max = Infinity): Record<string, string> {
  if (!isObject(v)) return {};
  const entries = Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '');
  return Object.fromEntries(entries.slice(-max));
}

/** Keys holding learned directory maps: validated entry by entry instead of merged with the (empty) default. */
const STRING_MAP_KEYS = new Set<keyof ClaudsidianSettings>(['environmentDirs', 'sessionCwds']);

/**
 * platform.claude.com and console.anthropic.com front the OAuth token endpoint with an edge that
 * rejects any non-SDK User-Agent with 429, and Obsidian mobile cannot override the User-Agent, so
 * sign-in and refresh fail on the iPad. api.anthropic.com runs the same exchange without that gate.
 * Rewrite the old default so existing installs pick up the working host.
 */
const LEGACY_TOKEN_URLS = new Set([
  'https://platform.claude.com/v1/oauth/token',
  'https://console.anthropic.com/v1/oauth/token',
]);

/**
 * Build settings from whatever is in data.json. v1 (Smart Composer fork) data has `version: 13`
 * and `providers`; none of it carries over, so anything without `version: 2` starts from defaults.
 * Unknown keys are dropped; missing keys get defaults; nested objects are merged one level deep.
 */
export function migrateSettings(raw: unknown): ClaudsidianSettings {
  if (!isObject(raw) || raw.version !== 2) return structuredClone(DEFAULT_SETTINGS);
  const out: ClaudsidianSettings = structuredClone(DEFAULT_SETTINGS);
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof ClaudsidianSettings)[]) {
    const v = raw[key];
    if (v === undefined) continue;
    const d = DEFAULT_SETTINGS[key];
    if (STRING_MAP_KEYS.has(key)) {
      (out as unknown as Record<string, unknown>)[key] = stringMap(v, key === 'sessionCwds' ? MAX_SESSION_CWDS : Infinity);
    } else if (isObject(d) && isObject(v)) {
      (out as unknown as Record<string, unknown>)[key] = { ...(d as Record<string, unknown>), ...v };
    } else if (Array.isArray(d)) {
      if (Array.isArray(v)) (out as unknown as Record<string, unknown>)[key] = v.filter((x) => typeof x === 'string');
    } else if (key === 'auth') {
      out.auth = isObject(v) && typeof v.accessToken === 'string' ? (v as unknown as AuthState) : null;
    } else if (key === 'handoffRequest') {
      out.handoffRequest = isObject(v) && typeof v.device === 'string' && typeof v.publicKey === 'string' && typeof v.at === 'number' ? (v as unknown as HandoffRequest) : null;
    } else if (key === 'authHandoff') {
      out.authHandoff =
        isObject(v) && typeof v.device === 'string' && typeof v.senderKey === 'string' && typeof v.nonce === 'string' && typeof v.box === 'string' && typeof v.at === 'number'
          ? (v as unknown as SealedHandoff)
          : null;
    } else if (typeof v === typeof d) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  if (LEGACY_TOKEN_URLS.has(out.oauthTokenUrl)) out.oauthTokenUrl = DEFAULT_SETTINGS.oauthTokenUrl;
  if (!/^[a-z0-9-]+$/.test(out.authSecretId)) out.authSecretId = DEFAULT_SETTINGS.authSecretId;
  if (out.listScope !== 'vault' && out.listScope !== 'all') out.listScope = DEFAULT_SETTINGS.listScope;
  return out;
}
