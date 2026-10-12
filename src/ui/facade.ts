/**
 * Everything the Preact UI needs from Obsidian, behind one interface so components stay
 * testable in jsdom and runnable in the browser harness. Implemented in src/ui/ChatView.ts.
 */
import type { ClaudsidianSettings } from '../settings';
import type { CapturedContext } from '../core/types';
import type { AuthApi } from '../api/auth-api';

/** What renderMarkdown may resolve with: something the caller can unload when the rendered block goes away. */
export interface MarkdownRenderHandle {
  unload(): void;
}

export interface PluginFacade {
  readonly isMobile: boolean;
  readonly vaultName: string;
  readonly version: string;
  readonly auth: AuthApi;
  settings(): ClaudsidianSettings;
  saveSettings(patch: Partial<ClaudsidianSettings>): Promise<void>;
  /**
   * Render markdown into `el` using Obsidian's renderer (sanitised). May resolve with a handle whose
   * unload() releases the render's child components; the caller unloads it when the block re-renders or unmounts.
   */
  renderMarkdown(markdown: string, el: HTMLElement, sourcePath?: string): Promise<void | MarkdownRenderHandle>;
  /** Capture active note, selection, cursor, open notes. `mentions` are @paths typed in the composer. */
  captureContext(mentions: string[]): CapturedContext;
  /** All markdown file paths in the vault, for the @ suggester. */
  vaultFiles(): string[];
  /**
   * Recently opened note paths, newest first, at most `limit`, for the @ suggester's empty query.
   * Optional so older facade implementations (the harness shim, test fakes) keep working; the UI
   * treats a missing method as no recent files.
   */
  getRecentFiles?(limit: number): string[];
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
