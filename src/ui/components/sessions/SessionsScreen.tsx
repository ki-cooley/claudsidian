/**
 * The sessions list screen: toolbar, banner, grouped rows, the row action sheet and the new session sheet. By
 * default it shows "This vault" only (the cooking sessions); a footer button shows every session, and a row's
 * sheet files a session run elsewhere under "This vault" (or takes it back out). A filter searches everything.
 */
import { useSignal, type Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import type { SessionStoreApi } from '../../../core/store-api';
import type { SessionSummary } from '../../../core/types';
import type { PluginFacade } from '../../facade';
import { EmptyState } from './EmptyState';
import { NewSessionSheet } from './NewSessionSheet';
import { SessionGroup } from './SessionGroup';
import { groupSessions, vaultMembership } from './grouping';
import { Banner, Button, Sheet, Spinner, cls } from './primitives';
import { needsYouText, statusOf, summaryLine } from './status';

const CLOCK_TICK_MS = 30_000;

export interface SessionsScreenProps {
  store: SessionStoreApi;
  facade: PluginFacade;
  onOpen: (id: string) => void;
  onRename: (id: string) => void;
  /**
   * Not called by the list: a row's Archive goes straight to store.archive() with a Notice (no confirm). Kept so
   * the shell can wire one handler for both screens; the chat header still routes through it.
   */
  onArchive?: (id: string) => void;
  /** Optional external toggle for the new session sheet (the "New session" command sets it to true). */
  showNewSession?: Signal<boolean>;
}


export function claudeCodeUrl(sessionId: string): string {
  return 'https://claude.ai/code/' + sessionId;
}

/** Client-side filter: title, the preview line, and the needs-you line, case-insensitive substring. */
export function matchesFilter(s: SessionSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (s.title.toLowerCase().includes(q) || summaryLine(s).toLowerCase().includes(q)) return true;
  return statusOf(s) === 'needs_you' && needsYouText(s).toLowerCase().includes(q);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SessionsScreen(p: SessionsScreenProps): JSX.Element {
  const { store } = p;
  const sessions = store.sessions.value;
  const loading = store.sessionsLoading.value;
  const banner = store.banner.value;
  const listError = store.sessionsError.value;
  const settings = p.facade.settings();

  const [showArchived, setShowArchived] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** the toolbar's own refresh in flight; background polls never spin the icon */
  const [manual, setManual] = useState(false);
  const [moreId, setMoreId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const localNew = useSignal(false);
  const showNew = p.showNewSession ?? localNew;
  const filterId = useId();
  const filterRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void store.refreshSessions({ resort: true });
    store.startListPolling();
    return () => store.stopListPolling();
  }, [store]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (filterOpen) filterRef.current?.focus();
  }, [filterOpen]);

  // Stable row callbacks, so memoised rows only re-render for their own data.
  const openRef = useRef(p.onOpen);
  openRef.current = p.onOpen;
  const onOpen = useCallback((id: string) => openRef.current(id), []);
  const onMore = useCallback((id: string) => setMoreId(id), []);

  const refresh = () => {
    if (manual) return;
    setManual(true);
    store.refreshSessions({ resort: true })
      .catch(() => undefined)
      .finally(() => {
        if (alive.current) setManual(false);
      });
  };

  const closeFilter = () => {
    setFilterOpen(false);
    setQuery('');
  };

  // Environments carry bridge_info.directory, which places sessions whose init cwd is unknown. The store has no
  // signal for them, so key the memo on their ids and cwds; the list signal changes on every poll anyway.
  const environments = store.environments();
  const envKey = environments.map((e) => e.id + ':' + (e.cwd ?? '') + ':' + e.label).join('|');
  const filtering = query.trim() !== '';
  const filtered = useMemo(() => (filtering ? sessions.filter((s) => matchesFilter(s, query)) : sessions), [sessions, query, filtering]);
  const pinnedIds = settings.vaultSessionIds;
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds.join('|')]);
  const inVault = useMemo(
    () => vaultMembership(sessions, settings.vaultPathOnMac, environments, pinned),
    [sessions, settings.vaultPathOnMac, envKey, pinned],
  );
  const vaultOnly = settings.listScope !== 'all' && !filtering;
  const scoped = useMemo(() => (vaultOnly ? filtered.filter(inVault) : filtered), [filtered, vaultOnly, inVault]);
  const hiddenCount = vaultOnly ? sessions.filter((s) => !s.archived && !inVault(s)).length : 0;
  const groups = useMemo(
    () => groupSessions(scoped, settings.vaultPathOnMac, showArchived, environments, pinned),
    [scoped, settings.vaultPathOnMac, showArchived, envKey, pinned],
  );
  const setScope = (listScope: 'vault' | 'all') => void p.facade.saveSettings({ listScope });
  const setPinned = (id: string, on: boolean) => {
    const next = pinnedIds.filter((x) => x !== id);
    if (on) next.push(id);
    void p.facade.saveSettings({ vaultSessionIds: next });
  };

  // The needs-you line of a blocked row comes from its transcript's pending control when this plugin has seen
  // it (the question text, the tool and file); reading the signal here re-renders the list when it changes.
  // Not memoised on purpose: the transcript signals are not in any dependency list, and the work is a few rows.
  const needsTexts = new Map<string, string>();
  for (const s of scoped) {
    if (s.archived || statusOf(s) !== 'needs_you') continue;
    needsTexts.set(s.id, needsYouText(s, store.transcript(s.id).value.pending));
  }

  const visibleCount = groups.reduce((n, g) => n + g.sessions.length, 0);
  const effectiveBanner = banner ?? (listError ? { kind: 'error' as const, text: listError } : null);
  const moreSession = moreId ? store.session(moreId) : undefined;

  const closeMore = () => setMoreId(null);
  const archive = (s: SessionSummary) => {
    closeMore();
    p.facade.notice(`Archived ${s.title}`);
    store.archive(s.id).catch((err: unknown) => p.facade.notice(`Archive failed: ${messageOf(err)}`));
  };

  return (
    <div class="claudsidian-sessions">
      <header class="claudsidian-sessions-toolbar">
        {filterOpen ? (
          <>
            <label class="claudsidian-sr-only" for={filterId}>
              Filter sessions
            </label>
            <input
              ref={filterRef}
              id={filterId}
              class="claudsidian-sessions-filter"
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Filter"
              value={query}
              onInput={(ev) => setQuery((ev.currentTarget as HTMLInputElement).value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  closeFilter();
                }
              }}
            />
          </>
        ) : (
          <h2 class="claudsidian-sessions-heading">Sessions</h2>
        )}
        <Button
          class="claudsidian-sessions-search"
          ghost
          icon="search"
          title="Filter sessions"
          pressed={filterOpen}
          onClick={() => (filterOpen ? closeFilter() : setFilterOpen(true))}
        />
        <Button
          class="claudsidian-show-archived"
          ghost
          icon="archive"
          title="Show archived"
          pressed={showArchived}
          onClick={() => setShowArchived((v) => !v)}
        />
        <Button
          class={cls('claudsidian-sessions-refresh', manual && 'is-loading')}
          ghost
          icon="refresh-cw"
          title="Refresh"
          onClick={refresh}
        />
        <Button class="claudsidian-sessions-new" primary icon="plus" label="New" ariaLabel="New session" onClick={() => (showNew.value = true)} />
      </header>

      <Banner banner={effectiveBanner} onDismiss={() => store.dismissBanner?.()} />

      <div class="claudsidian-sessions-body">
        {visibleCount === 0 ? (
          loading && sessions.length === 0 ? (
            <Spinner label="Loading sessions" />
          ) : filtering ? (
            <p class="claudsidian-sessions-nomatch">No sessions match "{query.trim()}".</p>
          ) : vaultOnly && hiddenCount > 0 ? (
            <p class="claudsidian-sessions-nomatch">No sessions in this vault yet.</p>
          ) : (
            <EmptyState
              variant={sessions.length > 0 ? 'all-archived' : 'none'}
              onNew={() => (showNew.value = true)}
              onShowArchived={() => setShowArchived(true)}
            />
          )
        ) : (
          groups.map((g) => (
            <SessionGroup key={g.title} title={g.title} sessions={g.sessions} now={now} needsTexts={needsTexts} onOpen={onOpen} onMore={onMore} />
          ))
        )}
        {hiddenCount > 0 ? (
          <Button class="claudsidian-sessions-scope" ghost label={hiddenCount === 1 ? 'Show 1 other session' : `Show ${hiddenCount} other sessions`} onClick={() => setScope('all')} />
        ) : !filtering && settings.listScope === 'all' ? (
          <Button class="claudsidian-sessions-scope" ghost label="Show this vault only" onClick={() => setScope('vault')} />
        ) : null}
      </div>

      {moreSession && (
        <Sheet title={moreSession.title} class="claudsidian-session-actions" onClose={closeMore}>
          <Button
            class="claudsidian-session-action"
            ghost
            icon="pencil"
            label="Rename"
            onClick={() => {
              closeMore();
              p.onRename(moreSession.id);
            }}
          />
          <Button
            class="claudsidian-session-action"
            ghost
            icon="external-link"
            label="Open in claude.ai"
            onClick={() => {
              closeMore();
              p.facade.openExternal(claudeCodeUrl(moreSession.id));
            }}
          />
          {pinned.has(moreSession.id) ? (
            <Button
              class="claudsidian-session-action"
              ghost
              icon="folder-minus"
              label="Remove from this vault"
              onClick={() => {
                closeMore();
                setPinned(moreSession.id, false);
              }}
            />
          ) : !inVault(moreSession) ? (
            <Button
              class="claudsidian-session-action"
              ghost
              icon="folder-plus"
              label="Show in this vault"
              onClick={() => {
                closeMore();
                setPinned(moreSession.id, true);
              }}
            />
          ) : null}
          {!moreSession.archived && (
            <Button class="claudsidian-session-action is-archive" ghost icon="archive" label="Archive" onClick={() => archive(moreSession)} />
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
