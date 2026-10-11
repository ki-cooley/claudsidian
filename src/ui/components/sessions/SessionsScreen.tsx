/** The sessions list screen: toolbar, banner, grouped rows, the row action sheet and the new session sheet. */
import { useSignal, type Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { SessionStoreApi } from '../../../core/store-api';
import type { PluginFacade } from '../../facade';
import { EmptyState } from './EmptyState';
import { NewSessionSheet } from './NewSessionSheet';
import { SessionGroup } from './SessionGroup';
import { groupSessions } from './grouping';
import { Banner, Button, Sheet, Spinner, cls } from './primitives';

const CLOCK_TICK_MS = 30_000;

export interface SessionsScreenProps {
  store: SessionStoreApi;
  facade: PluginFacade;
  onOpen: (id: string) => void;
  onRename: (id: string) => void;
  onArchive: (id: string) => void;
  /** Optional external toggle for the new session sheet (the "New session" command sets it to true). */
  showNewSession?: Signal<boolean>;
}

export function claudeCodeUrl(sessionId: string): string {
  return 'https://claude.ai/code/' + sessionId;
}

export function SessionsScreen(p: SessionsScreenProps): JSX.Element {
  const { store } = p;
  const sessions = store.sessions.value;
  const loading = store.sessionsLoading.value;
  const banner = store.banner.value;
  const listError = store.sessionsError.value;
  const settings = p.facade.settings();

  const [showArchived, setShowArchived] = useState(false);
  const [moreId, setMoreId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const localNew = useSignal(false);
  const showNew = p.showNewSession ?? localNew;

  useEffect(() => {
    void store.refreshSessions();
    store.startListPolling();
    return () => store.stopListPolling();
  }, [store]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Environments carry bridge_info.directory, which places sessions whose init cwd is unknown. The store has no
  // signal for them, so key the memo on their ids and cwds; the list signal changes on every poll anyway.
  const environments = store.environments();
  const envKey = environments.map((e) => e.id + ':' + (e.cwd ?? '') + ':' + e.label).join('|');
  const groups = useMemo(
    () => groupSessions(sessions, settings.vaultPathOnMac, showArchived, environments),
    [sessions, settings.vaultPathOnMac, showArchived, envKey],
  );
  const visibleCount = groups.reduce((n, g) => n + g.sessions.length, 0);
  const effectiveBanner = banner ?? (listError ? { kind: 'error' as const, text: listError } : null);
  const moreSession = moreId ? store.session(moreId) : undefined;

  const closeMore = () => setMoreId(null);

  return (
    <div class="claudsidian-sessions">
      <header class="claudsidian-sessions-toolbar">
        <h2 class="claudsidian-sessions-heading">Sessions</h2>
        <label class="claudsidian-show-archived">
          <input type="checkbox" checked={showArchived} onChange={(ev) => setShowArchived((ev.currentTarget as HTMLInputElement).checked)} />
          <span>Show archived</span>
        </label>
        <Button
          class={cls('claudsidian-sessions-refresh', loading && 'is-loading')}
          icon="refresh-cw"
          title="Refresh"
          onClick={() => void store.refreshSessions()}
        />
        <Button class="claudsidian-sessions-new" primary icon="plus" label="New" onClick={() => (showNew.value = true)} />
      </header>

      <Banner banner={effectiveBanner} />

      <div class="claudsidian-sessions-body">
        {visibleCount === 0 ? (
          loading && sessions.length === 0 ? (
            <Spinner label="Loading sessions" />
          ) : (
            <EmptyState
              variant={sessions.length > 0 ? 'all-archived' : 'none'}
              onNew={() => (showNew.value = true)}
              onShowArchived={() => setShowArchived(true)}
            />
          )
        ) : (
          groups.map((g) => (
            <SessionGroup key={g.title} title={g.title} sessions={g.sessions} now={now} onOpen={p.onOpen} onMore={setMoreId} />
          ))
        )}
      </div>

      {moreSession && (
        <Sheet title={moreSession.title} class="claudsidian-session-actions" onClose={closeMore}>
          <Button
            icon="pencil"
            label="Rename"
            onClick={() => {
              closeMore();
              p.onRename(moreSession.id);
            }}
          />
          <Button
            icon="external-link"
            label="Open in claude.ai"
            onClick={() => {
              closeMore();
              p.facade.openExternal(claudeCodeUrl(moreSession.id));
            }}
          />
          {!moreSession.archived && (
            <Button
              icon="archive"
              label="Archive"
              danger
              onClick={() => {
                closeMore();
                p.onArchive(moreSession.id);
              }}
            />
          )}
        </Sheet>
      )}

      {showNew.value && (
        <NewSessionSheet
          store={store}
          facade={p.facade}
          onCreated={(id) => {
            showNew.value = false;
            p.onOpen(id);
          }}
          onClose={() => (showNew.value = false)}
        />
      )}
    </div>
  );
}
