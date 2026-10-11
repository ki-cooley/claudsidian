// Shim: App (vault, workspace, metadata cache, settings host, command registry) and Plugin (data, views, commands, ribbon).
import { Component } from './events';
import { FileManager, MetadataCache, Vault } from './files';
import { setIcon } from './icons';
import { Scope } from './platform';
import { Workspace, type AppLike, type ViewCreator } from './workspace';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  authorUrl?: string;
  dir?: string;
  isDesktopOnly?: boolean;
}

export interface Command {
  id: string;
  name: string;
  icon?: string;
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => boolean | void;
  editorCallback?: (editor: unknown, view: unknown) => unknown;
  editorCheckCallback?: (checking: boolean, editor: unknown, view: unknown) => boolean | void;
  hotkeys?: unknown[];
}

export abstract class SettingTab {
  containerEl: HTMLElement;
  constructor(public app: App) {
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'vertical-tab-content';
  }
  abstract display(): void;
  hide(): void {
    this.containerEl.empty();
  }
}

export abstract class PluginSettingTab extends SettingTab {
  constructor(app: App, public plugin: Plugin) {
    super(app);
  }
}

export interface HarnessAppOptions {
  sidebarEl: HTMLElement;
  editorEl: HTMLElement;
  ribbonEl: HTMLElement;
  statusBarEl: HTMLElement;
  settingsEl: HTMLElement;
}

export class App implements AppLike {
  [key: string]: unknown;
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
  fileManager: FileManager;
  keymap = {};
  scope = new Scope();
  viewRegistry = new Map<string, ViewCreator>();
  pluginData = new Map<string, unknown>();
  protocolHandlers = new Map<string, (params: Record<string, string>) => unknown>();
  commands: { commands: Record<string, Command>; executeCommandById(id: string): boolean; listCommands(): Command[] };
  setting: { tabs: PluginSettingTab[]; open(): void; openTabById(id: string): PluginSettingTab | null; close(): void; activeTab: PluginSettingTab | null };
  plugins = { plugins: {} as Record<string, Plugin>, enabledPlugins: new Set<string>(), getPlugin: (id: string) => this.plugins.plugins[id] ?? null };
  isMobile: boolean;
  lastEvent: Event | null = null;
  readonly ui: HarnessAppOptions;

  constructor(opts: HarnessAppOptions, isMobile: boolean) {
    this.ui = opts;
    this.isMobile = isMobile;
    this.vault = new Vault();
    this.metadataCache = new MetadataCache(this.vault);
    this.fileManager = new FileManager(this.vault);
    this.workspace = new Workspace(this, opts.sidebarEl, opts.editorEl);
    const commands: Record<string, Command> = {};
    this.commands = {
      commands,
      listCommands: () => Object.values(commands),
      executeCommandById: (id: string) => {
        const c = commands[id];
        if (!c) return false;
        if (c.callback) {
          void c.callback();
          return true;
        }
        if (c.checkCallback) return c.checkCallback(false) !== false;
        const view = this.workspace.activeLeaf?.view as { editor?: unknown } | null | undefined;
        const editor = view?.editor;
        if (c.editorCallback && editor) {
          void c.editorCallback(editor, view);
          return true;
        }
        if (c.editorCheckCallback && editor) return c.editorCheckCallback(false, editor, view) !== false;
        return false;
      },
    };
    const settingsEl = opts.settingsEl;
    this.setting = {
      tabs: [],
      activeTab: null,
      open: () => {
        settingsEl.empty();
        settingsEl.classList.add('is-open');
        const tab = this.setting.tabs[0];
        if (tab) this.setting.openTabById('');
      },
      openTabById: (id: string) => {
        const tab = this.setting.tabs.find((t) => t.plugin.manifest.id === id) ?? this.setting.tabs[0] ?? null;
        if (!tab) return null;
        settingsEl.empty();
        settingsEl.classList.add('is-open');
        const close = settingsEl.createEl('button', { cls: 'harness-settings-close', text: 'Close settings' });
        close.addEventListener('click', () => this.setting.close());
        settingsEl.appendChild(tab.containerEl);
        tab.display();
        this.setting.activeTab = tab;
        return tab;
      },
      close: () => {
        this.setting.activeTab?.hide();
        this.setting.activeTab = null;
        settingsEl.classList.remove('is-open');
        settingsEl.empty();
      },
    };
  }

