// Text helpers: find the word inside its context sentence (so it can be highlighted
// or blanked out), check typed answers, and format intervals.

const LETTERS = '\\p{L}\\p{M}';

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex matching the word and simple inflections in running text
 * ("debate" → "debating", "carry" → "carried", "run" → "runs").
 */
export function wordPattern(word) {
  const w = (word || '').trim();
  if (!w) return null;
  let stem = w;
  if (w.length > 4 && /[ey]$/i.test(w)) stem = w.slice(0, -1);
  const body = escapeRegExp(stem).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![${LETTERS}])${body}[${LETTERS}]*`, 'giu');
}

/** Split `text` into segments, marking the ones that are the word. */
export function splitOnWord(text, word) {
  const src = text || '';
  const re = wordPattern(word);
  if (!re || !src) return [{ text: src, match: false }];
  const out = [];
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), match: false });
    out.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), match: false });
  return out;
}

export function containsWord(text, word) {
  return splitOnWord(text, word).some((s) => s.match);
}

export function normalizeAnswer(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Accept the dictionary form, or the exact form that appeared in the sentence. */
export function isCorrectAnswer(input, word, context = '') {
  const a = normalizeAnswer(input);
  if (!a) return false;
  if (a === normalizeAnswer(word)) return true;
  return splitOnWord(context, word).some((s) => s.match && normalizeAnswer(s.text) === a);
}

export function formatInterval(days) {
  if (days < 1) return '<1d';
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`;
}
