/** The status dot on a session row: pulsing accent while working, warm with a label when Claude needs you. */
import type { JSX } from 'preact';
import { STATUS_LABEL, type SessionStatus } from './status';
import { cls } from './primitives';

export function StatusDot(p: { status: SessionStatus; label?: boolean }): JSX.Element {
  const text = STATUS_LABEL[p.status];
  return (
    <span class={cls('claudsidian-ss-status', `is-${p.status}`)} title={text}>
      <span class="claudsidian-ss-status-dot" aria-hidden="true" />
      {p.label && <span class="claudsidian-ss-status-label">{text}</span>}
      {!p.label && <span class="claudsidian-sr-only">{text}</span>}
    </span>
  );
}
