// The harness's left pane: a sample note in a textarea wrapped as a MarkdownView leaf, a second (hidden) open note,
// and the buttons scenarios use to change the selection or switch notes.
import { App, MarkdownView, TFile, WorkspaceLeaf } from './obsidian-shim';

export interface EditorPane {
  leaf: WorkspaceLeaf;
  view: MarkdownView;
  textarea: HTMLTextAreaElement;
  openNote(path: string): void;
  selectLines(from: number, to: number): void;
  clearSelection(): void;
  nextNote(): void;
}

const NOTE_ORDER = ['menus/latitude 10/menu.md', 'components/dashi.md', 'techniques/kombu-cure.md'];

export function buildEditorPane(app: App, editorEl: HTMLElement): EditorPane {
  const header = editorEl.createDiv({ cls: 'harness-editor-header' });
  const title = header.createDiv({ cls: 'harness-editor-title' });
  const tools = header.createDiv({ cls: 'harness-editor-tools' });
  const textarea = editorEl.createEl('textarea', { cls: 'harness-editor', attr: { 'aria-label': 'Note editor', spellcheck: 'false' } });

  const leaf = new WorkspaceLeaf(app, editorEl);
  const first = app.vault.getFileByPath(NOTE_ORDER[0]!);
  const view = new MarkdownView(leaf, textarea, first);
  leaf.view = view;
  view.load();
  app.workspace.editorLeaves.push(leaf);

  // A second open note (never active) so "open notes" has something to list.
  const hidden = document.createElement('textarea');
  hidden.className = 'harness-hidden-note';
  editorEl.appendChild(hidden);
  const secondLeaf = new WorkspaceLeaf(app, editorEl);
  const secondFile = app.vault.getFileByPath(NOTE_ORDER[1]!);
  const secondView = new MarkdownView(secondLeaf, hidden, secondFile);
  hidden.value = app.vault.contentOf(NOTE_ORDER[1]!) ?? '';
  secondLeaf.view = secondView;
  secondView.load();
  app.workspace.editorLeaves.push(secondLeaf);

  function openNote(path: string): void {
    const file = app.vault.getFileByPath(path) ?? app.vault.getFileByPath(`${path}.md`);
    if (!file) return;
    view.file = file;
    textarea.value = app.vault.contentOf(file.path) ?? '';
    textarea.setSelectionRange(0, 0);
    title.setText(file.path);
    app.workspace.setActiveLeaf(leaf);
    app.workspace.trigger('file-open', file);
    app.workspace.trigger('active-leaf-change', leaf);
  }

  function selectLines(from: number, to: number): void {
    view.editor.setSelection({ line: from - 1, ch: 0 }, { line: to - 1, ch: view.editor.getLine(to - 1).length });
  }

  function clearSelection(): void {
    const pos = view.editor.getCursor('to');
    view.editor.setCursor(pos);
  }

  function nextNote(): void {
    const current = view.file?.path ?? NOTE_ORDER[0]!;
    const i = NOTE_ORDER.indexOf(current);
    openNote(NOTE_ORDER[(i + 1) % NOTE_ORDER.length]!);
  }

  const button = (label: string, cb: () => void, id: string): void => {
    const b = tools.createEl('button', { text: label, attr: { id } });
    b.addEventListener('click', cb);
  };
  button('Select lines 3-5', () => selectLines(3, 5), 'harness-select');
  button('Clear selection', clearSelection, 'harness-clear');
  button('Switch note', nextNote, 'harness-switch');

  textarea.addEventListener('focus', () => app.workspace.setActiveLeaf(leaf));
  textarea.addEventListener('input', () => {
    if (view.file) void app.vault.modify(view.file as TFile, textarea.value);
  });
  document.body.addEventListener('harness-open-note', (ev) => openNote((ev as CustomEvent<{ path: string }>).detail.path));

  openNote(NOTE_ORDER[0]!);
  selectLines(3, 5);

  return { leaf, view, textarea, openNote, selectLines, clearSelection, nextNote };
}
