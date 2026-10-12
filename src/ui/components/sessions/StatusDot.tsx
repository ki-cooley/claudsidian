/** The status dot on a session row: pulsing accent while working, warm when Claude needs you, hollow when offline. */
import type { JSX } from 'preact';
import { STATUS_LABEL, type SessionStatus } from './status';
import { cls } from './primitives';

export interface StatusDotProps {
  status: SessionStatus;
  /** render the status word next to the dot (the row puts its own word on the second line instead) */
  label?: boolean;
  /** the row has unread activity: the dot itself says so on hover */
  unread?: boolean;
}

export function StatusDot(p: StatusDotProps): JSX.Element {
  const text = STATUS_LABEL[p.status];
  const spoken = p.unread ? `${text}, unread` : text;
  return (
    <span class={cls('claudsidian-ss-status', `is-${p.status}`, p.unread && 'is-unread')} title={spoken}>
      <span class="claudsidian-ss-status-dot" aria-hidden="true" title={p.unread ? 'Unread' : undefined} />
      {p.label && <span class="claudsidian-ss-status-label">{text}</span>}
      {!p.label && <span class="claudsidian-sr-only">{spoken}</span>}
    </span>
  );
}
