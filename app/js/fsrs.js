// FSRS (Free Spaced Repetition Scheduler), v4.5 formulas with the published default weights.
// Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm
//
// The model tracks, per card:
//   S (stability)  – days until recall probability drops to 90%
//   D (difficulty) – 1..10, how hard the card is for you
//   R (retrievability) – probability you can recall it right now, decays with time
// Each review updates S and D. The next review is scheduled for the moment R is
// predicted to fall to your desired retention (default 90%).

import { addDays, daysBetween } from './dates.js';

export const DEFAULT_WEIGHTS = Object.freeze([
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072,
  0.0793, 0.3246, 1.587, 0.2272, 2.8755,
]);

export const Rating = Object.freeze({ Again: 1, Hard: 2, Good: 3, Easy: 4 });

export const DECAY = -0.5;
/** Chosen so that R(t = S) = 0.9. */
export const FACTOR = 19 / 81;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function newCard(due) {
  return { state: 'new', stability: 0, difficulty: 0, due, lastReview: null, reps: 0, lapses: 0 };
}

/** Forgetting curve: probability of recall after `elapsedDays` with stability `stability`. */
export function retrievability(elapsedDays, stability) {
  if (!(stability > 0)) return 0;
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

export class Scheduler {
  constructor({
    weights = DEFAULT_WEIGHTS,
    desiredRetention = 0.9,
    maximumInterval = 36500,
    fuzz = true,
    random = Math.random,
  } = {}) {
    if (weights.length !== 17) throw new RangeError('FSRS v4.5 needs exactly 17 weights');
    if (!(desiredRetention > 0 && desiredRetention < 1)) {
      throw new RangeError('desiredRetention must be between 0 and 1');
    }
    this.w = weights;
    this.desiredRetention = desiredRetention;
    this.maximumInterval = maximumInterval;
    this.fuzz = fuzz;
    this.random = random;
  }

  initStability(g) {
    return Math.max(0.1, this.w[g - 1]);
  }

  initDifficulty(g) {
    return clamp(this.w[4] - (g - 3) * this.w[5], 1, 10);
  }

  nextDifficulty(d, g) {
    const next = d - this.w[6] * (g - 3);
    // Mean reversion towards the default difficulty keeps D from drifting to the extremes.
    return clamp(this.w[7] * this.w[4] + (1 - this.w[7]) * next, 1, 10);
  }

  /** New stability after a successful recall (Hard / Good / Easy). */
  recallStability(d, s, r, g) {
    const w = this.w;
    const hardPenalty = g === Rating.Hard ? w[15] : 1;
    const easyBonus = g === Rating.Easy ? w[16] : 1;
    return (
      s *
      (1 +
        Math.exp(w[8]) *
          (11 - d) *
          Math.pow(s, -w[9]) *
          (Math.exp(w[10] * (1 - r)) - 1) *
          hardPenalty *
          easyBonus)
    );
  }

  /** New stability after a lapse (Again). Never larger than before the lapse. */
  forgetStability(d, s, r) {
    const w = this.w;
    const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
    return Math.min(sf, s);
  }

  /** Days until R falls to the desired retention. */
  nextInterval(s) {
    const raw = (s / FACTOR) * (Math.pow(this.desiredRetention, 1 / DECAY) - 1);
    return clamp(Math.round(raw), 1, this.maximumInterval);
  }

  /** Spread reviews a little so words added together don't stay clumped forever. */
  fuzzInterval(ivl) {
    if (ivl < 3) return ivl;
    const f = ivl < 7 ? 0.15 : ivl < 20 ? 0.1 : 0.05;
    const delta = Math.max(1, Math.round(ivl * f));
    const lo = ivl - delta;
    const hi = ivl + delta;
    return clamp(lo + Math.floor(this.random() * (hi - lo + 1)), 2, this.maximumInterval);
  }

  /**
   * Apply a rating to a card on study day `today`.
   * Returns { card, interval, elapsed, retrievability } without mutating the input.
   */
  review(card, rating, today, { fuzz = this.fuzz } = {}) {
    if (![1, 2, 3, 4].includes(rating)) throw new RangeError(`Invalid rating: ${rating}`);

    let s;
    let d;
    let r = null;
    let elapsed = 0;
    const isNew = card.state === 'new' || !card.lastReview;

    if (isNew) {
      s = this.initStability(rating);
      d = this.initDifficulty(rating);
    } else {
      elapsed = Math.max(0, daysBetween(card.lastReview, today));
      r = retrievability(elapsed, card.stability);
      d = this.nextDifficulty(card.difficulty, rating);
      s =
        rating === Rating.Again
          ? this.forgetStability(card.difficulty, card.stability, r)
          : this.recallStability(card.difficulty, card.stability, r, rating);
    }

    let interval = this.nextInterval(s);
    if (fuzz) interval = this.fuzzInterval(interval);

    return {
      card: {
        ...card,
        state: 'review',
        stability: s,
        difficulty: d,
        due: addDays(today, interval),
        lastReview: today,
        reps: card.reps + 1,
        lapses: card.lapses + (rating === Rating.Again && !isNew ? 1 : 0),
      },
      interval,
      elapsed,
      retrievability: r,
    };
  }

  /** Interval (days) each rating would produce, for showing on the buttons. */
  preview(card, today) {
    const out = {};
    for (const g of [1, 2, 3, 4]) out[g] = this.review(card, g, today, { fuzz: false }).interval;
    return out;
  }
}
