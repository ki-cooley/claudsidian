/**
 * A bottom sheet anchored to the plugin's own root: a backdrop, a titled panel with an X, and SheetAction rows.
 * Tapping the backdrop, the X or pressing Escape closes it. The dialog is named by its title element
 * (aria-labelledby), never by an aria-label, which Obsidian would also show as a hover tooltip.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId } from 'preact/hooks';
import { Button } from './Button';
import { Icon } from './Icon';

export interface SheetProps {
  title?: string;
  /** accessible name when there is no title */
  label?: string;
  onClose: () => void;
  class?: string;
  children?: ComponentChildren;
}

export function Sheet(p: SheetProps): JSX.Element {
  const titleId = useId();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        p.onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [p.onClose]);

  return (
    <div
      class="claudsidian-sheet-backdrop"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) p.onClose();
      }}
    >
      <div class={['claudsidian-sheet', p.class ?? ''].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {p.title !== undefined ? (
          <div class="claudsidian-sheet-head">
            <div class="claudsidian-sheet-title" id={titleId}>
              {p.title}
            </div>
            <Button icon="x" ariaLabel="Close" kind="ghost" onClick={p.onClose} />
          </div>
        ) : (
          <span class="claudsidian-sr-only" id={titleId}>
            {p.label ?? 'Menu'}
          </span>
        )}
        <div class="claudsidian-sheet-body">{p.children}</div>
      </div>
    </div>
  );
}

export interface SheetActionProps {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** marks the current choice in a picker */
  selected?: boolean;
  /** on/off state for a toggle row */
  pressed?: boolean;
}

export function SheetAction(p: SheetActionProps): JSX.Element {
  const cls = ['claudsidian-sheet-action', p.danger ? 'is-danger' : '', p.selected ? 'is-selected' : ''].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      class={cls}
      role="menuitem"
      disabled={p.disabled}
      aria-current={p.selected ? 'true' : undefined}
      aria-pressed={p.pressed === undefined ? undefined : p.pressed ? 'true' : 'false'}
      onClick={p.onClick}
    >
      {p.icon ? <Icon name={p.icon} /> : <span class="claudsidian-icon is-blank" aria-hidden="true" />}
      <span class="claudsidian-sheet-action-label">{p.label}</span>
      {p.selected ? <Icon name="check" size="small" class="claudsidian-sheet-check" /> : null}
      {p.pressed !== undefined ? <span class={`claudsidian-switch ${p.pressed ? 'is-on' : ''}`} aria-hidden="true" /> : null}
    </button>
  );
}
