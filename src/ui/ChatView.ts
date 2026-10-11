/**
 * ChatView: the Obsidian ItemView hosting the Preact UI. Owns the facade, mirrors its visibility into the
 * store, applies the mobile and cooking-mode classes, restores the last session, and tears down on close.
 */
import { ItemView, Platform, type WorkspaceLeaf } from 'obsidian';
import { h, render } from 'preact';
import type ClaudsidianPlugin from '../main';
import { ObsidianFacade } from '../obsidian/facade-impl';
import { Root } from './components/Root';
import { ConfirmModal } from './modals/ConfirmModal';
import { RenameModal } from './modals/RenameModal';

export const VIEW_TYPE_CHAT = 'claudsidian-chat';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ChatView extends ItemView {
  readonly plugin: ClaudsidianPlugin;
  readonly facade: ObsidianFacade;
  private readonly disposers: (() => void)[] = [];
  private visible = false;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudsidianPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.facade = new ObsidianFacade(plugin, this);
    this.navigation = false;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return 'Claudsidian';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('claudsidian-view');
    contentEl.toggleClass('is-mobile', Platform.isMobile);
    contentEl.toggleClass('is-phone', Platform.isPhone);

    this.registerDomEvent(document, 'visibilitychange', () => this.updateVisibility());
    this.registerEvent(this.app.workspace.on('layout-change', () => this.updateVisibility()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateVisibility()));
    // subscribe() runs now and after every save, outside signal tracking, so the render never re-arms it.
    this.disposers.push(
      this.plugin.settingsChanged.subscribe(() => {
        this.applyMode();
        this.renderRoot();
      }),
    );
    this.updateVisibility();
    await this.restoreLastSession();
  }

  async onClose(): Promise<void> {
    for (const dispose of this.disposers.splice(0)) dispose();
    render(null, this.contentEl);
    this.contentEl.empty();
    this.visible = false;
    this.plugin.store.visible.value = false;
    this.plugin.store.close();
    void this.facade.setWakeLock(false);
  }

  /** True while the leaf can be seen: the app is in the foreground, the leaf is the shown tab, its dock is open. */
  isViewVisible(): boolean {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    if (!this.containerEl.isShown()) return false;
    const leaf = this.leaf as { getRoot?: () => { collapsed?: boolean } | undefined };
    const root = typeof leaf.getRoot === 'function' ? leaf.getRoot() : undefined;
    return root?.collapsed !== true;
  }

  private renderRoot(): void {
    render(
      h(Root, {
        store: this.plugin.store,
        facade: this.facade,
        onRename: (id: string) => this.rename(id),
        onArchive: (id: string) => this.archive(id),
        showNewSession: this.plugin.ui.showNewSession,
      }),
      this.contentEl,
    );
  }

  private applyMode(): void {
    const settings = this.plugin.settings;
    const cooking = settings.cookingMode;
    this.contentEl.toggleClass('is-cooking', cooking);
    const scale = cooking && settings.cookingFontScale > 0 ? settings.cookingFontScale : 1;
    this.contentEl.style.setProperty('--claudsidian-scale', String(scale));
    void this.facade.setWakeLock(cooking && this.visible);
  }

  private updateVisibility(): void {
    const visible = this.isViewVisible();
    const store = this.plugin.store;
    if (visible === this.visible && store.visible.value === visible) return;
    this.visible = visible;
    store.visible.value = visible;
    void this.facade.setWakeLock(this.plugin.settings.cookingMode && visible);
  }

  /** Reopen settings.lastSessionId when it still exists, unless something else was opened meanwhile. */
  private async restoreLastSession(): Promise<void> {
    const id = this.plugin.settings.lastSessionId;
    const store = this.plugin.store;
    if (!id || !this.plugin.auth.isSignedIn() || store.selectedId.value) return;
    if (!store.session(id)) await store.refreshSessions();
    const session = store.session(id);
    if (!session || session.archived || store.selectedId.value) return;
    await store.open(id);
  }

  private rename(id: string): void {
    const store = this.plugin.store;
    const current = store.session(id)?.title ?? '';
    new RenameModal(this.app, current, (title) => {
      store.rename(id, title).catch((err: unknown) => this.facade.notice(`Rename failed: ${messageOf(err)}`));
    }).open();
  }

  private archive(id: string): void {
    const store = this.plugin.store;
    const title = store.session(id)?.title ?? 'this session';
    new ConfirmModal(
      this.app,
      `Archive "${title}"? It leaves the list here; it stays open in claude.ai.`,
      'Archive',
      () => {
        if (store.selectedId.value === id) store.close();
        store.archive(id).catch((err: unknown) => this.facade.notice(`Archive failed: ${messageOf(err)}`));
      },
    ).open();
  }
}
