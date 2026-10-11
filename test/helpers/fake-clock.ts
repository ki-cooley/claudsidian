/**
 * Manual clock implementing TimerApi for poller and store tests: timers fire only when tick() advances time.
 * Each fired callback is followed by a macrotask flush so promise chains settle before the next timer.
 */
import type { TimerApi } from '../../src/util/timers';

export interface FakeClock {
  timers: TimerApi;
  /** Advance the clock by ms, firing due timers in order (new timers that fall due are fired too). */
  tick(ms: number): Promise<void>;
  /** Let pending promises settle without advancing time. */
  flush(): Promise<void>;
  /** Number of armed timers. */
  pendingCount(): number;
  now(): number;
}

export function createFakeClock(start = 0): FakeClock {
  let now = start;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();

  const timers: TimerApi = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
    now: () => now,
  };

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  async function tick(ms: number): Promise<void> {
    const target = now + ms;
    await flush();
    for (;;) {
      let bestId: number | undefined;
      let best: { at: number; fn: () => void } | undefined;
      for (const [id, t] of pending) {
        if (t.at <= target && (!best || t.at < best.at)) {
          best = t;
          bestId = id;
        }
      }
      if (!best || bestId === undefined) break;
      pending.delete(bestId);
      now = best.at;
      best.fn();
      await flush();
    }
    now = target;
    await flush();
  }

  return { timers, tick, flush, pendingCount: () => pending.size, now: () => now };
}
