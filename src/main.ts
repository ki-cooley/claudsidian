/**
 * Plugin entry: builds the auth manager, API client, session store, and context capture, then registers
 * the chat view, commands, editor menu item, protocol handler, ribbon icon, settings tab, and notifications.
 */
import { signal } from '@preact/signals';
import { Notice, Platform, Plugin, type Editor, type WorkspaceLeaf } from 'obsidian';
import { AuthManager } from './api/auth';
import { CcrClient } from './api/client';
import { obsidianTransport } from './api/http';
import { formatContextBlock } from './core/context-format';
import { SessionStore } from './core/session-store';
import type { CapturedContext } from './core/types';
import { ContextCapture } from './obsidian/context-capture';
import { Notifications } from './obsidian/notifications';
import { type ClaudsidianSettings, migrateSettings } from './settings';
import { ChatView, VIEW_TYPE_CHAT } from './ui/ChatView';
import { QuickAskModal, lastAssistantText } from './ui/modals/QuickAskModal';
import { SignInModal } from './ui/modals/SignInModal';
import { ClaudsidianSettingTab } from './ui/SettingsTab';
import { setDebugLogging } from './util/log';
import { uuidv4 } from './util/uuid';

/**
 * The client and the auth manager read these through functions, so a change applies on the next request;
 * the list is refreshed right away so a bad host shows up as the ordinary error banner.
 */
