/**
 * Timezone-aware helpers for eligibility checks.
 *
 * Workers have no `Intl.DateTimeFormat` with timeZone option in some
 * runtime versions — but they DO in the current Workers runtime
 * (post-2023-09-04). We rely on that.
 *
 * If we ever need to support an older runtime, replace these with
 * manual UTC offset lookups.
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

/** "YYYY-MM-DD" in the given timezone. */
export function localDateString(d: Date, timezone: string): string {
  const parts = getFormatter(timezone).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value ?? '1970';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const day = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${day}`;
}

/** 0-23 in the given timezone. */
export function localHour(d: Date, timezone: string): number {
  const parts = getFormatter(timezone).formatToParts(d);
  const hour = parts.find(p => p.type === 'hour')?.value ?? '00';
  return Number(hour);
}

/** Days since the given epoch (rounded down). */
export function daysSince(epoch: number, now: Date): number {
  return Math.floor((now.getTime() - epoch) / (1000 * 60 * 60 * 24));
}

/** Days between a "YYYY-MM-DD" string and now, in the given timezone. */
export function daysBetween(dateStr: string, now: Date, timezone: string): number {
  const today = localDateString(now, timezone);
  const a = new Date(`${dateStr}T00:00:00Z`).getTime();
  const b = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}
