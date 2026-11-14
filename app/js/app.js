import { Scheduler, Rating } from './fsrs.js';
import { todayStr, daysBetween, addDays } from './dates.js';
import { load, save, createWord, normalizeData, normalizeSettings } from './store.js';
import {
  buildQueue,
  countNewIntroducedToday,
  countReviewsToday,
  dueCards,
  isProduceUnlocked,
} from './session.js';
import { lookup, bestSense } from './dictionary.js';
import { splitOnWord, containsWord, isCorrectAnswer, formatInterval, parseShared, sentencePieces } from './text.js';
import { planReminders } from './reminders.js';
import {
  isNative,
  onIncomingText,
  onNotificationTap,
  onPause,
  onResume,
  notificationPermission,
  setReminders,
  shareFile,
} from './native.js';

// ---------------------------------------------------------------- state

let data = load();
let scheduler = makeScheduler();
let session = null; // { day, queue, done, revealed, typed, correct, stale, extraNew }
let undoStack = [];
let pendingPrefill = null;
let wordsQuery = '';

function makeScheduler() {
  return new Scheduler({ desiredRetention: data.settings.desiredRetention });
}

function persist() {
  try {
    save(data);
  } catch (err) {
    console.error(err);
    toast('Could not save — browser storage is full or blocked. Export a backup now.', 'error');
  }
  updateBadge();
  scheduleReminders();
}

// Recompute the reminder plan shortly after data changes (batches a burst of ratings).
let reminderTimer;
function scheduleReminders({ now = false } = {}) {
  if (!isNative) return;
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(
    () => setReminders(planReminders(data)).catch((err) => console.warn('Could not schedule reminders', err)),
    now ? 0 : 1500,
  );
}

/** Ask for notification permission once there's something worth reminding about. */
async function maybeAskForNotifications() {
  if (!isNative || !data.settings.reminders || !data.words.length) return;
  if ((await notificationPermission()) === 'prompt') {
    await notificationPermission({ ask: true });
    scheduleReminders({ now: true });
  }
}

const findWord = (id) => data.words.find((w) => w.id === id);
const markStale = () => {
  if (session) session.stale = true;
};

// ---------------------------------------------------------------- DOM helpers

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  if (value !== undefined) el.value = value;
  return el;
}

/** Sentence with the word highlighted (or replaced by a blank). */
function contextEl(text, word, { blank = false } = {}) {
  return h(
    'p',
    { class: 'context' },
    splitOnWord(text, word).map((s) =>
      s.match ? h('mark', { class: blank ? 'blank' : '' }, blank ? '_____' : s.text) : s.text,
    ),
  );
}

function speak(word) {
  const w = typeof word === 'string' ? { word } : word;
  const tts = () => {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(w.word);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  if (w.audio) new Audio(w.audio).play().catch(tts);
  else tts();
}

const canSpeak = (word) => Boolean(word.audio) || 'speechSynthesis' in window;
const speakBtn = (word) =>
  canSpeak(word) &&
  h('button', { class: 'icon-btn', type: 'button', title: 'Pronounce', 'aria-label': 'Pronounce', onclick: () => speak(word) }, '🔊');

let toastTimer;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 6000 : 2500);
}

// ---------------------------------------------------------------- routing

function currentRoute() {
  return (location.hash.slice(1) || 'review').split('/')[0];
}

function route() {
  const [name, arg] = (location.hash.slice(1) || 'review').split('/');
  const tab = name === 'edit' ? 'words' : name;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === tab));
  window.scrollTo(0, 0);
  if (name === 'add') return renderForm(null);
  if (name === 'edit') {
    const w = findWord(arg);
    return w ? renderForm(w) : (location.hash = '#words');
  }
  if (name === 'words') return renderWords();
  if (name === 'stats') return renderStats();
  return renderReview();
}

