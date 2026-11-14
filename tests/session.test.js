import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueue, interleave, isProduceUnlocked, countNewIntroducedToday } from '../app/js/session.js';
import { createWord, normalizeData, load, save, emptyData, STORAGE_KEY } from '../app/js/store.js';

const today = '2026-03-10';
const noShuffle = () => 0.999999;

function word(name, created, cards = {}) {
  const w = createWord({ word: name, definition: `def of ${name}` }, '2026-03-01', created);
  Object.assign(w.cards.recognize, cards.recognize || {});
  Object.assign(w.cards.produce, cards.produce || {});
  return w;
}

const reviewState = (due, stability = 2, lastReview = '2026-03-01') => ({
  state: 'review',
  due,
  stability,
  difficulty: 5,
  lastReview,
  reps: 1,
});

test('new words are limited per day, oldest first', () => {
  const words = [word('c', 3), word('a', 1), word('b', 2)];
  const q = buildQueue(words, { today, newPerDay: 2, random: noShuffle });
  assert.deepEqual(q.map((i) => findName(words, i)), ['a', 'b']);
  const q2 = buildQueue(words, { today, newPerDay: 2, newIntroducedToday: 1, random: noShuffle });
  assert.equal(q2.length, 1);
});

test('only due review cards are included', () => {
  const due = word('due', 1, { recognize: reviewState('2026-03-09') });
  const later = word('later', 2, { recognize: reviewState('2026-03-20') });
  const q = buildQueue([due, later], { today, newPerDay: 0 });
  assert.deepEqual(q, [{ wordId: due.id, card: 'recognize' }]);
});

test('produce card unlocks once recognition is stable', () => {
  const young = word('young', 1, { recognize: reviewState('2026-03-20', 2) });
  const stable = word('stable', 2, { recognize: reviewState('2026-03-20', 10) });
  assert.equal(isProduceUnlocked(young), false);
  assert.equal(isProduceUnlocked(stable), true);
  const q = buildQueue([young, stable], { today, newPerDay: 10 });
  assert.deepEqual(q, [{ wordId: stable.id, card: 'produce' }]);
});

test('siblings are buried: one card per word per day', () => {
  const both = word('both', 1, {
    recognize: reviewState('2026-03-08', 10),
    produce: reviewState('2026-03-05', 3),
  });
  const q = buildQueue([both], { today });
  assert.deepEqual(q, [{ wordId: both.id, card: 'produce' }], 'more overdue card wins');

  const reviewedToday = word('x', 2, {
    recognize: reviewState('2026-03-20', 10, today),
    produce: reviewState('2026-03-01', 3),
  });
  assert.equal(buildQueue([reviewedToday], { today }).length, 0);
});

test('max reviews keeps the most overdue cards', () => {
  const words = ['2026-03-09', '2026-03-01', '2026-03-05'].map((d, i) =>
    word(`w${i}`, i, { recognize: reviewState(d) }),
  );
  const q = buildQueue(words, { today, newPerDay: 0, maxReviews: 2 });
  const names = q.map((i) => findName(words, i)).sort();
  assert.deepEqual(names, ['w1', 'w2']);
});

test('interleave spreads new items through reviews', () => {
  assert.deepEqual(interleave([1, 2, 3, 4], ['a', 'b']), [1, 2, 'a', 3, 'b', 4]);
  assert.deepEqual(interleave([], ['a']), ['a']);
  assert.deepEqual(interleave([1], []), [1]);
});

test('counts new words introduced today', () => {
  const log = [
    { day: today, card: 'recognize', wasNew: true },
    { day: today, card: 'produce', wasNew: true },
    { day: today, card: 'recognize', wasNew: false },
    { day: '2026-03-09', card: 'recognize', wasNew: true },
  ];
  assert.equal(countNewIntroducedToday(log, today), 1);
});

test('store round-trips and fills defaults', () => {
  const mem = memoryStorage();
  const data = emptyData();
  data.words.push(word('hello', 1));
  save(data, mem);
  const back = load(mem);
  assert.equal(back.words[0].word, 'hello');
  assert.equal(back.settings.desiredRetention, 0.9);

  assert.throws(() => normalizeData({ nope: true }));
  const partial = normalizeData({ words: [{ id: 'x', word: 'w' }], settings: { newPerDay: '999' } });
  assert.equal(partial.words[0].cards.recognize.state, 'new');
  assert.equal(partial.settings.newPerDay, 200);
});

test('unreadable saved data is preserved, not overwritten', () => {
  const mem = memoryStorage();
  mem.setItem(STORAGE_KEY, '{broken');
  const data = load(mem);
  assert.equal(data.words.length, 0);
  assert.ok([...mem.keys()].some((k) => k.startsWith(`${STORAGE_KEY}.unreadable-`)));
});

function findName(words, item) {
  return words.find((w) => w.id === item.wordId).word;
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    keys: () => m.keys(),
  };
}
