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
  - No base-form hints: the learner sees only the first letter of the main
    answer (prepositions show nothing), so grammar drills test the word and
    its form together. The Chinese must therefore make the word itself clear,
    and every alternative with the right form must be listed (went|walked|drove
    if 去了 could be any of them).
- Mix the forms being tested (tenses, third person, plurals) across a file.
- `note` (optional; required for `questions/particle/`): one short sentence
  in simple English (4–45 words) explaining the meaning or why that word is
  used, shown after the learner answers. E.g. "In New Zealand, down means
  south. Hamilton is south of Auckland, so you go down to Hamilton."
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
- `example` (optional; required for small talk): one natural model answer
  shown after the learner replies, 1–3 short sentences (3–60 words), the way
  a friendly New Zealander would really say it. English only.

Tracks are declared in `prompts/<module>/_meta.json`. Besides `name` and the
timing lights (`green`, `yellow`, `red` in seconds), a track may set `group`
(a heading for its button row, e.g. "Small talk") and `focus` (which AI
feedback style to use, e.g. "smalltalk"). In a ladder module only tracks named
`l1`…`l6` are levels that unlock; other tracks are always open.

Small-talk prompts (`prompts/speak/st_*.json`): `say` is the other person's
line, `task` names who they are, the learner's situation if it matters, and
the kind of reply wanted (answer + detail + ask back, react, follow-up
question, compliment, polite disagreement, deflect, exit), and `example` is
always present.
- Topics should be varied: work, IT, food, sport, shopping, travel, health,
  home, friends, money, feelings, opinions, New Zealand life. Never the same
  idea twice in a file.

Check your folder (must print `OK`):

```bash
python3 tools/check_bank.py prompts/<module>
```
