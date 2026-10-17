// Shim: views and the workspace. Leaves created by the plugin mount into #sidebar; the harness editor pane
// is a markdown leaf whose MarkdownView wraps a textarea Editor.
import { Component, Events } from './events';
import { Editor } from './editor';
import type { TFile } from './files';
import { setIcon } from './icons';
import { Scope } from './platform';

export interface ViewState {
  type: string;
  state?: Record<string, unknown>;
  active?: boolean;
  pinned?: boolean;
  group?: WorkspaceLeaf;
}

export type ViewCreator = (leaf: WorkspaceLeaf) => View;

export abstract class View extends Component {
  app: AppLike;
  icon = 'document';
  navigation = true;
  containerEl: HTMLElement;
  scope: Scope | null = null;

  constructor(public leaf: WorkspaceLeaf) {
    super();
    this.app = leaf.app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace-leaf-content';
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;

  getIcon(): string {
    return this.icon;
  }
  getState(): Record<string, unknown> {
    return {};
  }
  async setState(_state: unknown, _result: unknown): Promise<void> {}
  getEphemeralState(): Record<string, unknown> {
    return {};
  }
  setEphemeralState(_state: unknown): void {}
  onResize(): void {}
  onPaneMenu(_menu: unknown, _source: string): void {}
  protected async onOpen(): Promise<void> {}
  protected async onClose(): Promise<void> {}

  /** Harness: open/close hooks called by the leaf. */
  async _open(): Promise<void> {
    await this.onOpen();
  }
  async _close(): Promise<void> {
    await this.onClose();
  }
}

export abstract class ItemView extends View {
  contentEl: HTMLElement;
  headerEl: HTMLElement;
  titleEl: HTMLElement;
  actionsEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.headerEl = this.containerEl.createDiv({ cls: 'view-header' });
    const titleContainer = this.headerEl.createDiv({ cls: 'view-header-title-container' });
    this.titleEl = titleContainer.createDiv({ cls: 'view-header-title' });
    this.actionsEl = this.headerEl.createDiv({ cls: 'view-actions' });
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
  }

  addAction(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
    const el = this.actionsEl.createEl('button', { cls: 'clickable-icon view-action', attr: { 'aria-label': title } });
    setIcon(el, icon);
    el.addEventListener('click', (ev) => void callback(ev));
    return el;
  }

  async _open(): Promise<void> {
    this.titleEl.setText(this.getDisplayText());
    this.containerEl.setAttribute('data-type', this.getViewType());
    await this.onOpen();
  }
}

export abstract class FileView extends ItemView {
  file: TFile | null = null;
  allowNoFile = false;
  getDisplayText(): string {
    return this.file?.basename ?? 'No file';
  }
  async onLoadFile(_file: TFile): Promise<void> {}
  async onUnloadFile(_file: TFile): Promise<void> {}
}

export abstract class EditableFileView extends FileView {}

export abstract class TextFileView extends EditableFileView {
  data = '';
  requestSave(): void {}
  getViewData(): string {
    return this.data;
  }
  setViewData(data: string, _clear: boolean): void {
    this.data = data;
  }
  clear(): void {
    this.data = '';
  }
}

export class MarkdownView extends TextFileView {
  editor: Editor;
  currentMode = { type: 'source' };
  previewMode = { containerEl: document.createElement('div'), rerender: () => {} };

  constructor(leaf: WorkspaceLeaf, textarea: HTMLTextAreaElement, file: TFile | null) {
    super(leaf);
    this.editor = new Editor(textarea);
    this.file = file;
    this.navigation = true;
  }
  getViewType(): string {
    return 'markdown';
  }
  getMode(): 'source' | 'preview' {
    return 'source';
  }
  getViewData(): string {
    return this.editor.getValue();
  }
  setViewData(data: string): void {
    this.editor.setValue(data);
  }
  showSearch(_replace?: boolean): void {}
}

export interface AppLike {
  workspace: Workspace;
  viewRegistry: Map<string, ViewCreator>;
  [key: string]: unknown;
}

let leafCounter = 0;

export class WorkspaceLeaf extends Events {
  view: View | null = null;
  containerEl: HTMLElement;
  readonly id = `leaf-${++leafCounter}`;
  pinned = false;
  parent: { children: WorkspaceLeaf[] } | null = null;
  width = 0;
  height = 0;

