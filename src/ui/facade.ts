/**
 * Everything the Preact UI needs from Obsidian, behind one interface so components stay
 * testable in jsdom and runnable in the browser harness. Implemented in src/ui/ChatView.ts.
 */
import type { ClaudsidianSettings } from '../settings';
import type { CapturedContext } from '../core/types';
import type { AuthApi } from '../api/auth-api';

export interface PluginFacade {
  readonly isMobile: boolean;
  readonly vaultName: string;
  readonly version: string;
  readonly auth: AuthApi;
  settings(): ClaudsidianSettings;
  saveSettings(patch: Partial<ClaudsidianSettings>): Promise<void>;
  /** Render markdown into `el` using Obsidian's renderer (sanitised). */
  renderMarkdown(markdown: string, el: HTMLElement, sourcePath?: string): Promise<void>;
  /** Capture active note, selection, cursor, open notes. `mentions` are @paths typed in the composer. */
  captureContext(mentions: string[]): CapturedContext;
  /** All markdown file paths in the vault, for the @ suggester. */
  vaultFiles(): string[];
  openFile(path: string): Promise<void>;
  insertAtCursor(text: string): Promise<boolean>;
  replaceSelection(text: string): Promise<boolean>;
  createNote(path: string, content: string): Promise<string>;
  copyToClipboard(text: string): Promise<void>;
  openExternal(url: string): void;
  notice(text: string, timeoutMs?: number): void;
  /** Native image picker; resolves [] when cancelled. */
  pickImages(): Promise<File[]>;
  /** Open the sign-in modal; resolves true when signed in. */
  signIn(): Promise<boolean>;
  /** Keep the screen on while true (no-op where unsupported). */
  setWakeLock(on: boolean): Promise<void>;
}
