/** A Lucide icon through Obsidian's setIcon. The only place the UI touches that API. */
import { setIcon } from 'obsidian';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

export interface IconProps {
  name: string;
  class?: string;
  /** accessible name; without one the icon is decorative */
  label?: string;
  size?: 'small' | 'medium';
}

export function Icon(props: IconProps): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) setIcon(ref.current, props.name);
  }, [props.name]);
  const cls = ['claudsidian-icon', props.size === 'small' ? 'is-small' : '', props.class ?? ''].filter(Boolean).join(' ');
  return (
    <span
      ref={ref}
      class={cls}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
    />
  );
}
