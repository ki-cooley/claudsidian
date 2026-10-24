/**
 * RenameModal: one text field prefilled with the current title. Enter or the Rename button submits a
 * trimmed, non-empty title; closing without one submits nothing.
 */
import { App, Modal, Platform } from 'obsidian';
import { installKeyboardDismiss, submitOnReturn } from '../keyboard';

export class RenameModal extends Modal {
  private value: string;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    app: App,
    initial: string,
    private readonly onSubmit: (title: string) => void,
  ) {
    super(app);
    this.value = initial;
  }

  onOpen(): void {
    this.setTitle('Rename session');
    this.modalEl.addClass('claudsidian-modal', 'claudsidian-rename');
    const root = this.contentEl;
    root.empty();

    const input = root.createEl('input', {
      type: 'text',
      cls: 'claudsidian-modal-input',
      attr: { 'aria-label': 'Session title', spellcheck: 'false', autocapitalize: 'sentences' },
    });
    input.value = this.value;
    input.addEventListener('input', () => {
      this.value = input.value;
    });
    this.cleanups.push(submitOnReturn(input, () => this.submit(), 'done'));
    if (Platform.isMobile) this.cleanups.push(installKeyboardDismiss(this.modalEl));

    const actions = root.createDiv({ cls: 'claudsidian-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    actions.createEl('button', { text: 'Rename', cls: 'mod-cta' }).addEventListener('click', () => this.submit());

    input.focus();
    input.select();
  }

  onClose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.contentEl.empty();
  }

  private submit(): void {
    const title = this.value.trim();
    if (!title) return;
    this.close();
    this.onSubmit(title);
  }
}
