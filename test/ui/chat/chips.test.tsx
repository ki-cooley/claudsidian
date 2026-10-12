// ContextChips: labels (note basename, "selection 10-13", "cursor 10"), no "N open" chip, toggle state via
// aria-pressed, hidden without an open note, the compact cooking chip, and no aria-label on the group.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapturedContext } from '../../../src/core/types';
import { chipsFor, compactLabel, ContextChips, lineRange, type ContextChipsProps } from '../../../src/ui/components/chat/ContextChips';
import type { ContextToggles } from '../../../src/ui/components/chat/context-toggles';
import { mount, q, qa, text, tick, type Mounted } from './harness';

const CTX: CapturedContext = {
  vaultName: 'yes-chef',
  activeNote: { path: 'menus/latitude 10/prep-rd-2026-10-18.md', cursorLine: 10 },
  selection: { text: 'dashi', fromLine: 10, toLine: 13, truncated: false },
  openNotes: ['components/dashi.md', 'techniques/kombu-cure.md'],
  mentions: [],
};

const ALL_ON: ContextToggles = { note: true, selection: true, cursor: true, open: true, mentions: true };

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function setup(over: Partial<ContextChipsProps> = {}) {
  const onToggle = vi.fn();
  const props: ContextChipsProps = { context: CTX, enabled: ALL_ON, onToggle, ...over };
  const m = mount(ContextChips, props);
  mounted.push(m as Mounted<unknown>);
  return { ...m, onToggle, props };
}

describe('ContextChips', () => {
  it('reads the note basename, the selection range and the cursor line, and drops the open-notes chip', () => {
    const chips = chipsFor(CTX);
    expect(chips.map((c) => [c.key, c.label])).toEqual([
      ['note', 'prep-rd-2026-10-18.md'],
      ['cursor', 'cursor 10'],
      ['selection', 'selection 10-13'],
    ]);
    expect(lineRange(4, 4)).toBe('4');
    expect(chipsFor({ ...CTX, selection: { text: 'x', fromLine: 7, toLine: 7, truncated: false } }).find((c) => c.key === 'selection')?.label).toBe('selection 7');
    expect(chipsFor({ ...CTX, mentions: ['a.md', 'b.md'] }).at(-1)?.label).toBe('2 mentioned');
  });

  it('renders the chips as pressed toggles and reports the key on tap', async () => {
    const { root, onToggle } = setup();
    const keys = qa(root, '.claudsidian-chip').map((c) => c.getAttribute('data-key'));
    expect(keys).toEqual(['note', 'cursor', 'selection']);
    expect(root.querySelector('.claudsidian-chip[data-key="open"]')).toBeNull();
    const note = q<HTMLButtonElement>(root, '.claudsidian-chip[data-key="note"]');
    expect(note.getAttribute('aria-pressed')).toBe('true');
    expect(note.classList.contains('is-on')).toBe(true);
    note.click();
    expect(onToggle).toHaveBeenCalledWith('note');
    await tick();
  });

  it('an off chip shows as not pressed and strikes through; the cursor chip follows the note', () => {
    const { root } = setup({ enabled: { ...ALL_ON, note: false } });
    const note = q<HTMLButtonElement>(root, '.claudsidian-chip[data-key="note"]');
    expect(note.getAttribute('aria-pressed')).toBe('false');
    expect(note.classList.contains('is-off')).toBe(true);
    const cursor = q<HTMLButtonElement>(root, '.claudsidian-chip[data-key="cursor"]');
    expect(cursor.getAttribute('aria-pressed')).toBe('false');
    expect(cursor.disabled).toBe(true);
  });

  it('hides the row entirely without an open note, even with a selection or open notes', () => {
    const { root } = setup({ context: { ...CTX, activeNote: undefined } });
    expect(root.querySelector('.claudsidian-chips')).toBeNull();
    const none = setup({ context: null });
    expect(none.root.querySelector('.claudsidian-chips')).toBeNull();
  });

  it('names the group through a hidden element instead of an aria-label tooltip', () => {
    const { root } = setup();
    const group = q(root, '.claudsidian-chips');
    expect(group.getAttribute('aria-label')).toBeNull();
    const id = group.getAttribute('aria-labelledby');
    expect(id).toBeTruthy();
    expect(text(document.getElementById(id!))).toBe('Context for the next message');
  });

  it('cooking mode collapses to one "note + selection" chip that expands on tap', async () => {
    const { root, onToggle } = setup({ cooking: true });
    expect(compactLabel(CTX, ALL_ON)).toBe('note + selection');
    expect(compactLabel(CTX, { ...ALL_ON, selection: false })).toBe('note');
    expect(compactLabel(CTX, { ...ALL_ON, note: false, selection: false })).toBe('no context');
    const summary = q<HTMLButtonElement>(root, '.claudsidian-chip.is-summary');
    expect(text(summary)).toBe('note + selection');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(qa(root, '.claudsidian-chip[data-key]')).toHaveLength(0);
    summary.click();
    await tick();
    expect(q(root, '.claudsidian-chip.is-summary').getAttribute('aria-expanded')).toBe('true');
    expect(qa(root, '.claudsidian-chip[data-key]').map((c) => c.getAttribute('data-key'))).toEqual(['note', 'cursor', 'selection']);
    q<HTMLButtonElement>(root, '.claudsidian-chip[data-key="selection"]').click();
    expect(onToggle).toHaveBeenCalledWith('selection');
  });
});