function updateBadge() {
  const today = todayStr();
  const n = queueFor(today).length;
  const badge = $('#due-badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n === 0;
}

function queueFor(today, extraNew = 0) {
  return buildQueue(data.words, {
    today,
    newPerDay: data.settings.newPerDay + extraNew,
    newIntroducedToday: countNewIntroducedToday(data.log, today),
    maxReviews: data.settings.maxReviews - countReviewsToday(data.log, today),
  });
}

// ---------------------------------------------------------------- review

function startSession() {
  const today = todayStr();
  const sameDay = session && session.day === today;
  // Keep words you just failed: they come back a few cards later.
  const carry = sameDay ? session.queue.filter((i) => i.requeued && findWord(i.wordId)) : [];
  const extraNew = sameDay ? session.extraNew : 0;
  session = {
    day: today,
    queue: [...queueFor(today, extraNew), ...carry],
    done: sameDay ? session.done : 0,
    revealed: false,
    typed: '',
    correct: null,
    stale: false,
    extraNew,
  };
  if (!sameDay) undoStack = [];
}

function renderReview() {
  const today = todayStr();
  if (!session || session.stale || session.day !== today || !session.queue.length) startSession();
  const view = $('#view');
  view.replaceChildren();
  // Keyboard shortcuts should work right after clicking the nav tab.
  const active = document.activeElement;
  if (active && active !== document.body && !view.contains(active)) active.blur();

  if (!session.queue.length) return view.append(renderDone(today));

  const item = session.queue[0];
  const word = findWord(item.wordId);
  if (!word) {
    session.queue.shift();
    return renderReview();
  }

  const left = session.queue.length;
  view.append(
    h(
      'div',
      { class: 'progress' },
      h('span', {}, `${left} to go`),
      h('span', {}, `${session.done} done`),
      undoStack.length ? h('button', { class: 'link-btn', onclick: undo, title: 'Undo (Z)' }, '↶ Undo') : null,
    ),
    h('div', { class: 'progress-bar' }, h('div', { style: `width:${(100 * session.done) / (session.done + left)}%` })),
  );

  const card = item.card === 'produce' ? produceCard(word) : recognizeCard(word);
  view.append(card);

  if (session.revealed) view.append(ratingBar(word, item, today));
  else if (item.card === 'recognize') {
    view.append(
      h('div', { class: 'actions' }, h('button', { class: 'primary big', onclick: reveal }, 'Show meaning')),
      h('p', { class: 'hint' }, 'First try to recall the meaning — even a vague guess helps. Then reveal. (Space)'),
    );
  }
  const input = view.querySelector('input.answer');
  if (input && !session.revealed) input.focus();
}

function recognizeCard(word) {
  const showBack = session.revealed;
  return h(
    'article',
    { class: 'card' },
    h('div', { class: 'card-kind' }, 'What does it mean here?'),
    h('div', { class: 'headword' }, h('span', {}, word.word), speakBtn(word)),
    word.phonetic ? h('div', { class: 'phonetic' }, word.phonetic) : null,
    word.context ? contextEl(word.context, word.word) : null,
    word.source ? h('div', { class: 'source' }, `— ${word.source}`) : null,
    showBack
      ? h(
          'div',
          { class: 'back' },
          h('div', { class: 'definition' }, word.pos ? h('em', { class: 'pos' }, word.pos) : null, ' ', word.definition),
          synonymsEl(word),
          word.note ? h('div', { class: 'note' }, '💡 ', word.note) : null,
        )
      : null,
  );
}

const synonymsEl = (word) =>
  word.synonyms?.length ? h('div', { class: 'similar muted' }, `≈ ${word.synonyms.join(', ')}`) : null;

function produceCard(word) {
  const revealed = session.revealed;
  const hasCloze = word.context && containsWord(word.context, word.word);
  const form = h(
    'form',
    {
      class: 'answer-form',
      onsubmit: (e) => {
        e.preventDefault();
        session.typed = e.target.elements.answer.value;
        session.correct = isCorrectAnswer(session.typed, word.word, word.context);
        reveal();
      },
    },
    h('input', {
      class: 'answer',
      name: 'answer',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      placeholder: 'Type the word…',
      'aria-label': 'Your answer',
    }),
    h('button', { class: 'primary', type: 'submit' }, 'Check'),
    h('button', { class: 'ghost', type: 'submit', onclick: (e) => e.target.form.elements.answer.value = '' }, "I don't know"),
  );

  return h(
    'article',
    { class: 'card' },
    h('div', { class: 'card-kind' }, 'Which word fits?'),
    h('div', { class: 'definition big-def' }, word.pos ? h('em', { class: 'pos' }, word.pos) : null, ' ', word.definition),
    hasCloze ? contextEl(word.context, word.word, { blank: !revealed }) : null,
    revealed
      ? h(
          'div',
          { class: 'back' },
          h(
            'div',
            { class: `verdict ${session.correct ? 'ok' : 'bad'}` },
            session.correct ? '✓ Correct' : session.typed.trim() ? `✗ You wrote “${session.typed.trim()}”` : 'Answer:',
          ),
          h('div', { class: 'headword' }, h('span', {}, word.word), speakBtn(word)),
          word.phonetic ? h('div', { class: 'phonetic' }, word.phonetic) : null,
          synonymsEl(word),
          word.note ? h('div', { class: 'note' }, '💡 ', word.note) : null,
        )
      : form,
  );
}

function ratingBar(word, item, today) {
  const buttons = [];
  if (item.requeued) {
    buttons.push(
      rateBtn(Rating.Again, 'Again', 'soon'),
      rateBtn(Rating.Good, 'Got it', 'done for today'),
    );
  } else {
    const p = scheduler.preview(word.cards[item.card], today);
    buttons.push(
      rateBtn(Rating.Again, 'Again', formatInterval(p[1])),
      rateBtn(Rating.Hard, 'Hard', formatInterval(p[2])),
      rateBtn(Rating.Good, 'Good', formatInterval(p[3])),
      rateBtn(Rating.Easy, 'Easy', formatInterval(p[4])),
    );
  }
  return h(
    'div',
    {},
    h('div', { class: 'ratings' }, buttons),
    h(
      'p',
      { class: 'hint' },
      item.requeued
        ? 'Relearning step — it won’t change the schedule.'
        : 'Be honest: “Again” if you couldn’t recall it. Keys 1–4, Space = Good.',
    ),
  );
}

const rateBtn = (rating, label, sub) =>
  h('button', { class: `rate r${rating}`, onclick: () => rate(rating) }, h('b', {}, label), h('small', {}, sub));

function reveal() {
  session.revealed = true;
  renderReview();
}

function rate(rating) {
  const item = session.queue[0];
  const word = item && findWord(item.wordId);
  if (!word) return;
  const today = todayStr();
  undoStack.push({
    wordId: word.id,
    cardKey: item.card,
    prevCard: { ...word.cards[item.card] },
    logLen: data.log.length,
    queue: session.queue.slice(),
    done: session.done,
  });
  if (undoStack.length > 30) undoStack.shift();

  session.queue.shift();
  if (!item.requeued) {
    const before = word.cards[item.card];
    const res = scheduler.review(before, rating, today);
    word.cards[item.card] = res.card;
    data.log.push({
      wordId: word.id,
      card: item.card,
      rating,
      day: today,
      ts: Date.now(),
      wasNew: before.state === 'new',
      elapsed: res.elapsed,
      stability: before.stability,
      difficulty: before.difficulty,
    });
    persist();
  }
  if (rating === Rating.Again) {
    session.queue.splice(Math.min(3, session.queue.length), 0, { wordId: item.wordId, card: item.card, requeued: true });
  } else {
    session.done++;
  }
  session.revealed = false;
  session.typed = '';
  session.correct = null;
  renderReview();
}

function undo() {
  const u = undoStack.pop();
  if (!u) return;
  const word = findWord(u.wordId);
  if (word) word.cards[u.cardKey] = u.prevCard;
  data.log.length = u.logLen;
  session.queue = u.queue;
  session.done = u.done;
  session.revealed = false;
  session.typed = '';
  session.correct = null;
  persist();
  renderReview();
}

function renderDone(today) {
  const waitingNew = data.words.filter((w) => w.cards.recognize.state === 'new').length;
  const tomorrow = addDays(today, 1);
  const dueTomorrow = data.words.filter((w) => dueCards(w, tomorrow).length).length;

  if (!data.words.length) {
    return h(
      'section',
      { class: 'empty' },
      h('h2', {}, 'Start with the next word you meet'),
      h(
        'p',
        {},
        'When you come across an unfamiliar word while reading, save it together with the sentence it appeared in. ',
        'WordRecall will quiz you at the moments you’re about to forget it — a little before, every time — so each review counts.',
      ),
      h('a', { class: 'button primary big', href: '#add' }, '+ Add your first word'),
      h('p', { class: 'hint' }, 'Tip: install the “Save word” bookmarklet from the Stats tab to capture words straight from web pages.'),
    );
  }

  return h(
    'section',
    { class: 'empty' },
    h('h2', {}, session.done ? 'Done for today 🎉' : 'Nothing due right now'),
    h(
      'p',
      {},
      session.done ? `You reviewed ${session.done} card${session.done === 1 ? '' : 's'}. ` : '',
      'Stopping here is part of the method — spacing reviews out is what makes them stick.',
    ),
    h('p', { class: 'muted' }, `Tomorrow: ${dueTomorrow} word${dueTomorrow === 1 ? '' : 's'} due.`),
    waitingNew
      ? h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              class: 'ghost',
              onclick: () => {
                session.extraNew += 5;
                session.stale = true;
                renderReview();
              },
            },
            `Learn 5 more new words (${waitingNew} waiting)`,
          ),
        )
      : null,
    h(
      'div',
      { class: 'actions' },
      h('a', { class: 'button primary', href: '#add' }, '+ Add a word'),
      undoStack.length ? h('button', { class: 'ghost', onclick: undo }, '↶ Undo last answer') : null,
    ),
  );
}

