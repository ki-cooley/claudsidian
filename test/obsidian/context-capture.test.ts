// Tests for ContextCapture against the obsidian mock: active markdown view tracking, selection,
// cursor, open notes, and the context settings flags.
import { beforeEach, describe, expect, it } from 'vitest';
import { App, MarkdownView, Plugin, TFile, WorkspaceLeaf, type Editor, type EditorSelection } from 'obsidian';
import { ContextCapture } from '../../src/obsidian/context-capture';
import { DEFAULT_SETTINGS, type ContextSettings } from '../../src/settings';

const OWN = 'claudsidian-chat';

/** Plugin is abstract in the real typings; the mock is concrete. */
class TestPlugin extends Plugin {}

interface EditorOpts {
  selection?: string;
  range?: [number, number]; // 0-based anchor/head lines
  cursorLine?: number; // 0-based
}

function fakeEditor(o: EditorOpts = {}): Editor {
  const sel = o.selection ?? '';
  const [a, h] = o.range ?? [0, 0];
  const sels: EditorSelection[] = sel ? [{ anchor: { line: a, ch: 0 }, head: { line: h, ch: 0 } }] : [];
  return {
    getSelection: () => sel,
    somethingSelected: () => sel.length > 0,
    listSelections: () => sels,
    getCursor: () => ({ line: o.cursorLine ?? 0, ch: 0 }),
  } as unknown as Editor;
}

function markdownLeaf(path: string, editor: EditorOpts = {}): WorkspaceLeaf {
  const leaf = new WorkspaceLeaf();
  const view = new MarkdownView(leaf);
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() ?? path;
  Object.assign(view, { file, editor: fakeEditor(editor) });
  (leaf as unknown as { view: unknown }).view = view;
  return leaf;
}

function chatLeaf(): WorkspaceLeaf {
  const leaf = new WorkspaceLeaf();
  (leaf as unknown as { view: unknown }).view = { getViewType: () => OWN };
  return leaf;
}

function settings(patch: Partial<ContextSettings> = {}): ContextSettings {
  return { ...DEFAULT_SETTINGS.context, ...patch };
}

describe('ContextCapture', () => {
  let app: App;
  let plugin: TestPlugin;
  let capture: ContextCapture;
  let leaves: WorkspaceLeaf[];

  beforeEach(() => {
    app = new App();
    plugin = new TestPlugin(app, { id: "claudsidian", name: "Claudsidian", version: "test", minAppVersion: "1.5.0", author: "", description: "" });
    leaves = [];
    app.workspace.getLeavesOfType = (t: string) => (t === 'markdown' ? leaves : []);
    capture = new ContextCapture(app, { ownViewType: OWN });
    capture.install(plugin);
  });

  it('starts with no markdown view and captures only the vault name', () => {
    expect(capture.lastMarkdownView).toBeNull();
    expect(capture.capture(settings(), [])).toEqual({ vaultName: 'test-vault', openNotes: [], mentions: [] });
  });

  it('tracks the last active markdown view and ignores the chat leaf', () => {
    const note = markdownLeaf('menus/menu.md', { cursorLine: 41 });
    app.workspace.trigger('active-leaf-change', note);
    expect(capture.lastMarkdownView).toBe(note.view);
    app.workspace.trigger('active-leaf-change', chatLeaf());
    expect(capture.lastMarkdownView).toBe(note.view);
    app.workspace.trigger('active-leaf-change', null);
    expect(capture.lastMarkdownView).toBe(note.view);
    const ctx = capture.capture(settings(), []);
    expect(ctx.activeNote).toEqual({ path: 'menus/menu.md', cursorLine: 42 });
    expect(ctx.selection).toBeUndefined();
  });

  it('seeds from the active markdown view at install time', () => {
    const note = markdownLeaf('seed.md');
    const app2 = new App();
    app2.workspace.getActiveViewOfType = <T>() => note.view as unknown as T;
    const c2 = new ContextCapture(app2, { ownViewType: OWN });
    c2.install(new TestPlugin(app2, { id: "claudsidian", name: "Claudsidian", version: "test", minAppVersion: "1.5.0", author: "", description: "" }));
    expect(c2.lastMarkdownView).toBe(note.view);
  });

  it('captures a selection with a 1-based inclusive line range and no cursor line', () => {
    const note = markdownLeaf('a.md', { selection: 'two\nlines', range: [44, 39], cursorLine: 39 });
    app.workspace.trigger('active-leaf-change', note);
    const ctx = capture.capture(settings(), []);
    expect(ctx.selection).toEqual({ text: 'two\nlines', fromLine: 40, toLine: 45, truncated: false });
    expect(ctx.activeNote).toEqual({ path: 'a.md' });
  });

  it('truncates the selection to maxSelectionChars', () => {
    const note = markdownLeaf('a.md', { selection: 'abcdefghij', range: [0, 0] });
    app.workspace.trigger('active-leaf-change', note);
    const ctx = capture.capture(settings({ maxSelectionChars: 4 }), []);
    expect(ctx.selection).toEqual({ text: 'abcd', fromLine: 1, toLine: 1, truncated: true });
  });

  it('respects every include flag', () => {
    const note = markdownLeaf('a.md', { selection: 'x', range: [2, 2], cursorLine: 2 });
    leaves = [note, markdownLeaf('b.md'), markdownLeaf('c.md')];
    app.workspace.trigger('active-leaf-change', note);

    const noNote = capture.capture(settings({ includeActiveNote: false }), []);
    expect(noNote.activeNote).toBeUndefined();
    expect(noNote.selection).toBeDefined();
    expect(noNote.openNotes).toEqual(['b.md', 'c.md']);

    const noSel = capture.capture(settings({ includeSelection: false }), []);
    expect(noSel.selection).toBeUndefined();
    expect(noSel.activeNote).toEqual({ path: 'a.md', cursorLine: 3 });

    const noCursor = capture.capture(settings({ includeSelection: false, includeCursor: false }), []);
    expect(noCursor.activeNote).toEqual({ path: 'a.md' });

    const noOpen = capture.capture(settings({ includeOpenNotes: false }), []);
    expect(noOpen.openNotes).toEqual([]);
  });

  it('returns only the vault name and mentions when disabled', () => {
    const note = markdownLeaf('a.md', { selection: 'x' });
    leaves = [note, markdownLeaf('b.md')];
    app.workspace.trigger('active-leaf-change', note);
    expect(capture.capture(settings({ enabled: false }), ['recipes/tare.md'])).toEqual({
      vaultName: 'test-vault',
      openNotes: [],
      mentions: ['recipes/tare.md'],
    });
  });

  it('lists open notes without the active one, deduped and capped', () => {
    const note = markdownLeaf('a.md');
    leaves = [note, markdownLeaf('b.md'), markdownLeaf('b.md'), markdownLeaf('c.md'), markdownLeaf('d.md'), chatLeaf()];
    app.workspace.trigger('active-leaf-change', note);
    expect(capture.openMarkdownPaths()).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
    const ctx = capture.capture(settings({ maxOpenNotes: 2 }), []);
    expect(ctx.openNotes).toEqual(['b.md', 'c.md']);
  });

  it('skips a markdown view with no file and passes mentions through', () => {
    const empty = new WorkspaceLeaf();
    (empty as unknown as { view: unknown }).view = Object.assign(new MarkdownView(empty), { file: null, editor: fakeEditor() });
    app.workspace.trigger('active-leaf-change', empty);
    const ctx = capture.capture(settings(), ['x.md']);
    expect(ctx.activeNote).toBeUndefined();
    expect(ctx.mentions).toEqual(['x.md']);
  });
});
