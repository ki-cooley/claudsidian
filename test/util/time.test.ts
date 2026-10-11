// relativeTime: the five short formats the session rows use, plus the empty case.
import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../src/util/time';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Local noon so day arithmetic never crosses a DST boundary in the test's timezone.
const now = new Date(2026, 9, 10, 12, 0, 0).getTime();

describe('relativeTime', () => {
  it('returns "" for undefined', () => {
    expect(relativeTime(undefined, now)).toBe('');
  });
  it('says just now under a minute, including slightly future stamps', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now + 5_000, now)).toBe('just now');
  });
  it('uses minutes under an hour', () => {
    expect(relativeTime(now - 4 * MIN, now)).toBe('4m');
    expect(relativeTime(now - 59 * MIN, now)).toBe('59m');
  });
  it('uses hours under a day', () => {
    expect(relativeTime(now - 3 * HOUR, now)).toBe('3h');
    expect(relativeTime(now - 23 * HOUR, now)).toBe('23h');
  });
  it('says yesterday for the previous calendar day', () => {
    expect(relativeTime(now - 30 * HOUR, now)).toBe('yesterday');
  });
  it('falls back to a short date, with the year only when it differs', () => {
    expect(relativeTime(new Date(2026, 9, 3, 9, 0).getTime(), now)).toBe('Oct 3');
    expect(relativeTime(new Date(2025, 11, 25, 9, 0).getTime(), now)).toBe('Dec 25, 2025');
    expect(relativeTime(now - 7 * DAY, now)).toBe('Oct 3');
  });
  it('treats non-finite input as unknown', () => {
    expect(relativeTime(Number.NaN, now)).toBe('');
  });
});