  loadLocalStorage(key: string): unknown {
    try {
      const raw = localStorage.getItem(`harness:${key}`);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  }
  saveLocalStorage(key: string, value: unknown): void {
    try {
      if (value === null || value === undefined) localStorage.removeItem(`harness:${key}`);
      else localStorage.setItem(`harness:${key}`, JSON.stringify(value));
    } catch {
      // storage can be unavailable in a private window
    }
  }
  emulateMobile(mobile: boolean): void {
    this.isMobile = mobile;
    document.body.toggleClass('is-mobile', mobile);
  }
  openWithDefaultApp(_path: string): void {}
}

export abstract class Plugin extends Component {
  commands: Command[] = [];
  ribbonEls: HTMLElement[] = [];
  settingTabs: PluginSettingTab[] = [];

  constructor(
    public app: App,
    public manifest: PluginManifest,
  ) {
    super();
    app.plugins.plugins[manifest.id] = this;
    app.plugins.enabledPlugins.add(manifest.id);
  }

  async onload(): Promise<void> {}

  /** Like Component.load, but awaits the async onload so the harness can wait for the plugin to be ready. */
  async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    await this.onload();
  }

  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
    const el = this.app.ui.ribbonEl.createDiv({ cls: 'side-dock-ribbon-action clickable-icon', attr: { 'aria-label': title, role: 'button', tabindex: '0' } });
    setIcon(el, icon);
    el.addEventListener('click', (ev) => void callback(ev));
    this.ribbonEls.push(el);
    this.register(() => el.remove());
    return el;
  }

  addStatusBarItem(): HTMLElement {
    const el = this.app.ui.statusBarEl.createDiv({ cls: 'status-bar-item' });
    this.register(() => el.remove());
    return el;
  }

  addCommand(command: Command): Command {
    const full = { ...command, id: `${this.manifest.id}:${command.id}` };
    this.commands.push(full);
    this.app.commands.commands[full.id] = full;
    this.register(() => delete this.app.commands.commands[full.id]);
    return full;
  }

  removeCommand(id: string): void {
    delete this.app.commands.commands[`${this.manifest.id}:${id}`];
  }

  addSettingTab(tab: PluginSettingTab): void {
    this.settingTabs.push(tab);
    this.app.setting.tabs.push(tab);
    this.register(() => {
      this.app.setting.tabs = this.app.setting.tabs.filter((t) => t !== tab);
    });
  }

  registerView(type: string, creator: ViewCreator): void {
    this.app.viewRegistry.set(type, creator);
    this.register(() => this.app.viewRegistry.delete(type));
  }

  registerHoverLinkSource(_id: string, _info: unknown): void {}
  registerExtensions(_extensions: string[], _viewType: string): void {}
  registerMarkdownPostProcessor(_p: unknown, _sortOrder?: number): unknown {
    return _p;
  }
  registerMarkdownCodeBlockProcessor(_lang: string, _handler: unknown, _sortOrder?: number): unknown {
    return _handler;
  }
  registerEditorExtension(_ext: unknown): void {}
  registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => unknown): void {
    this.app.protocolHandlers.set(action, handler);
    this.register(() => this.app.protocolHandlers.delete(action));
  }
  registerEditorSuggest(_s: unknown): void {}

  async loadData(): Promise<unknown> {
    const data = this.app.pluginData.get(this.manifest.id);
    return data === undefined ? null : structuredClone(data);
  }
  async saveData(data: unknown): Promise<void> {
    this.app.pluginData.set(this.manifest.id, structuredClone(data));
  }
  onUserEnable(): void {}
  async onExternalSettingsChange(): Promise<void> {}
}
