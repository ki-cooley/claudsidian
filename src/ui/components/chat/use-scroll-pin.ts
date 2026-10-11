/**
 * Auto-scroll for the transcript: pinned to the bottom until the reader scrolls up, then a
 * "Jump to latest" pill when new content arrives. shouldPin is the pure decision.
 */
import type { RefObject } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export const PIN_THRESHOLD_PX = 80;

/** True when the viewport bottom is within `threshold` px of the content bottom. */
export function shouldPin(scrollTop: number, scrollHeight: number, clientHeight: number, threshold: number = PIN_THRESHOLD_PX): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export interface ScrollPin {
  ref: RefObject<HTMLDivElement>;
  pinned: boolean;
  /** content arrived while unpinned */
  hasNew: boolean;
  onScroll: () => void;
  /** scroll to the bottom and pin again */
  jump: () => void;
}

/** `contentKey` changes whenever the rendered content may have grown (item count, streaming text length). */
export function useScrollPin(contentKey: string): ScrollPin {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const pinnedRef = useRef(true);
  const lastKey = useRef(contentKey);

  const scrollToBottom = useCallback((): void => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    const next = shouldPin(el.scrollTop, el.scrollHeight, el.clientHeight);
    if (next !== pinnedRef.current) {
      pinnedRef.current = next;
      setPinned(next);
    }
    if (next) setHasNew(false);
  }, []);

  const jump = useCallback((): void => {
    pinnedRef.current = true;
    setPinned(true);
    setHasNew(false);
    scrollToBottom();
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    const changed = lastKey.current !== contentKey;
    lastKey.current = contentKey;
    if (pinnedRef.current) scrollToBottom();
    else if (changed) setHasNew(true);
  }, [contentKey, scrollToBottom]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // The composer growing or the keyboard opening shrinks the viewport: keep the bottom in view.
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  return { ref, pinned, hasNew, onScroll, jump };
}
