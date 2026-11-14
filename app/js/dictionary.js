// Definitions from the free Dictionary API (https://dictionaryapi.dev), no key needed.
// It is built from Wiktionary data, so it covers phrases ("take for granted"),
// inflected forms ("debating") and rare words, and includes synonyms and examples.

const ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const MAX_SYNONYMS = 6;

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

export function parseEntries(entries) {
  const senses = [];
  let phonetic = '';
  let audio = '';
  for (const e of Array.isArray(entries) ? entries : []) {
    const phonetics = Array.isArray(e.phonetics) ? e.phonetics : [];
    phonetic ||= e.phonetic || phonetics.find((p) => p.text)?.text || '';
    // Prefer a pronunciation that comes with both text and audio, then any audio.
    audio ||= phonetics.find((p) => p.audio && p.text)?.audio || phonetics.find((p) => p.audio)?.audio || '';
    for (const m of e.meanings || []) {
      const meaningSynonyms = Array.isArray(m.synonyms) ? m.synonyms : [];
      for (const d of m.definitions || []) {
        if (!d.definition) continue;
        const own = Array.isArray(d.synonyms) ? d.synonyms : [];
        senses.push({
          pos: m.partOfSpeech || '',
          definition: d.definition,
          example: d.example || '',
          synonyms: uniq([...own, ...meaningSynonyms]).slice(0, MAX_SYNONYMS),
        });
      }
    }
  }
  if (audio.startsWith('//')) audio = `https:${audio}`;
  return { senses, phonetic, audio };
}

export async function lookup(word, { signal, fetchImpl = globalThis.fetch } = {}) {
  const q = word.trim().toLowerCase();
  if (!q) return { senses: [], phonetic: '', audio: '' };
  const res = await fetchImpl(ENDPOINT + encodeURIComponent(q), { signal });
  if (res.status === 404) return { senses: [], phonetic: '', audio: '' };
  if (!res.ok) throw new Error(`Dictionary lookup failed (${res.status})`);
  return parseEntries(await res.json());
}

// ------------------------------------------------ picking the meaning used in the sentence

const STOPWORDS = new Set(
  ('a an the and or but if of to in on at by for with from as is are was were be been being it its ' +
    'this that these those he she they we you i his her their our your my me him them us not no so ' +
    'than then there here what which who whom whose when where why how all any some such into over ' +
    'about after before very can could would should will may might must do does did has have had ' +
    'one something someone especially often usually used etc').split(' '),
);

function contentWords(text, exclude = '') {
  const skip = exclude.toLowerCase();
  return new Set(
    (text.toLowerCase().match(/\p{L}+/gu) || [])
      .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !w.startsWith(skip))
      .map((w) => w.replace(/(ies|es|s)$/, '')),
  );
}

/** Rough part-of-speech guess from the words around `word` in `context`. */
export function guessPos(context, word) {
  const text = (context || '').toLowerCase();
  const w = (word || '').trim().toLowerCase();
  if (!text || !w) return '';
  const i = text.indexOf(w);
  if (i < 0) return '';
  const before = text.slice(0, i).match(/(\p{L}+)\W*$/u)?.[1] || '';
  if (/^(to|will|would|can|could|should|must|might|may|did|does|do|not)$/.test(before)) return 'verb';
  if (/^(very|so|too|more|most|less|quite|rather|extremely)$/.test(before)) return 'adjective';
  if (/\p{L}{3}ly$/u.test(w)) return 'adverb';
  return '';
}

/**
 * Index of the sense most likely meant in `context`: shared content words with
 * the definition/example, plus a small bonus when the part of speech fits.
 * Falls back to the first (usually most common) sense.
 */
export function bestSense(senses, context, word) {
  if (!senses.length) return -1;
  if (!context) return 0;
  const ctx = contentWords(context, word);
  const pos = guessPos(context, word);
  let best = 0;
  let bestScore = 0;
  senses.forEach((s, i) => {
    let score = 0;
    for (const t of contentWords(`${s.definition} ${s.example} ${s.synonyms?.join(' ') || ''}`, word)) {
      if (ctx.has(t)) score += 1;
    }
    if (pos && s.pos === pos) score += 0.5;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
