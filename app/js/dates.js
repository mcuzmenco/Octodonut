// Day-granularity date helpers. Scheduling works on calendar days ("YYYY-MM-DD"),
// which is what FSRS's default parameters were fitted on.

const DAY_MS = 86_400_000;

/** A new study day starts at 4am, so late-night reading sessions count as "today". */
export const ROLLOVER_HOUR = 4;

const pad = (n) => String(n).padStart(2, '0');
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function toUTC(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The current study day in local time, e.g. "2026-11-14". */
export function todayStr(now = new Date()) {
  const d = new Date(now.getTime() - ROLLOVER_HOUR * 3_600_000);
  return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function addDays(day, n) {
  const d = new Date(toUTC(day) + n * DAY_MS);
  return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}
