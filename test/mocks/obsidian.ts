/**
 * Minimal stand-in for the `obsidian` module in unit tests (jsdom). Extend as tests need;
 * keep behaviour dumb and predictable. Not used by the browser harness (that has its own shim).
 */
import { installDomHelpers } from './dom-helpers';

installDomHelpers();

export class Events {
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  on(name: string, cb: (...args: unknown[]) => void): { name: string; cb: typeof cb } {
    const list = this.handlers.get(name) ?? [];
    list.push(cb);
    this.handlers.set(name, list);
    return { name, cb };
  }
  off(name: string, cb: (...args: unknown[]) => void): void {
    this.handlers.set(name, (this.handlers.get(name) ?? []).filter((h) => h !== cb));
  }
  trigger(name: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(name) ?? []) h(...args);
  }
}

export class Component {
  private unloaders: (() => void)[] = [];
  load(): void {}
  unload(): void {
    for (const u of this.unloaders.splice(0)) u();
  }
  register(cb: () => void): void {
    this.unloaders.push(cb);
  }
  registerEvent(_ref: unknown): void {}
  registerDomEvent(el: EventTarget, type: string, cb: (ev: Event) => unknown, opts?: boolean | AddEventListenerOptions): void {
    el.addEventListener(type, cb, opts);
    this.register(() => el.removeEventListener(type, cb, opts));
  }
  registerInterval(id: number): number {
    return id;
  }
  addChild<T>(c: T): T {
    return c;
  }
}

export class TAbstractFile {
  path = '';
  name = '';
}
export class TFile extends TAbstractFile {
  extension = 'md';
  basename = '';
}
export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class Vault extends Events {
  getName(): string {
    return 'test-vault';
  }
  getMarkdownFiles(): TFile[] {
    return [];
  }
  getAbstractFileByPath(_p: string): TAbstractFile | null {
    return null;
  }
  async read(_f: TFile): Promise<string> {
    return '';
  }
  async create(_p: string, _c: string): Promise<TFile> {
    return new TFile();
  }
  adapter = { basePath: '/vault' };
}

export class WorkspaceLeaf {
  view: unknown = null;
  async setViewState(_s: unknown): Promise<void> {}
}

export class Workspace extends Events {
  activeLeaf: WorkspaceLeaf | null = null;
  getLeavesOfType(_t: string): WorkspaceLeaf[] {
    return [];
  }
  getRightLeaf(_split: boolean): WorkspaceLeaf | null {
    return new WorkspaceLeaf();
  }
  getLeaf(_new?: boolean | string): WorkspaceLeaf {
    return new WorkspaceLeaf();
  }
  async revealLeaf(_l: WorkspaceLeaf): Promise<void> {}
  getActiveViewOfType<T>(_t: unknown): T | null {
    return null;
  }
  getActiveFile(): TFile | null {
    return null;
  }
  iterateAllLeaves(_cb: (l: WorkspaceLeaf) => void): void {}
}

export class App {
  vault = new Vault();
  workspace = new Workspace();
  metadataCache = new Events();
}

export class Plugin extends Component {
  app: App;
  manifest: { id: string; version: string };
  private data: unknown = null;
  constructor(app?: App, manifest?: { id: string; version: string }) {
    super();
    this.app = app ?? new App();
    this.manifest = manifest ?? { id: 'claudsidian', version: 'test' };
  }
  async loadData(): Promise<unknown> {
    return this.data;
  }
  async saveData(d: unknown): Promise<void> {
    this.data = d;
  }
  addCommand(c: unknown): unknown {
    return c;
  }
  addRibbonIcon(_i: string, _t: string, _cb: () => void): HTMLElement {
    return document.createElement('div');
  }
  registerView(_t: string, _f: unknown): void {}
  addSettingTab(_t: unknown): void {}
  registerObsidianProtocolHandler(_a: string, _h: unknown): void {}
  registerEditorExtension(_e: unknown): void {}
}

export class ItemView extends Component {
  leaf: WorkspaceLeaf;
  app = new App();
  contentEl: HTMLElement = document.createElement('div');
  containerEl: HTMLElement = document.createElement('div');
  navigation = true;
  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
  }
  getViewType(): string {
    return '';
  }
  getDisplayText(): string {
    return '';
  }
}

export class Modal {
  app: App;
  contentEl: HTMLElement = document.createElement('div');
  titleEl: HTMLElement = document.createElement('div');
  modalEl: HTMLElement = document.createElement('div');
  constructor(app: App) {
    this.app = app;
  }
  open(): void {
    this.onOpen();
  }
  close(): void {
    this.onClose();
  }
  onOpen(): void {}
  onClose(): void {}
  setTitle(t: string): this {
    this.titleEl.textContent = t;
    return this;
  }
}

export class Notice {
  static last: string | undefined;
  constructor(message: string | DocumentFragment, _timeout?: number) {
    Notice.last = typeof message === 'string' ? message : message.textContent ?? '';
  }
  hide(): void {}
}

