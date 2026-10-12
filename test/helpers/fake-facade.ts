/**
 * FakeFacade: PluginFacade with recording stubs for component tests. Settings, the captured
 * context, the vault file list and the image picker result are plain fields a test sets before
 * rendering; every call lands in `calls` and in the per-effect lists (notices, clipboard, ...).
 */
import type { AuthApi } from '../../src/api/auth-api';
import type { AuthState } from '../../src/api/auth-types';
import type { CapturedContext } from '../../src/core/types';
import { DEFAULT_SETTINGS, type ClaudsidianSettings } from '../../src/settings';
import type { PluginFacade } from '../../src/ui/facade';

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export const SIGNED_IN: AuthState = {
  accessToken: 'sk-ant-oat01-TESTACCESS',
  refreshToken: 'sk-ant-ort01-TESTREFRESH',
  expiresAt: 9e12,
  scopes: [],
  clientId: 'cid',
  orgUuid: '12345678-aaaa-bbbb-cccc-dddddddddddd',
  email: 'ki@example.com',
};

export interface FakeAuth extends AuthApi {
  state: AuthState | null;
  /** change the state and notify subscribers */
  setState(state: AuthState | null): void;
}

export function fakeAuth(initial: AuthState | null = SIGNED_IN): FakeAuth {
  const listeners = new Set<(s: AuthState | null) => void>();
  const api: FakeAuth = {
    state: initial,
    setState(state) {
      api.state = state;
      for (const l of [...listeners]) l(state);
    },
    isSignedIn: () => api.state !== null,
    beginSignIn: async () => ({ url: 'https://claude.ai/oauth/authorize?state=s', state: 's' }),
    completeSignIn: async () => {
      api.setState(SIGNED_IN);
      return SIGNED_IN;
    },
    getAccessToken: async () => api.state?.accessToken ?? '',
    refresh: async () => api.state ?? SIGNED_IN,
    signOut: async () => api.setState(null),
    orgUuid: () => api.state?.orgUuid,
    setOrgUuid: async (uuid) => {
      if (api.state) api.setState({ ...api.state, orgUuid: uuid });
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  return api;
}

export const DEFAULT_CONTEXT: CapturedContext = {
  vaultName: 'yes-chef',
  activeNote: { path: 'menus/latitude 10/menu.md', cursorLine: 42 },
  selection: { text: 'dashi, kombu cure, fino', fromLine: 40, toLine: 44, truncated: false },
  openNotes: ['components/dashi.md', 'techniques/kombu-cure.md'],
  mentions: [],
};

export const DEFAULT_FILES = [
  'menus/latitude 10/menu.md',
  'menus/latitude 9/menu.md',
  'components/dashi.md',
  'techniques/kombu-cure.md',
  'recipes/tare.md',
];

export interface FakeFacadeOptions {
  isMobile?: boolean;
  settings?: Partial<ClaudsidianSettings>;
  context?: CapturedContext;
  files?: string[];
  /** recently opened paths, newest first (what getRecentFiles returns) */
  recentFiles?: string[];
  auth?: FakeAuth;
}

export class FakeFacade implements PluginFacade {
  isMobile: boolean;
  vaultName = 'yes-chef';
  version = '2.0.0-test';
  auth: FakeAuth;
  settingsValue: ClaudsidianSettings;
  context: CapturedContext;
  files: string[];
  recentFiles: string[];
  pickImagesResult: File[] = [];
  signInResult = true;
  insertResult = true;
  replaceResult = true;

  readonly calls: RecordedCall[] = [];
  readonly notices: string[] = [];
  readonly clipboard: string[] = [];
  readonly inserted: string[] = [];
  readonly replaced: string[] = [];
  readonly createdNotes: { path: string; content: string }[] = [];
  readonly openedFiles: string[] = [];
  readonly externalUrls: string[] = [];
  wakeLock: boolean | null = null;

  constructor(opts: FakeFacadeOptions = {}) {
    this.isMobile = opts.isMobile ?? false;
    this.settingsValue = { ...structuredClone(DEFAULT_SETTINGS), ...opts.settings };
    this.context = opts.context ?? structuredClone(DEFAULT_CONTEXT);
    this.files = opts.files ?? [...DEFAULT_FILES];
    this.recentFiles = opts.recentFiles ?? [];
    this.auth = opts.auth ?? fakeAuth();
  }

  callsTo(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  settings(): ClaudsidianSettings {
    return this.settingsValue;
  }

  async saveSettings(patch: Partial<ClaudsidianSettings>): Promise<void> {
    this.record('saveSettings', patch);
    this.settingsValue = { ...this.settingsValue, ...patch };
  }

  async renderMarkdown(markdown: string, el: HTMLElement, sourcePath?: string): Promise<void> {
    this.record('renderMarkdown', markdown, sourcePath);
    el.textContent = markdown;
  }

  captureContext(mentions: string[]): CapturedContext {
    this.record('captureContext', [...mentions]);
    return {
      ...this.context,
      activeNote: this.context.activeNote ? { ...this.context.activeNote } : undefined,
      selection: this.context.selection ? { ...this.context.selection } : undefined,
      openNotes: [...this.context.openNotes],
      mentions: [...mentions],
    };
  }

  vaultFiles(): string[] {
    this.record('vaultFiles');
    return [...this.files];
  }

  getRecentFiles(limit: number): string[] {
    this.record('getRecentFiles', limit);
    return this.recentFiles.slice(0, limit);
  }

  async openFile(path: string): Promise<void> {
    this.record('openFile', path);
    this.openedFiles.push(path);
  }

  async insertAtCursor(text: string): Promise<boolean> {
    this.record('insertAtCursor', text);
    this.inserted.push(text);
    return this.insertResult;
  }

  async replaceSelection(text: string): Promise<boolean> {
    this.record('replaceSelection', text);
    this.replaced.push(text);
    return this.replaceResult;
  }

  async createNote(path: string, content: string): Promise<string> {
    this.record('createNote', path, content);
    this.createdNotes.push({ path, content });
    return path;
  }

  async copyToClipboard(text: string): Promise<void> {
    this.record('copyToClipboard', text);
    this.clipboard.push(text);
  }

  openExternal(url: string): void {
    this.record('openExternal', url);
    this.externalUrls.push(url);
  }

  notice(text: string, timeoutMs?: number): void {
    this.record('notice', text, timeoutMs);
    this.notices.push(text);
  }

  async pickImages(): Promise<File[]> {
    this.record('pickImages');
    return this.pickImagesResult;
  }

  async signIn(): Promise<boolean> {
    this.record('signIn');
    if (this.signInResult) this.auth.setState(SIGNED_IN);
    return this.signInResult;
  }

  async setWakeLock(on: boolean): Promise<void> {
    this.record('setWakeLock', on);
    this.wakeLock = on;
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }
}
