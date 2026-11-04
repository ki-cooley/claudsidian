/**
 * SignInModal: the three-step manual-code OAuth flow. Opens claude.ai (or shows the URL to
 * copy), takes the pasted code, calls AuthApi.completeSignIn, and shows the server's error
 * text under the field without closing. Closes and reports onDone(true) on success. Finish sits beside the
 * code field, return finishes, and a pasted code#state finishes at once.
 *
 * Phone: iOS lays the keyboard over the webview without shrinking it, so the code field sat behind the keys,
 * the modal had nothing to scroll, and the paste callout opened out of sight. Paste reads the clipboard with
 * no keyboard at all, and while the keyboard is up the modal is lifted above it and limited to the visible
 * height so it scrolls. When the phone will not paste at all, "Sign in a phone or iPad from this Mac" on desktop
 * does the whole thing there and Obsidian Sync carries the sign-in over (Plugin.adoptHandoff).
 */
import { App, Modal, Notice, Platform } from 'obsidian';
import type { AuthApi } from '../../api/auth-api';
import { installKeyboardDismiss, submitOnReturn } from '../keyboard';

const KEYBOARD_VAR = '--claudsidian-modal-kb';
const VISIBLE_VAR = '--claudsidian-modal-vvh';

export class SignInModal extends Modal {
  private url = '';
  private done = false;
  private busy = false;
  private urlField: HTMLInputElement | null = null;
  private codeField: HTMLInputElement | null = null;
  private errorEl: HTMLElement | null = null;
  private finishBtn: HTMLButtonElement | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    app: App,
    private readonly auth: AuthApi,
    private readonly onDone?: (signedIn: boolean) => void,
    private readonly text: { title?: string; intro?: string } = {},
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.text.title ?? 'Sign in to Claude');
    this.modalEl.addClass('claudsidian-modal', 'claudsidian-sign-in');
    const root = this.contentEl;
    root.empty();

    root.createEl('p', {
      text: this.text.intro ?? 'Open claude.ai and approve access, copy the code it shows, then paste that code here.',
    });

    const step1 = root.createDiv({ cls: 'claudsidian-sign-in-step' });
    step1.createEl('div', { cls: 'claudsidian-sign-in-label', text: '1. Open claude.ai' });
    const openBtn = step1.createEl('button', { cls: 'mod-cta', text: 'Open claude.ai' });
    openBtn.addEventListener('click', () => {
      if (!this.url) return;
      try {
        window.open(this.url);
      } catch {
        new Notice('Could not open a browser. Copy the link instead.');
      }
    });
    const urlRow = step1.createDiv({ cls: ['claudsidian-sign-in-row', 'claudsidian-sign-in-url'] });
    this.urlField = urlRow.createEl('input', { type: 'text', attr: { readonly: 'true', 'aria-label': 'Sign-in link' } });
    this.urlField.readOnly = true;
    this.urlField.addEventListener('focus', () => this.urlField?.select());
    const copyBtn = urlRow.createEl('button', { text: 'Copy' });
    copyBtn.addEventListener('click', () => void this.copyUrl());

    const step2 = root.createDiv({ cls: 'claudsidian-sign-in-step' });
    step2.createEl('div', { cls: 'claudsidian-sign-in-label', text: '2. Paste the code here' });
    const pasteBtn = step2.createEl('button', { cls: ['mod-cta', 'claudsidian-sign-in-paste'], text: 'Paste code' });
    pasteBtn.addEventListener('click', () => void this.pasteFromClipboard());
    const codeRow = step2.createDiv({ cls: 'claudsidian-sign-in-row' });
    this.codeField = codeRow.createEl('input', {
      type: 'text',
      placeholder: 'or paste the code here',
      attr: { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Paste the code here' },
    });
    this.cleanups.push(submitOnReturn(this.codeField, () => void this.finish()));
    // claude.ai shows the code as code#state; a paste of that shape is the whole code, so finish without another tap
    this.codeField.addEventListener('paste', () => {
      window.setTimeout(() => {
        if (this.codeField?.value.trim().includes('#')) void this.finish();
      }, 0);
    });
    this.finishBtn = codeRow.createEl('button', { cls: 'mod-cta', text: 'Finish' });
    this.finishBtn.addEventListener('click', () => void this.finish());
    this.errorEl = step2.createDiv({ cls: 'claudsidian-sign-in-error' });
    this.errorEl.setAttr('role', 'alert');
    this.errorEl.hide();

    const foot = root.createEl('p', { cls: 'claudsidian-sign-in-foot' });
    if (Platform.isMobile && !this.text.title) {
      foot.appendText('Paste not working here? On your Mac, run "Sign in a phone or iPad from this Mac" and this device signs in through Obsidian Sync. ');
    }
    foot.appendText(`Claudsidian ${this.version()}`);

    if (Platform.isMobile) {
      this.cleanups.push(installKeyboardDismiss(this.modalEl));
      this.cleanups.push(this.fitAboveKeyboard());
    }

    void this.begin();
  }

  onClose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.contentEl.empty();
    if (!this.done) {
      this.done = true;
      this.onDone?.(false);
    }
  }

  private async begin(): Promise<void> {
    try {
      const { url } = await this.auth.beginSignIn();
      this.url = url;
      if (this.urlField) this.urlField.value = url;
    } catch (err) {
      this.showError(`Could not start sign-in: ${messageOf(err)}`);
    }
  }

  /** Reads the code from the clipboard (iOS shows its own Paste confirmation) and finishes with it. */
  private async pasteFromClipboard(): Promise<void> {
    let text = '';
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch (err) {
      this.showError(`Could not read the clipboard (${messageOf(err)}). Long-press the field below and tap Paste.`);
      this.codeField?.focus();
      return;
    }
    if (!text) {
      this.showError('The clipboard is empty. Copy the code on claude.ai first.');
      return;
    }
    if (this.codeField) this.codeField.value = text;
    await this.finish();
  }

  /**
   * Keeps the modal inside the part of the screen the keyboard leaves visible: the container is padded by the
   * keyboard's height and the modal capped at the visible height, so it scrolls instead of hiding under the keys.
   * Returns the remover.
   */
  private fitAboveKeyboard(): () => void {
    const viewport = window.visualViewport;
    if (!viewport) return () => {};
    const container = this.containerEl;
    const update = (): void => {
      const kb = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      container.style.setProperty(KEYBOARD_VAR, `${kb}px`);
      container.style.setProperty(VISIBLE_VAR, `${Math.round(viewport.height)}px`);
      if (kb > 0 && document.activeElement instanceof HTMLElement && this.modalEl.contains(document.activeElement)) {
        document.activeElement.scrollIntoView({ block: 'nearest' });
      }
    };
    let settle: number | undefined;
    const onViewport = (): void => {
      update();
      window.clearTimeout(settle);
      settle = window.setTimeout(update, 350);
    };
    viewport.addEventListener('resize', onViewport);
    viewport.addEventListener('scroll', onViewport);
    update();
    return () => {
      window.clearTimeout(settle);
      viewport.removeEventListener('resize', onViewport);
      viewport.removeEventListener('scroll', onViewport);
      container.style.removeProperty(KEYBOARD_VAR);
      container.style.removeProperty(VISIBLE_VAR);
    };
  }

  private version(): string {
    const plugins = (this.app as unknown as { plugins?: { manifests?: Record<string, { version?: string }> } }).plugins;
    return plugins?.manifests?.claudsidian?.version ?? '';
  }

  private async copyUrl(): Promise<void> {
    if (!this.url) return;
    try {
      await navigator.clipboard.writeText(this.url);
      new Notice('Link copied');
    } catch {
      this.urlField?.focus();
      this.urlField?.select();
      new Notice('Copy failed. The link is selected; copy it by hand.');
    }
  }

  private async finish(): Promise<void> {
    if (this.busy || this.done) return;
    const pasted = this.codeField?.value.trim() ?? '';
    if (!pasted) {
      this.showError('Paste the code from claude.ai first.');
      this.codeField?.focus();
      return;
    }
    this.busy = true;
    this.finishBtn?.setAttr('disabled', 'true');
    this.showError(null);
    try {
      await this.auth.completeSignIn(pasted);
      this.done = true;
      this.onDone?.(true);
      this.close();
    } catch (err) {
      this.showError(messageOf(err));
    } finally {
      this.busy = false;
      this.finishBtn?.removeAttribute('disabled');
    }
  }

  private showError(message: string | null): void {
    if (!this.errorEl) return;
    if (!message) {
      this.errorEl.setText('');
      this.errorEl.hide();
      return;
    }
    this.errorEl.setText(message);
    this.errorEl.show();
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}
