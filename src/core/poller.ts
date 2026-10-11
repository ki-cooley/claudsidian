/**
 * Adaptive poller: runs an async job on a mode-dependent interval, backs off on errors,
 * parks in background mode, and never overlaps two runs. Timers are injected so tests use a fake clock.
 */
import { realTimers, type TimerApi } from '../util/timers';

export type PollMode = 'active' | 'idle' | 'background';

export interface PollerOptions {
  run: () => Promise<void>;
  intervalMs: (mode: PollMode) => number;
  onError?: (err: unknown) => void;
  timers?: TimerApi;
  /** cap for the error backoff delay, default 30000 */
  maxBackoffMs?: number;
}

const DEFAULT_MAX_BACKOFF_MS = 30_000;

export class Poller {
  private readonly opts: PollerOptions;
  private readonly timers: TimerApi;
  private readonly maxBackoffMs: number;
  private currentMode: PollMode = 'idle';
  private started = false;
  private inFlight = false;
  private kickQueued = false;
  private handle: unknown = undefined;
  /** delay multiplier for the next schedule after errors; 1 after a success */
  private backoffFactor = 1;
  /** the delay the pending timer was armed with, so a faster mode can shorten it */
  private pendingDelay = Infinity;

  constructor(opts: PollerOptions) {
    this.opts = opts;
    this.timers = opts.timers ?? realTimers;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  /** The current mode. */
  get mode(): PollMode {
    return this.currentMode;
  }

  /** True between start() and stop(). A run may or may not be in flight. */
  get running(): boolean {
    return this.started;
  }

  /** Begin scheduling: the first run happens after intervalMs(mode). Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(this.delayFor());
  }

  /** Cancel the pending timer and stop rescheduling. An in-flight run finishes but schedules nothing. */
  stop(): void {
    this.started = false;
    this.kickQueued = false;
    this.cancel();
  }

  setMode(mode: PollMode): void {
    if (mode === this.currentMode) return;
    const previous = this.currentMode;
    this.currentMode = mode;
    if (!this.started) return;
    if (mode === 'background') {
      this.cancel();
      return;
    }
    if (this.inFlight) return; // completion schedules with the new mode
    const delay = this.delayFor();
    if (previous === 'background' || this.handle === undefined || delay < this.pendingDelay) {
      this.cancel();
      this.schedule(delay);
    }
  }

  /** Run now (or right after the in-flight run) and reset the backoff. No-op when stopped. */
  kick(): void {
    if (!this.started) return;
    this.backoffFactor = 1;
    if (this.inFlight) {
      this.kickQueued = true;
      return;
    }
    this.cancel();
    void this.execute();
  }

  private delayFor(): number {
    const base = this.opts.intervalMs(this.currentMode);
    return Math.min(base * this.backoffFactor, Math.max(base, this.maxBackoffMs));
  }

  private schedule(delay: number): void {
    if (!this.started || this.currentMode === 'background' || this.handle !== undefined) return;
    this.pendingDelay = delay;
    this.handle = this.timers.setTimeout(() => {
      this.handle = undefined;
      this.pendingDelay = Infinity;
      void this.execute();
    }, delay);
  }

  private cancel(): void {
    if (this.handle !== undefined) {
      this.timers.clearTimeout(this.handle);
      this.handle = undefined;
    }
    this.pendingDelay = Infinity;
  }

  private async execute(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    let failed = false;
    try {
      await this.opts.run();
    } catch (err) {
      failed = true;
      this.opts.onError?.(err);
    } finally {
      this.inFlight = false;
    }
    if (failed) {
      // The next delay is base * factor; the factor doubles after each failure (1x, 2x, 4x, capped).
      const delay = this.delayFor();
      this.backoffFactor = Math.min(this.backoffFactor * 2, 1 << 20);
      if (this.kickQueued) {
        this.kickQueued = false;
        this.backoffFactor = 1;
        void this.execute();
        return;
      }
      this.schedule(delay);
      return;
    }
    this.backoffFactor = 1;
    if (this.kickQueued) {
      this.kickQueued = false;
      void this.execute();
      return;
    }
    this.schedule(this.delayFor());
  }
}
