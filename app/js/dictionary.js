// Definitions from the free Dictionary API (https://dictionaryapi.dev), no key needed.

const ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

export function parseEntries(entries) {
  const senses = [];
  let phonetic = '';
  let audio = '';
  for (const e of Array.isArray(entries) ? entries : []) {
    const phonetics = Array.isArray(e.phonetics) ? e.phonetics : [];
    phonetic ||= e.phonetic || phonetics.find((p) => p.text)?.text || '';
    audio ||= phonetics.find((p) => p.audio)?.audio || '';
    for (const m of e.meanings || []) {
      for (const d of m.definitions || []) {
        if (d.definition) {
          senses.push({ pos: m.partOfSpeech || '', definition: d.definition, example: d.example || '' });
        }
      }
    }
  }
  if (audio.startsWith('//')) audio = `https:${audio}`;
  return { senses, phonetic, audio };
}

export async function lookup(word, { signal } = {}) {
  const q = word.trim().toLowerCase();
  if (!q) return { senses: [], phonetic: '', audio: '' };
  const res = await fetch(ENDPOINT + encodeURIComponent(q), { signal });
  if (res.status === 404) return { senses: [], phonetic: '', audio: '' };
  if (!res.ok) throw new Error(`Dictionary lookup failed (${res.status})`);
  return parseEntries(await res.json());
}
