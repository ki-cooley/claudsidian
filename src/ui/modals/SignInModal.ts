/**
 * SignInModal: the three-step manual-code OAuth flow. Opens claude.ai (or shows the URL to
 * copy), takes the pasted code, calls AuthApi.completeSignIn, and shows the server's error
 * text under the field without closing. Closes and reports onDone(true) on success. Finish sits beside the
 * code field so it stays above the phone keyboard, return finishes, and a pasted code#state finishes at once.
 */
import { App, Modal, Notice, Platform } from 'obsidian';
import type { AuthApi } from '../../api/auth-api';
import { installKeyboardDismiss, submitOnReturn } from '../keyboard';

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
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Sign in to Claude');
    this.modalEl.addClass('claudsidian-modal', 'claudsidian-sign-in');
    const root = this.contentEl;
    root.empty();

    root.createEl('p', {
      text: 'Open claude.ai and approve access, copy the code it shows, then paste that code here.',
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
    const codeRow = step2.createDiv({ cls: 'claudsidian-sign-in-row' });
    this.codeField = codeRow.createEl('input', {
      type: 'text',
      placeholder: 'Paste the code here',
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

    if (Platform.isMobile) this.cleanups.push(installKeyboardDismiss(this.modalEl));

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
