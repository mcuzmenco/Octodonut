import test from 'node:test';
import assert from 'node:assert/strict';
import { planReminders, parseTime, reminderText } from '../app/js/reminders.js';
import { createWord, emptyData } from '../app/js/store.js';

function dataWith(words) {
  const d = emptyData();
  d.words = words;
  return d;
}

function reviewWord(name, due, lastReview = '2026-03-01') {
  const w = createWord({ word: name, definition: 'x' }, '2026-03-01', 1);
  Object.assign(w.cards.recognize, { state: 'review', due, stability: 2, difficulty: 5, lastReview, reps: 1 });
  return w;
}

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min);

test('reminder at 9:00 today when words are due and it is still early', () => {
  const plan = planReminders(dataWith([reviewWord('a', '2026-03-10')]), { now: at(2026, 3, 10, 7), days: 3 });
  assert.equal(plan.length, 3, 'word stays due every day until reviewed');
  assert.deepEqual(plan[0].at, at(2026, 3, 10, 9));
  assert.equal(plan[0].count, 1);
});

test('no reminder for today after 9:00; future days only', () => {
  const plan = planReminders(dataWith([reviewWord('a', '2026-03-12')]), { now: at(2026, 3, 10, 10), days: 5 });
  assert.deepEqual(plan.map((p) => p.at.getDate()), [12, 13, 14]);
});

test('nothing due means no notifications', () => {
  assert.deepEqual(planReminders(dataWith([reviewWord('a', '2026-04-30')]), { now: at(2026, 3, 10, 7), days: 7 }), []);
  assert.deepEqual(planReminders(emptyData(), { now: at(2026, 3, 10, 7) }), []);
});

test('reviewed today: today’s reminder disappears', () => {
  // Due again in the future, last reviewed today.
  const plan = planReminders(dataWith([reviewWord('a', '2026-03-15', '2026-03-10')]), { now: at(2026, 3, 10, 7), days: 3 });
  assert.equal(plan.length, 0);
});

test('new words count, limited by the daily new-word setting', () => {
  const d = dataWith(Array.from({ length: 15 }, (_, i) => createWord({ word: `w${i}`, definition: 'x' }, '2026-03-01', i)));
  d.settings.newPerDay = 5;
  const [first] = planReminders(d, { now: at(2026, 3, 10, 7), days: 1 });
  assert.equal(first.count, 5);
});

test('respects the time and the on/off switch', () => {
  const d = dataWith([reviewWord('a', '2026-03-10')]);
  d.settings.reminderTime = '18:30';
  assert.deepEqual(planReminders(d, { now: at(2026, 3, 10, 12), days: 1 })[0].at, at(2026, 3, 10, 18, 30));
  d.settings.reminders = false;
  assert.deepEqual(planReminders(d, { now: at(2026, 3, 10, 12) }), []);
});

test('time parsing and wording', () => {
  assert.deepEqual(parseTime('07:05'), [7, 5]);
  assert.deepEqual(parseTime('nope'), [9, 0]);
  assert.deepEqual(parseTime('25:00'), [9, 0]);
  assert.equal(reminderText(1).title, '1 word to review');
  assert.equal(reminderText(12).title, '12 words to review');
  assert.match(reminderText(60).title, /piling up/);
});
