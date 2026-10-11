/** A small rotating ring for in-flight work; static under prefers-reduced-motion (see cards.css). */
import type { JSX } from 'preact';

export interface SpinnerProps {
  size?: 'small' | 'medium';
  label?: string;
  class?: string;
}

export function Spinner(p: SpinnerProps): JSX.Element {
  const cls = ['claudsidian-spinner', p.size === 'small' ? 'is-small' : '', p.class ?? ''].filter(Boolean).join(' ');
  return <span class={cls} role="progressbar" aria-label={p.label ?? 'Working'} aria-busy="true" />;
}