  constructor(
    readonly app: AppLike,
    readonly host: HTMLElement,
  ) {
    super();
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace-leaf';
    this.containerEl.setAttribute('data-leaf-id', this.id);
  }

  async setViewState(state: ViewState, _eState?: unknown): Promise<void> {
    if (this.view && this.view.getViewType() === state.type) {
      await this.view.setState(state.state ?? {}, { history: false });
      if (state.active) this.app.workspace.setActiveLeaf(this);
      return;
    }
    await this.detachView();
    if (state.type === 'empty') return;
    const creator = this.app.viewRegistry.get(state.type);
    if (!creator) throw new Error(`No view registered for type ${state.type}`);
    const view = creator(this);
    this.view = view;
    this.containerEl.appendChild(view.containerEl);
    if (!this.containerEl.isConnected) this.host.appendChild(this.containerEl);
    view.load();
    await view._open();
    if (state.state) await view.setState(state.state, { history: false });
    this.app.workspace.registerLeaf(this);
    if (state.active) this.app.workspace.setActiveLeaf(this);
    this.app.workspace.trigger('layout-change');
  }

  getViewState(): ViewState {
    return { type: this.view?.getViewType() ?? 'empty', state: this.view?.getState() ?? {} };
  }

  async open(view: View): Promise<View> {
    await this.detachView();
    this.view = view;
    this.containerEl.appendChild(view.containerEl);
    if (!this.containerEl.isConnected) this.host.appendChild(this.containerEl);
    view.load();
    await view._open();
    this.app.workspace.registerLeaf(this);
    return view;
  }

  async openFile(file: TFile, _state?: unknown): Promise<void> {
    await this.app.workspace.openLinkText(file.path, '', false);
  }

  private async detachView(): Promise<void> {
    const v = this.view;
    if (!v) return;
    this.view = null;
    await v._close();
    v.unload();
    v.containerEl.remove();
  }

  detach(): void {
    void this.detachView().then(() => {
      this.containerEl.remove();
      this.app.workspace.unregisterLeaf(this);
      this.app.workspace.trigger('layout-change');
    });
  }

  getIcon(): string {
    return this.view?.getIcon() ?? 'document';
  }
  getDisplayText(): string {
    return this.view?.getDisplayText() ?? '';
  }
  /** Every harness leaf lives in the sidebar pane, so its root is the right split (as for a real sidebar leaf). */
  getRoot(): unknown {
    return this.app.workspace.rightSplit;
  }
  getContainer(): WorkspaceLeaf {
    return this;
  }
  setPinned(pinned: boolean): void {
    this.pinned = pinned;
  }
  togglePinned(): void {
    this.pinned = !this.pinned;
  }
  setGroup(_group: string): void {}
  setGroupMember(_other: WorkspaceLeaf): void {}
  isDeferred = false;
  async loadIfDeferred(): Promise<void> {}
}

interface Split {
  collapsed: boolean;
  containerEl: HTMLElement;
  expand(): void;
  collapse(): void;
  toggle(): void;
}

function makeSplit(el: HTMLElement): Split {
  const split: Split = {
    collapsed: false,
    containerEl: el,
    expand() {
      split.collapsed = false;
      el.classList.remove('is-collapsed');
    },
    collapse() {
      split.collapsed = true;
      el.classList.add('is-collapsed');
    },
    toggle() {
      if (split.collapsed) split.expand();
      else split.collapse();
    },
  };
  return split;
}

export class Workspace extends Events {
  activeLeaf: WorkspaceLeaf | null = null;
  layoutReady = false;
  leftSplit: Split;
  rightSplit: Split;
  rootSplit: Split;
  containerEl: HTMLElement;
  /** every leaf currently holding a view, in creation order */
  private leaves: WorkspaceLeaf[] = [];
  /** the markdown leaves the harness editor pane owns */
  editorLeaves: WorkspaceLeaf[] = [];
  private layoutCallbacks: (() => void)[] = [];

