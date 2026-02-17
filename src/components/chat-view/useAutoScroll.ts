import { useCallback, useEffect, useRef } from 'react'

const SCROLL_AWAY_FROM_BOTTOM_THRESHOLD = 50
const USER_SCROLL_DEBOUNCE_MS = 150

type UseAutoScrollProps = {
  scrollContainerRef: React.RefObject<HTMLElement>
}

export function useAutoScroll({ scrollContainerRef }: UseAutoScrollProps) {
  const preventAutoScrollRef = useRef(false)
  const isUserScrollingRef = useRef(false)
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    // Only user-initiated events (wheel, touchmove) should control auto-scroll.
    // Content growth fires scroll events too, but those must NOT disable auto-scroll.
    const handleUserScrollStart = () => {
      isUserScrollingRef.current = true
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }
      userScrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
      }, USER_SCROLL_DEBOUNCE_MS)
    }

    const handleScroll = () => {
      // Only update auto-scroll state if a user interaction triggered this scroll
      if (!isUserScrollingRef.current) return

      preventAutoScrollRef.current =
        scrollContainer.scrollHeight -
          scrollContainer.scrollTop -
          scrollContainer.clientHeight >
        SCROLL_AWAY_FROM_BOTTOM_THRESHOLD
    }

    scrollContainer.addEventListener('wheel', handleUserScrollStart, {
      passive: true,
    })
    scrollContainer.addEventListener('touchmove', handleUserScrollStart, {
      passive: true,
    })
    scrollContainer.addEventListener('scroll', handleScroll)
    return () => {
      scrollContainer.removeEventListener('wheel', handleUserScrollStart)
      scrollContainer.removeEventListener('touchmove', handleUserScrollStart)
      scrollContainer.removeEventListener('scroll', handleScroll)
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
      }
    }
  }, [scrollContainerRef])

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current
      if (scrollContainer.scrollTop !== scrollContainer.scrollHeight) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [scrollContainerRef])

  // Auto-scrolls to bottom only if the scroll position is near the bottom
  const autoScrollToBottom = useCallback(() => {
    if (!preventAutoScrollRef.current) {
      scrollToBottom()
    }
  }, [scrollToBottom])

  // Forces scroll to bottom regardless of current position
  const forceScrollToBottom = useCallback(() => {
    preventAutoScrollRef.current = false
    scrollToBottom()
  }, [scrollToBottom])

  return {
    autoScrollToBottom,
    forceScrollToBottom,
  }
}
