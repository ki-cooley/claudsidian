/**
 * One-shot busy state for the permission and question cards: a tap disables every button and
 * spins the tapped one until the handler's promise settles, or CONFIRM_TIMEOUT_MS passes for a
 * handler that returns nothing. The store resolves the card (and unmounts it) on confirmation,
 * so the timeout only matters when the send fails silently.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export const CONFIRM_TIMEOUT_MS = 10_000;

export type Handler = (() => void | Promise<unknown>) | undefined;

export interface Busy {
  /** the key of the button that was tapped, while waiting */
  key: string | null;
  /** run the handler for `key`, guarding against a second tap */
  run(key: string, handler: Handler): void;
}

export function useBusy(timeoutMs: number = CONFIRM_TIMEOUT_MS): Busy {
  const [key, setKey] = useState<string | null>(null);
  // Two taps can land before the state re-renders; the ref is the guard, the state is the paint.
  const current = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const run = useCallback(
    (next: string, handler: Handler): void => {
      if (current.current !== null || !handler) return;
      current.current = next;
      setKey(next);
      const done = (): void => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
        current.current = null;
        if (alive.current) setKey(null);
      };
      timer.current = setTimeout(done, timeoutMs);
      let result: void | Promise<unknown>;
      try {
        result = handler();
      } catch {
        done();
        return;
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(done, done);
      }
    },
    [timeoutMs],
  );

  return { key, run };
}
