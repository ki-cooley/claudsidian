/**
 * ObsidianFacade: the PluginFacade the Preact UI talks to inside Obsidian. Wraps the vault, workspace,
 * editor, clipboard, image picker, sign-in modal, and wake lock so components never import obsidian.
 */
import { MarkdownRenderer, MarkdownView, Notice, Platform, type Component, type Editor, type Vault } from 'obsidian';
import type { AuthApi } from '../api/auth-api';
import type { CapturedContext } from '../core/types';
import type ClaudsidianPlugin from '../main';
import type { ClaudsidianSettings } from '../settings';
import type { PluginFacade } from '../ui/facade';
import { SignInModal } from '../ui/modals/SignInModal';
import { log } from '../util/log';

/** What the facade needs from the plugin; tests build this shape without a real plugin. */
export type FacadeHost = Pick<ClaudsidianPlugin, 'app' | 'manifest' | 'settings' | 'auth' | 'capture' | 'saveSettings'>;

interface ScreenLock {
  release(): Promise<void>;
  addEventListener?(type: 'release', cb: () => void): void;
}

/** Give up on numbered suffixes after this many collisions and use a timestamp instead. */
const MAX_SUFFIX = 1000;

/** `path` when free, else `stem 2.ext`, `stem 3.ext`, ... (the suffix goes before the extension). */
export function uniqueNotePath(exists: (path: string) => boolean, path: string): string {
  if (!exists(path)) return path;
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const hasExt = dot > slash + 1;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : '';
  for (let n = 2; n < MAX_SUFFIX; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem} ${Date.now()}${ext}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ObsidianFacade implements PluginFacade {
  private wakeLock: ScreenLock | null = null;

  constructor(
    private readonly plugin: FacadeHost,
    private readonly component: Component,
  ) {}

  get isMobile(): boolean {
    return Platform.isMobile;
  }

  get vaultName(): string {
    return this.plugin.app.vault.getName();
  }

  get version(): string {
    return this.plugin.manifest.version;
  }

  get auth(): AuthApi {
    return this.plugin.auth;
  }

  settings(): ClaudsidianSettings {
    return this.plugin.settings;
  }

  saveSettings(patch: Partial<ClaudsidianSettings>): Promise<void> {
    return this.plugin.saveSettings(patch);
  }

  renderMarkdown(markdown: string, el: HTMLElement, sourcePath?: string): Promise<void> {
    return MarkdownRenderer.render(this.plugin.app, markdown, el, sourcePath ?? '', this.component);
  }

  captureContext(mentions: string[]): CapturedContext {
    return this.plugin.capture.capture(this.plugin.settings.context, mentions);
  }

  vaultFiles(): string[] {
    return this.plugin.app.vault
      .getMarkdownFiles()
      .map((f) => f.path)
      .sort((a, b) => a.localeCompare(b));
  }

  async openFile(path: string): Promise<void> {
    await this.plugin.app.workspace.openLinkText(path, '', false);
  }

  async insertAtCursor(text: string): Promise<boolean> {
    const editor = this.activeEditor();
    if (!editor) return false;
    editor.replaceRange(text, editor.getCursor());
    return true;
  }

  async replaceSelection(text: string): Promise<boolean> {
    const editor = this.activeEditor();
    if (!editor) return false;
    editor.replaceSelection(text);
    return true;
  }

  async createNote(path: string, content: string): Promise<string> {
    const vault = this.plugin.app.vault;
    const target = uniqueNotePath((p) => vault.getAbstractFileByPath(p) !== null, path);
    await this.ensureFolder(vault, target);
    const file = await vault.create(target, content);
    return file.path || target;
  }

  async copyToClipboard(text: string): Promise<void> {
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      try {
        await clipboard.writeText(text);
        return;
      } catch (err) {
        log.debug('clipboard.writeText failed; using the textarea fallback', { message: messageOf(err) });
      }
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    try {
      area.focus();
      area.select();
      area.setSelectionRange(0, text.length);
      const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
      if (!copied) throw new Error('Clipboard is not available here');
    } finally {
      area.remove();
    }
  }

  openExternal(url: string): void {
    window.open(url, '_blank');
  }

  notice(text: string, timeoutMs?: number): void {
    new Notice(text, timeoutMs);
  }

  pickImages(): Promise<File[]> {
    return new Promise<File[]>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.style.display = 'none';
      let settled = false;
      const finish = (files: File[]): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(files);
      };
      const chosen = (): File[] => Array.from(input.files ?? []);
      // Browsers without the cancel event only hand focus back; give a late change event a moment to land.
      const onFocus = (): void => {
        window.setTimeout(() => finish(chosen()), 1000);
      };
      input.addEventListener('change', () => finish(chosen()));
      input.addEventListener('cancel', () => finish([]));
      document.body.appendChild(input);
      window.addEventListener('focus', onFocus, { once: true });
      input.click();
    });
  }

  signIn(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      new SignInModal(this.plugin.app, this.plugin.auth, resolve).open();
    });
  }

  async setWakeLock(on: boolean): Promise<void> {
    if (!on) {
      const held = this.wakeLock;
      this.wakeLock = null;
      if (held) {
        try {
          await held.release();
        } catch (err) {
          log.debug('wake lock release failed', { message: messageOf(err) });
        }
      }
      return;
    }
    if (this.wakeLock) return;
    const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<ScreenLock> } }).wakeLock;
    if (!api || typeof api.request !== 'function') return;
    try {
      const lock = await api.request('screen');
      this.wakeLock = lock;
      lock.addEventListener?.('release', () => {
        if (this.wakeLock === lock) this.wakeLock = null;
      });
    } catch (err) {
      log.debug('wake lock unavailable', { message: messageOf(err) });
    }
  }

  /** The active markdown editor, or the last one that was active when our own view holds focus. */
  private activeEditor(): Editor | null {
    const workspace = this.plugin.app.workspace;
    const view = workspace.getActiveViewOfType(MarkdownView) ?? this.plugin.capture.lastMarkdownView;
    return view?.editor ?? null;
  }

  /** Create every missing ancestor folder of a note path, in order. */
  private async ensureFolder(vault: Vault, notePath: string): Promise<void> {
    const parts = notePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (vault.getAbstractFileByPath(current)) continue;
      try {
        await vault.createFolder(current);
      } catch (err) {
        log.debug('createFolder failed; vault.create may still succeed', { path: current, message: messageOf(err) });
      }
    }
  }
}