export class PluginSettingTab {
  app: App;
  containerEl: HTMLElement = document.createElement('div');
  constructor(app: App, _plugin: unknown) {
    this.app = app;
  }
  display(): void {}
  hide(): void {}
}

export class Setting {
  settingEl: HTMLElement;
  constructor(container: HTMLElement) {
    this.settingEl = document.createElement('div');
    container.appendChild(this.settingEl);
  }
  setName(_n: string): this {
    return this;
  }
  setDesc(_d: string | DocumentFragment): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  addText(cb: (t: TextComponent) => void): this {
    cb(new TextComponent());
    return this;
  }
  addTextArea(cb: (t: TextComponent) => void): this {
    cb(new TextComponent());
    return this;
  }
  addToggle(cb: (t: ToggleComponent) => void): this {
    cb(new ToggleComponent());
    return this;
  }
  addDropdown(cb: (d: DropdownComponent) => void): this {
    cb(new DropdownComponent());
    return this;
  }
  addButton(cb: (b: ButtonComponent) => void): this {
    cb(new ButtonComponent());
    return this;
  }
  addSlider(cb: (s: SliderComponent) => void): this {
    cb(new SliderComponent());
    return this;
  }
}

export class TextComponent {
  value = '';
  setValue(v: string): this {
    this.value = v;
    return this;
  }
  getValue(): string {
    return this.value;
  }
  setPlaceholder(_p: string): this {
    return this;
  }
  onChange(_cb: (v: string) => unknown): this {
    return this;
  }
  inputEl: HTMLInputElement = document.createElement('input');
}
export class ToggleComponent {
  value = false;
  setValue(v: boolean): this {
    this.value = v;
    return this;
  }
  onChange(_cb: (v: boolean) => unknown): this {
    return this;
  }
}
export class DropdownComponent {
  value = '';
  addOption(_k: string, _v: string): this {
    return this;
  }
  addOptions(_o: Record<string, string>): this {
    return this;
  }
  setValue(v: string): this {
    this.value = v;
    return this;
  }
  onChange(_cb: (v: string) => unknown): this {
    return this;
  }
}
export class ButtonComponent {
  buttonEl: HTMLButtonElement = document.createElement('button');
  setButtonText(t: string): this {
    this.buttonEl.textContent = t;
    return this;
  }
  setCta(): this {
    return this;
  }
  setWarning(): this {
    return this;
  }
  setDisabled(_d: boolean): this {
    return this;
  }
  onClick(cb: () => unknown): this {
    this.buttonEl.addEventListener('click', () => void cb());
    return this;
  }
}
export class SliderComponent {
  value = 0;
  setLimits(_a: number, _b: number, _c: number): this {
    return this;
  }
  setValue(v: number): this {
    this.value = v;
    return this;
  }
  setDynamicTooltip(): this {
    return this;
  }
  onChange(_cb: (v: number) => unknown): this {
    return this;
  }
}

export const Platform = {
  isMobile: false,
  isMobileApp: false,
  isDesktop: true,
  isDesktopApp: true,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: true,
};

export const MarkdownRenderer = {
  async render(_app: App, markdown: string, el: HTMLElement, _sourcePath: string, _component: Component): Promise<void> {
    el.textContent = markdown;
  },
};

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function setIcon(el: HTMLElement, icon: string): void {
  el.setAttribute('data-icon', icon);
}

export class AbstractInputSuggest<T> {
  constructor(_app: App, _input: HTMLInputElement) {}
  getSuggestions(_q: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(_v: T, _el: HTMLElement): void {}
  selectSuggestion(_v: T, _e: MouseEvent | KeyboardEvent): void {}
  close(): void {}
}

export async function requestUrl(_p: unknown): Promise<never> {
  throw new Error('requestUrl is not available in unit tests; inject an HttpTransport');
}

export class MarkdownView {
  leaf: WorkspaceLeaf;
  file: TFile | null = null;
  constructor(leaf?: WorkspaceLeaf) {
    this.leaf = leaf ?? new WorkspaceLeaf();
  }
  editor = {
    getSelection: () => '',
    getCursor: () => ({ line: 0, ch: 0 }),
    somethingSelected: () => false,
    listSelections: () => [] as { anchor: { line: number; ch: number }; head: { line: number; ch: number } }[],
    replaceSelection: (_s: string) => {},
    replaceRange: (_s: string, _from: { line: number; ch: number }) => {},
    getLine: (_n: number) => '',
    lineCount: () => 0,
  };
}

export class Menu {
  addItem(cb: (item: MenuItem) => void): this {
    cb(new MenuItem());
    return this;
  }
  showAtMouseEvent(_e: MouseEvent): void {}
  showAtPosition(_p: { x: number; y: number }): void {}
}
export class MenuItem {
  setTitle(_t: string): this {
    return this;
  }
  setIcon(_i: string): this {
    return this;
  }
  onClick(_cb: () => unknown): this {
    return this;
  }
}

export const moment = (d?: number | string | Date) => ({
  fromNow: () => 'just now',
  format: (_f: string) => String(d ?? ''),
});
