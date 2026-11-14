import test from 'node:test';
import assert from 'node:assert/strict';
import { splitOnWord, isCorrectAnswer, containsWord, formatInterval } from '../app/js/text.js';
import { parseEntries } from '../app/js/dictionary.js';

const matches = (text, word) => splitOnWord(text, word).filter((s) => s.match).map((s) => s.text);

test('finds the word and simple inflections in context', () => {
  assert.deepEqual(matches('Smartphones are ubiquitous now.', 'ubiquitous'), ['ubiquitous']);
  assert.deepEqual(matches('They were debating it.', 'debate'), ['debating']);
  assert.deepEqual(matches('She carried the box.', 'carry'), ['carried']);
  assert.deepEqual(matches('Ubiquity aside, Ubiquitous things…', 'ubiquitous'), ['Ubiquitous']);
  assert.deepEqual(matches('He gave up on it.', 'give up'), []);
  assert.deepEqual(matches('Please look  into it.', 'look into'), ['look  into']);
});

test('does not match inside other words', () => {
  assert.deepEqual(matches('The scatter was wide.', 'cat'), []);
});

test('segments reassemble the original text', () => {
  const text = 'An ephemeral, truly ephemeral joy.';
  assert.equal(splitOnWord(text, 'ephemeral').map((s) => s.text).join(''), text);
  assert.equal(splitOnWord('', 'x').length, 1);
});

test('answer checking is forgiving about case, accents and the inflected form', () => {
  assert.ok(isCorrectAnswer('  Ubiquitous ', 'ubiquitous'));
  assert.ok(isCorrectAnswer('naive', 'naïve'));
  assert.ok(isCorrectAnswer('debating', 'debate', 'They were debating it.'));
  assert.ok(!isCorrectAnswer('debater', 'debate', 'They were debating it.'));
  assert.ok(!isCorrectAnswer('', 'debate'));
  assert.ok(containsWord('They were debating it.', 'debate'));
});

test('formats intervals', () => {
  assert.equal(formatInterval(1), '1d');
  assert.equal(formatInterval(45), '1.5mo');
  assert.equal(formatInterval(60), '2mo');
  assert.equal(formatInterval(400), '1.1y');
});

test('parses dictionary API responses', () => {
  const res = parseEntries([
    {
      word: 'ubiquitous',
      phonetics: [{ text: '/juːˈbɪkwɪtəs/' }, { audio: '//example.org/u.mp3' }],
      meanings: [
        { partOfSpeech: 'adjective', definitions: [{ definition: 'Being everywhere at once.', example: 'ubiquitous phones' }] },
      ],
    },
  ]);
  assert.equal(res.phonetic, '/juːˈbɪkwɪtəs/');
  assert.equal(res.audio, 'https://example.org/u.mp3');
  assert.deepEqual(res.senses, [{ pos: 'adjective', definition: 'Being everywhere at once.', example: 'ubiquitous phones', synonyms: [] }]);
  assert.deepEqual(parseEntries(null).senses, []);
});

import { parseShared, sentencePieces } from '../app/js/text.js';

test('parses text shared from Kindle and other apps', () => {
  assert.deepEqual(
    parseShared('“It was a quixotic attempt to reform the system.”\n\n— The Great Novel by Jane Author\nhttps://a.co/d/abc123'),
    { word: '', context: 'It was a quixotic attempt to reform the system.', source: 'The Great Novel by Jane Author' },
  );
  assert.deepEqual(
    parseShared('"He gave a perfunctory nod." from Some Book by Someone. Start reading it for free: https://a.co/d/x'),
    { word: '', context: 'He gave a perfunctory nod.', source: 'Some Book by Someone' },
  );
  assert.deepEqual(parseShared('“Serendipity,”'), { word: 'serendipity', context: '', source: '' });
  assert.deepEqual(parseShared('ubiquitous'), { word: 'ubiquitous', context: '', source: '' });
  assert.deepEqual(parseShared('NASA'), { word: 'NASA', context: '', source: '' });
  assert.deepEqual(parseShared('The garden was verdant.\nhttps://x.org/a', 'Spring Gardens'), {
    word: '',
    context: 'The garden was verdant.',
    source: 'Spring Gardens',
  });
  assert.deepEqual(parseShared(''), { word: '', context: '', source: '' });
});

test('splits a sentence into tappable words', () => {
  const pieces = sentencePieces('He gave a “perfunctory” nod.');
  assert.deepEqual(pieces.filter((p) => p.word).map((p) => p.word), ['He', 'gave', 'a', 'perfunctory', 'nod']);
  assert.equal(pieces.map((p) => p.text).join(''), 'He gave a “perfunctory” nod.');
});
