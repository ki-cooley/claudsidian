// Shim: Menu (a popup with real .menu-item rows), MenuItem, popover suggesters (AbstractInputSuggest, EditorSuggest).
import { Component } from './events';
import { setIcon } from './icons';
import { Scope } from './platform';

export class MenuItem {
  dom: HTMLElement;
  iconEl: HTMLElement;
  titleEl: HTMLElement;
  private handler: ((evt: MouseEvent | KeyboardEvent) => unknown) | null = null;
  disabled = false;
  section = '';

  constructor(private readonly menu: Menu) {
    this.dom = document.createElement('div');
    this.dom.className = 'menu-item';
    this.dom.setAttribute('role', 'menuitem');
    this.iconEl = this.dom.createDiv({ cls: 'menu-item-icon' });
    this.titleEl = this.dom.createDiv({ cls: 'menu-item-title' });
    this.dom.addEventListener('click', (ev) => {
      if (this.disabled) return;
      this.menu.hide();
      void this.handler?.(ev);
    });
  }
  setTitle(title: string | DocumentFragment): this {
    this.titleEl.setText(title);
    return this;
  }
  setIcon(icon: string | null): this {
    if (icon) setIcon(this.iconEl, icon);
    return this;
  }
  setChecked(checked: boolean | null): this {
    this.dom.toggleClass('is-checked', checked === true);
    return this;
  }
  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.dom.toggleClass('is-disabled', disabled);
    return this;
  }
  setIsLabel(isLabel: boolean): this {
    this.dom.toggleClass('is-label', isLabel);
    return this;
  }
  setSection(section: string): this {
    this.section = section;
    this.dom.setAttribute('data-section', section);
    return this;
  }
  setWarning(warning: boolean): this {
    this.dom.toggleClass('is-warning', warning);
    return this;
  }
  onClick(cb: (evt: MouseEvent | KeyboardEvent) => unknown): this {
    this.handler = cb;
    return this;
  }
}

export class MenuSeparator {}

export class Menu extends Component {
  dom: HTMLElement;
  items: MenuItem[] = [];
  private hideCallbacks: (() => unknown)[] = [];
  private readonly onDocClick = (ev: MouseEvent): void => {
    if (!this.dom.contains(ev.target as Node)) this.hide();
  };
  private readonly onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') this.hide();
  };

  constructor() {
    super();
    this.dom = document.createElement('div');
    this.dom.className = 'menu';
    this.dom.setAttribute('role', 'menu');
  }

  setUseNativeMenu(_use: boolean): this {
    return this;
  }
  setNoIcon(): this {
    this.dom.addClass('mod-no-icon');
    return this;
  }
  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem(this);
    this.items.push(item);
    this.dom.appendChild(item.dom);
    cb(item);
    return this;
  }
  addSeparator(): this {
    this.dom.createDiv({ cls: 'menu-separator' });
    return this;
  }
  addSections(_sections: string[]): this {
    return this;
  }
  showAtMouseEvent(evt: MouseEvent): this {
    return this.showAtPosition({ x: evt.clientX, y: evt.clientY });
  }
  showAtPosition(position: { x: number; y: number }): this {
    document.body.appendChild(this.dom);
    const rect = this.dom.getBoundingClientRect();
    const x = Math.max(4, Math.min(position.x, window.innerWidth - rect.width - 4));
    const y = Math.max(4, Math.min(position.y, window.innerHeight - rect.height - 4));
    this.dom.style.left = `${x}px`;
    this.dom.style.top = `${y}px`;
    setTimeout(() => {
      document.addEventListener('mousedown', this.onDocClick, true);
      document.addEventListener('keydown', this.onKey);
    }, 0);
    this.load();
    return this;
  }
  hide(): this {
    document.removeEventListener('mousedown', this.onDocClick, true);
    document.removeEventListener('keydown', this.onKey);
    this.dom.remove();
    this.unload();
    for (const cb of this.hideCallbacks) void cb();
    return this;
  }
  close(): void {
    this.hide();
  }
  onHide(cb: () => unknown): void {
    this.hideCallbacks.push(cb);
  }
}

export abstract class PopoverSuggest<T> {
  suggestEl: HTMLElement;
  scope = new Scope();
  protected isOpen = false;
  constructor(public app: unknown, _scope?: Scope) {
    this.suggestEl = document.createElement('div');
    this.suggestEl.className = 'suggestion-container';
  }
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
  open(): void {
    this.isOpen = true;
    document.body.appendChild(this.suggestEl);
  }
  close(): void {
    this.isOpen = false;
    this.suggestEl.remove();
  }
}

export abstract class AbstractInputSuggest<T> extends PopoverSuggest<T> {
  limit = 100;
  private selectCb: ((value: T, evt: MouseEvent | KeyboardEvent) => unknown) | null = null;
  constructor(app: unknown, protected readonly textInputEl: HTMLInputElement | HTMLDivElement) {
    super(app);
    textInputEl.addEventListener('input', () => void this.refresh());
    textInputEl.addEventListener('focus', () => void this.refresh());
    textInputEl.addEventListener('blur', () => setTimeout(() => this.close(), 150));
  }
  protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
  setValue(value: string): void {
    if (this.textInputEl instanceof HTMLInputElement) this.textInputEl.value = value;
    else this.textInputEl.textContent = value;
  }
  getValue(): string {
    return this.textInputEl instanceof HTMLInputElement ? this.textInputEl.value : this.textInputEl.textContent ?? '';
  }
  onSelect(cb: (value: T, evt: MouseEvent | KeyboardEvent) => unknown): this {
    this.selectCb = cb;
    return this;
  }
  selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
    void this.selectCb?.(value, evt);
    this.close();
  }
  private async refresh(): Promise<void> {
    const items = (await this.getSuggestions(this.getValue())).slice(0, this.limit);
    this.suggestEl.empty();
    if (!items.length) {
      this.close();
      return;
    }
    for (const item of items) {
      const el = this.suggestEl.createDiv({ cls: 'suggestion-item' });
      this.renderSuggestion(item, el);
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.selectSuggestion(item, ev);
      });
    }
    const rect = this.textInputEl.getBoundingClientRect();
    this.suggestEl.style.left = `${rect.left}px`;
    this.suggestEl.style.top = `${rect.bottom + 2}px`;
    this.suggestEl.style.minWidth = `${rect.width}px`;
    this.open();
  }
}

export abstract class EditorSuggest<T> extends PopoverSuggest<T> {
  context: unknown = null;
  limit = 100;
  setInstructions(_i: unknown[]): void {}
  abstract onTrigger(cursor: unknown, editor: unknown, file: unknown): unknown;
  abstract getSuggestions(context: unknown): T[] | Promise<T[]>;
}
