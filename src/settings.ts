import type { AuthState } from './api/auth-types';

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
  auth: AuthState | null;
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
    } else if (typeof v === typeof d) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  if (LEGACY_TOKEN_URLS.has(out.oauthTokenUrl)) out.oauthTokenUrl = DEFAULT_SETTINGS.oauthTokenUrl;
  if (out.listScope !== 'vault' && out.listScope !== 'all') out.listScope = DEFAULT_SETTINGS.listScope;
  return out;
}