  constructor(
    private readonly app: AppLike,
    private readonly sidebarEl: HTMLElement,
    editorEl: HTMLElement,
  ) {
    super();
    this.containerEl = document.body;
    this.leftSplit = makeSplit(editorEl);
    this.rightSplit = makeSplit(sidebarEl);
    this.rootSplit = makeSplit(editorEl);
  }

  registerLeaf(leaf: WorkspaceLeaf): void {
    if (!this.leaves.includes(leaf)) this.leaves.push(leaf);
  }
  unregisterLeaf(leaf: WorkspaceLeaf): void {
    this.leaves = this.leaves.filter((l) => l !== leaf);
    if (this.activeLeaf === leaf) this.activeLeaf = this.editorLeaves[0] ?? null;
  }

  onLayoutReady(cb: () => void): void {
    if (this.layoutReady) cb();
    else this.layoutCallbacks.push(cb);
  }
  /** Harness: mark the layout ready and flush the callbacks. */
  markLayoutReady(): void {
    this.layoutReady = true;
    for (const cb of this.layoutCallbacks.splice(0)) cb();
    this.trigger('layout-ready');
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    if (type === 'markdown') return this.editorLeaves.filter((l) => l.view !== null);
    return this.leaves.filter((l) => l.view?.getViewType() === type);
  }

  getRightLeaf(_split: boolean): WorkspaceLeaf | null {
    return new WorkspaceLeaf(this.app, this.sidebarEl);
  }
  getLeftLeaf(_split: boolean): WorkspaceLeaf | null {
    return new WorkspaceLeaf(this.app, this.sidebarEl);
  }
  getLeaf(_newLeaf?: boolean | string, _direction?: string): WorkspaceLeaf {
    return new WorkspaceLeaf(this.app, this.sidebarEl);
  }
  createLeafBySplit(_leaf: WorkspaceLeaf): WorkspaceLeaf {
    return new WorkspaceLeaf(this.app, this.sidebarEl);
  }
  getUnpinnedLeaf(): WorkspaceLeaf {
    return this.getLeaf(false);
  }
  getMostRecentLeaf(): WorkspaceLeaf | null {
    return this.activeLeaf ?? this.editorLeaves[0] ?? null;
  }
  getLeafById(id: string): WorkspaceLeaf | null {
    return [...this.leaves, ...this.editorLeaves].find((l) => l.id === id) ?? null;
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    this.rightSplit.expand();
    document.body.dispatchEvent(new CustomEvent('harness-reveal', { detail: { leafId: leaf.id } }));
  }

  setActiveLeaf(leaf: WorkspaceLeaf, _params?: unknown): void {
    if (this.activeLeaf === leaf) return;
    this.activeLeaf = leaf;
    this.trigger('active-leaf-change', leaf);
  }

  getActiveViewOfType<T>(type: abstract new (...args: never[]) => T): T | null {
    const view = this.activeLeaf?.view;
    return view instanceof type ? (view as T) : null;
  }

  getActiveFile(): TFile | null {
    const view = this.activeLeaf?.view as (View & { file?: TFile | null }) | null | undefined;
    return view?.file ?? null;
  }

  iterateAllLeaves(cb: (leaf: WorkspaceLeaf) => unknown): void {
    for (const l of [...this.editorLeaves, ...this.leaves]) cb(l);
  }
  iterateRootLeaves(cb: (leaf: WorkspaceLeaf) => unknown): void {
    for (const l of this.editorLeaves) cb(l);
  }
  detachLeavesOfType(type: string): void {
    for (const l of this.getLeavesOfType(type)) l.detach();
  }
  getLastOpenFiles(): string[] {
    return this.editorLeaves.map((l) => (l.view as MarkdownView | null)?.file?.path ?? '').filter(Boolean);
  }
  requestSaveLayout(): void {}
  changeLayout(): Promise<void> {
    return Promise.resolve();
  }
  getLayout(): Record<string, unknown> {
    return {};
  }
  updateOptions(): void {}

  /** Switches the harness editor to `linktext` when it names a vault note; the harness pane listens for this. */
  async openLinkText(linktext: string, _sourcePath: string, _newLeaf?: boolean | string, _state?: unknown): Promise<void> {
    document.body.dispatchEvent(new CustomEvent('harness-open-note', { detail: { path: linktext } }));
  }
}
