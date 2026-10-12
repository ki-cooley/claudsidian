/**
 * Auto-scroll for the transcript. Pinned to the bottom until the reader scrolls up by more than
 * PIN_THRESHOLD_PX; while pinned, every growth of the content (async markdown, icons, images,
 * streaming text) re-pins through a ResizeObserver on the content element. Scroll events the
 * hook caused itself (or that fire late, after content grew under a scroll it set) are told
 * apart from the reader's by the scrollTop they report, so they never unpin.
 *
 * On session open the pin holds for OPEN_HOLD_MS or until the first user input (wheel, touch,
 * pointer, key), whichever comes first, so a late layout cannot leave the view mid-transcript.
 *
 * The jump control shows only when the reader is more than one viewport above the bottom, or
 * new content arrived while they were scrolled up; it hides the moment they use it or reach the
 * bottom. `claudsidian:scroll-to-bottom` dispatched on the plugin root (the composer does this
 * after a send) jumps too. shouldPin is the pure decision.
 */
import type { RefObject } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export const PIN_THRESHOLD_PX = 40;
export const OPEN_HOLD_MS = 1500;
export const SCROLL_TO_BOTTOM_EVENT = 'claudsidian:scroll-to-bottom';
/** Re-pin ticks after an open, for growth that no ResizeObserver reports (fonts, icons). */
const OPEN_REPIN_DELAYS_MS = [50, 200, 600, 1200];

/** True when the viewport bottom is within `threshold` px of the content bottom. */
export function shouldPin(scrollTop: number, scrollHeight: number, clientHeight: number, threshold: number = PIN_THRESHOLD_PX): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/** True when the reader is more than one viewport above the bottom: far enough for a jump control. */
export function isFarFromBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight > clientHeight;
}

export interface ScrollPinOptions {
  /** changes when another session opens: the pin re-arms and holds */
  sessionKey?: string;
  /** how long a fresh open keeps the pin against non-user scrolls */
  openHoldMs?: number;
}

export interface ScrollPin {
  /** the scroll container */
  ref: RefObject<HTMLDivElement>;
  /** the element wrapping the content, observed for growth */
  contentRef: RefObject<HTMLDivElement>;
  pinned: boolean;
  /** content arrived while unpinned */
  hasNew: boolean;
  /** the jump control should show */
  showJump: boolean;
  onScroll: () => void;
  /** scroll to the bottom and pin again */
  jump: () => void;
}

/** `contentKey` changes whenever the rendered content may have grown (item count, streaming text length). */
export function useScrollPin(contentKey: string, opts: ScrollPinOptions = {}): ScrollPin {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [far, setFar] = useState(false);
  const pinnedRef = useRef(true);
  const lastKey = useRef(contentKey);
  /** the scrollTop this hook set last; a scroll event reporting it is ours, not the reader's */
  const expectedTop = useRef<number | null>(null);
  const holdUntil = useRef(0);
  const userInput = useRef(false);
  const openHoldMs = opts.openHoldMs ?? OPEN_HOLD_MS;
  const sessionKey = opts.sessionKey ?? '';

  const scrollToBottom = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    expectedTop.current = el.scrollTop;
  }, []);

  const setPin = useCallback((next: boolean): void => {
    if (next !== pinnedRef.current) {
      pinnedRef.current = next;
      setPinned(next);
    }
    if (next) {
      setHasNew(false);
      setFar(false);
    }
  }, []);

  const onScroll = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    if (expectedTop.current !== null && el.scrollTop === expectedTop.current) return;
    expectedTop.current = null;
    const atBottom = shouldPin(el.scrollTop, el.scrollHeight, el.clientHeight);
    const holding = !userInput.current && Date.now() < holdUntil.current;
    if (holding && !atBottom && pinnedRef.current) {
      scrollToBottom();
      return;
    }
    setPin(atBottom);
    if (!atBottom) setFar(isFarFromBottom(el.scrollTop, el.scrollHeight, el.clientHeight));
  }, [scrollToBottom, setPin]);

  const jump = useCallback((): void => {
    setPin(true);
    scrollToBottom();
  }, [scrollToBottom, setPin]);

  // A fresh open (mount, another session, or the history landing on an empty transcript): pin and hold.
  const arm = useCallback((): void => {
    holdUntil.current = Date.now() + openHoldMs;
    userInput.current = false;
    setPin(true);
    scrollToBottom();
  }, [openHoldMs, scrollToBottom, setPin]);

  useLayoutEffect(() => {
    arm();
    const timers = OPEN_REPIN_DELAYS_MS.filter((ms) => ms <= openHoldMs).map((ms) =>
      setTimeout(() => {
        if (pinnedRef.current) scrollToBottom();
      }, ms),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [sessionKey, arm, openHoldMs, scrollToBottom]);

  const wasEmpty = useRef(contentKey === '0');
  useLayoutEffect(() => {
    const changed = lastKey.current !== contentKey;
    lastKey.current = contentKey;
    const nowEmpty = contentKey === '0';
    if (wasEmpty.current && !nowEmpty) {
      wasEmpty.current = false;
      arm();
      return;
    }
    wasEmpty.current = nowEmpty;
    if (pinnedRef.current) scrollToBottom();
    else if (changed) setHasNew(true);
  }, [contentKey, arm, scrollToBottom]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const markUser = (): void => {
      userInput.current = true;
    };
    const events: (keyof HTMLElementEventMap)[] = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    for (const name of events) el.addEventListener(name, markUser, { passive: true });
    return () => {
      for (const name of events) el.removeEventListener(name, markUser);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // Content growing (async markdown, images) or the viewport shrinking (composer, keyboard): keep the bottom in view.
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom();
    });
    ro.observe(el);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  useEffect(() => {
    const el = ref.current;
    const target: EventTarget = el?.closest('.claudsidian-root') ?? document;
    const onJump = (): void => jump();
    target.addEventListener(SCROLL_TO_BOTTOM_EVENT, onJump);
    return () => target.removeEventListener(SCROLL_TO_BOTTOM_EVENT, onJump);
  }, [jump]);

  return { ref, contentRef, pinned, hasNew, showJump: !pinned && (hasNew || far), onScroll, jump };
}