document.addEventListener('keydown', (e) => {
  if (currentRoute() !== 'review' || !session) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches('input, textarea, select, button, a')) return;
  if (e.key === 'z' || e.key === 'Z') return undo();
  if (!session.queue.length) return;
  const item = session.queue[0];
  if (!session.revealed) {
    if ((e.key === ' ' || e.key === 'Enter') && item.card === 'recognize') {
      e.preventDefault();
      reveal();
    }
    return;
  }
  let rating = null;
  if (e.key === ' ' || e.key === 'Enter') rating = Rating.Good;
  else if (['1', '2', '3', '4'].includes(e.key)) rating = Number(e.key);
  if (rating == null) return;
  e.preventDefault();
  if (item.requeued && rating !== Rating.Again) rating = Rating.Good;
  rate(rating);
});

// ---------------------------------------------------------------- add / edit

function renderForm(existing) {
  const prefill = existing || pendingPrefill || {};
  pendingPrefill = null;
  const extra = {
    phonetic: prefill.phonetic || '',
    audio: prefill.audio || '',
    synonyms: Array.isArray(prefill.synonyms) ? prefill.synonyms : [],
  };
  const view = $('#view');

  const senses = h('div', { class: 'senses' });
  const picker = h('div', { class: 'picker' });
  const status = h('span', { class: 'muted small' });
  const similar = h('div', { class: 'similar small muted' });
  // Fields the dictionary filled in. They may be replaced by a later lookup;
  // anything you type yourself is never overwritten.
  const autoFilled = new Set();
  let controller;
  let lastLookup = existing ? existing.word.trim().toLowerCase() : '';
  let debounce;

  const showSimilar = () => {
    similar.textContent = extra.synonyms.length ? `Similar: ${extra.synonyms.join(', ')}` : '';
  };

  function setAuto(name, value) {
    const el = form.elements[name];
    if (el.value.trim() && !autoFilled.has(name)) return;
    el.value = value;
    if (value) autoFilled.add(name);
    else autoFilled.delete(name);
  }

  function chooseSense(s, button, { manual }) {
    const f = form.elements;
    if (manual) {
      // An explicit pick always wins over what you had in the meaning fields.
      f.definition.value = s.definition;
      f.pos.value = s.pos;
      autoFilled.delete('definition');
      autoFilled.delete('pos');
    } else {
      setAuto('definition', s.definition);
      setAuto('pos', s.pos);
    }
    // No sentence of your own yet? Use the dictionary's example so the cards have context.
    // (Only replaces a sentence the dictionary put there, never one you wrote.)
    const example = s.example && containsWord(s.example, f.word.value) ? s.example : '';
    setAuto('context', example);
    extra.synonyms = s.synonyms || [];
    showSimilar();
    senses.querySelectorAll('.sense').forEach((b) => b.classList.toggle('chosen', b === button));
  }

  async function doLookup({ force = false } = {}) {
    const word = form.elements.word.value.trim();
    if (!word || (!force && word.toLowerCase() === lastLookup)) return;
    lastLookup = word.toLowerCase();
    controller?.abort();
    controller = new AbortController();
    status.textContent = 'Looking up…';
    senses.replaceChildren();
    try {
      const res = await lookup(word, { signal: controller.signal });
      extra.phonetic = res.phonetic;
      extra.audio = res.audio;
      if (!res.senses.length) {
        extra.synonyms = [];
        showSimilar();
        status.textContent = 'No dictionary entry found — write your own definition.';
        return;
      }
      const shown = res.senses.slice(0, 12);
      const buttons = shown.map((s) =>
        h(
          'button',
          { type: 'button', class: 'sense', onclick: (e) => chooseSense(s, e.currentTarget, { manual: true }) },
          s.pos ? h('em', { class: 'pos' }, s.pos) : null,
          ' ',
          s.definition,
          s.example ? h('span', { class: 'example' }, `“${s.example}”`) : null,
        ),
      );
      senses.append(...buttons);
      const userWroteMeaning = form.elements.definition.value.trim() && !autoFilled.has('definition');
      if (userWroteMeaning) {
        status.textContent = 'Dictionary meanings — tap one to use it instead of yours:';
      } else {
        const i = bestSense(shown, form.elements.context.value, word);
        chooseSense(shown[i], buttons[i], { manual: false });
        status.textContent =
          shown.length > 1
            ? 'Filled in from the dictionary. Tap another meaning if it doesn’t match your sentence:'
            : 'Filled in from the dictionary.';
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      lastLookup = '';
      status.textContent = navigator.onLine ? 'Lookup failed — write your own definition.' : 'You’re offline — write your own definition.';
    }
  }

  const field = (label, control, help) =>
    h('label', { class: 'field' }, h('span', { class: 'label' }, label), control, help ? h('span', { class: 'help' }, help) : null);
  const manualEdit = (e) => autoFilled.delete(e.target.name);

  // Shared a whole sentence (the usual case from Kindle)? Tap the word you want to learn.
  function drawPicker() {
    const f = form.elements;
    const show = !existing && f.context.value.trim() && !f.word.value.trim();
    picker.replaceChildren();
    if (!show) return;
    picker.append(
      h('div', { class: 'label' }, 'Tap the word you want to learn'),
      h(
        'p',
        { class: 'context picker-sentence' },
        sentencePieces(f.context.value).map((piece) =>
          piece.word
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'pick',
                  onclick: () => {
                    f.word.value = /^\p{Lu}\p{Ll}+$/u.test(piece.word) ? piece.word.toLowerCase() : piece.word;
                    drawPicker();
                    doLookup({ force: true });
                  },
                },
                piece.text,
              )
            : piece.text,
        ),
      ),
    );
  }

  const form = h(
    'form',
    { class: 'word-form', onsubmit: (e) => onSave(e) },
    h('h2', {}, existing ? 'Edit word' : 'Add a word'),
    picker,
    field(
      'Word or phrase',
      h(
        'div',
        { class: 'row' },
        h('input', {
          name: 'word',
          required: true,
          value: prefill.word || '',
          autocomplete: 'off',
          autocapitalize: 'off',
          placeholder: 'e.g. ubiquitous',
          oninput: () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => doLookup(), 800);
            drawPicker();
          },
          onblur: () => {
            clearTimeout(debounce);
            doLookup();
          },
          onkeydown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              clearTimeout(debounce);
              doLookup({ force: true });
            }
          },
        }),
        h('button', { type: 'button', class: 'ghost', onclick: () => doLookup({ force: true }) }, 'Look up'),
      ),
      existing ? null : 'Meaning, pronunciation and similar words are filled in automatically.',
    ),
    field(
      'Sentence where you found it',
      h('textarea', {
        name: 'context',
        rows: 3,
        value: prefill.context || '',
        oninput: (e) => {
          manualEdit(e);
          drawPicker();
        },
        placeholder: 'Paste or type the sentence from your book or article',
      }),
      'Memories are tied to context: you’ll be quizzed on the word inside this sentence.',
    ),
    h('div', {}, status, senses),
    field('Meaning', h('textarea', { name: 'definition', rows: 2, required: true, value: prefill.definition || '', oninput: manualEdit })),
    similar,
    h(
      'div',
      { class: 'row two' },
      field('Part of speech', h('input', { name: 'pos', value: prefill.pos || '', oninput: manualEdit, placeholder: 'adjective' })),
      field('Source', h('input', { name: 'source', value: prefill.source || '', placeholder: 'Book or article' })),
    ),
    field(
      'Your memory hook (optional)',
      h('textarea', { name: 'note', rows: 2, value: prefill.note || '', placeholder: 'Your own example sentence, a link to a word you know, an image…' }),
      'Writing it in your own words takes 20 seconds and noticeably improves recall (generation effect).',
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'primary big', type: 'submit' }, existing ? 'Save changes' : 'Save word'),
      existing ? h('button', { type: 'button', class: 'danger', onclick: () => onDelete(existing) }, 'Delete') : null,
    ),
  );

  function onSave(e) {
    e.preventDefault();
    clearTimeout(debounce);
    const f = form.elements;
    const fields = {
      word: f.word.value.trim(),
      context: f.context.value.trim(),
      definition: f.definition.value.trim(),
      pos: f.pos.value.trim(),
      source: f.source.value.trim(),
      note: f.note.value.trim(),
    };
    if (!fields.word || !fields.definition) return toast('A word and its meaning are required.', 'error');

    if (existing) {
      if (fields.word.toLowerCase() !== existing.word.toLowerCase()) Object.assign(existing, extra);
      else existing.synonyms = extra.synonyms;
      Object.assign(existing, fields);
      persist();
      markStale();
      toast('Saved.');
      location.hash = '#words';
      return;
    }
    const dup = data.words.find((w) => w.word.toLowerCase() === fields.word.toLowerCase());
    if (dup && !confirm(`“${dup.word}” is already in your list (“${dup.definition}”). Add it again as a separate meaning?`)) return;

    data.words.push(createWord({ ...fields, ...extra }, todayStr()));
    persist();
    markStale();
    requestPersistence();
    maybeAskForNotifications();
    toast(`Saved “${fields.word}”. You’ll meet it in your next review.`);
    renderForm(null);
  }

  view.replaceChildren(form);
  showSimilar();
  drawPicker();
  if (!existing && !picker.childElementCount) form.elements.word.focus();
  if (!existing && prefill.word && !prefill.definition) doLookup();
}

