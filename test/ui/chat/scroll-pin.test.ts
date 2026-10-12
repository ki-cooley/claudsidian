// shouldPin: the auto-scroll decision behind the transcript's jump-to-latest pill.
import { describe, expect, it } from 'vitest';
import { isFarFromBottom, shouldPin } from '../../../src/ui/components/chat/use-scroll-pin';

describe('shouldPin', () => {
  it('is pinned at the bottom and within the default 40 px threshold (was 80: a smaller band so a deliberate scroll up unpins)', () => {
    expect(shouldPin(500, 1000, 500)).toBe(true);
    expect(shouldPin(460, 1000, 500)).toBe(true);
    expect(shouldPin(461, 1000, 500)).toBe(true);
  });

  it('is not pinned once the reader is more than the threshold above the bottom', () => {
    expect(shouldPin(459, 1000, 500)).toBe(false);
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

describe('isFarFromBottom', () => {
  it('is true only when more than one viewport of content is below the reader', () => {
    expect(isFarFromBottom(0, 1000, 500)).toBe(false);
    expect(isFarFromBottom(0, 1001, 500)).toBe(true);
    expect(isFarFromBottom(300, 1000, 300)).toBe(true);
    expect(isFarFromBottom(700, 1000, 300)).toBe(false);
  });
});
