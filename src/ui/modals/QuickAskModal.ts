/**
 * QuickAskModal: ask about the editor selection without leaving the note. Sends the question to the open
 * session with the selection as context; when the reply lands, a notice offers to insert it at the cursor.
 */
import { App, Modal, Notice } from 'obsidian';
import { formatContextBlock } from '../../core/context-format';
import type { CapturedContext, TranscriptState } from '../../core/types';
import type ClaudsidianPlugin from '../../main';
import { ObsidianFacade } from '../../obsidian/facade-impl';

const DEFAULT_QUESTION = 'Look at this selection.';
const PREVIEW_CHARS = 600;
/** Stop waiting for a reply after this long. */
const REPLY_WAIT_MS = 10 * 60_000;
const REPLY_NOTICE_MS = 20_000;

/** The newest top-level assistant text in a transcript, or undefined when there is none. */
export function lastAssistantText(state: TranscriptState): string | undefined {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (item && item.kind === 'assistant_text' && !item.parentToolUseId && item.text.trim()) return item.text;
  }
  return undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class QuickAskModal extends Modal {
  private question = '';
  private busy = false;

  constructor(
    app: App,
    private readonly plugin: ClaudsidianPlugin,
    private readonly selection: string,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Ask Claude about the selection');
    this.modalEl.addClass('claudsidian-modal', 'claudsidian-quick-ask');
    const root = this.contentEl;
    root.empty();

    const sessionId = this.plugin.store.selectedId.value;
    const title = sessionId ? this.sessionTitle(sessionId) : null;
    root.createDiv({
      cls: 'claudsidian-quick-ask-target',
      text: title ? `Sends to ${title}` : 'Open a session in Claudsidian first.',
    });

    const preview = root.createEl('pre', { cls: 'claudsidian-quick-ask-selection' });
    const shown = this.selection.length > PREVIEW_CHARS ? `${this.selection.slice(0, PREVIEW_CHARS)}\n[${this.selection.length - PREVIEW_CHARS} more characters]` : this.selection;
    preview.setText(shown);

    const field = root.createEl('textarea', {
      cls: 'claudsidian-modal-textarea',
      attr: { rows: '3', placeholder: DEFAULT_QUESTION, 'aria-label': 'Question' },
    });
    field.addEventListener('input', () => {
      this.question = field.value;
    });
    field.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        void this.send();
      }
    });

    const actions = root.createDiv({ cls: 'claudsidian-modal-actions' });
    actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    const send = actions.createEl('button', { text: 'Send', cls: 'mod-cta' });
    if (!sessionId) send.disabled = true;
    send.addEventListener('click', () => void this.send());

    field.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private sessionTitle(sessionId: string): string {
    return this.plugin.store.session(sessionId)?.title ?? 'the open session';
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    const store = this.plugin.store;
    const sessionId = store.selectedId.value;
    if (!sessionId) {
      new Notice('Open a session in Claudsidian first.');
      return;
    }
    this.busy = true;
    const text = this.question.trim() || DEFAULT_QUESTION;
    const contextText = formatContextBlock(this.contextWithSelection(), {
      vaultPathOnMac: this.plugin.settings.vaultPathOnMac,
      sessionCwd: store.transcript(sessionId).value.init?.cwd,
    });
    const title = this.sessionTitle(sessionId);
    this.close();
    try {
      await store.send(sessionId, text, { contextText });
    } catch (err) {
      new Notice(`Send failed: ${messageOf(err)}`);
      return;
    }
    new Notice(`Sent to ${title}`);
    this.waitForReply(sessionId, title);
  }

  /** The usual context with the selection forced in, so the question carries it even with auto context off. */
  private contextWithSelection(): CapturedContext {
    const settings = this.plugin.settings;
    const ctx = this.plugin.capture.capture(settings.context, []);
    const view = this.plugin.capture.lastMarkdownView;
    if (!ctx.activeNote && view?.file) ctx.activeNote = { path: view.file.path };
    if (ctx.selection && ctx.selection.text === this.selection) return ctx;
    const editor = view?.editor;
    const range = editor?.getSelection() === this.selection ? editor?.listSelections()[0] : undefined;
    const cursorLine = (editor?.getCursor().line ?? 0) + 1;
    const fromLine = range ? Math.min(range.anchor.line, range.head.line) + 1 : cursorLine;
    const toLine = range ? Math.max(range.anchor.line, range.head.line) + 1 : cursorLine;
    const max = Math.max(0, settings.context.maxSelectionChars);
    const truncated = this.selection.length > max;
    ctx.selection = { text: truncated ? this.selection.slice(0, max) : this.selection, fromLine, toLine, truncated };
    if (ctx.activeNote) delete ctx.activeNote.cursorLine;
    return ctx;
  }

  /** One notice with an "Insert at cursor" button when the session's next turn ends. */
  private waitForReply(sessionId: string, title: string): void {
    const store = this.plugin.store;
    const facade = new ObsidianFacade(this.plugin, this.plugin);
    let off: (() => void) | null = null;
    const timer = window.setTimeout(() => off?.(), REPLY_WAIT_MS);
    off = store.on('turn_end', (id, state) => {
      if (id !== sessionId) return;
      off?.();
      off = null;
      window.clearTimeout(timer);
      const reply = lastAssistantText(state);
      if (!reply) return;
      const fragment = document.createDocumentFragment();
      fragment.createSpan({ text: `${title} replied.` });
      const button = fragment.createEl('button', { text: 'Insert at cursor', cls: 'claudsidian-notice-action' });
      const notice = new Notice(fragment, REPLY_NOTICE_MS);
      button.addEventListener('click', () => {
        void facade.insertAtCursor(reply).then((ok) => {
          if (!ok) new Notice('No editor to insert into.');
          notice.hide();
        });
      });
    });
  }
}
