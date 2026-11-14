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
