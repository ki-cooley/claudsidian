// shouldPin: the auto-scroll decision behind the transcript's jump-to-latest pill.
import { describe, expect, it } from 'vitest';
import { shouldPin } from '../../../src/ui/components/chat/use-scroll-pin';

describe('shouldPin', () => {
  it('is pinned at the bottom and within the default 80 px threshold', () => {
    expect(shouldPin(500, 1000, 500)).toBe(true);
    expect(shouldPin(420, 1000, 500)).toBe(true);
    expect(shouldPin(421, 1000, 500)).toBe(true);
  });

  it('is not pinned once the reader is more than the threshold above the bottom', () => {
    expect(shouldPin(419, 1000, 500)).toBe(false);
    expect(shouldPin(0, 1000, 500)).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(shouldPin(400, 1000, 500, 100)).toBe(true);
    expect(shouldPin(399, 1000, 500, 100)).toBe(false);
    expect(shouldPin(499, 1000, 500, 0)).toBe(false);
    expect(shouldPin(500, 1000, 500, 0)).toBe(true);
  });

  it('treats content that fits without scrolling as pinned', () => {
    expect(shouldPin(0, 300, 500)).toBe(true);
    expect(shouldPin(0, 0, 0)).toBe(true);
  });
});
