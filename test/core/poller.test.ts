import { describe, expect, it, vi } from 'vitest';
import { Poller, type PollMode } from '../../src/core/poller';
import { createFakeClock } from '../helpers/fake-clock';

const intervals: Record<PollMode, number> = { active: 700, idle: 4000, background: 4000 };
const intervalMs = (mode: PollMode): number => intervals[mode];

function setup(opts: { run?: () => Promise<void>; maxBackoffMs?: number; intervalMs?: (m: PollMode) => number } = {}) {
  const clock = createFakeClock();
  const runs: number[] = [];
  const onError = vi.fn();
  const run = opts.run ?? (async () => {});
  const poller = new Poller({
    run: async () => {
      runs.push(clock.now());
      await run();
    },
    intervalMs: opts.intervalMs ?? intervalMs,
    onError,
    timers: clock.timers,
    maxBackoffMs: opts.maxBackoffMs,
  });
  return { clock, runs, onError, poller };
}

describe('Poller', () => {
  it('schedules at the mode interval', async () => {
    const { clock, runs, poller } = setup();
    poller.setMode('idle');
    poller.start();
    expect(poller.running).toBe(true);
    await clock.tick(3999);
    expect(runs).toEqual([]);
    await clock.tick(1);
    expect(runs).toEqual([4000]);
    await clock.tick(4000);
    expect(runs).toEqual([4000, 8000]);
    poller.setMode('active');
    await clock.tick(700);
    expect(runs).toEqual([4000, 8000, 8700]);
    await clock.tick(700);
    expect(runs).toEqual([4000, 8000, 8700, 9400]);
  });

  it('backs off on error (1x, 2x, 4x, cap) and resets on success', async () => {
    let fail = true;
    const { clock, runs, onError, poller } = setup({
      run: async () => {
        if (fail) throw new Error('boom');
      },
      intervalMs: () => 1000,
      maxBackoffMs: 3000,
    });
    poller.start();
    await clock.tick(1000);
    expect(runs).toEqual([1000]);
    await clock.tick(1000); // 1x after the first error
    expect(runs).toEqual([1000, 2000]);
    await clock.tick(1999); // 2x after the second
    expect(runs).toEqual([1000, 2000]);
    await clock.tick(1);
    expect(runs).toEqual([1000, 2000, 4000]);
    await clock.tick(3000); // 4x would be 4000, capped at 3000
    expect(runs).toEqual([1000, 2000, 4000, 7000]);
    await clock.tick(3000); // still capped
    expect(runs).toEqual([1000, 2000, 4000, 7000, 10000]);
    expect(onError).toHaveBeenCalledTimes(5);
    fail = false;
    await clock.tick(3000); // this run succeeds
    expect(runs).toEqual([1000, 2000, 4000, 7000, 10000, 13000]);
    await clock.tick(1000); // back to 1x
    expect(runs).toEqual([1000, 2000, 4000, 7000, 10000, 13000, 14000]);
    expect(onError).toHaveBeenCalledTimes(5);
  });

  it('background stops scheduling until a mode change or a kick', async () => {
    const { clock, runs, poller } = setup({ intervalMs: () => 1000 });
    poller.start();
    await clock.tick(1000);
    expect(runs).toEqual([1000]);
    poller.setMode('background');
    expect(clock.pendingCount()).toBe(0);
    await clock.tick(10_000);
    expect(runs).toEqual([1000]);
    poller.kick();
    await clock.flush();
    expect(runs).toEqual([1000, 11000]);
    await clock.tick(10_000); // a kicked run in background does not reschedule
    expect(runs).toEqual([1000, 11000]);
    poller.setMode('idle');
    await clock.tick(1000);
    expect(runs).toEqual([1000, 11000, 22000]);
  });

  it('kick runs immediately and resets backoff', async () => {
    let failures = 2;
    const { clock, runs, poller } = setup({
      run: async () => {
        if (failures-- > 0) throw new Error('boom');
      },
      intervalMs: () => 1000,
    });
    poller.start();
    await clock.tick(1000);
    await clock.tick(1000);
    expect(runs).toEqual([1000, 2000]); // two failures, the next delay would be 2000
    poller.kick();
    await clock.flush();
    expect(runs).toEqual([1000, 2000, 2000]);
    await clock.tick(1000); // backoff reset: the next run is at 1x
    expect(runs).toEqual([1000, 2000, 2000, 3000]);
  });

  it('never overlaps runs when run is slow and queues a kick for after the run', async () => {
    const clock = createFakeClock();
    let active = 0;
    let maxActive = 0;
    const starts: number[] = [];
    const poller = new Poller({
      run: () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          starts.push(clock.now());
          clock.timers.setTimeout(() => {
            active--;
            resolve();
          }, 2000);
        }),
      intervalMs: () => 500,
      timers: clock.timers,
    });
    poller.start();
    await clock.tick(500);
    expect(starts).toEqual([500]);
    await clock.tick(500);
    expect(starts).toEqual([500]);
    poller.kick(); // in flight: queued, not started
    await clock.flush();
    expect(starts).toEqual([500]);
    await clock.tick(1500); // first run completes at 2500, the queued kick starts right away
    expect(starts).toEqual([500, 2500]);
    await clock.tick(2000); // second run completes at 4500
    await clock.tick(500); // then the regular interval
    expect(starts).toEqual([500, 2500, 5000]);
    expect(maxActive).toBe(1);
  });

  it('switching to a faster mode reschedules with the new interval', async () => {
    const { clock, runs, poller } = setup();
    poller.setMode('idle');
    poller.start();
    await clock.tick(1000);
    poller.setMode('active');
    expect(poller.mode).toBe('active');
    await clock.tick(699);
    expect(runs).toEqual([]);
    await clock.tick(1);
    expect(runs).toEqual([1700]);
  });

  it('switching to a slower mode keeps the pending run and then uses the new interval', async () => {
    const { clock, runs, poller } = setup();
    poller.setMode('active');
    poller.start();
    await clock.tick(100);
    poller.setMode('idle');
    await clock.tick(600);
    expect(runs).toEqual([700]);
    await clock.tick(4000);
    expect(runs).toEqual([700, 4700]);
  });

  it('stop cancels the timer and an in-flight run does not reschedule', async () => {
    const clock = createFakeClock();
    const starts: number[] = [];
    const poller = new Poller({
      run: () =>
        new Promise<void>((resolve) => {
          starts.push(clock.now());
          clock.timers.setTimeout(resolve, 1000);
        }),
      intervalMs: () => 500,
      timers: clock.timers,
    });
    poller.start();
    await clock.tick(500);
    expect(starts).toEqual([500]);
    poller.stop();
    expect(poller.running).toBe(false);
    await clock.tick(10_000);
    expect(starts).toEqual([500]);
    poller.kick(); // no-op when stopped
    await clock.flush();
    expect(starts).toEqual([500]);
  });

  it('start is idempotent', async () => {
    const { clock, runs, poller } = setup({ intervalMs: () => 1000 });
    poller.start();
    poller.start();
    expect(clock.pendingCount()).toBe(1);
    await clock.tick(1000);
    expect(runs).toEqual([1000]);
  });
});
