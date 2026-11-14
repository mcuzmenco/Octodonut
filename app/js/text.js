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

// ------------------------------------------------ text shared from other apps

const URL_RE = /\bhttps?:\/\/\S+/gi;
// Promotional lines reading apps add around a shared quote.
const PROMO_RE = /start reading|read (it )?(for )?free|get (it|this book)|download|kindle|amazon|goodreads|^check out/i;
const QUOTE_RE = /^\s*["“”‘'«]([\s\S]+?)["“”’'»]\s*(?:\n|$|[—–-]|\bfrom\b)/i;

const cleanSource = (s) =>
  s
    .replace(/^[\s—–\-:,.]*(from\s+)?/i, '')
    .replace(/[\s,.]+$/, '')
    .replace(/^["“](.+)["”]$/, '$1')
    .trim()
    .slice(0, 120);

const stripEdges = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Turn shared text into form fields. Handles a bare word, a bare sentence, and
 * the "“quote” — Book Title by Author https://…" shape that Kindle and other
 * reading apps produce.
 * @returns {{ word: string, context: string, source: string }}
 */
export function parseShared(text, subject = '') {
  let body = (text || '').replace(URL_RE, '').replace(/\r/g, '').trim();
  let source = '';

  const quoted = QUOTE_RE.exec(body);
  let passage;
  if (quoted) {
    passage = quoted[1];
    source = body.slice(quoted[0].length - (quoted[0].match(/(\n|[—–-]|\bfrom\b)$/i)?.[0].length || 0));
  } else {
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    passage = lines.shift() || '';
    source = lines.join(' ');
  }
  source = source
    .split('\n')
    .map((l) => {
      const promo = l.search(PROMO_RE);
      return (promo >= 0 ? l.slice(0, promo) : l).trim();
    })
    .filter(Boolean)
    .join(' ');
  source = cleanSource(source) || cleanSource(subject);
  // "Title by Author" → keep both, it's useful context; but drop a bare "by Author".
  if (/^by\s/i.test(source)) source = '';

  passage = passage.replace(/\s+/g, ' ').trim();
  const single = !/\s/.test(passage);
  // "Verdant" from the start of a sentence → "verdant"; leave ALLCAPS and names like "iPhone".
  const word = stripEdges(passage).replace(/^(\p{Lu})(\p{Ll}+)$/u, (_, a, b) => a.toLowerCase() + b);
  return single ? { word, context: '', source } : { word: '', context: passage, source };
}

/** Words of a sentence as tappable pieces: [{ text, word }] (word is '' for spaces/punctuation). */
export function sentencePieces(sentence) {
  return (sentence || '').split(/(\s+)/).filter(Boolean).flatMap((chunk) => {
    if (/^\s+$/.test(chunk)) return [{ text: chunk, word: '' }];
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(chunk);
    return [
      m[1] && { text: m[1], word: '' },
      m[2] && { text: m[2], word: m[2] },
      m[3] && { text: m[3], word: '' },
    ].filter(Boolean);
  });
}
