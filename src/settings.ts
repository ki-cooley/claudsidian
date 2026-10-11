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
}

export const DEFAULT_SETTINGS: ClaudsidianSettings = {
  version: 2,
  apiBaseUrl: 'https://api.anthropic.com',
  oauthTokenUrl: 'https://platform.claude.com/v1/oauth/token',
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
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

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
    if (isObject(d) && isObject(v)) {
      (out as unknown as Record<string, unknown>)[key] = { ...(d as Record<string, unknown>), ...v };
    } else if (Array.isArray(d)) {
      if (Array.isArray(v)) (out as unknown as Record<string, unknown>)[key] = v.filter((x) => typeof x === 'string');
    } else if (key === 'auth') {
      out.auth = isObject(v) && typeof v.accessToken === 'string' ? (v as unknown as AuthState) : null;
    } else if (typeof v === typeof d) {
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}
