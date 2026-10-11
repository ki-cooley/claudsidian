/** A titled group of session rows ("This vault", "Other local", "Cloud", "Archived"). */
import type { JSX } from 'preact';
import type { SessionSummary } from '../../../core/types';
import { SessionRow } from './SessionRow';

export interface SessionGroupProps {
  title: string;
  sessions: SessionSummary[];
  now: number;
  onOpen: (id: string) => void;
  onMore: (id: string) => void;
}

export function SessionGroup(p: SessionGroupProps): JSX.Element {
  return (
    <section class="claudsidian-session-group">
      <div class="claudsidian-session-group-head">
        <h3 class="claudsidian-session-group-title">{p.title}</h3>
        <span class="claudsidian-session-group-count">{p.sessions.length}</span>
      </div>
      <ul class="claudsidian-session-list">
        {p.sessions.map((s) => (
          <SessionRow key={s.id} session={s} now={p.now} onOpen={p.onOpen} onMore={p.onMore} />
        ))}
      </ul>
    </section>
  );
}
