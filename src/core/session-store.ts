/**
 * SessionStore: the reactive state behind the UI. Lists sessions, loads and polls the open session's
 * transcript through the pure reducer, sends messages and control answers, announces presence, and
 * exposes everything as @preact/signals. One session is polled at a time.
 */
import { signal, type ReadonlySignal, type Signal } from '@preact/signals';
import type { CcrApi } from '../api/client-api';
import { ApiError } from '../api/errors';
import {
  interruptPayload,
  permissionResponsePayload,
  setModelPayload,
  setPermissionModePayload,
  userMessagePayload,
} from '../api/payloads';
import {
  isCanUseTool,
  isSystemInit,
  type ContentBlock,
  type CreateSessionRequest,
  type ImageBlock,
  type PermissionResult,
  type StreamJsonEvent,
  type WireEnvironment,
  type WireEventRow,
  type WireSession,
} from '../api/types';
import { MAX_SESSION_CWDS, type ClaudsidianSettings } from '../settings';
import { log } from '../util/log';
import { realTimers, type TimerApi } from '../util/timers';
import { Poller, type PollMode } from './poller';
import type {
  Banner,
  CreateSessionOptions,
  Environment,
  RefreshOptions,
  SendOptions,
  SessionStoreApi,
  StoreEvent,
} from './store-api';
import { applyEvents, findItem, markControlSent, markOffline, markSent } from './transcript';
import {
  createTranscript,
  sameSummary,
  summarizeSession,
  type OutgoingAttachment,
  type SessionSummary,
  type TranscriptItem,
  type TranscriptState,
} from './types';

/** The directory maps the store learns and hands back for data.json. */
export type LearnedDirs = Pick<ClaudsidianSettings, 'environmentDirs' | 'sessionCwds'>;

export interface SessionStoreDeps {
  client: CcrApi;
  settings: () => ClaudsidianSettings;
  /** per-install uuid sent with presence */
  clientId: string;
  timers?: TimerApi;
  onNotice?: (text: string) => void;
  /** Persist learned directories (environment id -> dir, session id -> cwd) so grouping is right on the next load. */
  persistLearned?: (patch: LearnedDirs) => Promise<void> | void;
}

const HISTORY_LIMIT = 200;
/** Page size of the after_id poll (what claude.ai/code asks for); a full page means more pages follow at once. */
const AFTER_ID_LIMIT = 500;
/** Pages one poll may chain before yielding to the next tick. */
const AFTER_ID_MAX_PAGES = 20;
/** What a stored image block carries instead of its base64 body (the rebuild only counts images). */
const IMAGE_DATA_PLACEHOLDER = '<image omitted>';
const PRESENCE_INTERVAL_MS = 60_000;
/** consecutive 401s from polling before the auth banner shows (one is a refresh race, not a sign-out) */
const AUTH_FAILURES_FOR_BANNER = 2;
/** Bridge environments with no known directory probed per list refresh (one listEvents call each). */
const ENV_PROBE_LIMIT = 3;
/** An environment whose probe found no cwd is not probed again within this window. */
const ENV_PROBE_COOLDOWN_MS = 600_000;
/** Rows read from the oldest end of a session when looking for its init event. */
const ENV_PROBE_ROWS = 40;
/** mark_read POSTs per session while rows stream are spaced by at least this; the turn end flushes at once. */
const MARK_READ_MIN_INTERVAL_MS = 2000;

const AUTH_BANNER: Banner = { kind: 'auth', text: 'Signed out. Sign in to see your sessions.' };
const OFFLINE_BANNER: Banner = { kind: 'offline', text: 'No connection. Retrying.' };
const GONE_BANNER: Banner = { kind: 'error', text: 'Session not found. It may have been archived.' };

type Listener = (sessionId: string, state: TranscriptState) => void;

/** Per-session bookkeeping the reducer state does not carry. */
interface SessionTrack {
  /** rows applied so far, ascending by seq, compacted (for loadOlder rebuilds; see compactRows) */
  rows: WireEventRow[];
  /** smallest seq applied, Infinity before any */
  firstSeq: number;
  /** 'from' until the server shows it ignores from_sequence_num, then after_id pages from the last row's uuid */
  strategy: 'from' | 'after_id';
  /** payload.uuid of the newest row applied (the after_id cursor) */
  lastUuid: string | undefined;
  /** request ids already announced as needs_input */
  announced: Set<string>;
  historyLoaded: boolean;
  /** transcript currently marked offline by us */
  offline: boolean;
  /** in-flight loadOlder, so overlapping calls share one request */
  loadingOlder: Promise<boolean> | null;
  /** highest seq the server was told was read (-1 before any) */
  markedSeq: number;
  /** when the last mark_read was sent, -Infinity before any */
  markAt: number;
  /** trailing mark_read timer while the throttle window is open */
  markTimer: unknown;
}

function seqOf(row: WireEventRow): number {
  const n = Number(row.sequence_num);
  return Number.isFinite(n) ? n : -1;
}

function bySeqAsc(a: WireEventRow, b: WireEventRow): number {
  return seqOf(a) - seqOf(b);
}

function uuidOf(row: WireEventRow): string | undefined {
  const u: unknown = row.payload?.uuid;
  return typeof u === 'string' && u ? u : undefined;
}

function lastUuidOf(rows: WireEventRow[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const u = uuidOf(rows[i]!);
    if (u) return u;
  }
  return undefined;
}

function scopeOf(row: WireEventRow): string {
  const parent: unknown = row.payload?.parent_tool_use_id;
  return typeof parent === 'string' ? parent : '';
}

