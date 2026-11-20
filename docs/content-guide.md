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
  zero-padded (01, 02 … or 001 … for a new file that will have 100+). When an
  existing file grows past 99, keep counting (99, 100, 101 …) and never renumber:
  practice progress is stored by id.
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

## Sentence translation: `translate/<sentence type>.json`

Whole-sentence Chinese → English. The learner types the full English sentence;
the AI checks it against the reference, so any correct, natural translation
passes. One file per sentence type, each a JSON array with one sentence per line:

```json
{"id":"t-passive-01","level":1,"scene":"work","zh":"会议推迟到下周了。","en":"The meeting's been pushed back to next week.","alt":["The meeting has been postponed until next week."],"point":"中文没有“被”，英文也要用被动：has been pushed back"}
```

- `id`: `t-<file name>-NN`, numbered 01–60 in file order: L1 first (01–20),
  then L2 (21–40), then L3 (41–60).
- `level`: 1–3, exactly 20 per level.
  - **L1**: one short clause, 3–10 English words, very common words. The
    pattern in its plainest form.
  - **L2**: 8–16 words, adds a detail (time, reason, a second short clause).
  - **L3**: 14–28 words, two or three clauses, real work-email or meeting
    register, a collocation or idiom a fluent speaker would use.
- `scene`: one of `work`, `tech`, `restaurant`, `sports`, `shopping`, `travel`,
  `health`, `home`, `social`, `money`. **Exactly 2 per scene in each level.**
- `zh`: natural Chinese the way a Chinese speaker would really say it, not
  Chinese written to mirror the English. The point of the exercise is the gap
  between the two. If the English tense is not clear from the Chinese, add a
  time word (昨天、已经、下周).
- `en`: the best translation: natural spoken NZ English, contractions where
  people use them, British/NZ spelling. Ends with `.` `?` or `!`.
- `alt` (optional, up to 3): other common correct translations that differ in
  structure or a key word, not just punctuation or a contraction. The AI accepts
  any correct answer anyway; `alt` shows the learner other ways to say it.
- `point`: Chinese, one line (4–60 characters): what this sentence trains,
  i.e. the trap a Chinese speaker falls into, e.g. “‘有’ 在这里不是 have，要用 there's”.
  Shown with the answer.
- Every `zh` and every `en` is unique across all files. Vary the vocabulary;
  do not reuse the same idea in another scene.

Sentence types (file names):

| File | Type | What to train |
|---|---|---|
| `subjectless` | 无主语句 & 省略 | 下雨了 / 该走了 / 到了吗 / 好了 / 来不及了 / 不用了: English needs a subject (it, we, I, you) and often a different verb |
| `topic` | 话题句 & 把字句 | 这件事我来处理 / 把门关上 / 那个报告你看了吗 / 钱我已经转了: put the object back after the verb, pick the right verb |
| `existential` | “有”字句 & 存在句 | 有人找你 / 这附近有超市吗 / 我们公司有200人 / 有没有更便宜的: there is/are, have/got, someone's here, is there any |
| `questions` | 疑问句 | wh-questions, yes/no, tag questions (isn't it?), indirect questions (Do you know where…, I was wondering if…), negative questions (Didn't you…?) |
| `polite` | 礼貌请求与建议 | Could you / Would you mind / Is it OK if I / Shall we / How about / Do you want me to / I'd suggest: requests, offers, suggestions, softened refusals |
| `relative` | 定语从句 | 我昨天买的那本书 → the book I bought yesterday; who/which/that/where/whose, reduced clauses, “the one that…” |
| `time_if` | 时间与条件从句 | when / before / after / until / as soon as / once / if / unless / in case; future meaning with present tense after when/if |
| `reason_contrast` | 因果与让步 | because / so / since / that's why / although / even though / but / though at the end; never “although … but” |
| `tense` | 时态 | 过去、现在完成 (have been / have done / have been doing)、过去进行、将来 (going to / will / present continuous for plans), 已经/还没/一直/刚 |
| `passive` | 被动 | 中文常不用“被”: 会议取消了, 你的包裹送到了, 饭做好了, get + past participle, 被动 + by |
| `compare` | 比较 | -er/more, as … as, not as … as, the most, much/a bit/way + comparative, the same as, different from, prefer … to, the more … the more |

Check (must print `OK`):

