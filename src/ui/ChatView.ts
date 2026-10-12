/**
 * ChatView: the Obsidian ItemView hosting the Preact UI. Owns the facade, mirrors its visibility into the
 * store, applies the mobile, phone, tablet and cooking-mode classes, measures the phone chrome that floats
 * over the view (header above, navbar below) into CSS variables, restores the last session, and tears
 * down on close.
 */
import { ItemView, Platform, type WorkspaceLeaf } from 'obsidian';
import { h, render } from 'preact';
import type ClaudsidianPlugin from '../main';
import { ObsidianFacade } from '../obsidian/facade-impl';
import { Root } from './components/Root';
import { ConfirmModal } from './modals/ConfirmModal';
import { RenameModal } from './modals/RenameModal';

export const VIEW_TYPE_CHAT = 'claudsidian-chat';

/** Set on the view on phones: how far Obsidian's floating header reaches into the view, and the navbar from below. */
export const PHONE_TOP_VAR = '--claudsidian-phone-top';
export const PHONE_BOTTOM_VAR = '--claudsidian-phone-bottom';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Box {
  top: number;
  bottom: number;
  height: number;
}

/**
 * How many px of the view's top sit under a floating header, and of its bottom under a navbar.
 * An element that is not laid out (no height) does not count; an overlap larger than half the view
 * is a measurement taken mid-transition and is ignored.
 */
export function phoneInsets(view: Box, header: Box | null, navbar: Box | null): { top: number; bottom: number } {
  const limit = view.height / 2;
  let top = 0;
  if (header && header.height > 0) {
    const overlap = Math.round(header.bottom - view.top);
    if (overlap > 0 && overlap <= limit) top = overlap;
  }
  let bottom = 0;
  if (navbar && navbar.height > 0) {
    const overlap = Math.round(view.bottom - navbar.top);
    if (overlap > 0 && overlap <= limit) bottom = overlap;
  }
  return { top, bottom };
}

export class ChatView extends ItemView {
  readonly plugin: ClaudsidianPlugin;
  readonly facade: ObsidianFacade;
  private readonly disposers: (() => void)[] = [];
  private visible = false;
  private insetFrame: number | null = null;

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
    contentEl.toggleClass('is-tablet', Platform.isMobile && !Platform.isPhone);

    this.registerDomEvent(document, 'visibilitychange', () => this.updateVisibility());
    if (!Platform.isMobile) {
      // A desktop window behind another app stays 'visible' to the page; focus is the signal that matters there.
      this.registerDomEvent(window, 'blur', () => this.updateVisibility());
      this.registerDomEvent(window, 'focus', () => this.updateVisibility());
    }
    this.registerEvent(this.app.workspace.on('layout-change', () => this.onLayout()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.onLayout()));
    this.registerEvent(this.app.workspace.on('resize', () => this.scheduleInsets()));
    if (Platform.isPhone) {
      this.registerDomEvent(window, 'resize', () => this.scheduleInsets());
      const viewport = window.visualViewport;
      if (viewport) {
        const onViewport = (): void => this.scheduleInsets();
        viewport.addEventListener('resize', onViewport);
        this.register(() => viewport.removeEventListener('resize', onViewport));
      }
    }
    // subscribe() runs now and after every save, outside signal tracking, so the render never re-arms it.
    this.disposers.push(
      this.plugin.settingsChanged.subscribe(() => {
        this.applyMode();
        this.renderRoot();
      }),
    );
    this.updateVisibility();
    this.applyInsets();
    this.scheduleInsets();
    await this.restoreLastSession();
  }

  async onClose(): Promise<void> {
    for (const dispose of this.disposers.splice(0)) dispose();
    if (this.insetFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.insetFrame);
    this.insetFrame = null;
    render(null, this.contentEl);
    this.contentEl.empty();
    this.visible = false;
    this.plugin.store.visible.value = false;
    this.plugin.store.close();
    void this.facade.setWakeLock(false);
  }

  /**
   * True while the leaf can be seen: the app is in the foreground (on desktop, also focused), the leaf is the
   * shown tab, its dock is open.
   */
  isViewVisible(): boolean {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    if (!Platform.isMobile && typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus()) {
      return false;
    }
    if (!this.containerEl.isShown()) return false;
    const leaf = this.leaf as { getRoot?: () => { collapsed?: boolean } | undefined };
    const root = typeof leaf.getRoot === 'function' ? leaf.getRoot() : undefined;
    return root?.collapsed !== true;
  }

  /**
   * Measure Obsidian's phone chrome against the view and publish the overlaps as CSS variables. On a
   * tablet or desktop nothing floats over the view, so the variables stay unset and mobile.css applies
   * its single padding.
   */
  applyInsets(): void {
    if (!Platform.isPhone) return;
    const content = this.contentEl;
    const view = content.getBoundingClientRect();
    if (view.height <= 0) return;
    const header = this.containerEl.querySelector<HTMLElement>('.view-header');
    const navbar = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.mobile-navbar') : null;
    const box = (el: HTMLElement | null): Box | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    const insets = phoneInsets({ top: view.top, bottom: view.bottom, height: view.height }, box(header), box(navbar));
    content.style.setProperty(PHONE_TOP_VAR, `${insets.top}px`);
    content.style.setProperty(PHONE_BOTTOM_VAR, `${insets.bottom}px`);
  }

  private scheduleInsets(): void {
    if (!Platform.isPhone) return;
    if (typeof requestAnimationFrame !== 'function') {
      this.applyInsets();
      return;
    }
    if (this.insetFrame !== null) return;
    this.insetFrame = requestAnimationFrame(() => {
      this.insetFrame = null;
      this.applyInsets();
    });
  }

  private onLayout(): void {
    this.updateVisibility();
    this.scheduleInsets();
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
