/**
 * ConfirmModal: a sentence and two buttons. The confirming button carries the action's own name
 * ("Archive", not "OK") and runs onConfirm after the modal closes; Cancel and Escape run nothing.
 */
import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly text: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.confirmLabel);
    this.modalEl.addClass('claudsidian-modal', 'claudsidian-confirm');
    const root = this.contentEl;
    root.empty();
    root.createEl('p', { text: this.text, cls: 'claudsidian-confirm-text' });

    const actions = root.createDiv({ cls: 'claudsidian-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const confirm = actions.createEl('button', { text: this.confirmLabel, cls: 'mod-warning' });
    confirm.addEventListener('click', () => {
      this.close();
      this.onConfirm();
    });
    confirm.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
