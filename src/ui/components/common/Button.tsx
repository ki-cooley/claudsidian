/** The one button: icon, label or both; primary and danger map onto Obsidian's mod-cta and mod-warning. */
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from './Icon';

export type ButtonKind = 'default' | 'primary' | 'danger' | 'ghost';

export interface ButtonProps {
  label?: string;
  icon?: string;
  kind?: ButtonKind;
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  pressed?: boolean;
  /** required for icon-only buttons */
  ariaLabel?: string;
  title?: string;
  class?: string;
  onClick?: (ev: MouseEvent) => void;
  children?: ComponentChildren;
}

const KIND_CLASS: Record<ButtonKind, string> = {
  default: '',
  primary: 'mod-cta is-primary',
  danger: 'mod-warning is-danger',
  ghost: 'is-ghost',
};

export function Button(p: ButtonProps): JSX.Element {
  const kind = p.kind ?? 'default';
  const iconOnly = !p.label && !p.children;
  const cls = [
    'claudsidian-btn',
    KIND_CLASS[kind],
    p.size ? `is-${p.size}` : '',
    iconOnly ? 'is-icon' : '',
    p.pressed ? 'is-pressed' : '',
    p.class ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      class={cls}
      disabled={p.disabled}
      aria-label={p.ariaLabel ?? (iconOnly ? p.icon : undefined)}
      aria-pressed={p.pressed === undefined ? undefined : p.pressed ? 'true' : 'false'}
      title={p.title ?? (iconOnly ? p.ariaLabel : undefined)}
      onClick={p.onClick}
    >
      {p.icon ? <Icon name={p.icon} /> : null}
      {p.label ? <span class="claudsidian-btn-label">{p.label}</span> : null}
      {p.children}
    </button>
  );
}
