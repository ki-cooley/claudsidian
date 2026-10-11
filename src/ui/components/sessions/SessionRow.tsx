/** One session in the list: dot, title, relative time, summary line, and the trailing actions button. */
import type { JSX } from 'preact';
import type { SessionSummary } from '../../../core/types';
import { relativeTime } from '../../../util/time';
import { StatusDot } from './StatusDot';
import { Icon, cls } from './primitives';
import { statusOf, summaryLine } from './status';

export interface SessionRowProps {
  session: SessionSummary;
  now: number;
  onOpen: (id: string) => void;
  onMore: (id: string) => void;
}

export function SessionRow(p: SessionRowProps): JSX.Element {
  const s = p.session;
  const status = statusOf(s);
  const summary = summaryLine(s);
  const time = relativeTime(s.lastEventAt, p.now);
  return (
    <li class={cls('claudsidian-session-row', `is-${status}`, s.unread && 'is-unread')} data-session-id={s.id}>
      <button type="button" class="claudsidian-session-main" onClick={() => p.onOpen(s.id)}>
        <StatusDot status={status} />
        <span class="claudsidian-session-body">
          <span class="claudsidian-session-head">
            <span class="claudsidian-session-title">{s.title}</span>
            {time && <span class="claudsidian-session-time">{time}</span>}
          </span>
          {(status === 'needs_you' || summary) && (
            <span class="claudsidian-session-sub">
              {status === 'needs_you' && <span class="claudsidian-session-needs">Needs you</span>}
              {summary && <span class="claudsidian-session-summary">{summary}</span>}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        class="claudsidian-session-more"
        aria-label={`Actions for ${s.title}`}
        title="Actions"
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
