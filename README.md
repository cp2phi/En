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

The interface is in English. Chinese appears only as learning support: the sentence to translate in cloze, Translate and writing L1, the reasons in translation feedback, faint translations under example sentences, and a **Show Chinese** link under each practice instruction.

| Page | What it does |
|---|---|
| Cloze | Chinese → English fill-in-the-blank, served continuously. Filter by word class (or grammar topic), scene and level. An answer counts only if the word, its form and its spelling are all right. |
| Translate | Whole-sentence Chinese → English. Filter by sentence type, scene and level. Type the full sentence and press Enter: the AI says ✅ correct and natural, ⚠️ almost or ❌ not quite, lists at most three fixes (wrong part → fix, a short reason in Chinese) and shows your sentence fixed. Any correct, natural translation passes, not only the reference. Then you see the reference, other ways to say it and a 💡 line on the trap for Chinese speakers. **Show answer** any time; a revealed sentence goes to the wrong book. After a wrong answer you choose: **Next** (move on) or **Save to wrong book & next**. **☆ Save** puts any sentence in the wrong book. **Add to word bank** brings you back to the same card after saving (or **← Back to the card** without saving). Without an OpenAI key you compare with the answer and mark it yourself. |
| Wrong book | Two tabs, Translation and Cloze. Every question you missed or revealed, and every sentence you saved with ☆, to read through (with your last answer) or redo them all. **Remove** takes one off the list (its redo schedule stays; it comes back if you miss it again). |
| Keep writing | A six-level ladder, L1–L6: one-sentence translation → chat message → email → story or opinion → multi-paragraph piece → speech script. Five good sessions on a level unlock the next. You can write a Chinese word where you don't know the English. After you submit you get a natural rewrite, at most three issues that matter, and expressions you can save to the word bank with one click. |
| Keep speaking | A six-level ladder, L1–L6: repeat a sentence → 30 seconds → an experience → an opinion → improvised story or rebuttal → impromptu speech. Recording, a timer and a "stuck" button; your speech is transcribed and you get feedback. |
| Small talk (in Keep speaking) | 400 quick replies in 10 scenes, always open: everyday questions, office kitchen & corridor, before meetings & calls, starting a conversation, networking & meetups, cafés/shops/services, neighbours/friends/parties, Kiwi topics, reacting & keeping it going, tricky moments & exits. The other person's line is read aloud, you reply in 10–30 seconds, then see one natural example answer (it uses your own name and hometown from Settings). |
| Improv | Grouped by the Improv 101 lessons: "Yes, and", spontaneity, storytelling, status, justification, scene set-ups, understanding game rules, and rescue phrases. |
| Toastmasters | Table Topics (with green/yellow/red timing lights), Ice Breaker, evaluations, and meeting-role language. |
| Stats | Line charts of your word-bank size and cumulative speaking and writing minutes (hover or use the arrow keys for each day; a table view lists every value). Rank and XP, streak, words written, typing speed, error rate, speaking time, speaking speed, stuck count, filler words, today vs. the last 7 days vs. the 7 days before, and the last 14 days. |
| Presenting data (in Keep speaking) | Always open: say a change in numbers (up 4%, month-on-month, percentage points), walk a meeting through a chart, and explain causes, caveats and answers to questions. The task gives you the data; afterwards you see one natural model answer. |
| Meeting language (in Keep speaking) | Always open: 150 short replies for getting through meetings: joining in and interrupting, clarifying and checking, agreeing, disagreeing and pushing back, not knowing and following up, next steps and wrapping up, online-meeting moments. The other person's line is read aloud, you reply in 10–30 seconds, then see one natural example answer. A **Useful phrases** panel lists the meeting phrase pack. |
| Work writing (in Keep writing) | Always open: Teams messages, status updates and weekly reports, raising risks and issues, meeting notes and actions, work emails (asks, follow-ups, pushback). The task gives you the facts, so you only work on the English; afterwards you see one model answer. **Talk it through** then starts a conversation in which the person you wrote to asks you about it. |
| Conversation | Role-play with follow-up questions. The AI plays a manager, client, colleague, meeting chair or audience member, opens the conversation (read aloud), and after each answer reacts and asks one follow-up question that digs into what you said: a date, a number, an example, why, what if. You answer out loud (or type). **💡 Help me start** gives a first sentence and two or three points when you're stuck. After 3–5 answers you get feedback on the whole conversation: how you handled the follow-ups, each answer said more naturally, what to fix and phrases for next time. Scenarios: project updates, explaining your work, Q&A after a talk, pushback and tricky asks, in a meeting (the chair talks fast and cuts in), colleague chat. **Free topic**: pick who you're talking to and what about. Needs an OpenAI key. |
| Introducing yourself (in Keep speaking) | Always open, for client meetings: round-the-table intros, kick-offs, joining late, being introduced by your manager; then follow-ups ("so what do you do exactly?", your background) and introducing your company or a colleague. A **Useful phrases** panel above the prompts lists the sentence patterns (I look after…, I'll be your main point of contact for…, My background is in…) with Chinese and examples, and adds them to your word bank with one click. Example answers use your name, job title and company from Settings. |
| Review words | Forgot / Fuzzy / Remembered / Never show again. Due reviews come first, then new words. Tag chips at the top limit the review to one or more tags (e.g. only Restaurant, or only Restaurant → Café & coffee). The back of the card shows the Chinese meaning and a picture. |
| Add / Capture | Paste a sentence and mark the part you don't understand; the AI explains it and fills in the card, and you tick which notes to keep. Give the card a Chinese meaning and tags (default `Manual`). |
| Word bank | **Word packs**: **Preview & choose** opens a pack topic by topic, with each card's photo, Chinese, definition, example and notes; tick single cards or whole topics and add only those (cards already in your bank are marked ✓). Or **Add all** at once. Preview photos are cached in `cache/wiki/` (not synced). Browse, search (English or Chinese), filter by tag, edit tags, open a card's details to manage its picture, delete. |
| Tags | Every card says where it came from: `Manual`, `Cloze`, `Keep writing`, `Keep speaking`, `Improv`, `Toastmasters` (plus the practice track, e.g. `Keep speaking/Numbers & changes`), or a pack such as `Restaurant/Café & coffee`. `/` makes a sub-topic; picking a tag also picks everything under it. Cards from before tags existed show as **No tag**. |
| Pictures | On any card: **Find a photo** (free, the lead photo of the matching Wikipedia article), **AI picture** (your OpenAI key, about US$0.005 each) or **Upload** your own (shrunk to 800 px in the browser). Pack cards that name a Wikipedia article fetch their photo automatically the first time you see them. Pictures are saved in `data/images/` and synced. |
| Settings | OpenAI key, AI model, daily new-word limit, whether cloze blanks show their first letter, your name, where you're from, job title and company (filled into small-talk and self-introduction example answers); read-aloud voice (OpenAI natural voice or browser voice), US or UK accent, voice, pace and speech model, with a preview before saving. |
| Private practice | `private/` (git-ignored, and also kept out by Sync even if `.gitignore` changes) holds practice about real work projects: extra tracks in `private/prompts/<module>/`, shown with "(private)" next to their name. What you say or write there, and the read-aloud audio for it, is kept in `private/journal/` and `private/tts/`, never in `data/`; words saved from its feedback get the tag `My projects` and no example sentence. Free-topic and Talk-it-through conversations are private too. It is still sent to OpenAI for transcription and feedback. |
| Sync | Commits the whole repository (code, question banks, practice records, cached audio), pulls what other computers uploaded, and pushes to the git remote. On another computer, `git clone` or `git pull` and carry on. `config.local.json`, which holds the API key, and the `private/` folder are never uploaded. |

Each practice module has its own question bank and does not draw on your word bank. When you meet an expression you don't know during practice, click **Add to word bank** to keep it.

## Question banks

| Category | Questions | Content |
|---|---|---|
| Verbs | 1750 | 27 scenes: work, IT, restaurant & food, sport, shopping, travel, health, home, social, money, video calls & meetings, email & messages, driving & commuting, family & kids, feelings, weather & outdoors, paperwork & services, presenting & speaking, learning & study, body & movement, animals & plants, news/law & society, phone & social media, hobbies & arts, ways of talking, thinking & deciding, DIY & repairs. Covers about 1,350 everyday verbs, many in more than one sense |
| Phrasal verbs | 1249 | Same 27 scenes. Covers about 800 common phrasal verbs, the most polysemous ones (pick up, take off, put out…) in several senses |
| Particles & directions | 280 | Small words that change the meaning: video calls & meetings 60 (bring your camera *back on*, you're *on mute*), directions & places in NZ 60 (*down* to Hamilton = south, *up* north, *over* to the Shore, *across* the ditch), everyday on/off/up/down 60 (the milk's *off*, is it still *on*?), work 50 (I'm *across* it, *off* sick), IT 50 (the server *went down*, it's *back up*). Each answer comes with a one-line explanation |
| Adjectives | 200 | The 10 core scenes (work … money) |
| Prepositions | 200 | The 10 core scenes (work … money) (no first-letter hint) |
| Adverbs | 200 | The 10 core scenes (work … money) |
| Nouns | 500 | The 10 core scenes (work … money), 50 per scene |
| Noun phrases | 300 | The 10 core scenes (work … money), 30 per scene |
| Other | 200 | Connectors 40, polite language 50, idioms and slang 60, sentence patterns 50 |
| Combos (multiple blanks) | 20 | A verb and a noun blanked in the same sentence |
| Grammar topics | 420 | Past 100, future 40, present continuous 40, subjunctive 40, other common tenses 60, third person 40, plurals 40, other grammar 60. Only the first letter is shown, not the base form, so the word and its form are tested together |

Sentence translation: 4,950 sentences in `translate/`, 11 sentence types × 6 levels × 75, with 3 per scene in each level. The 25 scenes cover daily life in New Zealand: work, IT, job hunting, study, home, renting & flatting, neighbours, power/internet/phone plans, tradies & repairs, shopping, restaurants, money, paperwork & government, health, emergencies & police, driving & transport, travel, weather & outdoors, sport, hobbies & going out, social life, holidays & occasions, family & kids, pets, feelings & relationships:

| Sentence type | Trains |
|---|---|
| No subject in Chinese | 下雨了 / 该走了 / 到了吗: English needs a subject and often another verb |
| Topic first & 把 | 这事我来办 / 把门关上: the object goes back after the verb |
| 有: there is / have | 有人找你 / 这附近有超市吗 |
| Questions | wh-, yes/no, tag, indirect and negative questions |
| Polite requests & suggestions | Could you / Would you mind / Shall we / I'd suggest |
| Relative clauses | 我昨天买的那本书 → the book I bought yesterday |
| Time & if clauses | when / until / as soon as / unless, present tense for the future |
| Because / although | because / so / although / even though, never "although … but" |
| Tenses | 已经 / 还没 / 一直 / 刚: present perfect, past continuous, future |
| Passive without 被 | 会议取消了 / 包裹送到了 |
| Comparisons | -er / more, as … as, much + comparative, prefer … to |

Levels: L1 one short clause, L2 adds a detail, L3 two clauses with everyday-life vocabulary, L4 two or three clauses in message, phone-call or meeting register, L5 formal or official register (landlord, council, insurer, complaints), L6 native-like nuance (tact, hedging, idioms, implied meaning).

Practice prompts: keep writing 240, work writing 115, keep speaking 240, small talk 400, meeting language 150, presenting data 160, introducing yourself 125, Improv 250, Toastmasters 160, conversation scenarios 42.

## Word packs

Themed card lists in `vocab/`, added from the Word bank page. Each card has the English, a pronunciation respelling where useful, the Chinese meaning, a simple English definition, an example with its translation, notes on NZ usage and traps, and, for things you can see, a Wikipedia photo.

| Pack | Tag | Cards | Topics |
|---|---|---|---|
| Construction: plant, fleet & business | Construction | 413 | Plant & machines, Attachments & parts, Trucks & vehicles, Fleet & maintenance, Compliance & licensing, Hire & plant rates, Contracts & commercial, Project controls, Quality & documents, Office roles & systems, Meeting phrases |
| Construction: civil works & site | Construction | 514 | Types of civil work, Earthworks & ground, Roads & pavements, Pipes & three waters, Concrete & structures, Survey & drawings, Health & safety, Traffic management, Site people & roles, Everyday site talk, Quality & testing, Materials |
| Data reporting & presenting results | Data reporting | 498 | Chart types, Parts of a chart, Describing change: numbers, Trend verbs & nouns, Size & speed of change, Statistics basics, Business metrics & KPIs, Data work, Presentation signposting, Causes & effects, Caveats & hedging, Recommendations & next steps, Q&A in a data meeting |
| Restaurant: dining & world cuisines | Restaurant | 634 | Cooking methods & menu words, Sauces & sides, Steak & meat, Seafood, Cheese, charcuterie & bread, Desserts, Wine & drinks, Fine dining & service, Italian, Japanese, Thai, Vietnamese & Malaysian, Indian, Chinese dishes in English, French, Spanish, Greek & Middle Eastern, Mexican & Latin, Korean, American & BBQ |
| Restaurant: everyday NZ | Restaurant | 573 | Reading the menu, Ordering & dietary needs, Paying & tipping in NZ, Café & coffee, Brunch & breakfast, Bakery & cabinet food, Fast food, Fish & chips and Kiwi takeaways, Kiwi favourites, Pub & bar, Table items & tableware, Menu ingredients, Desserts & ice cream, Service & staff |
| Meeting language: getting through meetings | Meeting language | 156 | Joining in & interrupting, Clarifying & checking, Agreeing, disagreeing & pushing back, Not knowing & following up, Next steps & wrapping up, Online meeting moments |
| Self-introduction at work | Self-introduction | 221 | Opening & your name, Job title & team, What you do day to day, Your part in this project, Background & experience, Strengths without bragging, Rapport with the client, Introducing your company, Introducing others & handing over, Online meetings, Tricky moments, Closing & follow-up, IT roles & job titles |

## Review rules

- **Forgot**: comes back 2 more times the same day, then the next day. Forgot again on one of those repeats: once more that day (not 2 again).
- **Fuzzy**: comes back at least once more the same day; the interval does not grow.
- A card is shown at most 3 times a day, and a same-day repeat waits until 10 other cards have been shown. Repeats past the limit move to the next day.
- **Remembered**: intervals of 1, 3, 7, 15, 30, 60, then 120 days.
- **Cloze**: a question answered right the first time does not come back. **I don't know** (before answering, or after a right answer you only guessed) shows the answer and treats it as **Forgot**, and so does a wrong first answer: all go to the wrong book. **Add to word bank** also puts the question in the wrong book (not counted as a mistake) and brings you back to the same card after saving. The answer shows the best answer first, with the blank words highlighted, then every other accepted answer. It passes once you keep getting it right until its interval reaches 15 days.
- **Translate**: ✅ the first time means done. **Show answer** is treated as **Forgot** and goes to the wrong book. After ⚠️ or ❌ you choose: **Next** marks the sentence done without saving it; **Save to wrong book & next** treats it as **Forgot**. If you leave a checked sentence before choosing (another page, a filter, closing or reloading the tab), it is saved to the wrong book; a sentence you never checked stays new. **☆ Save** puts a sentence in the wrong book without counting it as a mistake, and it comes back tomorrow.
- Cloze questions, translation sentences and words can all be set to **Never show again**.
- **← Previous** brings back what you just did. In Cloze and Translate it shows your last 20 answered cards with their buttons still working (e.g. **I don't know**, **☆ Save**), then **Back to current** returns to the question you were on, with what you'd typed still there. In Keep writing, Keep speaking, Conversation, Improv and Toastmasters it shows earlier AI feedback. In Review words, **← Previous card** takes back your last rating (up to 20) so you can rate the card again. None of this survives a page reload or a server restart. Cloze and Translate also lose it when you change the word class, sentence type or scene.

## Layout

```
app/         Backend: standard-library HTTP server, spaced repetition, grading, practice and stats, git sync, OpenAI calls
static/      Frontend: plain HTML/JS
questions/   Cloze questions: questions/<word class>/<scene>.json
vocab/       Word packs: vocab/<pack>.json
prompts/     Writing, speaking, Improv, Toastmasters prompts and conversation scenarios (talk): prompts/<module>/<group>.json
data/        Your practice records; data/journal/ keeps everything you wrote or said, with its feedback; data/images/ holds card pictures
cache/tts/   Generated read-aloud audio (mp3)
private/     Not in git, never synced: practice about real work projects (prompts/, journal/, tts/, notes)
docs/        Content guide
tools/       Question bank checker
tests/       Tests
```

`config.local.json` holds the OpenAI key. It is listed in `.gitignore` and also forcibly excluded on every sync, so it is never uploaded. On a new computer, enter the key again in Settings. `cache/tts/` holds the generated read-aloud audio and is uploaded with each sync, so another computer does not need to generate it again. Audio for every cloze sentence is about 60 MB.

## Adding questions

See [docs/content-guide.md](docs/content-guide.md) for the rules (word packs have their own section; check them with `python3 tools/check_bank.py vocab --online`). To add a cloze question, add one line to `questions/<word class>/<scene>.json`. The answer goes in `{}`, other accepted answers are separated by `|`, and a sentence can have more than one blank:

```json
{"id":"v-work-01","level":2,"g":"3sg","zh":"她每周一主持团队例会。","en":"She {runs|chairs|leads} the team meeting every Monday."}
{"id":"g-past-001","level":2,"g":"past","zh":"我昨天去了超市。","en":"I {went} to the supermarket yesterday."}
```

Then run `python3 tools/check_bank.py questions/<word class>`; it must print `OK`. Never change an `id` once it has been used, because practice records are linked to it.

## Costs

- Writing and speaking feedback uses `gpt-4o-mini` (changeable in Settings): under 1 US cent per piece.
- AI pictures for word cards use `gpt-image-1-mini` at low quality: about USD 0.005 per picture. Wikipedia photos are free.
- Speech-to-text uses `whisper-1`: about USD 0.006 per minute, so two hours of speaking is about USD 0.70.
- The natural read-aloud voice uses `gpt-4o-mini-tts` by default (USD 12 per 1M audio output tokens, about 1.5 US cents per minute). Each sentence is generated once and then played from `cache/tts/`. Listening to all 2440 cloze sentences once costs about USD 2.
- OpenAI shuts `gpt-4o-mini-tts` down on 2027-01-06. From then on the app switches to `gpt-audio-1.5` automatically (about 5 times the price, no shutdown date announced). Audio already cached keeps playing.

## Next steps

- Grow the banks fivefold (1000 verb questions, several thousand noun questions) by adding files that follow the content guide.
