/**
 * The list that floats above the composer for @ files and / commands. The composer owns the
 * keyboard (arrows, Enter, Escape) and passes the highlighted index; the popup renders and
 * handles taps. Mouse-down is swallowed so the textarea keeps focus. The listbox is named through
 * a visually hidden element (aria-labelledby), never aria-label, which Obsidian would show as a tooltip.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';

export interface SuggestPopupProps<T> {
  items: T[];
  render: (t: T) => ComponentChildren;
  onPick: (t: T) => void;
  onClose: () => void;
  anchor?: HTMLElement;
  /** highlighted row */
  selected?: number;
  label?: string;
  /** text when there are no items */
  empty?: string;
}

export function SuggestPopup<T>(p: SuggestPopupProps<T>): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const selected = p.selected ?? 0;

  useEffect(() => {
    const el = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]').item(selected);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selected, p.items]);

  useEffect(() => {
    // A tap anywhere outside the composer dismisses the list.
    const onPointer = (ev: Event): void => {
      const target = ev.target as Node | null;
      if (listRef.current?.contains(target) || p.anchor?.contains(target ?? null)) return;
      p.onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [p.onClose, p.anchor]);

  return (
    <div class="claudsidian-suggest" role="listbox" aria-labelledby={labelId} ref={listRef}>
      <span id={labelId} class="claudsidian-sr-only">
        {p.label ?? 'Suggestions'}
      </span>
      {p.items.length === 0 ? (
        <div class="claudsidian-suggest-empty">{p.empty ?? 'No matches'}</div>
      ) : (
        p.items.map((item, i) => (
          <button
            type="button"
            role="option"
            key={i}
            aria-selected={i === selected ? 'true' : 'false'}
            class={`claudsidian-suggest-item ${i === selected ? 'is-selected' : ''}`}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => p.onPick(item)}
          >
            {p.render(item)}
          </button>
        ))
      )}
    </div>
  );
}
