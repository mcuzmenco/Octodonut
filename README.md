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
- **Automatic fill-in** from the free [dictionaryapi.dev](https://dictionaryapi.dev), which
  is built from Wiktionary. It needs no key and handles phrases and inflected forms. As you
  type a word, the app fills in:
  - the meaning that best fits your sentence (one tap picks a different one)
  - part of speech, pronunciation and audio
  - similar words, shown on the review card after you answer
  - a sample sentence, if you didn't give one

  Anything you typed yourself is never overwritten.
- **Review screen** with keyboard shortcuts: `Space` reveals the answer, `1–4` rates
  Again/Hard/Good/Easy, and `Z` undoes. Each rating button shows when you'll see the word
  next.
- **"Again" relearning.** A word you fail comes back a few cards later in the same session.
- **Stats:** a 7-day forecast, your actual recall rate, a streak count and strong-word count.
- **Settings:** target recall (80–95%), new words per day, and maximum reviews per day.
- **Backups:** export and import as JSON. Do this regularly, because browser storage can be
  cleared.

## Android app

The same web app is packaged as an Android app with [Capacitor](https://capacitorjs.com).
The app adds:

- **Daily reminder** at 9:00 (changeable in Stats → Settings). The phone schedules it
  itself, with no server. It shows how many words are due, goes away once you've
  reviewed, and skips days with nothing due.
- **Save from Kindle.** Select the sentence → **Share** → **WordRecall**, then tap the word.
  Other apps also get **Save to WordRecall** in the text-selection menu.
- Backups go through the Android share sheet (Drive, Files, email…).

**Install:** on your phone, open the
[latest Android release](../../releases/tag/android-latest) and tap **WordRecall.apk**. Builds
from other branches go to [android-preview](../../releases/tag/android-preview). Every
build is signed with the same key, so updates install over the old version and keep
your words.

> The signing key (`android/wordrecall-dev.keystore`) is in the repository for
> convenience. That's fine for a personal app you install yourself. To use a private
> key instead, add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
> `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` as repository secrets. Switching keys
> means uninstalling once, so export a backup first.

Build locally (needs the Android SDK and Java 21):

```bash
npm run android:build   # → android/app/build/outputs/apk/release/app-release.apk
```

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
  js/reminders.js    plans the daily reminder notifications
  js/native.js       Android features (no-ops on the website)
  js/app.js          UI
  vendor/            Capacitor's bridge script
  sw.js              offline cache
android/             Capacitor Android project (share/selection intents in MainActivity)
tests/               node:test suites
scripts/serve.js     zero-dependency dev server
```

## Ideas for later

- Fit personal FSRS weights from your review log. The log is already recorded with each
  review.
- Sync between devices (e.g. via a gist or a small backend).
- Kindle "Vocabulary Builder" import.