```bash
python3 tools/check_bank.py translate
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

`example` may use the placeholders `{name}`, `{hometown}`, `{role}` (job
title) and `{company}`; the app fills them in from Settings.

Tracks are declared in `prompts/<module>/_meta.json`. A track may set `pack`
(a word-pack file name in `vocab/`, without `.json`), shown as a "Useful
phrases" panel above its prompts. Besides `name` and the
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

Meeting-language prompts (`prompts/speak/mt_*.json`, focus `meeting`): same
shape as small talk (`say` + `example` always present). `say` is a line from
a stand-up, client workshop, steering meeting, incident call or design review;
`task` names the job the reply must do (jump in, clarify, push back, say you'll
follow up, confirm owner and date). Examples 5–45 words, sayable in a live meeting.

Work-writing prompts (`prompts/write/ww_*.json`, focus `workwriting`): `task`
gives every fact the learner needs (who it's to, dates, numbers, what happened)
and a word range, so the exercise is only about the English. `example` is one
model answer inside that range that leads with the point; use `\n` for line
breaks and bullets and `{name}` to sign. These tracks set `example_words` in
`_meta.json` (80 for Teams messages, 180 for the rest) to allow longer examples.

Conversation scenarios (`prompts/talk/<track>.json`): the AI plays a person and
asks one follow-up question after each of the learner's answers. Fields: `id`
(`c-<file>-NN`), `level`, `task` (what the learner does, plus any facts they
need), `zh`, `role` (who the AI plays, written to the AI: name, job,
personality, what they care about), `setting` (the situation and how to press,
written to the AI), `say` (the opening line, read aloud), `turns` (2–6 learner
answers before the AI wraps up). No `example`. Scenarios about the learner's own
work stay generic ("an update on the project you're working on"): the AI asks
about whatever the learner says and never invents facts about it. Private
scenarios may add `brief`: true background facts the AI may ask about and the
feedback checks the learner against.

Private tracks (`private/prompts/<module>/`, not in git): same layout, with
their own `_meta.json`; track ids must not clash with public ones. Use neutral
track and prompt ids (`p1_qa`, `p1-qa-01`): ids are stored in the synced
practice record even though the content is not. A speaking track with focus
`showcase` sends its `example` to the feedback as reference notes.

Check your folder (must print `OK`):

```bash
python3 tools/check_bank.py prompts/<module>
python3 tools/check_bank.py private/prompts/<module>
```

## Word packs: `vocab/<file>.json`

A word pack is a themed list of cards (restaurant menus, construction, data
reporting…) that the learner adds to their word bank with one click on the
Word bank page. Each file is one JSON object, with one card per line in `words`:

```json
{"tag": "Restaurant", "name": "Restaurant: everyday NZ", "description": "Cafés, fast food, menus, ordering and paying in New Zealand.", "words": [
{"term": "flat white", "topic": "Café & coffee", "respelling": "flat WYTE", "zh": "馥芮白（浓缩咖啡加细腻热奶，奶泡很薄）", "definition": "An espresso coffee with steamed milk and only a thin layer of foam.", "examples": [{"en": "Can I get a large flat white with oat milk, please?", "zh": "请给我一杯大杯燕麦奶馥芮白。"}], "wiki": "Flat white", "emoji": "☕"}
]}
```

- `tag`: the pack's tag (no `/`). Several files may share a tag; each card gets
  the tags `<tag>` and `<tag>/<topic>`, so the learner can filter by either.
- `term`: the word or phrase as written on a menu, sign or slide, lowercase
  unless it is a proper noun or an abbreviation (`BYO`, `KPI`, `Eggs Benedict`
  is fine as `eggs benedict`).
- `topic`: the section inside the pack (no `/`), e.g. `Café & coffee`. Keep
  10–25 cards or more per topic and reuse the exact same spelling.
- `zh`: the Chinese meaning, short (2–25 characters), with a few words of
  explanation in （） when a plain translation would not tell the learner what
  the thing actually is.
- `definition`: one simple English sentence (2–35 words).
- `examples`: 1–2 natural sentences the learner would really hear or say, each
  with a Chinese translation.
- `respelling` (optional, strongly recommended for foreign or tricky words):
  stressed syllable in capitals, e.g. `broo-SKET-uh`, `NYOK-ee`.
- `note` (optional): Chinese, one or two short points: how it differs from a
  similar word, NZ vs US usage, a trap (NZ "entrée" = starter, US "entrée" = main).
- `wiki` (optional): the exact English Wikipedia article title whose lead
  photo shows the thing, for concrete nouns where a picture helps (dishes,
  ingredients, machines, materials, chart types). The app fetches that photo.
  Leave it out for abstract words, or when the article's photo would not show
  this thing.
- `emoji` (optional): one emoji when there is an obvious one.
- Order: most useful topics first, most common cards first inside a topic.
  New cards are introduced in file order.
- No duplicate terms within a tag.

Check (must print `OK`; `--online` also confirms every `wiki` title has a photo):

```bash
python3 tools/check_bank.py vocab --online
```
