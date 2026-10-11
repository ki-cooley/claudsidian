// Shim: Modal (renders into a .modal-container overlay), Notice (toast in #notices), SuggestModal, FuzzySuggestModal.
import { Scope } from './platform';

export class Modal {
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  scope = new Scope();
  shouldRestoreSelection = false;
  private readonly bgEl: HTMLElement;
  private readonly closeButtonEl: HTMLElement;
  private isOpen = false;
  private readonly onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
      return;
    }
    this.scope.handle(ev);
  };

  constructor(public app: unknown) {
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'modal-container mod-dim';
    this.bgEl = this.containerEl.createDiv({ cls: 'modal-bg' });
    this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
    this.closeButtonEl = this.modalEl.createDiv({ cls: 'modal-close-button', attr: { 'aria-label': 'Close', role: 'button', tabindex: '0' } });
    const header = this.modalEl.createDiv({ cls: 'modal-header' });
    this.titleEl = header.createDiv({ cls: 'modal-title' });
    this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
    this.bgEl.addEventListener('click', () => this.close());
    this.closeButtonEl.addEventListener('click', () => this.close());
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    document.body.appendChild(this.containerEl);
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', this.onKey);
    this.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    document.removeEventListener('keydown', this.onKey);
    this.onClose();
    this.containerEl.remove();
    if (!document.querySelector('.modal-container')) document.body.classList.remove('modal-open');
  }

  onOpen(): void {}
  onClose(): void {}

  setTitle(title: string): this {
    this.titleEl.setText(title);
    return this;
  }
  setContent(content: string | DocumentFragment): this {
    this.contentEl.empty();
    if (typeof content === 'string') this.contentEl.setText(content);
    else this.contentEl.appendChild(content);
    return this;
  }
}

export class ConfirmationModal extends Modal {}

export class Notice {
  static container(): HTMLElement {
    let el = document.getElementById('notices');
    if (!el) {
      el = document.createElement('div');
      el.id = 'notices';
      el.className = 'notice-container';
      document.body.appendChild(el);
    }
    return el;
  }

  noticeEl: HTMLElement;
  messageEl: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(message: string | DocumentFragment, duration = 5000) {
    this.noticeEl = Notice.container().createDiv({ cls: 'notice' });
    this.messageEl = this.noticeEl.createDiv({ cls: 'notice-message' });
    this.setMessage(message);
    this.noticeEl.addEventListener('click', () => this.hide());
    if (duration > 0) this.timer = setTimeout(() => this.hide(), duration);
  }

  setMessage(message: string | DocumentFragment): this {
    this.messageEl.empty();
    if (typeof message === 'string') this.messageEl.setText(message);
    else this.messageEl.appendChild(message);
    return this;
  }

  hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.noticeEl.remove();
  }
}

export abstract class SuggestModal<T> extends Modal {
  inputEl: HTMLInputElement;
  resultContainerEl: HTMLElement;
  limit = 100;
  emptyStateText = 'No results';
  private items: T[] = [];
  private selected = 0;

  constructor(app: unknown) {
    super(app);
    this.modalEl.addClass('mod-suggest');
    const prompt = this.contentEl.createDiv({ cls: 'prompt' });
    this.inputEl = prompt.createEl('input', { cls: 'prompt-input', type: 'text' });
    this.resultContainerEl = prompt.createDiv({ cls: 'prompt-results' });
    this.inputEl.addEventListener('input', () => void this.refresh());
    this.inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') this.move(1);
      else if (ev.key === 'ArrowUp') this.move(-1);
      else if (ev.key === 'Enter') {
        const item = this.items[this.selected];
        if (item !== undefined) {
          this.close();
          this.onChooseSuggestion(item, ev);
        }
      }
    });
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;

  setPlaceholder(placeholder: string): void {
    this.inputEl.placeholder = placeholder;
  }
  setInstructions(_instructions: unknown[]): void {}
  onNoSuggestion(): void {
    this.resultContainerEl.empty();
    this.resultContainerEl.createDiv({ cls: 'suggestion-empty', text: this.emptyStateText });
  }
  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    this.close();
    this.onChooseSuggestion(value, evt);
  }

  onOpen(): void {
    this.inputEl.focus();
    void this.refresh();
  }

  private move(delta: number): void {
    if (!this.items.length) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.paint();
  }

  private async refresh(): Promise<void> {
    this.items = (await this.getSuggestions(this.inputEl.value)).slice(0, this.limit);
    this.selected = 0;
    if (!this.items.length) {
      this.onNoSuggestion();
      return;
    }
    this.paint();
  }

  private paint(): void {
    this.resultContainerEl.empty();
    this.items.forEach((item, i) => {
      const el = this.resultContainerEl.createDiv({ cls: 'suggestion-item' + (i === this.selected ? ' is-selected' : '') });
      this.renderSuggestion(item, el);
      el.addEventListener('click', (ev) => this.selectSuggestion(item, ev));
    });
  }
}

export interface FuzzyMatch<T> {
  item: T;
  match: { score: number; matches: [number, number][] };
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;

  getSuggestions(query: string): FuzzyMatch<T>[] {
    const q = query.toLowerCase();
    const out: FuzzyMatch<T>[] = [];
    for (const item of this.getItems()) {
      const text = this.getItemText(item);
      const i = text.toLowerCase().indexOf(q);
      if (i >= 0) out.push({ item, match: { score: -i, matches: [[i, i + q.length]] } });
    }
    return out;
  }
  renderSuggestion(value: FuzzyMatch<T>, el: HTMLElement): void {
    el.setText(this.getItemText(value.item));
  }
  onChooseSuggestion(item: FuzzyMatch<T>, evt: MouseEvent | KeyboardEvent): void {
    this.onChooseItem(item.item, evt);
  }
}
