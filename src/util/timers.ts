/** Injectable timers so pollers and stores are testable with fake clocks. */
export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export const realTimers: TimerApi = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function sleep(ms: number, timers: TimerApi = realTimers): Promise<void> {
  return new Promise((resolve) => timers.setTimeout(resolve, ms));
}