/** A stored copy of a user row with image bodies replaced; the rebuild only counts image blocks. */
function compactRow(row: WireEventRow): WireEventRow {
  const payload: unknown = row.payload;
  if (!payload || typeof payload !== 'object' || (payload as { type?: unknown }).type !== 'user') return row;
  const message = (payload as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (!Array.isArray(content)) return row;
  if (!content.some((b) => (b as ImageBlock)?.type === 'image' && typeof (b as ImageBlock).source?.data === 'string')) return row;
  const blocks = content.map((b) =>
    (b as ImageBlock)?.type === 'image' && typeof (b as ImageBlock).source?.data === 'string'
      ? { ...(b as ImageBlock), source: { ...(b as ImageBlock).source, data: IMAGE_DATA_PLACEHOLDER } }
      : (b as ContentBlock),
  );
  return { ...row, payload: { ...(payload as object), message: { ...message, content: blocks } } as WireEventRow['payload'] };
}

/**
 * Append fresh rows to the stored ones and drop what a rebuild no longer needs: once a final `assistant`
 * row of a scope has been applied, the stream_event rows before it in that scope only repeat its content.
 */
function compactRows(stored: WireEventRow[], fresh: WireEventRow[]): WireEventRow[] {
  const cutoff = new Map<string, number>();
  for (const row of fresh) {
    if (row.payload?.type !== 'assistant') continue;
    const scope = scopeOf(row);
    cutoff.set(scope, Math.max(cutoff.get(scope) ?? -1, seqOf(row)));
  }
  const all = stored.concat(fresh.map(compactRow));
  if (cutoff.size === 0) return all;
  return all.filter((r) => r.payload?.type !== 'stream_event' || seqOf(r) >= (cutoff.get(scopeOf(r)) ?? -1));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function lastPathSegment(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** "KisWorkComputer:yes-chef:8e72" or bridge_info.directory -> "yes-chef on KisWorkComputer" (plus offline marker). */
function environmentLabelFromWire(e: WireEnvironment): string {
  const kind = e.kind === 'anthropic_cloud' ? 'cloud' : (e.kind ?? 'unknown');
  const parts = (e.name ?? '').split(':');
  const machine = (e.bridge_info?.machine_name ?? parts[0] ?? '').split('.')[0] ?? '';
  const dir = e.bridge_info?.directory ? lastPathSegment(e.bridge_info.directory) : parts.length >= 2 ? (parts[1] ?? '') : '';
  let label: string;
  if (kind === 'bridge') label = dir && machine ? `${dir} on ${machine}` : dir || machine || 'Mac';
  else label = e.name || kind;
  if (e.bridge_info?.online === false) label += ' (offline)';
  return label;
}

function environmentLabel(kind: string, cwd: string | undefined): string {
  const kindLabel = kind === 'bridge' ? 'Mac' : kind;
  const segment = cwd ? lastPathSegment(cwd) : '';
  return segment ? `${segment} (${kindLabel})` : kindLabel;
}

function imageBlock(att: OutgoingAttachment): ImageBlock {
  return { type: 'image', source: { type: 'base64', media_type: att.mediaType, data: att.base64 } };
}

function byLastEventDesc(a: SessionSummary, b: SessionSummary): number {
  return (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0);
}

function bySortAtDesc(a: SessionSummary, b: SessionSummary): number {
  return (b.sortAt ?? b.lastEventAt ?? 0) - (a.sortAt ?? a.lastEventAt ?? 0);
}

/**
 * The list's top rank, mirroring statusOf() === 'needs_you' in src/ui/components/sessions/status.ts (the store
 * cannot import the UI). A row keeps its place between polls unless this changes; the two must agree.
 */
function needsAttention(s: SessionSummary): boolean {
  if (s.connectionStatus !== 'connected') return false;
  return s.workerStatus === 'requires_action' || (s.summary?.needsAction ?? '').trim() !== '';
}

/** cwd of the first system/init row, when it carries one (Desktop-hosted sessions report ''). */
function initCwdOf(rows: WireEventRow[]): string | undefined {
  for (const row of rows) {
    const p = row.payload;
    if (p && isSystemInit(p) && typeof p.cwd === 'string' && p.cwd) return p.cwd;
  }
  return undefined;
}

/** Drop `pending` from user items whose echo has landed (the reducer took their uuid out of inFlightUserUuids). */
function settlePending(state: TranscriptState): TranscriptState {
  let items: TranscriptItem[] | undefined;
  state.items.forEach((item, i) => {
    if (item.kind !== 'user' || !item.pending || state.inFlightUserUuids.includes(item.id)) return;
    if (!items) items = state.items.slice();
    const settled = { ...item };
    delete settled.pending;
    items[i] = settled;
  });
  return items ? { ...state, items } : state;
}

export class SessionStore implements SessionStoreApi {
  readonly sessions = signal<SessionSummary[]>([]);
  readonly sessionsLoading = signal(false);
  readonly sessionsError = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly banner = signal<Banner | null>(null);
  readonly visible = signal(true);

  private readonly deps: SessionStoreDeps;
  private readonly timers: TimerApi;
  /** Environments from GET /v1/environments, merged into environments(); refreshed at most once a minute. */
  private envCache: WireEnvironment[] = [];
  private envFetchedAt = -1;
  /** Bumped when envCache changes so components that call environments() during render re-render. */
  private readonly envVersion = signal(0);
  private readonly transcripts = new Map<string, Signal<TranscriptState>>();
  private readonly tracks = new Map<string, SessionTrack>();
  /** session id -> init cwd, oldest first (seeded from settings.sessionCwds, bounded to MAX_SESSION_CWDS) */
  private readonly cwdCache = new Map<string, string>();
  /** environment id -> directory (seeded from settings.environmentDirs) */
  private readonly envDirs = new Map<string, string>();
  /** environment id -> when its newest session was last probed for an init cwd */
  private readonly envProbeAt = new Map<string, number>();
  private persistQueued = false;
  /** a resort was asked for; consumed by the next doRefresh to run */
  private pendingResort = false;
  private readonly listeners = new Map<StoreEvent, Set<Listener>>();
  private readonly unsubscribeVisible: () => void;
  private sessionPoller: Poller | null = null;
  /** the session the poller belongs to */
  private polledId: string | null = null;
  private listPoller: Poller | null = null;
  private presenceHandle: unknown = undefined;
  private refreshing: Promise<void> | null = null;
  private refreshQueued: Promise<void> | null = null;
  private authFailures = 0;
  private disposed = false;

  constructor(deps: SessionStoreDeps) {
    this.deps = deps;
    this.timers = deps.timers ?? realTimers;
    const saved = deps.settings();
    for (const [id, cwd] of Object.entries(saved.sessionCwds ?? {})) if (cwd) this.cwdCache.set(id, cwd);
    for (const [id, dir] of Object.entries(saved.environmentDirs ?? {})) if (dir) this.envDirs.set(id, dir);
    let initial = true;
    this.unsubscribeVisible = this.visible.subscribe((v) => {
      if (initial) {
        initial = false;
        return;
      }
      this.onVisibility(v);
    });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  transcript(sessionId: string): ReadonlySignal<TranscriptState> {
    return this.transcriptSignal(sessionId);
  }

  session(sessionId: string): SessionSummary | undefined {
    return this.sessions.value.find((s) => s.id === sessionId);
  }

  environments(): Environment[] {
    void this.envVersion.value; // subscribe render-time callers to environment refreshes
    const byId = new Map<string, Environment>();
    for (const e of this.envCache) {
      const kind = e.kind === 'anthropic_cloud' ? 'cloud' : (e.kind ?? 'unknown');
      const env: Environment = { id: e.environment_id, kind, label: environmentLabelFromWire(e), sessionCount: 0 };
      const dir = e.bridge_info?.directory || this.envDirs.get(e.environment_id);
      if (dir) env.cwd = dir;
      if (typeof e.bridge_info?.online === 'boolean') env.online = e.bridge_info.online;
      byId.set(e.environment_id, env);
    }
    const groups = new Map<string, { kind: string; cwd?: string; count: number }>();
    for (const s of this.sessions.value) {
      if (s.archived || !s.environmentId) continue;
      const g = groups.get(s.environmentId) ?? { kind: s.environmentKind, count: 0 };
      g.count += 1;
      if (!g.cwd && s.cwd) g.cwd = s.cwd;
      if (g.kind === 'unknown' && s.environmentKind !== 'unknown') g.kind = s.environmentKind;
      groups.set(s.environmentId, g);
    }
    for (const [id, g] of groups) {
      const existing = byId.get(id);
      const cwd = this.envDirs.get(id) ?? g.cwd;
      if (existing) {
        existing.sessionCount = g.count;
        if (!existing.cwd && cwd) existing.cwd = cwd;
        continue;
      }
      const env: Environment = { id, kind: g.kind, label: environmentLabel(g.kind, cwd), sessionCount: g.count };
      if (cwd) env.cwd = cwd;
      byId.set(id, env);
    }
    const envs = [...byId.values()];
    envs.sort((a, b) => {
      const ka = a.kind === 'bridge' ? 0 : 1;
      const kb = b.kind === 'bridge' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      const oa = a.online === false ? 1 : 0;
      const ob = b.online === false ? 1 : 0;
      if (oa !== ob) return oa - ob;
      if (a.sessionCount !== b.sessionCount) return b.sessionCount - a.sessionCount;
      return a.label.localeCompare(b.label);
    });
    return envs;
  }

  async refreshEnvironments(): Promise<void> {
    try {
      this.envCache = await this.deps.client.listEnvironments();
      this.envFetchedAt = Date.now();
      let learned = false;
      for (const e of this.envCache) {
        const dir = e.bridge_info?.directory;
        if (dir && this.learnEnvDir(e.environment_id, dir)) learned = true;
      }
      this.envVersion.value += 1;
      if (learned) this.persistLearned();
    } catch (err) {
      log.debug('refreshEnvironments failed', { message: messageOf(err) });
    }
  }

  // ---------------------------------------------------------------------------
  // Learned directories
  // ---------------------------------------------------------------------------

  /** Remember a session's init cwd (newest last, bounded). True when it changed. */
  private rememberCwd(sessionId: string, cwd: string): boolean {
    if (this.cwdCache.get(sessionId) === cwd) return false;
    this.cwdCache.delete(sessionId);
    this.cwdCache.set(sessionId, cwd);
    while (this.cwdCache.size > MAX_SESSION_CWDS) {
      const oldest = this.cwdCache.keys().next().value;
      if (oldest === undefined) break;
      this.cwdCache.delete(oldest);
    }
    return true;
  }

  /** Remember an environment's directory and let environments() callers re-render. True when it changed. */
  private learnEnvDir(environmentId: string, dir: string): boolean {
    if (!environmentId || !dir || this.envDirs.get(environmentId) === dir) return false;
    this.envDirs.set(environmentId, dir);
    this.envVersion.value += 1;
    return true;
  }

  /** Hand both maps to the plugin once per burst of learning. */
  private persistLearned(): void {
    if (this.persistQueued || !this.deps.persistLearned) return;
    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      const patch: LearnedDirs = {
        environmentDirs: Object.fromEntries(this.envDirs),
        sessionCwds: Object.fromEntries(this.cwdCache),
      };
      try {
        void Promise.resolve(this.deps.persistLearned?.(patch)).catch((err: unknown) => {
          log.debug('persisting learned directories failed', { message: messageOf(err) });
        });
      } catch (err) {
        log.debug('persisting learned directories failed', { message: messageOf(err) });
      }
    });
  }

  /**
   * "This vault" on a cold start: a bridge environment with no known directory gets one from the init event of
   * its newest session, at most ENV_PROBE_LIMIT environments per refresh (one request each) and not the same
   * environment again within ENV_PROBE_COOLDOWN_MS.
   */
  private async resolveEnvironmentDirs(): Promise<void> {
    const now = this.timers.now();
    const newest = new Map<string, SessionSummary>();
    let learned = false;
    for (const s of this.sessions.value) {
      if (s.archived || s.environmentKind !== 'bridge' || !s.environmentId || this.envDirs.has(s.environmentId)) continue;
      if (s.cwd) {
        if (this.learnEnvDir(s.environmentId, s.cwd)) learned = true;
        continue;
      }
      const cur = newest.get(s.environmentId);
      if (!cur || (s.lastEventAt ?? 0) > (cur.lastEventAt ?? 0)) newest.set(s.environmentId, s);
    }
    if (learned) this.persistLearned();
    const targets = [...newest.values()]
      .filter((s) => now - (this.envProbeAt.get(s.environmentId) ?? -Infinity) >= ENV_PROBE_COOLDOWN_MS)
      .sort(byLastEventDesc)
      .slice(0, ENV_PROBE_LIMIT);
    for (const s of targets) this.envProbeAt.set(s.environmentId, now);
    await Promise.all(targets.map((s) => this.probeCwd(s)));
  }

  private async probeCwd(s: SessionSummary): Promise<void> {
    try {
      const rows = await this.deps.client.listEvents(s.id, { limit: ENV_PROBE_ROWS, sortOrder: 'asc' });
      if (this.disposed) return;
      const cwd = initCwdOf(rows);
      if (!cwd) return;
      const changed = this.rememberCwd(s.id, cwd);
      const learned = this.learnEnvDir(s.environmentId, cwd);
      if (changed) this.patchSession(s.id, { cwd });
      if (changed || learned) this.persistLearned();
    } catch (err) {
      log.debug('cwd probe failed', { sessionId: s.id, message: messageOf(err) });
    }
  }

  // ---------------------------------------------------------------------------
  // Sessions list
  // ---------------------------------------------------------------------------

  /**
   * Refresh the list. A call during an in-flight refresh queues one follow-up refresh and resolves with it.
   * Rows keep their relative order between calls; `resort` (screen mount, manual refresh) orders everything
   * by last activity again.
   */
  refreshSessions(opts: RefreshOptions = {}): Promise<void> {
    if (opts.resort) this.pendingResort = true;
    if (this.refreshing) {
      if (!this.refreshQueued) {
        this.refreshQueued = this.refreshing.then(() => {
          this.refreshQueued = null;
          return this.refreshSessions();
        });
      }
      return this.refreshQueued;
    }
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const resort = this.pendingResort;
    this.pendingResort = false;
    const previous = this.sessions.value;
    // The spinner is for the first load only; a background poll must not flicker the toolbar.
    if (previous.length === 0) this.sessionsLoading.value = true;
    try {
      const wire = await this.deps.client.listSessions();
      const list = this.mergeList(this.sessions.value, wire, resort);
      if (list !== this.sessions.value) this.sessions.value = list;
      if (Date.now() - this.envFetchedAt > 60_000) {
        this.envFetchedAt = Date.now(); // throttle; refreshEnvironments sets it again on success
        void this.refreshEnvironments();
      }
      this.sessionsError.value = null;
      this.clearBanner('auth', 'offline');
      void this.resolveEnvironmentDirs();
    } catch (err) {
      this.sessionsError.value = messageOf(err);
      if (err instanceof ApiError && err.isAuth) this.banner.value = AUTH_BANNER;
      else if (err instanceof ApiError && err.isNetwork) this.banner.value = OFFLINE_BANNER;
      log.debug('refreshSessions failed', { message: messageOf(err) });
    } finally {
      if (this.sessionsLoading.value) this.sessionsLoading.value = false;
    }
  }

  /**
   * Summaries for the wire rows, reusing the previous object for a row whose rendered fields did not change,
   * ordered by sortAt. Between polls a row keeps its sortAt unless its rank (needs you or not) changed; a row
   * new to the list surfaces above everything; a resort (or an empty previous list) freezes lastEventAt into
   * sortAt for every row. Returns `previous` itself when nothing changed, so the signal is not republished.
   */
  private mergeList(previous: SessionSummary[], wire: WireSession[], resort: boolean): SessionSummary[] {
    const full = resort || previous.length === 0;
    const prevById = new Map(previous.map((s) => [s.id, s]));
    let top = this.timers.now();
    for (const s of previous) if (s.sortAt !== undefined && s.sortAt >= top) top = s.sortAt + 1;
    const list = wire.map((w) => {
      const next = summarizeSession(w, this.cwdCache.get(w.id));
      const prev = prevById.get(w.id);
      if (full || !prev) next.sortAt = full ? (next.lastEventAt ?? 0) : Math.max(next.lastEventAt ?? 0, top);
      else if (needsAttention(prev) !== needsAttention(next)) next.sortAt = next.lastEventAt ?? 0;
      else next.sortAt = prev.sortAt ?? prev.lastEventAt ?? 0;
      return prev && sameSummary(prev, next) ? prev : next;
    });
    list.sort(bySortAtDesc);
    const unchanged = list.length === previous.length && list.every((s, i) => s === previous[i]);
    return unchanged ? previous : list;
  }

  startListPolling(): void {
    if (this.disposed) return;
    if (!this.listPoller) {
      this.listPoller = new Poller({
        run: async () => {
          await this.refreshSessions();
          const error = this.sessionsError.value;
          if (error) throw new Error(error);
        },
        intervalMs: () => this.deps.settings().polling.listMs,
        onError: (err) => log.debug('list poll failed', { message: messageOf(err) }),
        timers: this.timers,
      });
    }
    this.listPoller.setMode(this.visible.value ? 'idle' : 'background');
    this.listPoller.start();
  }

  stopListPolling(): void {
    this.listPoller?.stop();
  }

  // ---------------------------------------------------------------------------
  // Open, close, poll
  // ---------------------------------------------------------------------------

  async open(sessionId: string): Promise<void> {
    if (this.disposed) return;
    const previous = this.selectedId.value;
    if (previous && previous !== sessionId) this.stopSession(previous);
    this.selectedId.value = sessionId;
    if (!this.trackFor(sessionId).historyLoaded) {
      try {
        await this.loadHistory(sessionId);
      } catch (err) {
        if (this.selectedId.value !== sessionId) return;
        this.handlePollError(sessionId, err); // the poller retries the history load on its next run
        if (err instanceof ApiError && err.status === 404) return; // gone: no poller, no presence
      }
    }
    if (this.selectedId.value !== sessionId) return;
    this.startSessionPoller(sessionId);
    this.startPresence(sessionId);
    this.markReadIfVisible(sessionId);
  }

  /** Newest HISTORY_LIMIT rows, applied in ascending order. */
  private async loadHistory(sessionId: string): Promise<void> {
    const rows = await this.deps.client.listEvents(sessionId, { limit: HISTORY_LIMIT, sortOrder: 'desc' });
    if (this.selectedId.value !== sessionId) return; // the user moved on while the request was in flight
    this.applyRows(sessionId, [...rows].reverse());
    this.trackFor(sessionId).historyLoaded = true;
    this.handleSuccess(sessionId);
    this.announceNeedsInput(sessionId);
  }

  close(): void {
    const id = this.selectedId.value;
    if (id) this.stopSession(id);
    this.selectedId.value = null;
    this.clearBanner('error'); // "session not found" belongs to the chat it came from, not the list
  }

  dismissBanner(): void {
    this.banner.value = null;
  }

  /** Concurrent calls for one session share the in-flight request (a scroll handler firing twice). */
  loadOlder(sessionId: string): Promise<boolean> {
    const track = this.trackFor(sessionId);
    if (track.loadingOlder) return track.loadingOlder;
    track.loadingOlder = this.doLoadOlder(sessionId).finally(() => {
      track.loadingOlder = null;
    });
    return track.loadingOlder;
  }

  private async doLoadOlder(sessionId: string): Promise<boolean> {
    const track = this.trackFor(sessionId);
    if (track.rows.length === 0 || track.firstSeq <= 0) return false;
    // Without a working from_sequence_num there is no way to ask for the window before firstSeq.
    if (track.strategy === 'after_id') return false;
    const firstSeq = track.firstSeq;
    const from = Math.max(0, firstSeq - HISTORY_LIMIT);
    const rows = await this.deps.client.listEvents(sessionId, {
      fromSequenceNum: from,
      sortOrder: 'asc',
      limit: HISTORY_LIMIT,
    });
    const older = rows.filter((r) => seqOf(r) < firstSeq).sort(bySeqAsc);
    if (older.length === 0) return false;
    const sig = this.transcriptSignal(sessionId);
    const current = sig.value;
    const merged = older.concat(track.rows);
    let rebuilt = applyEvents(createTranscript(), merged);
    // Rows do not hold what the store added locally: in-flight sends and an offline marker.
    const optimistic: TranscriptItem[] = current.items.filter(
      (i) => i.kind === 'user' && current.inFlightUserUuids.includes(i.id),
    );
    rebuilt = {
      ...rebuilt,
      items: optimistic.length ? rebuilt.items.concat(optimistic) : rebuilt.items,
      inFlightUserUuids: current.inFlightUserUuids,
      turn: current.turn === 'sending' ? 'sending' : rebuilt.turn,
    };
    if (track.offline) rebuilt = markOffline(rebuilt, true);
    track.rows = merged;
    track.firstSeq = seqOf(merged[0]!);
    sig.value = rebuilt;
    return true;
  }

  private async pollSession(sessionId: string): Promise<void> {
    const sig = this.transcriptSignal(sessionId);
    const track = this.trackFor(sessionId);
    if (!track.historyLoaded) {
      await this.loadHistory(sessionId);
      if (this.polledId !== sessionId) return;
      this.markReadIfVisible(sessionId);
      this.sessionPoller?.setMode(this.modeFor(sessionId));
      return;
    }
    const lastSeq = sig.value.lastSeq;
    let rows: WireEventRow[];
    if (track.strategy === 'from') {
      rows = await this.deps.client.listEvents(sessionId, {
        fromSequenceNum: lastSeq + 1,
        sortOrder: 'asc',
        limit: HISTORY_LIMIT,
      });
      if (this.ignoresFromSequenceNum(track, rows, lastSeq)) {
        track.strategy = 'after_id';
        log.info('server ignores from_sequence_num; polling with after_id', { sessionId });
      }
    } else {
      rows = await this.pollAfterId(sessionId, track);
    }
    if (this.polledId !== sessionId) return; // closed while the request was in flight
    const { fresh } = this.applyRows(sessionId, rows);
    this.handleSuccess(sessionId);
    if (fresh.length > 0) {
      const turnEnded = fresh.some((r) => r.payload.type === 'result');
      if (turnEnded) this.emit('turn_end', sessionId, sig.value);
      this.markReadIfVisible(sessionId, { flush: turnEnded });
    }
    this.announceNeedsInput(sessionId);
    this.sessionPoller?.setMode(this.modeFor(sessionId));
  }

  /**
   * The server ignored from_sequence_num when a non-empty batch brought nothing above lastSeq, or when it
   * starts at (or before) the first row we hold: it answered from the beginning of history. Overlap alone
   * (a few rows at or below lastSeq ahead of new ones) is harmless and keeps the strategy.
   */
  private ignoresFromSequenceNum(track: SessionTrack, rows: WireEventRow[], lastSeq: number): boolean {
    if (rows.length === 0) return false;
    if (rows.every((r) => seqOf(r) <= lastSeq)) return true;
    const first = Math.min(...rows.map(seqOf));
    return track.rows.length > 0 && first <= track.firstSeq && track.firstSeq < lastSeq;
  }

  /** Rows after the last applied uuid, chaining pages at once while they come back full. Nothing is dropped. */
  private async pollAfterId(sessionId: string, track: SessionTrack): Promise<WireEventRow[]> {
    let rows: WireEventRow[] = [];
    let afterId = track.lastUuid;
    for (let page = 0; page < AFTER_ID_MAX_PAGES; page++) {
      // Without a cursor (no applied row carried a uuid) the oldest rows come back and the reducer dedupes them.
      const batch = await this.deps.client.listEvents(
        sessionId,
        afterId ? { afterId, limit: AFTER_ID_LIMIT } : { sortOrder: 'asc', limit: AFTER_ID_LIMIT },
      );
      if (this.polledId !== sessionId) return rows;
      rows = rows.concat(batch);
      const cursor = lastUuidOf(batch);
      if (cursor) track.lastUuid = cursor; // advance even when the rows dedupe, or the same page returns forever
      if (batch.length < AFTER_ID_LIMIT || !cursor || cursor === afterId) break;
      afterId = cursor;
    }
    return rows;
  }

  /** Run rows through the reducer, record them for loadOlder, and cache the cwd. */
  private applyRows(sessionId: string, rows: WireEventRow[]): { fresh: WireEventRow[] } {
    const sig = this.transcriptSignal(sessionId);
    const track = this.trackFor(sessionId);
    const before = sig.value;
    const next = settlePending(applyEvents(before, rows));
    if (next !== before) sig.value = next;
    const fresh = rows.filter((r) => seqOf(r) > before.lastSeq).sort(bySeqAsc);
    if (fresh.length > 0) {
      track.rows = compactRows(track.rows, fresh);
      track.firstSeq = Math.min(track.firstSeq, seqOf(fresh[0]!));
      track.lastUuid = lastUuidOf(fresh) ?? track.lastUuid;
    }
    this.cacheCwd(sessionId, next);
    return { fresh };
  }

  /** The init cwd names the session's directory and, through it, its environment's; both are persisted. */
  private cacheCwd(sessionId: string, state: TranscriptState): void {
    const cwd = state.init?.cwd;
    if (!cwd) return;
    const changed = this.rememberCwd(sessionId, cwd);
    const learned = this.learnEnvDir(this.session(sessionId)?.environmentId ?? '', cwd);
    if (changed) this.patchSession(sessionId, { cwd });
    if (changed || learned) this.persistLearned();
  }

  private startSessionPoller(sessionId: string): void {
    if (this.sessionPoller && this.polledId === sessionId) {
      this.sessionPoller.setMode(this.modeFor(sessionId));
      return;
    }
    this.sessionPoller?.stop();
    this.polledId = sessionId;
    const poller = new Poller({
      run: () => this.pollSession(sessionId),
      intervalMs: (mode) => this.intervalFor(mode),
      onError: (err) => this.handlePollError(sessionId, err),
      timers: this.timers,
    });
    this.sessionPoller = poller;
    poller.setMode(this.modeFor(sessionId));
    poller.start();
  }

  private stopSession(sessionId: string): void {
    if (this.polledId === sessionId) {
      this.sessionPoller?.stop();
      this.sessionPoller = null;
      this.polledId = null;
    }
    // A trailing mark_read still owed goes out now rather than after the session has left the screen.
    const track = this.tracks.get(sessionId);
    if (track && track.markTimer !== undefined) this.postMarkRead(sessionId, this.transcriptSignal(sessionId).value.lastSeq);
    this.stopPresence();
    void this.deps.client.presence(sessionId, this.deps.clientId, false).catch((err: unknown) => {
      log.debug('presence clear failed', { message: messageOf(err) });
    });
  }

  private modeFor(sessionId: string): PollMode {
    if (!this.visible.value) return 'background';
    const turn = this.transcriptSignal(sessionId).value.turn;
    return turn === 'working' || turn === 'needs_input' || turn === 'sending' ? 'active' : 'idle';
  }

  private intervalFor(mode: PollMode): number {
    const polling = this.deps.settings().polling;
    return mode === 'active' ? polling.activeMs : polling.idleMs;
  }

  private handleSuccess(sessionId: string): void {
    this.authFailures = 0;
    if (this.banner.value?.kind === 'offline') this.banner.value = null;
    const track = this.trackFor(sessionId);
    if (track.offline) {
      track.offline = false;
      const sig = this.transcriptSignal(sessionId);
      sig.value = markOffline(sig.value, false);
    }
  }

  private handlePollError(sessionId: string, err: unknown): void {
    if (err instanceof ApiError) {
      if (err.isNetwork) {
        this.banner.value = OFFLINE_BANNER;
        const track = this.trackFor(sessionId);
        if (!track.offline) {
          track.offline = true;
          const sig = this.transcriptSignal(sessionId);
          sig.value = markOffline(sig.value, true);
        }
        return;
      }
      if (err.isAuth) {
        this.authFailures += 1;
        if (this.authFailures >= AUTH_FAILURES_FOR_BANNER) this.banner.value = AUTH_BANNER;
        return;
      }
      if (err.status === 404) {
        this.banner.value = GONE_BANNER;
        this.deps.onNotice?.(GONE_BANNER.text);
        if (this.polledId === sessionId) {
          this.sessionPoller?.stop();
          this.sessionPoller = null;
          this.polledId = null;
        }
        if (this.selectedId.value === sessionId) this.stopPresence();
        this.emit('error', sessionId, this.transcriptSignal(sessionId).value);
        void this.refreshSessions();
        return;
      }
    }
    log.debug('poll failed', { sessionId, message: messageOf(err) });
  }

  /** Emit needs_input once per pending request id. */
  private announceNeedsInput(sessionId: string): void {
    const state = this.transcriptSignal(sessionId).value;
    if (state.turn !== 'needs_input') return;
    const track = this.trackFor(sessionId);
    let announce = false;
    for (const p of state.pending) {
      if (track.announced.has(p.requestId)) continue;
      track.announced.add(p.requestId);
      announce = true;
    }
    if (announce) this.emit('needs_input', sessionId, state);
  }

  /**
   * Tell the server what was seen: at most one POST per MARK_READ_MIN_INTERVAL_MS while rows stream (a trailing
   * post carries the newest seq when the window closes), at once with `flush` (turn end, leaving the session).
   */
  private markReadIfVisible(sessionId: string, opts: { flush?: boolean } = {}): void {
    if (!this.visible.value) return;
    const state = this.transcriptSignal(sessionId).value;
    if (state.lastSeq < 0) return;
    const track = this.trackFor(sessionId);
    if (state.lastSeq <= track.markedSeq) return;
    const due = track.markAt + MARK_READ_MIN_INTERVAL_MS - this.timers.now();
    if (opts.flush || due <= 0) {
      this.postMarkRead(sessionId, state.lastSeq);
      return;
    }
    if (track.markTimer !== undefined) return; // the trailing post reads the newest seq when it fires
    track.markTimer = this.timers.setTimeout(() => {
      track.markTimer = undefined;
      this.markReadIfVisible(sessionId, { flush: true });
    }, due);
  }

  private postMarkRead(sessionId: string, seq: number): void {
    const track = this.trackFor(sessionId);
    if (track.markTimer !== undefined) {
      this.timers.clearTimeout(track.markTimer);
      track.markTimer = undefined;
    }
    if (seq <= track.markedSeq) return;
    track.markedSeq = seq;
    track.markAt = this.timers.now();
    void this.deps.client.markRead(sessionId, seq).catch((err: unknown) => {
      log.debug('markRead failed', { message: messageOf(err) });
    });
    if (this.session(sessionId)?.unread) this.patchSession(sessionId, { unread: false });
  }

  private startPresence(sessionId: string): void {
    this.stopPresence();
    const announce = (): void => {
      void this.deps.client.presence(sessionId, this.deps.clientId, true).catch((err: unknown) => {
        log.debug('presence failed', { message: messageOf(err) });
      });
      this.presenceHandle = this.timers.setTimeout(announce, PRESENCE_INTERVAL_MS);
    };
    announce();
  }

  private stopPresence(): void {
    if (this.presenceHandle !== undefined) {
      this.timers.clearTimeout(this.presenceHandle);
      this.presenceHandle = undefined;
    }
  }

  private onVisibility(visible: boolean): void {
    if (!visible) {
      this.sessionPoller?.setMode('background');
      this.listPoller?.setMode('background');
      return;
    }
    const id = this.polledId;
    if (id && this.sessionPoller) {
      // Rows applied while hidden (a send kicks a background poll) were never marked read.
      this.markReadIfVisible(id);
      this.sessionPoller.setMode(this.modeFor(id));
      this.sessionPoller.kick();
    }
    if (this.listPoller?.running) {
      this.listPoller.setMode('idle');
      this.listPoller.kick();
    }
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  async send(sessionId: string, text: string, opts: SendOptions = {}): Promise<void> {
    const images = opts.images ?? [];
    const fullText = opts.contextText ? `${text}\n\n${opts.contextText}` : text;
    const blocks: ContentBlock[] = [];
    if (fullText.length > 0) blocks.push({ type: 'text', text: fullText });
    for (const att of images) blocks.push(imageBlock(att));
    if (blocks.length === 0) return;
    const payload = userMessagePayload(blocks);
    const sig = this.transcriptSignal(sessionId);
    const before = sig.value;
    const optimistic = markSent(before, payload, text, images.length);
    // The optimistic item is pending until the server echoes it; the reducer then replaces it by uuid.
    const sent = optimistic.items[optimistic.items.length - 1];
    const sentId = sent?.id;
    const items =
      sent && sent.kind === 'user' ? [...optimistic.items.slice(0, -1), { ...sent, pending: true }] : optimistic.items;
    sig.value = { ...optimistic, items };
    try {
      await this.deps.client.sendEvents(sessionId, [payload]);
    } catch (err) {
      const current = sig.value;
      sig.value = {
        ...current,
        items: current.items.filter((item) => item.id !== sentId),
        inFlightUserUuids: current.inFlightUserUuids.filter((u) => u !== payload.uuid),
        turn: current.turn === 'sending' ? before.turn : current.turn,
      };
      this.failSend(sessionId, err);
      throw err;
    }
    this.afterSend(sessionId);
  }

  async sendRaw(sessionId: string, payload: StreamJsonEvent): Promise<void> {
    await this.sendControl(sessionId, payload);
  }

  async respondPermission(sessionId: string, requestId: string, result: PermissionResult): Promise<void> {
    await this.sendControl(sessionId, permissionResponsePayload(requestId, result), requestId, result);
  }

  async answerQuestion(
    sessionId: string,
    requestId: string,
    answers: Record<string, string | string[]>,
    response?: string,
  ): Promise<void> {
    const state = this.transcriptSignal(sessionId).value;
    const pending = state.pending.find((p) => p.requestId === requestId);
    const rawInput = pending && isCanUseTool(pending.raw.request) ? pending.raw.request.input : undefined;
    const item = findItem(state, requestId);
    const questions = rawInput?.questions ?? (item?.kind === 'question' ? item.questions : []);
    const updatedInput: Record<string, unknown> = { questions, answers };
    if (response) updatedInput.response = response;
    const result: PermissionResult = { behavior: 'allow', updatedInput };
    await this.sendControl(sessionId, permissionResponsePayload(requestId, result), requestId, result);
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.sendControl(sessionId, interruptPayload());
  }

  async setModel(sessionId: string, model: string): Promise<void> {
    await this.sendControl(sessionId, setModelPayload(model));
    const sig = this.transcriptSignal(sessionId);
    sig.value = { ...sig.value, model };
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<void> {
    await this.sendControl(sessionId, setPermissionModePayload(mode));
    const sig = this.transcriptSignal(sessionId);
    sig.value = { ...sig.value, permissionMode: mode };
  }

  /** Queue one payload; optionally resolve a pending control request locally (with the result sent) once the server accepted it. */
  private async sendControl(
    sessionId: string,
    payload: StreamJsonEvent,
    resolveRequestId?: string,
    result?: PermissionResult,
  ): Promise<void> {
    try {
      await this.deps.client.sendEvents(sessionId, [payload]);
    } catch (err) {
      this.failSend(sessionId, err);
      throw err;
    }
    if (resolveRequestId) {
      const sig = this.transcriptSignal(sessionId);
      let next = markControlSent(sig.value, resolveRequestId, result);
      if (next.pending.length === 0 && next.turn === 'needs_input') next = { ...next, turn: 'working' };
      sig.value = next;
    }
    this.afterSend(sessionId);
  }

  private failSend(sessionId: string, err: unknown): void {
    this.banner.value = { kind: 'error', text: messageOf(err) };
    this.emit('error', sessionId, this.transcriptSignal(sessionId).value);
  }

  private afterSend(sessionId: string): void {
    this.clearBanner('error', 'offline');
    if (this.polledId !== sessionId || !this.sessionPoller) return;
    this.sessionPoller.setMode(this.visible.value ? 'active' : 'background');
    this.sessionPoller.kick();
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  async rename(sessionId: string, title: string): Promise<void> {
    const previous = this.session(sessionId)?.title;
    this.patchSession(sessionId, { title });
    try {
      await this.deps.client.renameSession(sessionId, title);
    } catch (err) {
      if (previous !== undefined) this.patchSession(sessionId, { title: previous });
      throw err;
    }
    this.patchSession(sessionId, { title });
    await this.refreshSessions();
  }

  async archive(sessionId: string): Promise<void> {
    this.patchSession(sessionId, { archived: true });
    try {
      await this.deps.client.archiveSession(sessionId);
    } catch (err) {
      this.patchSession(sessionId, { archived: false });
      throw err;
    }
    this.patchSession(sessionId, { archived: true });
    await this.refreshSessions();
  }

  async createSession(opts: CreateSessionOptions): Promise<SessionSummary> {
    // Mirrors claude.ai/code (verified 2026-10-10): create with config and no events, then send the
    // permission mode and the first message as events, then set the title with a rename.
    const req: CreateSessionRequest = {
      environment_id: opts.environmentId,
      config: {},
      events: [],
      tags: ['remote-control-app', 'claudsidian'],
    };
    if (opts.model) req.config!.model = opts.model;
    const wire = await this.deps.client.createSession(req);
    const followUps: StreamJsonEvent[] = [];
    if (opts.permissionMode) followUps.push(setPermissionModePayload(opts.permissionMode));
    if (opts.firstMessage) followUps.push(userMessagePayload(opts.firstMessage));
    if (followUps.length) await this.deps.client.sendEvents(wire.id, followUps);
    if (opts.title) {
      try {
        await this.deps.client.renameSession(wire.id, opts.title);
      } catch (err) {
        log.debug('rename after create failed', { message: messageOf(err) });
      }
    }
    await this.refreshSessions();
    return this.session(wire.id) ?? summarizeSession(wire, this.cwdCache.get(wire.id));
  }


  // ---------------------------------------------------------------------------
  // Events and lifecycle
  // ---------------------------------------------------------------------------

  on(event: StoreEvent, cb: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(cb);
    this.listeners.set(event, set);
    return () => {
      set.delete(cb);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    this.listPoller?.stop();
    this.listPoller = null;
    this.unsubscribeVisible();
    this.listeners.clear();
  }

  private emit(event: StoreEvent, sessionId: string, state: TranscriptState): void {
    for (const cb of this.listeners.get(event) ?? []) {
      try {
        cb(sessionId, state);
      } catch (err) {
        log.warn(`store listener for ${event} threw`, { message: messageOf(err) });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private transcriptSignal(sessionId: string): Signal<TranscriptState> {
    let sig = this.transcripts.get(sessionId);
    if (!sig) {
      sig = signal(createTranscript());
      this.transcripts.set(sessionId, sig);
    }
    return sig;
  }

  private trackFor(sessionId: string): SessionTrack {
    let track = this.tracks.get(sessionId);
    if (!track) {
      track = {
        rows: [],
        firstSeq: Infinity,
        strategy: 'from',
        lastUuid: undefined,
        announced: new Set(),
        historyLoaded: false,
        offline: false,
        loadingOlder: null,
        markedSeq: -1,
        markAt: -Infinity,
        markTimer: undefined,
      };
      this.tracks.set(sessionId, track);
    }
    return track;
  }

  private patchSession(sessionId: string, patch: Partial<SessionSummary>): void {
    if (!this.sessions.value.some((s) => s.id === sessionId)) return;
    this.sessions.value = this.sessions.value.map((s) => (s.id === sessionId ? { ...s, ...patch } : s));
  }

  private clearBanner(...kinds: Banner['kind'][]): void {
    const current = this.banner.value;
    if (current && kinds.includes(current.kind)) this.banner.value = null;
  }
}
