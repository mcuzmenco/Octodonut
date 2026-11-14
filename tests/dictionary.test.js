import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEntries, bestSense, guessPos, lookup } from '../app/js/dictionary.js';

const bank = [
  { pos: 'noun', definition: 'An institution where one can place and borrow money and take care of financial affairs.', example: 'I deposited my salary at the bank.', synonyms: [] },
  { pos: 'noun', definition: 'An edge of river, lake, or other watercourse.', example: '', synonyms: ['shore'] },
  { pos: 'verb', definition: 'To deposit money or valuables in a financial institution.', example: '', synonyms: [] },
];

test('collects synonyms per sense, including meaning-level ones', () => {
  const { senses } = parseEntries([
    {
      word: 'kerfuffle',
      meanings: [
        {
          partOfSpeech: 'noun',
          synonyms: ['fracas', 'hubbub'],
          definitions: [{ definition: 'A commotion.', synonyms: ['brouhaha', 'fracas'] }, { definition: '' }],
        },
      ],
    },
  ]);
  assert.equal(senses.length, 1, 'empty definitions are skipped');
  assert.deepEqual(senses[0].synonyms, ['brouhaha', 'fracas', 'hubbub']);
});

test('prefers pronunciation audio that has matching text', () => {
  const r = parseEntries([{ phonetics: [{ audio: 'https://x/au.mp3' }, { text: '/x/', audio: 'https://x/uk.mp3' }], meanings: [] }]);
  assert.equal(r.audio, 'https://x/uk.mp3');
  assert.equal(r.phonetic, '/x/');
});

test('picks the sense that matches the sentence', () => {
  assert.equal(bestSense(bank, 'We had a picnic on the bank of the river.', 'bank'), 1);
  assert.equal(bestSense(bank, 'She walked to the bank to get money.', 'bank'), 0);
  assert.equal(bestSense(bank, 'I need to bank this cheque today.', 'bank'), 2, 'part of speech breaks the tie');
});

test('falls back to the first sense', () => {
  assert.equal(bestSense(bank, '', 'bank'), 0);
  assert.equal(bestSense(bank, 'Nothing related here at all.', 'bank'), 0);
  assert.equal(bestSense([], 'x', 'bank'), -1);
});

test('guesses part of speech from neighbouring words', () => {
  assert.equal(guessPos('They tried to obfuscate the issue.', 'obfuscate'), 'verb');
  assert.equal(guessPos('It was very ubiquitous.', 'ubiquitous'), 'adjective');
  assert.equal(guessPos('He spoke tersely.', 'tersely'), 'adverb');
  assert.equal(guessPos('The kerfuffle ended.', 'kerfuffle'), '');
});

test('lookup handles found, not found and errors', async () => {
  const fake = (status, body) => async () => ({ status, ok: status < 400, json: async () => body });
  const found = await lookup('Ubiquitous ', { fetchImpl: fake(200, [{ meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Everywhere.' }] }] }]) });
  assert.equal(found.senses[0].definition, 'Everywhere.');
  assert.deepEqual((await lookup('zzzz', { fetchImpl: fake(404, {}) })).senses, []);
  await assert.rejects(lookup('x', { fetchImpl: fake(500, {}) }), /500/);
  let url;
  await lookup('take for granted', { fetchImpl: async (u) => ((url = u), { status: 404 }) });
  assert.match(url, /take%20for%20granted$/);
});