function onDelete(word) {
  if (!confirm(`Delete “${word.word}” and its review history?`)) return;
  data.words = data.words.filter((w) => w.id !== word.id);
  data.log = data.log.filter((e) => e.wordId !== word.id);
  persist();
  markStale();
  location.hash = '#words';
}

// ---------------------------------------------------------------- word list

function wordStatus(w, today) {
  const r = w.cards.recognize;
  if (r.state === 'new') return { label: 'new', cls: 'new' };
  let next = r.due;
  if (isProduceUnlocked(w) && w.cards.produce.due < next) next = w.cards.produce.due;
  const d = daysBetween(today, next);
  const strength = r.stability >= 21 ? 'strong' : r.stability >= 7 ? 'growing' : 'learning';
  return { label: d <= 0 ? 'due' : `next in ${formatInterval(d)}`, cls: d <= 0 ? 'due' : strength, strength };
}

function renderWords() {
  const today = todayStr();
  const view = $('#view');
  const list = h('ul', { class: 'word-list' });

  const draw = () => {
    const q = wordsQuery.trim().toLowerCase();
    const items = data.words
      .filter((w) => !q || w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt);
    list.replaceChildren(
      ...items.map((w) => {
        const st = wordStatus(w, today);
        return h(
          'li',
          {},
          h(
            'a',
            { href: `#edit/${w.id}` },
            h('div', { class: 'wl-top' }, h('b', {}, w.word), w.pos ? h('em', { class: 'pos' }, w.pos) : null, h('span', { class: `chip ${st.cls}` }, st.strength ? `${st.strength} · ${st.label}` : st.label)),
            h('div', { class: 'wl-def' }, w.definition),
          ),
        );
      }),
    );
    if (!items.length) list.append(h('li', { class: 'muted pad' }, data.words.length ? 'No matches.' : 'No words yet.'));
  };

  view.replaceChildren(
    h(
      'div',
      { class: 'list-head' },
      h('h2', {}, `Your words (${data.words.length})`),
      h('a', { class: 'button primary', href: '#add' }, '+ Add'),
    ),
    h('input', {
      type: 'search',
      class: 'search',
      placeholder: 'Search words or meanings',
      value: wordsQuery,
      oninput: (e) => {
        wordsQuery = e.target.value;
        draw();
      },
    }),
    list,
  );
  draw();
}

