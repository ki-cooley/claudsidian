// Shim: Obsidian's Editor over a textarea. Positions are {line, ch}; selections are anchor/head pairs.

export interface EditorPosition {
  line: number;
  ch: number;
}

export interface EditorSelection {
  anchor: EditorPosition;
  head: EditorPosition;
}

export interface EditorRange {
  from: EditorPosition;
  to: EditorPosition;
}

export class Editor {
  constructor(readonly textarea: HTMLTextAreaElement) {}

  getDoc(): this {
    return this;
  }

  getValue(): string {
    return this.textarea.value;
  }

  setValue(content: string): void {
    this.textarea.value = content;
    this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private lines(): string[] {
    return this.textarea.value.split('\n');
  }

  lineCount(): number {
    return this.lines().length;
  }

  lastLine(): number {
    return this.lineCount() - 1;
  }

  getLine(n: number): string {
    return this.lines()[n] ?? '';
  }

  posToOffset(pos: EditorPosition): number {
    const lines = this.lines();
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) offset += (lines[i] ?? '').length + 1;
    return offset + Math.min(pos.ch, (lines[pos.line] ?? '').length);
  }

  offsetToPos(offset: number): EditorPosition {
    const lines = this.lines();
    let remaining = Math.max(0, Math.min(offset, this.textarea.value.length));
    for (let line = 0; line < lines.length; line++) {
      const len = (lines[line] ?? '').length;
      if (remaining <= len) return { line, ch: remaining };
      remaining -= len + 1;
    }
    const last = lines.length - 1;
    return { line: last, ch: (lines[last] ?? '').length };
  }

  getCursor(which: 'from' | 'to' | 'head' | 'anchor' = 'head'): EditorPosition {
    const { selectionStart, selectionEnd, selectionDirection } = this.textarea;
    if (which === 'from') return this.offsetToPos(selectionStart);
    if (which === 'to') return this.offsetToPos(selectionEnd);
    const backward = selectionDirection === 'backward';
    const headOffset = backward ? selectionStart : selectionEnd;
    const anchorOffset = backward ? selectionEnd : selectionStart;
    return this.offsetToPos(which === 'head' ? headOffset : anchorOffset);
  }

  setCursor(pos: EditorPosition | number, ch = 0): void {
    const p = typeof pos === 'number' ? { line: pos, ch } : pos;
    const offset = this.posToOffset(p);
    this.textarea.setSelectionRange(offset, offset);
    this.textarea.dispatchEvent(new Event('select', { bubbles: true }));
  }

  somethingSelected(): boolean {
    return this.textarea.selectionStart !== this.textarea.selectionEnd;
  }

  getSelection(): string {
    const { selectionStart, selectionEnd, value } = this.textarea;
    return value.slice(selectionStart, selectionEnd);
  }

  listSelections(): EditorSelection[] {
    return [{ anchor: this.getCursor('anchor'), head: this.getCursor('head') }];
  }

  setSelection(anchor: EditorPosition, head?: EditorPosition): void {
    const a = this.posToOffset(anchor);
    const h = this.posToOffset(head ?? anchor);
    this.textarea.setSelectionRange(Math.min(a, h), Math.max(a, h), h < a ? 'backward' : 'forward');
    this.textarea.dispatchEvent(new Event('select', { bubbles: true }));
  }

  setSelections(ranges: EditorSelection[]): void {
    const first = ranges[0];
    if (first) this.setSelection(first.anchor, first.head);
  }

  getRange(from: EditorPosition, to: EditorPosition): string {
    return this.textarea.value.slice(this.posToOffset(from), this.posToOffset(to));
  }

  replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void {
    const start = this.posToOffset(from);
    const end = to ? this.posToOffset(to) : start;
    const v = this.textarea.value;
    this.textarea.value = v.slice(0, start) + replacement + v.slice(end);
    const caret = start + replacement.length;
    this.textarea.setSelectionRange(caret, caret);
    this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  replaceSelection(replacement: string): void {
    const { selectionStart, selectionEnd } = this.textarea;
    this.replaceRange(replacement, this.offsetToPos(selectionStart), this.offsetToPos(selectionEnd));
  }

  focus(): void {
    this.textarea.focus();
  }

  blur(): void {
    this.textarea.blur();
  }

  hasFocus(): boolean {
    return document.activeElement === this.textarea;
  }

  getScrollInfo(): { top: number; left: number } {
    return { top: this.textarea.scrollTop, left: this.textarea.scrollLeft };
  }

  scrollTo(_x?: number | null, y?: number | null): void {
    if (typeof y === 'number') this.textarea.scrollTop = y;
  }

  scrollIntoView(_range: EditorRange, _center?: boolean): void {}

  exec(_command: string): void {}

  transaction(tx: { changes?: { from: EditorPosition; to?: EditorPosition; text: string }[]; selection?: EditorSelection }): void {
    for (const c of [...(tx.changes ?? [])].reverse()) this.replaceRange(c.text, c.from, c.to);
    if (tx.selection) this.setSelection(tx.selection.anchor, tx.selection.head);
  }

  undo(): void {}
  redo(): void {}
  refresh(): void {}
  wordAt(_pos: EditorPosition): EditorRange | null {
    return null;
  }
}
