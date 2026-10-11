/**
 * Private UI primitives for the sessions screen (Icon, Button, Spinner, Banner, Sheet). Task B1 owns the shared
 * versions in src/ui/components/common/; these exist so the sessions screen builds without them and can be
 * swapped to the common ones at integration (same class names, same shapes).
 */
import { setIcon } from 'obsidian';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Banner as BannerData } from '../../../core/store-api';

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Icon(p: { name: string; class?: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, p.name);
  }, [p.name]);
  return <span ref={ref} class={cls('claudsidian-icon', p.class)} aria-hidden="true" />;
}

export interface ButtonProps {
  label?: string;
  icon?: string;
  /** accessible name for icon-only buttons, also the tooltip */
  title?: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  class?: string;
  onClick?: (ev: MouseEvent) => void;
}

export function Button(p: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      class={cls('claudsidian-btn', p.primary && 'mod-cta', p.danger && 'mod-warning', !p.label && 'is-icon-only', p.class)}
      aria-label={p.label ?? p.title}
      title={p.title}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      {p.icon && <Icon name={p.icon} />}
      {p.label && <span class="claudsidian-btn-label">{p.label}</span>}
    </button>
  );
}

export function Spinner(p: { label?: string }): JSX.Element {
  return <div class="claudsidian-spinner" role="status" aria-label={p.label ?? 'Loading'} />;
}

export function Banner(p: { banner: BannerData | null }): JSX.Element | null {
  const b = p.banner;
  if (!b) return null;
  return (
    <div class={cls('claudsidian-banner', `is-${b.kind}`)} role={b.kind === 'error' ? 'alert' : 'status'}>
      <span class="claudsidian-banner-text">{b.text}</span>
      {b.action && <Button class="claudsidian-banner-action" label={b.action.label} onClick={() => b.action?.run()} />}
    </div>
  );
}

export interface SheetProps {
  title?: string;
  onClose: () => void;
  class?: string;
  children?: ComponentChildren;
}

/** Mounted sheets in opening order; only the last one (the topmost) answers Escape. */
const openSheets: symbol[] = [];

/** A bottom sheet contained in the view (not the whole window). Backdrop tap and Escape close it. */
export function Sheet(p: SheetProps): JSX.Element {
  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;
  useEffect(() => {
    const token = Symbol('sheet');
    openSheets.push(token);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || openSheets[openSheets.length - 1] !== token) return;
      ev.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = openSheets.indexOf(token);
      if (i >= 0) openSheets.splice(i, 1);
    };
  }, []);
  return (
    <div class="claudsidian-sheet-layer">
      <div class="claudsidian-sheet-backdrop" onClick={() => p.onClose()} />
      <div class={cls('claudsidian-sheet', p.class)} role="dialog" aria-modal="true" aria-label={p.title}>
        {p.title && <div class="claudsidian-sheet-title">{p.title}</div>}
        {p.children}
      </div>
    </div>
  );
}