const URL_KEYS: (keyof ClaudsidianSettings)[] = ['apiBaseUrl', 'oauthTokenUrl', 'oauthAuthorizeUrl'];

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default class ClaudsidianPlugin extends Plugin {
  settings: ClaudsidianSettings = migrateSettings(null);
  auth!: AuthManager;
  client!: CcrClient;
  store!: SessionStore;
  capture!: ContextCapture;
  /** Signals shared between commands and the view. */
  readonly ui = { showNewSession: signal(false) };
  /** Bumps after every saveSettings so the view re-applies modes and re-renders. */
  readonly settingsChanged = signal(0);
  private notifications: Notifications | null = null;
  private ribbonEl: HTMLElement | null = null;
  private readonly needsInput = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    setDebugLogging(this.settings.debugLog);
    if (!this.settings.clientId) {
      this.settings.clientId = uuidv4();
      await this.saveData(this.settings);
    }

    this.auth = new AuthManager({
      transport: obsidianTransport,
      load: () => this.settings.auth,
      save: async (s) => {
        this.settings.auth = s;
        await this.saveSettings();
      },
      tokenUrl: () => this.settings.oauthTokenUrl,
      authorizeUrl: () => this.settings.oauthAuthorizeUrl,
      profileUrl: () => `${this.settings.apiBaseUrl}/api/oauth/profile`,
    });
    this.client = new CcrClient({
      baseUrl: () => this.settings.apiBaseUrl,
      transport: obsidianTransport,
      getAccessToken: () => this.auth.getAccessToken(),
      onUnauthorized: async () => {
        try {
          await this.auth.refresh();
          return true;
        } catch {
          return false;
        }
      },
      orgUuid: () => this.auth.orgUuid(),
      clientPlatform: () => this.settings.clientPlatform,
      userAgent: `claudsidian/${this.manifest.version}`,
    });
    this.store = new SessionStore({
      client: this.client,
      settings: () => this.settings,
      clientId: this.settings.clientId,
      onNotice: (text) => new Notice(text),
      // Learned directories only feed grouping and the new-session sheet, which read the store; no view re-render.
      persistLearned: (patch) => {
        Object.assign(this.settings, patch);
        return this.saveData(this.settings);
      },
    });
    this.capture = new ContextCapture(this.app, { ownViewType: VIEW_TYPE_CHAT });
    this.capture.install(this);
    this.notifications = new Notifications(this.store, {
      enabled: () => this.settings.notifications,
      isViewVisible: () => this.store.visible.value && this.viewOpen(),
      sessionTitle: (id) => this.store.session(id)?.title ?? 'Claude',
      notice: (text) => new Notice(text),
    });

    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
    this.ribbonEl = this.addRibbonIcon('bot', 'Open Claudsidian', () => void this.activateView());
    this.ribbonEl.addClass('claudsidian-ribbon');
    this.registerCommands();
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        const selection = editor.getSelection();
        if (!selection.trim()) return;
        menu.addItem((item) =>
          item
            .setTitle('Ask Claude about selection')
            .setIcon('bot')
            .onClick(() => new QuickAskModal(this.app, this, selection).open()),
        );
      }),
    );
    this.registerObsidianProtocolHandler('claudsidian', (params) => {
      const id = typeof params.session === 'string' ? params.session.trim() : '';
      void this.activateView(id || undefined);
    });
    this.addSettingTab(
      new ClaudsidianSettingTab(this.app, this, {
        auth: this.auth,
        getSettings: () => this.settings,
        save: (patch) => this.saveSettings(patch),
        environments: () => this.store.environments().map((e) => ({ id: e.id, label: e.label })),
        openSignIn: () => this.openSignIn(),
      }),
    );

    this.register(this.store.on('needs_input', (id) => this.markNeedsInput(id)));
    this.register(this.store.on('turn_end', (id) => this.clearNeedsInput(id)));
    this.register(
      this.store.selectedId.subscribe((id) => {
        if (!id) return;
        this.clearNeedsInput(id);
        this.rememberSession(id);
      }),
    );
    this.register(
      this.auth.onChange((state) => {
        if (state) return;
        this.store.close();
        this.store.stopListPolling();
      }),
    );
  }

  onunload(): void {
    this.notifications?.dispose();
    this.notifications = null;
    if (this.store) this.store.dispose();
    // The chat leaf stays in the layout (plugin guidelines): Obsidian restores the view when the plugin returns.
  }

  /** data.json changed outside this app (Obsidian Sync from the iPad or phone, a file write): take it in. */
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    setDebugLogging(this.settings.debugLog);
    this.settingsChanged.value += 1;
  }

  async loadSettings(): Promise<void> {
    this.settings = migrateSettings(await this.loadData());
  }

  /** Apply a patch (when given), persist, and tell the view. */
  async saveSettings(patch?: Partial<ClaudsidianSettings>): Promise<void> {
    let urlChanged = false;
    if (patch) {
      urlChanged = URL_KEYS.some((k) => patch[k] !== undefined && patch[k] !== this.settings[k]);
      Object.assign(this.settings, patch);
    }
    await this.saveData(this.settings);
    setDebugLogging(this.settings.debugLog);
    this.settingsChanged.value += 1;
    if (urlChanged && this.store) void this.store.refreshSessions();
  }

  /** Open (or reveal) the chat view in the right sidebar (the drawer on iPad and phone). */
  async activateView(sessionId?: string): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0] ?? null;
    // Before 2.0.5 mobile opened the view as a tab; the layout keeps that tab, so move it to the sidebar once.
    if (leaf && Platform.isMobile && leaf.getRoot() !== workspace.rightSplit) {
      leaf.detach();
      leaf = null;
    }
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (sessionId) await this.openSession(sessionId);
    return leaf;
  }

  /** Select a session in the store, refreshing the list first when it is not listed yet. */
  async openSession(id: string): Promise<void> {
    if (!this.store.session(id)) await this.store.refreshSessions();
    await this.store.open(id);
  }

  openSignIn(): void {
    new SignInModal(this.app, this.auth, (signedIn) => {
      if (!signedIn) return;
      new Notice('Signed in to Claude');
      void this.store.refreshSessions();
    }).open();
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  private registerCommands(): void {
    this.addCommand({ id: 'open', name: 'Open Claudsidian', callback: () => void this.activateView() });
    this.addCommand({ id: 'new-session', name: 'New session', callback: () => void this.newSession() });
    this.addCommand({
      id: 'ask-selection',
      name: 'Ask Claude about selection',
      editorCheckCallback: (checking, editor) => {
        const selection = editor.getSelection();
        if (!selection.trim()) return false;
        if (!checking) new QuickAskModal(this.app, this, selection).open();
        return true;
      },
    });
    this.addCommand({
      id: 'send-current-note',
      name: 'Send current note to Claude',
      callback: () => void this.sendCurrentNote(),
    });
    this.addCommand({
      id: 'insert-last-reply',
      name: 'Insert last reply at cursor',
      editorCallback: (editor) => this.insertLastReply(editor),
    });
    this.addCommand({ id: 'toggle-cooking', name: 'Toggle cooking mode', callback: () => void this.toggleCooking() });
    this.addCommand({ id: 'sign-in', name: 'Sign in to Claude', callback: () => this.openSignIn() });
    this.addCommand({ id: 'sign-out', name: 'Sign out of Claude', callback: () => void this.signOut() });
  }

  private async newSession(): Promise<void> {
    await this.activateView();
    if (!this.auth.isSignedIn()) {
      new Notice('Sign in to Claude first.');
      return;
    }
    // The sheet lives on the sessions screen.
    this.store.close();
    this.ui.showNewSession.value = true;
  }

  /** "Look at this note." with the active note as the only context, auto context on or off. */
  private async sendCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile() ?? this.capture.lastMarkdownView?.file ?? null;
    if (!file) {
      new Notice('No note is open.');
      return;
    }
    const id = this.store.selectedId.value;
    if (!id) {
      new Notice('Open a session in Claudsidian first.');
      await this.activateView();
      return;
    }
    const ctx: CapturedContext = { vaultName: this.app.vault.getName(), activeNote: { path: file.path }, openNotes: [], mentions: [] };
    const contextText = formatContextBlock(ctx, {
      vaultPathOnMac: this.settings.vaultPathOnMac,
      sessionCwd: this.store.transcript(id).value.init?.cwd,
    });
    try {
      await this.store.send(id, 'Look at this note.', { contextText });
      new Notice(`Sent ${file.path}`);
    } catch (err) {
      new Notice(`Send failed: ${messageOf(err)}`);
      return;
    }
    await this.activateView();
  }

  private insertLastReply(editor: Editor): void {
    const id = this.store.selectedId.value;
    const text = id ? lastAssistantText(this.store.transcript(id).value) : undefined;
    if (!text) {
      new Notice('No reply to insert yet.');
      return;
    }
    editor.replaceRange(text, editor.getCursor());
  }

  private async toggleCooking(): Promise<void> {
    const cookingMode = !this.settings.cookingMode;
    await this.saveSettings({ cookingMode });
    new Notice(cookingMode ? 'Cooking mode on' : 'Cooking mode off');
  }

  private async signOut(): Promise<void> {
    await this.auth.signOut();
    new Notice('Signed out of Claude');
  }

  // ---------------------------------------------------------------------------
  // Ribbon dot, last session
  // ---------------------------------------------------------------------------

  private viewOpen(): boolean {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT).length > 0;
  }

  private markNeedsInput(id: string): void {
    if (id === this.store.selectedId.value && this.store.visible.value && this.viewOpen()) return;
    this.needsInput.add(id);
    this.updateRibbonDot();
  }

  private clearNeedsInput(id: string): void {
    if (this.needsInput.delete(id)) this.updateRibbonDot();
  }

  private updateRibbonDot(): void {
    const el = this.ribbonEl;
    if (!el) return;
    const dot = el.querySelector('.claudsidian-ribbon-dot');
    if (this.needsInput.size > 0) {
      if (!dot) el.createDiv({ cls: 'claudsidian-ribbon-dot' });
    } else {
      dot?.remove();
    }
  }

  private rememberSession(id: string): void {
    if (this.settings.lastSessionId === id) return;
    void this.saveSettings({ lastSessionId: id });
  }
}
