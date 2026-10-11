/** Short relative timestamps for list rows: "just now", "4m", "3h", "yesterday", "Oct 3". */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "" when the time is unknown. Future stamps (clock skew) read as "just now". */
export function relativeTime(epochMs: number | undefined, now: number): string {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return '';
  const delta = now - epochMs;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  const then = new Date(epochMs);
  const today = new Date(now);
  const dayDiff = Math.round((startOfLocalDay(today) - startOfLocalDay(then)) / 86_400_000);
  if (dayDiff === 1) return 'yesterday';
  const monthDay = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === today.getFullYear() ? monthDay : `${monthDay}, ${then.getFullYear()}`;
}
