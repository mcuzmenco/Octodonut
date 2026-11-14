// Plans the daily reminder notifications.
//
// The phone schedules them in advance, so each one carries the number of words
// that will be due that morning if you don't open the app before then. Every time
// the app's data changes the plan is recomputed, so today's reminder disappears
// once you've finished, and days with nothing due get no notification at all.

import { buildQueue, countNewIntroducedToday, countReviewsToday } from './session.js';
import { addDays, todayStr } from './dates.js';

export const DAYS_AHEAD = 30;
const SECONDS_PER_CARD = 12;

/** "09:00" → [9, 0]; invalid input falls back to 9am. */
export function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  const h = m ? Number(m[1]) : 9;
  const min = m ? Number(m[2]) : 0;
  return h < 24 && min < 60 ? [h, min] : [9, 0];
}

function atLocal(day, [h, min]) {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, h, min, 0, 0);
}

export function reminderText(count) {
  const minutes = Math.max(1, Math.round((count * SECONDS_PER_CARD) / 60));
  const words = `${count} word${count === 1 ? '' : 's'}`;
  return {
    title: count > 40 ? `${words} are piling up` : `${words} to review`,
    body: `About ${minutes} min. Reviewing now, just before you'd forget, is what makes them stick.`,
  };
}

/**
 * @returns {{ at: Date, count: number, title: string, body: string }[]}
 */
export function planReminders(data, { now = new Date(), days = DAYS_AHEAD } = {}) {
  const s = data.settings;
  if (!s.reminders || !data.words.length) return [];
  const time = parseTime(s.reminderTime);
  const today = todayStr(now);
  const plan = [];

  for (let i = 0; i < days; i++) {
    // Calendar day i days from now (study days roll over at 4am, reminders are later).
    const day = addDays(today, i);
    const at = atLocal(day, time);
    if (at <= now) continue;
    const isToday = day === today;
    const count = buildQueue(data.words, {
      today: day,
      newPerDay: s.newPerDay,
      newIntroducedToday: isToday ? countNewIntroducedToday(data.log, day) : 0,
      maxReviews: s.maxReviews - (isToday ? countReviewsToday(data.log, day) : 0),
      random: () => 0,
    }).length;
    if (count > 0) plan.push({ at, count, ...reminderText(count) });
  }
  return plan;
}
