/**
 * Captures what the plugin attaches to every message: the last active markdown note (never the chat
 * leaf), its selection or cursor line, and the other open notes. Obsidian-side counterpart of
 * src/core/context-format.ts, which renders the result.
 */
import { MarkdownView, type App, type Plugin, type WorkspaceLeaf } from 'obsidian';
import type { CapturedContext } from '../core/types';
import type { ContextSettings } from '../settings';

export interface ContextCaptureOptions {
  /** view type of our own chat leaf, which never counts as the active note */
  ownViewType: string;
}

export class ContextCapture {
  private current: MarkdownView | null = null;

  constructor(
    private readonly app: App,
    private readonly opts: ContextCaptureOptions,
  ) {}

  /**
   * The markdown view that was most recently active and is still open; null before any note was focused or
   * once that note's leaf left the workspace (its CodeMirror state outlives the view, so a stale one would
   * still answer getSelection and accept edits nobody can see).
   */
  get lastMarkdownView(): MarkdownView | null {
    const view = this.current;
    if (view && !this.isOpen(view)) {
      const active = this.app.workspace.getActiveViewOfType(MarkdownView);
      this.current = active && this.isOpen(active) ? active : null;
    }
    return this.current;
  }

  /** True while the view still shows a file and its leaf is in the workspace. */
  private isOpen(view: MarkdownView): boolean {
    if (!view.file) return false;
    const leaf: unknown = view.leaf;
    return this.app.workspace.getLeavesOfType('markdown').some((l) => l === leaf || l.view === view);
  }

  /** Seed from the active note and follow active-leaf-change for the plugin's lifetime. */
  install(plugin: Plugin): void {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) this.current = active;
    plugin.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.onLeafChange(leaf)));
  }

  private onLeafChange(leaf: WorkspaceLeaf | null): void {
    const view: unknown = leaf?.view;
    if (!view || !(view instanceof MarkdownView)) return;
    if (typeof view.getViewType === 'function' && view.getViewType() === this.opts.ownViewType) return;
    this.current = view;
  }

  /** Paths of every open markdown note, in leaf order, deduped. */
  openMarkdownPaths(): string[] {
    const seen = new Set<string>();
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view: unknown = leaf.view;
      const path = view instanceof MarkdownView ? view.file?.path : undefined;
      if (path) seen.add(path);
    }
    return [...seen];
  }

  /** Snapshot for one message. Mentions are passed through even when auto context is off. */
  capture(settings: ContextSettings, mentions: string[]): CapturedContext {
    const ctx: CapturedContext = { vaultName: this.app.vault.getName(), openNotes: [], mentions: [...mentions] };
    if (!settings.enabled) return ctx;

    const view = this.lastMarkdownView;
    const activePath = view?.file?.path;
    const editor = view?.editor;

    let selected = false;
    if (settings.includeSelection && editor) {
      const text = editor.getSelection();
      if (text.length > 0) {
        const range = editor.listSelections()[0];
        const a = range?.anchor.line ?? 0;
        const h = range?.head.line ?? a;
        const max = Math.max(0, settings.maxSelectionChars);
        ctx.selection = {
          text: text.length > max ? text.slice(0, max) : text,
          fromLine: Math.min(a, h) + 1,
          toLine: Math.max(a, h) + 1,
          truncated: text.length > max,
        };
        selected = true;
      }
    }

    if (settings.includeActiveNote && activePath) {
      ctx.activeNote = { path: activePath };
      if (settings.includeCursor && !selected && editor) ctx.activeNote.cursorLine = editor.getCursor().line + 1;
    }

    if (settings.includeOpenNotes) {
      const max = Math.max(0, settings.maxOpenNotes);
      ctx.openNotes = this.openMarkdownPaths()
        .filter((p) => p !== activePath)
        .slice(0, max);
    }

    return ctx;
  }
}
