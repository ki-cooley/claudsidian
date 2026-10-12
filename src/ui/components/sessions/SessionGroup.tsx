/** A titled group of session rows ("This vault", "Other local", "Cloud", "Archived"); quiet rows sit last. */
import type { JSX } from 'preact';
import type { SessionSummary } from '../../../core/types';
import { SessionRow } from './SessionRow';
import { quietLast } from './status';

export interface SessionGroupProps {
  title: string;
  sessions: SessionSummary[];
  now: number;
  /** needs-you lines by session id, for rows whose pending control the screen knows */
  needsTexts?: ReadonlyMap<string, string>;
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
        {quietLast(p.sessions).map((s) => (
          <SessionRow key={s.id} session={s} now={p.now} needsText={p.needsTexts?.get(s.id)} onOpen={p.onOpen} onMore={p.onMore} />
        ))}
      </ul>
    </section>
  );
}
