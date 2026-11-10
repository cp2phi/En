# Content guide: how to write questions and prompts

Read this before adding to `questions/` or `prompts/`.

## The learner

A Chinese-speaking IT professional living in New Zealand. Intermediate English:
recognises most common words but struggles to *produce* them, to understand a
familiar word in a new sense ("run a meeting", "in the zone", "settle up"), to
pick natural collocations, and to spell longer words ("postponed"). Preparing
for an improv class and Toastmasters.

Write for that person: natural, everyday, spoken-style English that a colleague
or friend in NZ would actually say. British/NZ spelling first, American spelling
as an accepted alternative when they differ. No textbook stiffness, no rare
literary words, nothing offensive.

## Cloze questions: `questions/<word class>/<file>.json`

Each file is a JSON array, one question per line:

```json
{"id":"v-work-01","level":2,"g":"3sg","zh":"她每周一主持团队例会。","en":"She {runs|chairs|leads} the team meeting every Monday."}
```

- `id`: `<prefix>-<file name>-<number>`, unique, never reused. Numbers are
  zero-padded (01, 02 … or 001 … when a file has 100+).
- `level`: 1 (very common) to 5 (hard). Aim for roughly 15% L1, 30% L2, 30% L3,
  18% L4, 7% L5.
- `g`: a short grammar tag for the blank: `base`, `3sg`, `past`, `ing`,
  `perfect`, `passive`, `plural`, `singular`, `comparative`, or `-` when not relevant.
- `zh`: natural Chinese that makes the missing English word inferable. If the
  English tense is not obvious from the Chinese, add a time word to both
  sentences (昨天 / yesterday).
- `en`: the English sentence. Each `{...}` is one blank.
  - `|` separates accepted answers; the first is the best one and gives the
    first-letter hint. List every answer a fluent speaker would accept in that
    exact sentence, in the exact form required (same tense and number).
    Do not list an alternative that needs a different preposition or article.
  - Answers contain only letters, spaces, apostrophes and hyphens.
  - A blank may hold several words (`{settled up}`, `{would have gone}`).
  - A sentence may have two blanks, but one blank is the norm.
  - Cue: `{went::go}` shows "go" to the learner instead of the first letter.
    Use cues in grammar drills (base verb or base noun in the cue).
- Mix the forms being tested (tenses, third person, plurals) across a file.
- Every sentence must be unique within the word class. Prefer the *useful*
  sense of a common word over an obscure word.
- No Chinese inside `en`. No blank at a position where many unrelated words fit.

Check your folder (must print `OK`):

```bash
python3 tools/check_bank.py questions/<word class>
```

## Practice prompts: `prompts/<module>/<file>.json`

Each file is a JSON array, one prompt per line:

```json
{"id":"i-teamwork-01","level":2,"task":"Your scene partner says the line below. Accept it and add one new detail. Start with \"Yes, and...\"","say":"I brought the elephant you ordered.","zh":"接受对方的话，并加一个新的细节。"}
```

- `id`: `<prefix>-<file name>-<number>`, unique.
- `level`: 1 to 6 (difficulty of the speaking or writing task).
- `task`: the instruction in simple English, one to three sentences.
- `zh`: the same instruction in Chinese (for translation tasks, the Chinese
  sentence to translate).
- `say` (optional): an English line the app reads aloud before the learner
  answers — a scene partner's line, a sentence to repeat, a Table Topics
  question.
- Topics should be varied: work, IT, food, sport, shopping, travel, health,
  home, friends, money, feelings, opinions, New Zealand life. Never the same
  idea twice in a file.

Check your folder (must print `OK`):

```bash
python3 tools/check_bank.py prompts/<module>
```
