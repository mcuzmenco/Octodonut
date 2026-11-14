import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, Rating, newCard, retrievability, FACTOR } from '../app/js/fsrs.js';
import { addDays, daysBetween, todayStr } from '../app/js/dates.js';

const sched = new Scheduler({ fuzz: false });
const day0 = '2026-01-10';

test('forgetting curve gives 90% recall when elapsed time equals stability', () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-12);
  assert.equal(retrievability(0, 5), 1);
  assert.ok(retrievability(30, 5) < retrievability(10, 5));
  assert.ok(FACTOR > 0);
});

test('at 90% target the interval equals stability', () => {
  assert.equal(sched.nextInterval(10), 10);
  assert.equal(sched.nextInterval(0.2), 1, 'never less than a day');
});

test('higher target retention means shorter intervals', () => {
  const strict = new Scheduler({ desiredRetention: 0.95, fuzz: false });
  const relaxed = new Scheduler({ desiredRetention: 0.8, fuzz: false });
  assert.ok(strict.nextInterval(20) < sched.nextInterval(20));
  assert.ok(relaxed.nextInterval(20) > sched.nextInterval(20));
});

test('first review uses initial stability/difficulty for the rating', () => {
  const { card, interval } = sched.review(newCard(day0), Rating.Good, day0);
  assert.equal(card.state, 'review');
  assert.equal(card.stability, 3.7145);
  assert.ok(Math.abs(card.difficulty - 5.1618) < 1e-9);
  assert.equal(interval, 4);
  assert.equal(card.due, addDays(day0, 4));
  assert.equal(card.reps, 1);
  assert.equal(card.lapses, 0);
});

test('new-card intervals are ordered Again ≤ Hard ≤ Good ≤ Easy', () => {
  const p = sched.preview(newCard(day0), day0);
  assert.deepEqual(p, { 1: 1, 2: 1, 3: 4, 4: 14 });
});

test('successful review on time increases stability; Again decreases it', () => {
  let c = sched.review(newCard(day0), Rating.Good, day0).card;
  const reviewDay = c.due;
  const good = sched.review(c, Rating.Good, reviewDay).card;
  const again = sched.review(c, Rating.Again, reviewDay).card;
  assert.ok(good.stability > c.stability * 2, `expected growth, got ${good.stability}`);
  assert.ok(again.stability < c.stability);
  assert.equal(again.lapses, 1);
  assert.ok(again.difficulty > c.difficulty, 'failing makes the card harder');
  assert.ok(good.difficulty <= c.difficulty + 1e-9);
});

test('review intervals are monotonic in rating', () => {
  const c = sched.review(newCard(day0), Rating.Good, day0).card;
  const p = sched.preview(c, c.due);
  assert.ok(p[1] <= p[2] && p[2] <= p[3] && p[3] <= p[4], JSON.stringify(p));
});

test('reviewing late (lower recall chance) earns a bigger stability boost', () => {
  const c = sched.review(newCard(day0), Rating.Good, day0).card;
  const onTime = sched.review(c, Rating.Good, c.due).card;
  const late = sched.review(c, Rating.Good, addDays(c.due, 10)).card;
  assert.ok(late.stability > onTime.stability);
});

test('repeated Good reviews grow intervals into months', () => {
  let c = newCard(day0);
  let today = day0;
  const intervals = [];
  for (let i = 0; i < 6; i++) {
    const res = sched.review(c, Rating.Good, today);
    intervals.push(res.interval);
    c = res.card;
    today = c.due;
  }
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] > intervals[i - 1], intervals.join(','));
  assert.ok(intervals.at(-1) > 90, intervals.join(','));
});

test('difficulty stays within 1..10', () => {
  let c = newCard(day0);
  let today = day0;
  for (let i = 0; i < 30; i++) {
    c = sched.review(c, Rating.Again, today).card;
    today = c.due;
  }
  assert.ok(c.difficulty <= 10 && c.difficulty >= 1);
  for (let i = 0; i < 30; i++) {
    c = sched.review(c, Rating.Easy, today).card;
    today = c.due;
  }
  assert.ok(c.difficulty <= 10 && c.difficulty >= 1);
});

test('fuzz stays near the original interval', () => {
  const rng = [0, 0.999];
  for (const r of rng) {
    const s = new Scheduler({ random: () => r });
    for (const ivl of [3, 10, 50, 200]) {
      const f = s.fuzzInterval(ivl);
      assert.ok(Math.abs(f - ivl) <= Math.max(1, Math.round(ivl * 0.15)), `${ivl} -> ${f}`);
    }
  }
  assert.equal(new Scheduler().fuzzInterval(2), 2);
});

test('review does not mutate the input card', () => {
  const c = newCard(day0);
  const copy = { ...c };
  sched.review(c, Rating.Good, day0);
  assert.deepEqual(c, copy);
});

test('invalid ratings are rejected', () => {
  assert.throws(() => sched.review(newCard(day0), 0, day0), RangeError);
  assert.throws(() => sched.review(newCard(day0), 5, day0), RangeError);
});

test('date helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
  // 2am counts as the previous study day.
  assert.equal(todayStr(new Date(2026, 10, 14, 2, 0)), '2026-11-13');
  assert.equal(todayStr(new Date(2026, 10, 14, 5, 0)), '2026-11-14');
});
