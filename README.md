# English Practice

A local English practice tool for vocabulary, speaking and writing, built to prepare for Improv 101 and Toastmasters.

## Running it

Requires Python 3.10 or later. There are no third-party dependencies.

```bash
python3 run.py          # opens http://127.0.0.1:8765
python3 -m unittest discover -s tests -t .   # runs the tests
```

On first use, enter your OpenAI key in **Settings**. The key is used for AI explanations, writing and speaking feedback, speech-to-text and the natural read-aloud voice. Without a key you can still practise: there is no feedback, speaking sessions record time only, and read-aloud uses the browser's built-in voice.

## Features

The interface is in English. Chinese appears only as learning support: the sentence to translate in cloze and in writing L1, faint translations under example sentences, and a **Show Chinese** link under each practice instruction.

| Page | What it does |
|---|---|
| Cloze | Chinese → English fill-in-the-blank, served continuously. Filter by word class (or grammar topic), scene and level. An answer counts only if the word, its form and its spelling are all right. |
| Wrong book | Every question you have missed, as Chinese/English pairs to read through, or redo them all. |
| Keep writing | A six-level ladder, L1–L6: one-sentence translation → chat message → email → story or opinion → multi-paragraph piece → speech script. Five good sessions on a level unlock the next. You can write a Chinese word where you don't know the English. After you submit you get a natural rewrite, at most three issues that matter, and expressions you can save to the word bank with one click. |
| Keep speaking | A six-level ladder, L1–L6: repeat a sentence → 30 seconds → an experience → an opinion → improvised story or rebuttal → impromptu speech. Recording, a timer and a "stuck" button; your speech is transcribed and you get feedback. |
| Improv | Grouped by the Improv 101 lessons: "Yes, and", spontaneity, storytelling, status, justification, scene set-ups, understanding game rules, and rescue phrases. |
| Toastmasters | Table Topics (with green/yellow/red timing lights), Ice Breaker, evaluations, and meeting-role language. |
| Stats | Rank and XP, streak, words written, typing speed, error rate, speaking time, speaking speed, stuck count, filler words, today vs. the last 7 days vs. the 7 days before, and the last 14 days. |
| Review words | Forgot / Fuzzy / Remembered / Never show again. Due reviews come first, then new words. |
| Add / Capture | Paste a sentence and mark the part you don't understand; the AI explains it and fills in the card, and you tick which notes to keep. |
| Word bank | Browse, search and delete words. |
| Settings | OpenAI key, AI model, daily new-word limit; read-aloud voice (OpenAI natural voice or browser voice), US or UK accent, voice, pace and speech model, with a preview before saving. |
| Sync | Commits the whole repository (code, question banks, practice records, cached audio), pulls what other computers uploaded, and pushes to the git remote. On another computer, `git clone` or `git pull` and carry on. `config.local.json`, which holds the API key, is never uploaded. |

Each practice module has its own question bank and does not draw on your word bank. When you meet an expression you don't know during practice, click **Add to word bank** to keep it.

## Question banks

| Category | Questions | Content |
|---|---|---|
| Verbs | 200 | 10 scenes: work, IT, restaurant, sport, shopping, travel, health, home, social, money |
| Phrasal verbs | 200 | Same 10 scenes |
| Adjectives | 200 | Same 10 scenes |
| Prepositions | 200 | Same 10 scenes (no first-letter hint) |
| Adverbs | 200 | Same 10 scenes |
| Nouns | 500 | Same 10 scenes, 50 per scene |
| Noun phrases | 300 | Same 10 scenes, 30 per scene |
| Other | 200 | Connectors 40, polite language 50, idioms and slang 60, sentence patterns 50 |
| Combos (multiple blanks) | 20 | A verb and a noun blanked in the same sentence |
| Grammar topics | 420 | Past 100, future 40, present continuous 40, subjunctive 40, other common tenses 60, third person 40, plurals 40, other grammar 60. Only the first letter is shown, not the base form, so the word and its form are tested together |

Practice prompts: keep writing 240, keep speaking 240, Improv 250, Toastmasters 160.

## Review rules

- **Forgot**: comes back at least 2 more times the same day, then the next day.
- **Fuzzy**: comes back at least once more the same day; the interval does not grow.
- **Remembered**: intervals of 1, 3, 7, 15, 30, 60, then 120 days.
- **Cloze**: a question answered right the first time does not come back (click **I actually guessed** to put it in the redo queue). A question answered wrong, or whose answer you revealed, is treated as **Forgot**. It passes once you keep getting it right until its interval reaches 15 days.
- Both cloze questions and words can be set to **Never show again**.

## Layout

```
app/         Backend: standard-library HTTP server, spaced repetition, grading, practice and stats, git sync, OpenAI calls
static/      Frontend: plain HTML/JS
questions/   Cloze questions: questions/<word class>/<scene>.json
prompts/     Writing, speaking, Improv and Toastmasters prompts: prompts/<module>/<group>.json
data/        Your practice records; data/journal/ keeps everything you wrote or said, with its feedback
cache/tts/   Generated read-aloud audio (mp3)
docs/        Content guide
tools/       Question bank checker
tests/       Tests
```

`config.local.json` holds the OpenAI key. It is listed in `.gitignore` and also forcibly excluded on every sync, so it is never uploaded. On a new computer, enter the key again in Settings. `cache/tts/` holds the generated read-aloud audio and is uploaded with each sync, so another computer does not need to generate it again. Audio for every cloze sentence is about 60 MB.

## Adding questions

See [docs/content-guide.md](docs/content-guide.md) for the rules. To add a cloze question, add one line to `questions/<word class>/<scene>.json`. The answer goes in `{}`, other accepted answers are separated by `|`, and a sentence can have more than one blank:

```json
{"id":"v-work-01","level":2,"g":"3sg","zh":"她每周一主持团队例会。","en":"She {runs|chairs|leads} the team meeting every Monday."}
{"id":"g-past-001","level":2,"g":"past","zh":"我昨天去了超市。","en":"I {went} to the supermarket yesterday."}
```

Then run `python3 tools/check_bank.py questions/<word class>`; it must print `OK`. Never change an `id` once it has been used, because practice records are linked to it.

## Costs

- Writing and speaking feedback uses `gpt-4o-mini` (changeable in Settings): under 1 US cent per piece.
- Speech-to-text uses `whisper-1`: about USD 0.006 per minute, so two hours of speaking is about USD 0.70.
- The natural read-aloud voice uses `gpt-4o-mini-tts` by default (USD 12 per 1M audio output tokens, about 1.5 US cents per minute). Each sentence is generated once and then played from `cache/tts/`. Listening to all 2440 cloze sentences once costs about USD 2.
- OpenAI shuts `gpt-4o-mini-tts` down on 2027-01-06. From then on the app switches to `gpt-audio-1.5` automatically (about 5 times the price, no shutdown date announced). Audio already cached keeps playing.

## Next steps

- Grow the banks fivefold (1000 verb questions, several thousand noun questions) by adding files that follow the content guide.
- A conversation mode for speaking, with the AI playing a colleague.