// ---------------------------------------------------------------- stats & settings

function streak(today) {
  const days = new Set(data.log.map((e) => e.day));
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

function renderStats() {
  const today = todayStr();
  const since = addDays(today, -30);
  const recent = data.log.filter((e) => !e.wasNew && e.day > since);
  const retention = recent.length >= 10 ? `${Math.round((100 * recent.filter((e) => e.rating > 1).length) / recent.length)}%` : '—';
  const strong = data.words.filter((w) => w.cards.recognize.stability >= 21).length;

  const forecast = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    let n = 0;
    for (const w of data.words) {
      for (const key of ['recognize', 'produce']) {
        const c = w.cards[key];
        if (c.state !== 'review' || (key === 'produce' && !isProduceUnlocked(w))) continue;
        if (i === 0 ? c.due <= day : c.due === day) n++;
      }
    }
    forecast.push({ day, n });
  }
  const max = Math.max(1, ...forecast.map((f) => f.n));

  const stat = (label, value, help) => h('div', { class: 'stat', title: help || '' }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));

  const s = data.settings;
  const reminderStatus = h('p', { class: 'help' });
  if (isNative) {
    notificationPermission().then((p) => {
      reminderStatus.textContent =
        p === 'denied'
          ? 'Notifications are turned off for WordRecall. Enable them in Android Settings → Apps → WordRecall → Notifications.'
          : 'Only on days when words are due, with the count. It goes away once you’ve reviewed.';
    });
  }
  const settingsForm = h(
    'form',
    {
      class: 'settings',
      onchange: (e) => {
        const f = e.currentTarget.elements;
        data.settings = normalizeSettings({
          ...data.settings,
          desiredRetention: f.desiredRetention.value,
          newPerDay: f.newPerDay.value,
          maxReviews: f.maxReviews.value,
          ...(f.reminders ? { reminders: f.reminders.checked, reminderTime: f.reminderTime.value } : {}),
        });
        if (data.settings.reminders) maybeAskForNotifications();
        scheduler = makeScheduler();
        persist();
        markStale();
        toast('Settings saved.');
      },
      onsubmit: (e) => e.preventDefault(),
    },
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'label' }, 'Target recall'),
      h(
        'select',
        { name: 'desiredRetention', value: String(s.desiredRetention) },
        [
          ['0.8', '80% — fewest reviews'],
          ['0.85', '85%'],
          ['0.9', '90% — recommended'],
          ['0.95', '95% — many more reviews'],
        ].map(([v, t]) => h('option', { value: v }, t)),
      ),
      h('span', { class: 'help' }, 'Reviews are scheduled when your chance of remembering drops to this level.'),
    ),
    h(
      'div',
      { class: 'row two' },
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'New words per day'), h('input', { name: 'newPerDay', type: 'number', min: 0, max: 200, value: s.newPerDay })),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Max reviews per day'), h('input', { name: 'maxReviews', type: 'number', min: 10, max: 9999, value: s.maxReviews })),
    ),
    isNative
      ? h(
          'div',
          { class: 'field' },
          h('span', { class: 'label' }, 'Daily reminder'),
          h(
            'div',
            { class: 'reminder-row' },
            h('label', { class: 'check' }, h('input', { name: 'reminders', type: 'checkbox', checked: s.reminders }), 'Remind me at'),
            h('input', { name: 'reminderTime', type: 'time', value: s.reminderTime, 'aria-label': 'Reminder time' }),
          ),
        )
      : null,
    isNative ? reminderStatus : null,
  );
  // <select value> isn't an attribute; set it after options exist.
  settingsForm.elements.desiredRetention.value = String(s.desiredRetention);

  const backupAge = s.lastBackup ? daysBetween(s.lastBackup, today) : null;

  $('#view').replaceChildren(
    h('h2', {}, 'Progress'),
    h(
      'div',
      { class: 'stats-grid' },
      stat('words', data.words.length),
      stat('strong', strong, 'Remembered for 3+ weeks at a time'),
      stat('due today', queueFor(today, session?.day === today ? session.extraNew : 0).length),
      stat('recall rate (30d)', retention, 'Share of reviews you got right. Close to your target = the scheduler is calibrated.'),
      stat('day streak', streak(today)),
      stat('reviews today', data.log.filter((e) => e.day === today).length),
    ),
    h('h3', {}, 'Next 7 days'),
    h(
      'div',
      { class: 'forecast' },
      forecast.map((f, i) =>
        h(
          'div',
          { class: 'bar-col', title: `${f.n} reviews` },
          h('div', { class: 'bar-n' }, f.n || ''),
          h('div', { class: 'bar', style: `height:${(100 * f.n) / max}%` }),
          h('div', { class: 'bar-day' }, i === 0 ? 'today' : new Date(`${f.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })),
        ),
      ),
    ),

    h('h3', {}, 'Capture words while reading'),
    ...(isNative
      ? [
          h('p', {}, h('b', {}, 'Kindle: '), 'select the sentence with the word → ', h('b', {}, 'Share'), ' → ', h('b', {}, 'WordRecall'), ', then tap the word.'),
          h('p', {}, h('b', {}, 'Other apps: '), 'select text → ', h('b', {}, '⋮'), ' → ', h('b', {}, 'Save to WordRecall'), ', or use Share.'),
        ]
      : [
          h(
            'p',
            {},
            'Drag this button to your bookmarks bar. On any web page, select a word and click it — the word, its sentence and the page title are filled in for you.',
          ),
          h('p', {}, bookmarkletLink()),
        ]),

    h('h3', {}, 'Settings'),
    settingsForm,

    h('h3', {}, 'Backup'),
    h(
      'p',
      { class: backupAge == null || backupAge > 14 ? 'warn' : 'muted' },
      isNative ? 'Your words are stored only on this phone. ' : 'Your words are stored only in this browser. ',
      backupAge == null ? 'You haven’t exported a backup yet.' : `Last backup: ${backupAge === 0 ? 'today' : `${backupAge} days ago`}.`,
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'ghost', onclick: exportData }, '⬇ Export backup'),
      h('label', { class: 'button ghost' }, '⬆ Import backup', h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importData })),
    ),

    h('h3', {}, 'How it works'),
    howItWorks(),
  );
}

function bookmarkletLink() {
  const appUrl = location.origin + location.pathname;
  const code =
    `(()=>{const s=getSelection();const w=String(s).trim();let c='';try{` +
    `const n=s.anchorNode;const el=n&&(n.nodeType===1?n:n.parentElement);` +
    `const b=el&&(el.closest('p,li,blockquote,dd,td,figcaption,h1,h2,h3,h4')||el);const t=b?b.innerText:'';` +
    `const i=t.indexOf(w);if(w&&i>=0){let a=i,e=i+w.length;` +
    `while(a>0&&!/[.!?\\n]/.test(t[a-1]))a--;while(e<t.length&&!/[.!?\\n]/.test(t[e]))e++;` +
    `c=t.slice(a,Math.min(e+1,t.length)).trim();}}catch(x){}` +
    `window.open(${JSON.stringify(appUrl)}+'?word='+encodeURIComponent(w)+'&context='+encodeURIComponent(c)+'&source='+encodeURIComponent(document.title),'_blank');})()`;
  return h(
    'a',
    { class: 'button bookmarklet', href: `javascript:${code}`, onclick: (e) => { e.preventDefault(); toast('Drag me to your bookmarks bar.'); } },
    '＋ Save word',
  );
}

function howItWorks() {
  const item = (title, text) => h('li', {}, h('b', {}, title), ' — ', text);
  return h(
    'ul',
    { class: 'science' },
    item('Spaced repetition', 'each review is timed for just before you would forget, using the FSRS memory model (the scheduler Anki now uses). Every successful recall makes the memory more stable, so gaps grow from days to months.'),
    item('Active recall', 'you always try to retrieve the answer before seeing it. Retrieval strengthens memory far more than re-reading (the “testing effect”).'),
    item('Context', 'you’re quizzed on the word inside the sentence where you actually met it, which ties the new word to a meaningful memory.'),
    item('Both directions', 'once you recognize a word reliably, you also have to produce it from its meaning — harder, and that difficulty is what moves the word into your active vocabulary.'),
    item('Interleaving', 'reviews are shuffled rather than in a fixed order, so you can’t lean on the previous card.'),
    item('Elaboration', 'your own sentence or memory hook gives the word extra connections to things you already know.'),
    item('Honest grading', 'the model adapts to your ratings. Press “Again” whenever you couldn’t recall it — the word simply comes back sooner.'),
  );
}

async function exportData() {
  const today = todayStr();
  const name = `wordrecall-backup-${today}.json`;
  const json = JSON.stringify(data, null, 2);
  if (isNative) {
    try {
      await shareFile(name, json);
      data.settings.lastBackup = today;
      persist();
      renderStats();
    } catch (err) {
      if (!/cancel/i.test(err?.message || '')) toast(`Backup failed: ${err.message || err}`, 'error');
    }
    return;
  }
  data.settings.lastBackup = today;
  persist();
  const blob = new Blob([json], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  renderStats();
}

async function importData(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = normalizeData(JSON.parse(await file.text()));
    if (!confirm(`Replace your current ${data.words.length} words with ${incoming.words.length} words from this backup?`)) return;
    data = incoming;
    scheduler = makeScheduler();
    session = null;
    persist();
    toast(`Imported ${incoming.words.length} words.`);
    renderStats();
  } catch (err) {
    toast(err.message || 'Could not read that file.', 'error');
  }
}

async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}

// ---------------------------------------------------------------- startup

function readIncomingWord() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].some((k) => ['word', 'context', 'text', 'title'].includes(k))) return;
  // Bookmarklet sends word/context/source; the web share target sends text/title.
  const shared = parseShared(p.get('text') || '', p.get('title') || '');
  pendingPrefill = {
    word: (p.get('word') || '').trim() || shared.word,
    context: (p.get('context') || '').trim() || shared.context,
    source: (p.get('source') || '').trim() || shared.source,
  };
  history.replaceState(null, '', `${location.pathname}#add`);
}

function openAddForm(prefill) {
  pendingPrefill = prefill;
  if (location.hash === '#add') route();
  else location.hash = '#add';
}

readIncomingWord();
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  // Pick up the next study day if the tab has been open overnight.
  if (document.visibilityState === 'visible') {
    updateBadge();
    if (currentRoute() === 'review' && session && session.day !== todayStr()) renderReview();
  }
});
window.addEventListener('storage', (e) => {
  if (e.key && e.key.startsWith('wordrecall')) {
    data = load();
    scheduler = makeScheduler();
    markStale();
    route();
    updateBadge();
  }
});
updateBadge();
route();

if (isNative) {
  onIncomingText(({ text, subject }) => openAddForm(parseShared(text, subject)));
  onNotificationTap(() => {
    location.hash = '#review';
  });
  onResume(() => {
    updateBadge();
    if (currentRoute() === 'review' && session && session.day !== todayStr()) renderReview();
    scheduleReminders({ now: true });
  });
  onPause(() => scheduleReminders({ now: true }));
  scheduleReminders({ now: true });
  maybeAskForNotifications();
} else if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker failed', err));
}
