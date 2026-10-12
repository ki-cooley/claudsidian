/**
 * One session in the list: [dot] [title · needs-you pill · time] / [state word or needs-you text · preview], and
 * the trailing "more" control. Memoised on the fields it renders so a list poll with unchanged rows is free.
 */
import { Component, type JSX } from 'preact';
import type { SessionSummary } from '../../../core/types';
import { relativeTime } from '../../../util/time';
import { StatusDot } from './StatusDot';
import { Icon, cls } from './primitives';
import { isQuiet, needsYouText, statusOf, summaryLine, type SessionStatus } from './status';

export interface SessionRowProps {
  session: SessionSummary;
  now: number;
  /** the needs-you line when the screen knows the pending control (else it is derived from the list payload) */
  needsText?: string;
  onOpen: (id: string) => void;
  onMore: (id: string) => void;
}

const STATE_WORD: Partial<Record<SessionStatus, string>> = { working: 'Working', offline: 'Offline' };

/** Everything the row paints from a summary, as one string: equal keys mean an identical row. */
export function rowRenderKey(s: SessionSummary, now: number): string {
  return [s.id, s.title, statusOf(s), s.unread ? 1 : 0, s.archived ? 1 : 0, isQuiet(s) ? 1 : 0, summaryLine(s), relativeTime(s.lastEventAt, now)].join(
    '\u0000',
  );
}

export function sameRowProps(a: SessionRowProps, b: SessionRowProps): boolean {
  if (a.onOpen !== b.onOpen || a.onMore !== b.onMore || a.needsText !== b.needsText) return false;
  if (a.session === b.session && a.now === b.now) return true;
  return rowRenderKey(a.session, a.now) === rowRenderKey(b.session, b.now);
}

function RowView(p: SessionRowProps): JSX.Element {
  const s = p.session;
  const status = statusOf(s);
  const line = status === 'needs_you' ? (p.needsText ?? needsYouText(s)) : summaryLine(s);
  const state = STATE_WORD[status];
  const time = relativeTime(s.lastEventAt, p.now);
  return (
    <li
      class={cls('claudsidian-session-row', `is-${status}`, s.unread && 'is-unread', isQuiet(s) && 'is-quiet')}
      data-session-id={s.id}
    >
      <button type="button" class="claudsidian-session-main" onClick={() => p.onOpen(s.id)}>
        <StatusDot status={status} unread={s.unread} />
        <span class="claudsidian-session-head">
          <span class="claudsidian-session-title">{s.title}</span>
          {status === 'needs_you' && <span class="claudsidian-session-pill">Needs you</span>}
        </span>
        {time && <span class="claudsidian-session-time">{time}</span>}
        {(state || line) && (
          <span class="claudsidian-session-sub">
            {state && <span class="claudsidian-session-state">{state}</span>}
            {line && (
              <span class={cls('claudsidian-session-summary', status === 'needs_you' && 'is-needs')} title={status === 'needs_you' ? line : undefined}>
                {line}
              </span>
            )}
          </span>
        )}
      </button>
      <button
        type="button"
        class="claudsidian-session-more"
        aria-label={`Actions for ${s.title}`}
        onClick={(ev) => {
          ev.stopPropagation();
          p.onMore(s.id);
        }}
      >
        <Icon name="more-horizontal" />
      </button>
    </li>
  );
}

/** Memoised row: re-renders only when a rendered field, the needs-you text or a callback changes. */
export class SessionRow extends Component<SessionRowProps> {
  shouldComponentUpdate(next: SessionRowProps): boolean {
    return !sameRowProps(this.props, next);
  }
  render(): JSX.Element {
    return <RowView {...this.props} />;
  }
}
