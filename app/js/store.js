// Persistence in localStorage, plus validation for backups.

import { newCard } from './fsrs.js';

export const STORAGE_KEY = 'wordrecall.v1';

export function defaultSettings() {
  return {
    desiredRetention: 0.9,
    newPerDay: 10,
    maxReviews: 200,
    lastBackup: null,
    reminders: true,
    reminderTime: '09:00',
  };
}

export function emptyData() {
  return { version: 1, words: [], log: [], settings: defaultSettings() };
}

const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function normalizeSettings(s = {}) {
  const d = defaultSettings();
  return {
    desiredRetention: num(s.desiredRetention, 0.7, 0.97, d.desiredRetention),
    newPerDay: Math.round(num(s.newPerDay, 0, 200, d.newPerDay)),
    maxReviews: Math.round(num(s.maxReviews, 10, 9999, d.maxReviews)),
    lastBackup: typeof s.lastBackup === 'string' ? s.lastBackup : null,
    reminders: typeof s.reminders === 'boolean' ? s.reminders : d.reminders,
    reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.reminderTime || '') ? s.reminderTime : d.reminderTime,
  };
}

/** Validate and fill in defaults. Throws on data that isn't a WordRecall backup. */
export function normalizeData(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.words)) {
    throw new Error('This file is not a WordRecall backup.');
  }
  const words = obj.words
    .filter((w) => w && typeof w.word === 'string' && w.word.trim() && typeof w.id === 'string')
    .map((w) => {
      const created = w.cards?.recognize?.due || '1970-01-01';
      return {
        context: '',
        source: '',
        definition: '',
        pos: '',
        phonetic: '',
        audio: '',
        note: '',
        synonyms: [],
        createdAt: 0,
        ...w,
        cards: {
          recognize: { ...newCard(created), ...(w.cards?.recognize || {}) },
          produce: { ...newCard(created), ...(w.cards?.produce || {}) },
        },
      };
    });
  return {
    version: 1,
    words,
    log: Array.isArray(obj.log) ? obj.log.filter((e) => e && typeof e === 'object') : [],
    settings: normalizeSettings(obj.settings),
  };
}

export function load(storage = globalThis.localStorage) {
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return emptyData();
  }
  if (!raw) return emptyData();
  try {
    return normalizeData(JSON.parse(raw));
  } catch (err) {
    // Never silently overwrite data we failed to read: park a copy first.
    try {
      storage.setItem(`${STORAGE_KEY}.unreadable-${Date.now()}`, raw);
    } catch {
      /* storage full; nothing more we can do */
    }
    console.error('Could not read saved data', err);
    return emptyData();
  }
}

export function save(data, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createWord(fields, today, now = Date.now()) {
  return {
    id: makeId(),
    word: fields.word.trim(),
    context: (fields.context || '').trim(),
    source: (fields.source || '').trim(),
    definition: (fields.definition || '').trim(),
    pos: (fields.pos || '').trim(),
    phonetic: fields.phonetic || '',
    audio: fields.audio || '',
    note: (fields.note || '').trim(),
    synonyms: Array.isArray(fields.synonyms) ? fields.synonyms.slice(0, 6) : [],
    createdAt: now,
    cards: { recognize: newCard(today), produce: newCard(today) },
  };
}
