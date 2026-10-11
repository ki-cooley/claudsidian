/**
 * Notifications: an Obsidian notice when a session finishes a turn or needs input while the chat view is
 * not visible. Subscribes to the store's turn_end and needs_input events; dedupes per session and event.
 */
import type { SessionStoreApi, StoreEvent } from '../core/store-api';

/** The same session and event within this window produce one notice. */
export const DEDUPE_MS = 5000;

export interface NotificationsOptions {
  enabled: () => boolean;
  isViewVisible: () => boolean;
  sessionTitle: (id: string) => string;
  notice: (text: string) => void;
  /** Clock override for tests; Date.now otherwise. */
  now?: () => number;
}

const LABELS: Partial<Record<StoreEvent, string>> = {
  turn_end: 'finished',
  needs_input: 'needs you',
};

export class Notifications {
  private readonly unsubscribers: (() => void)[] = [];
  private readonly lastShown = new Map<string, number>();

  constructor(
    store: SessionStoreApi,
    private readonly opts: NotificationsOptions,
  ) {
    this.unsubscribers.push(store.on('turn_end', (id) => this.handle('turn_end', id)));
    this.unsubscribers.push(store.on('needs_input', (id) => this.handle('needs_input', id)));
  }

  dispose(): void {
    for (const off of this.unsubscribers.splice(0)) off();
    this.lastShown.clear();
  }

  private handle(event: StoreEvent, sessionId: string): void {
    const label = LABELS[event];
    if (!label || !this.opts.enabled() || this.opts.isViewVisible()) return;
    const now = this.opts.now?.() ?? Date.now();
    this.prune(now);
    const key = `${event}:${sessionId}`;
    const last = this.lastShown.get(key);
    if (last !== undefined && now - last < DEDUPE_MS) return;
    this.lastShown.set(key, now);
    this.opts.notice(`${this.opts.sessionTitle(sessionId)}: ${label}`);
  }

  private prune(now: number): void {
    for (const [key, at] of this.lastShown) if (now - at >= DEDUPE_MS) this.lastShown.delete(key);
  }
}
