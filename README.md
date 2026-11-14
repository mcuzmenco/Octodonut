# WordRecall

Remember the English words you meet while reading.

Save a new word **together with the sentence you found it in**. WordRecall then quizzes
you at the moment you're about to forget it, so every review counts and you only need a few
minutes a day.

It's an installable web app (PWA). It works offline on phone and desktop, has no account
and no server, and your data stays in your browser.

## The method

| Technique | How WordRecall uses it | Evidence |
|---|---|---|
| **Spaced repetition** | Each review is scheduled for when your recall chance drops to your target (90% by default). The gaps between reviews grow from days to months. | The spacing effect is among the most replicated findings in memory research (Ebbinghaus 1885; Cepeda et al. 2006 meta-analysis). |
| **FSRS memory model** | Tracks *stability*, *difficulty* and *retrievability* for every card. FSRS is the open-source scheduler that Anki now ships by default. It predicts recall better than the older SM-2 algorithm. | Ye et al., *A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling* (KDD 2022); [open-spaced-repetition benchmark](https://github.com/open-spaced-repetition/srs-benchmark). |
| **Active recall** | You always try to retrieve the meaning (or the word) *before* you see it. | The testing effect: Roediger & Karpicke 2006; Karpicke & Roediger 2008. |
| **Learning in context** | The word is shown inside the real sentence where you met it, and later as a fill-in-the-blank. | Context-rich, meaningful encoding beats isolated word lists (levels of processing: Craik & Lockhart 1972). |
| **Recognition → production** | Once you reliably know the meaning, a second card asks you to *type the word* from its meaning. This harder retrieval moves the word into your active vocabulary. | Desirable difficulties (Bjork 1994); productive retrieval helps vocabulary learning (Nation, *Learning Vocabulary in Another Language*). |
| **Interleaving** | Due reviews are shuffled, and new words are spread through them. | Interleaved practice improves retention (Rohrer & Taylor 2007). |
| **Elaboration** | An optional "memory hook" field for your own sentence or association. | Generation effect (Slamecka & Graf 1978); self-reference effect. |

## Features

- **Fast capture.** A **"Save word" bookmarklet** grabs the selected word, its whole
  sentence and the page title from any web page. On Android, install the app and use
  **Share → WordRecall**.
- **Dictionary lookup** (free [dictionaryapi.dev](https://dictionaryapi.dev)). You pick the
  meaning that matches your sentence, and pronunciation audio is included.
- **Review screen** with keyboard shortcuts: `Space` reveals the answer, `1–4` rates
  Again/Hard/Good/Easy, and `Z` undoes. Each rating button shows when you'll see the word
  next.
- **"Again" relearning.** A word you fail comes back a few cards later in the same session.
- **Stats:** a 7-day forecast, your actual recall rate, a streak count and strong-word count.
- **Settings:** target recall (80–95%), new words per day, and maximum reviews per day.
- **Backups:** export and import as JSON. Do this regularly, because browser storage can be
  cleared.

## Run it

You need Node 20.11 or newer. There are no dependencies to install.

```bash
npm start      # http://localhost:5173
npm test       # scheduler, queue, text-matching and storage tests
```

You can also serve the `app/` folder with any static file server.

### Put it on your phone (GitHub Pages)

The workflow in `.github/workflows/pages.yml` runs the tests and publishes `app/` on every
push to `main`. To turn it on:

1. Go to **Settings → Pages** on GitHub.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open the published URL on your phone and choose **Add to Home Screen** / **Install app**.
4. Open the app's **Stats** page to get the bookmarklet for that URL.

Each browser keeps its own data. If you use more than one device, move your words with
export/import.

## Project layout

```
app/                 the web app (static files, no build step)
  js/fsrs.js         FSRS v4.5 scheduler (pure, tested)
  js/session.js      daily queue: limits, sibling burying, interleaving
  js/store.js        localStorage persistence and backup validation
  js/text.js         find/blank the word in its sentence, check typed answers
  js/dictionary.js   dictionary lookup
  js/app.js          UI
  sw.js              offline cache
tests/               node:test suites
scripts/serve.js     zero-dependency dev server
```

## Ideas for later

- Fit personal FSRS weights from your review log. The log is already recorded with each
  review.
- Sync between devices (e.g. via a gist or a small backend).
- Kindle "Vocabulary Builder" import.
