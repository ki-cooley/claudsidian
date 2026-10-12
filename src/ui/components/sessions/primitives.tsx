/**
 * Private UI primitives for the sessions screen (Icon, Button, Spinner, Banner, Sheet). Task B1 owns the shared
 * versions in src/ui/components/common/; these exist so the sessions screen builds without them. Their class
 * names are namespaced claudsidian-ss-* so chat.css (which styles the common set) never reaches them: the shared
 * sheet markup nests the sheet inside its backdrop, this one keeps them as siblings.
 */
import { setIcon } from 'obsidian';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef } from 'preact/hooks';
import type { Banner as BannerData } from '../../../core/store-api';

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Icon(p: { name: string; class?: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  // layout effect: the SVG lands in the same frame as the row, so a list mount never paints 49 empty buttons first
  useLayoutEffect(() => {
    if (ref.current) setIcon(ref.current, p.name);
  }, [p.name]);
  return <span ref={ref} class={cls('claudsidian-ss-icon', p.class)} aria-hidden="true" />;
}

export interface ButtonProps {
  label?: string;
  icon?: string;
  /** native tooltip; also the accessible name of an icon-only button */
  title?: string;
  /** accessible name when it should differ from the visible label (a label the layout may hide) */
  ariaLabel?: string;
  primary?: boolean;
  danger?: boolean;
  /** no fill: an icon that sits in a toolbar or a row */
  ghost?: boolean;
  /** on/off state of a toggle, exposed as aria-pressed */
  pressed?: boolean;
  disabled?: boolean;
  class?: string;
  onClick?: (ev: MouseEvent) => void;
}

export function Button(p: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      class={cls(
        'claudsidian-ss-btn',
        p.primary && 'mod-cta',
        p.danger && 'mod-warning',
        p.ghost && 'is-ghost',
        p.pressed && 'is-pressed',
        !p.label && 'is-icon-only',
        p.class,
      )}
      aria-label={p.ariaLabel ?? (p.label ? undefined : p.title)}
      aria-pressed={p.pressed === undefined ? undefined : p.pressed ? 'true' : 'false'}
      title={p.title}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      {p.icon && <Icon name={p.icon} />}
      {p.label && <span class="claudsidian-ss-btn-label">{p.label}</span>}
    </button>
  );
}

export function Spinner(p: { label?: string }): JSX.Element {
  return <div class="claudsidian-ss-spinner" role="status" aria-label={p.label ?? 'Loading'} />;
}

export function Banner(p: { banner: BannerData | null; onDismiss?: () => void }): JSX.Element | null {
  const b = p.banner;
  if (!b) return null;
  return (
    <div class={cls('claudsidian-ss-banner', `is-${b.kind}`)} role={b.kind === 'error' ? 'alert' : 'status'}>
      <span class="claudsidian-ss-banner-text">{b.text}</span>
      {b.action && <Button class="claudsidian-ss-banner-action" label={b.action.label} onClick={() => b.action?.run()} />}
      {p.onDismiss && <Button class="claudsidian-ss-banner-dismiss" icon="x" title="Dismiss" onClick={() => p.onDismiss?.()} />}
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

/** A bottom sheet contained in the view (not the whole window). Backdrop tap, the X in its head and Escape close it. */
export function Sheet(p: SheetProps): JSX.Element {
  const titleId = useId();
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
    <div class="claudsidian-ss-sheet-layer">
      <div class="claudsidian-ss-sheet-backdrop" onClick={() => p.onClose()} />
      <div class={cls('claudsidian-ss-sheet', p.class)} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div class="claudsidian-ss-sheet-head">
          <div class={cls('claudsidian-ss-sheet-title', !p.title && 'claudsidian-sr-only')} id={titleId}>
            {p.title ?? 'Menu'}
          </div>
          <Button class="claudsidian-ss-sheet-close" ghost icon="x" title="Close" onClick={() => p.onClose()} />
        </div>
        {p.children}
      </div>
    </div>
  );
}
