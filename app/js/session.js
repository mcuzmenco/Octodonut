// Builds the day's review queue.
//
// Each word has two cards:
//   recognize – see the word in its original sentence, recall the meaning
//   produce   – see the meaning + the sentence with a blank, type the word
// Producing is harder than recognizing (and strengthens memory more), so the
// produce card only unlocks once the meaning is reasonably stable.

/** Recognize-card stability (days) required before the produce card is introduced. */
export const PRODUCE_UNLOCK_STABILITY = 4;

export function isProduceUnlocked(word) {
  const r = word.cards.recognize;
  return r.state === 'review' && r.stability >= PRODUCE_UNLOCK_STABILITY;
}

export function countNewIntroducedToday(log, today) {
  return log.filter((e) => e.day === today && e.card === 'recognize' && e.wasNew).length;
}

export function countReviewsToday(log, today) {
  return log.filter((e) => e.day === today && !e.wasNew).length;
}

/** Cards of this word that are due (ignores daily limits and sibling burying). */
export function dueCards(word, today) {
  const out = [];
  const { recognize, produce } = word.cards;
  if (recognize.state === 'review' && recognize.due <= today) out.push('recognize');
  if (isProduceUnlocked(word) && produce.due <= today) out.push('produce');
  return out;
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Spread the items of `b` evenly through `a`. */
export function interleave(a, b) {
  if (!b.length) return a.slice();
  if (!a.length) return b.slice();
  const out = [];
  const gap = a.length / (b.length + 1);
  let bi = 0;
  for (let i = 0; i < a.length; i++) {
    out.push(a[i]);
    while (bi < b.length && (bi + 1) * gap <= i + 1) out.push(b[bi++]);
  }
  while (bi < b.length) out.push(b[bi++]);
  return out;
}

/**
 * @returns {{wordId: string, card: 'recognize'|'produce'}[]}
 */
export function buildQueue(
  words,
  { today, newPerDay = 10, newIntroducedToday = 0, maxReviews = Infinity, random = Math.random },
) {
  const reviews = [];
  const fresh = [];

  for (const w of words) {
    const { recognize, produce } = w.cards;
    // Bury siblings: once either card was reviewed today, the other waits —
    // seeing one direction right after the other would be a free answer.
    if (recognize.lastReview === today || produce.lastReview === today) continue;

    if (recognize.state === 'new') {
      fresh.push({ wordId: w.id, card: 'recognize', createdAt: w.createdAt });
      continue;
    }
    const due = dueCards(w, today);
    if (!due.length) continue;
    // At most one card per word per day: the more overdue one.
    const pick =
      due.length === 2 ? (produce.due < recognize.due ? 'produce' : 'recognize') : due[0];
    reviews.push({ wordId: w.id, card: pick, due: w.cards[pick].due });
  }

  // If over the daily cap, keep the most overdue first…
  reviews.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const keptReviews = reviews.slice(0, Math.max(0, maxReviews));
  // …then shuffle: mixing words (interleaving) beats reviewing them in a fixed order.
  shuffle(keptReviews, random);

  fresh.sort((a, b) => a.createdAt - b.createdAt);
  const keptNew = fresh.slice(0, Math.max(0, newPerDay - newIntroducedToday));

  return interleave(keptReviews, keptNew).map(({ wordId, card }) => ({ wordId, card }));
}
