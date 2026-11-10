import random
import unittest
from datetime import date, timedelta
from pathlib import Path

from app import ai, cloze, practice, srs, words
from app.text import edit_distance, stem, stem_phrase

ROOT = Path(__file__).resolve().parent.parent
D0 = date(2026, 11, 10)


class SrsTest(unittest.TestCase):
    def test_remember_walks_the_ladder(self):
        s = srs.new_state()
        day = D0
        intervals = []
        for seq in range(1, 5):
            s = srs.rate(s, "remember", day, seq)
            intervals.append(s["interval"])
            day = date.fromisoformat(s["due"])
        self.assertEqual(intervals, [1, 3, 7, 15])

    def test_forget_repeats_at_least_twice_today(self):
        s = srs.rate(srs.new_state(), "forget", D0, 1)
        self.assertEqual(s["same_day_left"], 2)
        self.assertTrue(srs.is_due(s, D0))
        s = srs.rate(s, "remember", D0, 2)
        self.assertTrue(srs.is_due(s, D0), "one repeat is not enough after forget")
        s = srs.rate(s, "remember", D0, 3)
        self.assertFalse(srs.is_due(s, D0))
        self.assertEqual(s["due"], (D0 + timedelta(days=1)).isoformat())

    def test_fuzzy_repeats_once_today_and_keeps_interval(self):
        s = srs.new_state() | {"interval": 7}
        s = srs.rate(s, "fuzzy", D0, 1)
        self.assertEqual((s["same_day_left"], s["interval"]), (1, 7))
        self.assertTrue(srs.is_due(s, D0))
        s = srs.rate(s, "remember", D0, 2)
        self.assertFalse(srs.is_due(s, D0))
        self.assertEqual(s["due"], (D0 + timedelta(days=7)).isoformat())

    def test_forget_during_repeats_restores_two(self):
        s = srs.rate(srs.new_state(), "forget", D0, 1)
        s = srs.rate(s, "remember", D0, 2)
        s = srs.rate(s, "forget", D0, 3)
        self.assertEqual(s["same_day_left"], 2)

    def test_never_is_never_due(self):
        s = srs.rate(srs.rate(srs.new_state(), "forget", D0, 1), "never", D0, 2)
        self.assertFalse(srs.is_due(s, D0 + timedelta(days=400)))

    def test_same_day_repeat_waits_for_gap(self):
        s = srs.rate(srs.new_state(), "forget", D0, 5)
        self.assertFalse(srs.is_ready(s, 5))
        self.assertTrue(srs.is_ready(s, 5 + srs.SAME_DAY_GAP))

    def test_unknown_rating(self):
        with self.assertRaises(ValueError):
            srs.rate(srs.new_state(), "maybe", D0, 1)


class TextTest(unittest.TestCase):
    def test_stem_groups_verb_forms(self):
        groups = [
            ["run", "runs", "running", "ran"],
            ["postpone", "postpones", "postponed", "postponing"],
            ["carry", "carries", "carried", "carrying"],
            ["raise", "raises", "raised", "raising"],
            ["stop", "stops", "stopped", "stopping"],
            ["pass", "passes", "passed", "passing"],
            ["go", "goes", "went", "gone", "going"],
            ["make", "makes", "made", "making"],
            ["use", "uses", "used", "using"],
        ]
        for group in groups:
            self.assertEqual(len({stem(w) for w in group}), 1, group)

    def test_stem_keeps_different_words_apart(self):
        self.assertNotEqual(stem("run"), stem("ruin"))
        self.assertNotEqual(stem("raise"), stem("rise"))

    def test_stem_phrase_and_distance(self):
        self.assertEqual(stem_phrase("Settled  up"), stem_phrase("settle up"))
        self.assertEqual(edit_distance("postponed", "posponed"), 1)
        self.assertEqual(edit_distance("kitten", "sitting"), 3)


class ClozeTest(unittest.TestCase):
    def setUp(self):
        self.q = self._q("q1", "She {runs|chairs} the {meeting} every Monday.")
        self.questions = {"q1": self.q, "q2": self._q("q2", "We {missed} it.", level=2),
                          "q3": self._q("q3", "I {agree}.", level=4)}

    @staticmethod
    def _q(qid, en, level=1):
        segments, blanks = cloze.parse(en)
        return {"id": qid, "en": en, "zh": "中文", "level": level, "pos": "verb", "scene": "work",
                "segments": segments, "blanks": blanks, "sentence": cloze.solution(en)}

    def test_parse(self):
        self.assertEqual(self.q["blanks"], [["runs", "chairs"], ["meeting"]])
        self.assertEqual(self.q["sentence"], "She runs the meeting every Monday.")
        self.assertEqual(self.q["segments"][1], {"blank": 0, "hint": "r", "length": 4, "cue": ""})

    def test_cue_replaces_letter_hint(self):
        q = self._q("g1", "She {went|walked::go} home and {didn't call::not call}.")
        self.assertEqual(q["blanks"], [["went", "walked"], ["didn't call"]])
        self.assertEqual(q["sentence"], "She went home and didn't call.")
        blanks = [seg for seg in cloze.public_view(q)["segments"] if "blank" in seg]
        self.assertEqual([(b["cue"], b["hint"]) for b in blanks], [("go", ""), ("not call", "")])
        self.assertTrue(cloze.check(q, ["went", "didn't call"])["correct"])
        self.assertEqual(cloze.classify("goed", ["went"]), "grammar")
        self.assertEqual(cloze.classify("go", ["went"]), "grammar")

    def test_no_letter_hint_for_prepositions(self):
        q = self._q("p1", "I'm good {at} this.") | {"pos": "preposition"}
        self.assertEqual(cloze.public_view(q)["segments"][1]["hint"], "")

    def test_public_view_hides_answers(self):
        self.assertNotIn("runs", str(cloze.public_view(self.q)))

    def test_classify(self):
        self.assertEqual(cloze.classify(" Runs ", ["runs", "chairs"]), "correct")
        self.assertEqual(cloze.classify("chairs", ["runs", "chairs"]), "correct")
        self.assertEqual(cloze.classify("run", ["runs"]), "grammar")
        self.assertEqual(cloze.classify("ran", ["runs"]), "grammar")
        self.assertEqual(cloze.classify("posponed", ["postponed"]), "spelling")
        self.assertEqual(cloze.classify("holds", ["runs"]), "word")
        self.assertEqual(cloze.classify("", ["runs"]), "empty")

    def test_check_needs_every_blank(self):
        self.assertTrue(cloze.check(self.q, ["runs", "meeting"])["correct"])
        result = cloze.check(self.q, ["runs", "meetings"])
        self.assertFalse(result["correct"])
        self.assertEqual([b["kind"] for b in result["blanks"]], ["correct", "grammar"])
        self.assertFalse(cloze.check(self.q, ["runs"])["correct"])

    def test_correct_first_time_is_not_replayed(self):
        p = {"seq": 0, "items": {}}
        cloze.record(p, "q1", "correct", D0)
        self.assertEqual(p["items"]["q1"]["status"], "passed")
        self.assertEqual(cloze.wrong_book(self.questions, p), [])

    def test_guessed_after_correct_goes_to_redo(self):
        p = {"seq": 0, "items": {}}
        cloze.record(p, "q1", "correct", D0)
        cloze.record(p, "q1", "guessed", D0)
        self.assertEqual(p["items"]["q1"]["status"], "learning")
        self.assertEqual(len(cloze.wrong_book(self.questions, p)), 1)

    def test_wrong_question_repeats_then_graduates(self):
        p = {"seq": 0, "items": {}}
        cloze.record(p, "q1", "reveal", D0)
        item = p["items"]["q1"]
        self.assertEqual(item["srs"]["same_day_left"], 2)
        day = D0
        for _ in range(20):
            if item["status"] == "passed":
                break
            cloze.record(p, "q1", "correct", day)
            if item["srs"]["same_day_left"] == 0:
                day = date.fromisoformat(item["srs"]["due"])
        self.assertEqual(item["status"], "passed")
        self.assertGreaterEqual(item["attempts"], 5)

    def test_next_question_order(self):
        p = {"seq": 0, "items": {}}
        rng = random.Random(1)
        first = cloze.next_question(self.questions, p, {}, D0, rng)
        self.assertIn(first["id"], ("q1", "q2"), "easiest levels come first")
        cloze.record(p, "q1", "wrong", D0)
        # q1 must wait for the gap, so an unseen question comes next.
        self.assertNotEqual(cloze.next_question(self.questions, p, {}, D0, rng)["id"], "q1")
        cloze.record(p, "q2", "correct", D0)
        cloze.record(p, "q3", "correct", D0)
        # Nothing unseen is left: the waiting redo item is served.
        self.assertEqual(cloze.next_question(self.questions, p, {}, D0, rng)["id"], "q1")
        cloze.record(p, "q1", "correct", D0)
        cloze.record(p, "q1", "correct", D0)
        self.assertIsNone(cloze.next_question(self.questions, p, {}, D0, rng))
        self.assertEqual(cloze.next_question(self.questions, p, {}, D0 + timedelta(days=1), rng)["id"], "q1")

    def test_never_and_filters_and_wrongbook_mode(self):
        p = {"seq": 0, "items": {}}
        cloze.record(p, "q1", "wrong", D0)
        self.assertEqual(cloze.next_question(self.questions, p, {"mode": "wrongbook"}, D0)["id"], "q1")
        cloze.record(p, "q1", "never", D0)
        self.assertIsNone(cloze.next_question(self.questions, p, {"mode": "wrongbook"}, D0))
        self.assertEqual(cloze.next_question(self.questions, p, {"level": "4"}, D0)["id"], "q3")
        self.assertIsNone(cloze.next_question(self.questions, p, {"scene": "sports"}, D0))
        self.assertEqual(cloze.stats(self.questions, p, D0)["never"], 1)


class QuestionBankTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.questions = cloze.load_questions(ROOT / "questions")

    def test_counts(self):
        m = cloze.meta(self.questions)
        expected = {"verb": 200, "combo": 20, "phrasal": 200, "adjective": 200, "preposition": 200,
                    "adverb": 200, "noun": 500, "nounphrase": 300, "other": 200, "grammar": 420}
        self.assertEqual(m["pos"], expected)
        topics = {"past": 100, "future": 40, "continuous": 40, "subjunctive": 40, "tenses": 60,
                  "third": 40, "plural": 40, "misc": 60}
        self.assertEqual(m["by_pos"]["grammar"], topics)

    def test_every_question_is_well_formed(self):
        for q in self.questions.values():
            with self.subTest(q["id"]):
                self.assertIn(q["level"], range(1, 6))
                self.assertTrue(q["zh"].strip())
                self.assertNotIn("{", q["sentence"])
                for accepted in q["blanks"]:
                    self.assertEqual(len(accepted), len(set(accepted)))
                    for answer in accepted:
                        self.assertRegex(answer, r"^[A-Za-z][A-Za-z' -]*$")
                self.assertNotIn("::", q["sentence"])
                if q["pos"] == "grammar":
                    self.assertTrue(all(seg["cue"] for seg in q["segments"] if "blank" in seg),
                                    "grammar drills show a cue for every blank")
                self.assertTrue(cloze.check(q, [b[0] for b in q["blanks"]])["correct"])
                if q["pos"] == "combo":
                    self.assertGreaterEqual(len(q["blanks"]), 2)

    def test_no_duplicate_sentences(self):
        seen = {}
        for q in self.questions.values():
            key = (q["pos"], q["sentence"])
            self.assertNotIn(key, seen, f"{q['id']} repeats {seen.get(key)}")
            seen[key] = q["id"]


class WordsTest(unittest.TestCase):
    def setUp(self):
        self.data = {"seq": 0, "words": {}}

    def add(self, term, **extra):
        return words.add_word(self.data, {"term": term, **extra}, D0)

    def test_add_and_duplicate_merges_examples(self):
        w, dup = self.add("Settle up", examples=[{"en": "Let's settle up.", "zh": "结账吧"}], note="a")
        self.assertFalse(dup)
        self.assertEqual(w["term"], "settle up")
        w2, dup = self.add("settled up", examples=[{"en": "Let's settle up."}, {"en": "We settled up."}], note="b")
        self.assertTrue(dup)
        self.assertIs(w, w2)
        self.assertEqual(len(w["examples"]), 2)
        self.assertEqual(w["note"], "a\nb")
        self.assertEqual(len(self.data["words"]), 1)

    def test_term_required(self):
        with self.assertRaises(ValueError):
            self.add("   ")

    def test_new_word_limit_per_day(self):
        for term in ("alpha", "bravo", "charlie"):
            self.add(term)
        seen = []
        for _ in range(3):
            w = words.next_word(self.data, D0, new_limit=2)
            if w is None:
                break
            seen.append(w["term"])
            words.rate_word(self.data, w["id"], "remember", D0)
        self.assertEqual(len(seen), 2)
        self.assertEqual(words.counts(self.data, D0, 2)["new_today_left"], 0)
        self.assertEqual(words.counts(self.data, D0 + timedelta(days=1), 2)["new_today_left"], 1)

    def test_forgotten_word_returns_twice_today(self):
        w, _ = self.add("zone")
        words.rate_word(self.data, w["id"], "forget", D0)
        shown = 0
        while (nxt := words.next_word(self.data, D0, new_limit=0)) is not None:
            shown += 1
            words.rate_word(self.data, nxt["id"], "remember", D0)
        self.assertEqual(shown, 2)
        self.assertIsNotNone(words.next_word(self.data, D0 + timedelta(days=1), 0))

    def test_due_words_come_before_new_and_respect_gap(self):
        a, _ = self.add("alpha")
        self.add("bravo")
        words.rate_word(self.data, a["id"], "fuzzy", D0)
        self.assertEqual(words.next_word(self.data, D0, 5)["term"], "bravo")

    def test_never_and_update(self):
        w, _ = self.add("zone")
        words.rate_word(self.data, w["id"], "never", D0)
        self.assertIsNone(words.next_word(self.data, D0, 5))
        words.update_word(self.data, w["id"], {"my_examples": [" I was in the zone. ", ""], "term": "In the Zone"})
        self.assertEqual(w["my_examples"], ["I was in the zone."])
        self.assertEqual(w["key"], stem_phrase("in the zone"))


class AiTest(unittest.TestCase):
    def test_explain_parses_and_trims(self):
        captured = {}

        def post(payload, key):
            captured.update(payload=payload, key=key)
            content = ('{"term":"In The Zone","respelling":"in thuh ZOHN","definition":"fully focused",'
                       '"sentence_zh":"你很专注","notes":["a","b"],'
                       '"examples":[{"en":"1","zh":"一"},{"en":"2","zh":"二"},{"en":"3","zh":"三"},{"en":"4","zh":"四"}]}')
            return {"choices": [{"message": {"content": content}}]}

        r = ai.explain("in the zone", "You're in the zone today.", "sk-test", "m", post=post)
        self.assertEqual(r["term"], "in the zone")
        self.assertEqual(len(r["examples"]), 3)
        self.assertEqual(r["sentence"], "You're in the zone today.")
        self.assertEqual(captured["key"], "sk-test")
        self.assertIn("in the zone", captured["payload"]["messages"][1]["content"])

    def test_explain_errors(self):
        with self.assertRaises(ai.AIError):
            ai.explain("x", "", "")
        with self.assertRaises(ai.AIError):
            ai.explain("", "", "sk")
        with self.assertRaises(ai.AIError):
            ai.explain("x", "", "sk", post=lambda p, k: {"choices": [{"message": {"content": "not json"}}]})


class PracticeTest(unittest.TestCase):
    def setUp(self):
        def prompts(module, track, n):
            return [{"id": f"{module}-{track}-{i}", "level": 1, "task": "Say it.", "zh": "说",
                     "module": module, "track": track} for i in range(n)]
        self.bank = {
            "write": {"name": "写", "ladder": True, "tracks": {
                "l1": {"name": "L1", "prompts": prompts("write", "l1", 3)},
                "l2": {"name": "L2", "prompts": prompts("write", "l2", 3)}}},
            "toast": {"name": "T", "ladder": False, "tracks": {
                "table_topics": {"name": "TT", "green": 60, "yellow": 90, "red": 120,
                                 "prompts": prompts("toast", "table_topics", 2)}}},
        }
        self.data = {"sessions": [], "done": {}, "vocab": {"write": {}, "spoken": {}}}

    def do(self, prompt, text, score=None, seconds=60, mode="write", day=D0, stuck=0):
        fb = {"score": score, "issues": [{"original": "a", "better": "b", "why": "c"}]} if score else None
        return practice.record_session(self.data, prompt, text, seconds, mode, stuck, fb, day)

    def test_ladder_unlocks_after_enough_good_sessions(self):
        p1 = self.bank["write"]["tracks"]["l1"]["prompts"][0]
        self.assertTrue(practice.is_locked(self.bank, self.data, "write", "l2"))
        self.do(p1, "too short")                       # under the word minimum: not good
        self.do(p1, "I will take tomorrow off.", score=2)  # low score: not good
        for _ in range(practice.UNLOCK_SESSIONS - 1):
            self.assertIsNone(self.do(p1, "I will take tomorrow off.", score=4)["leveled_up"])
        self.assertTrue(practice.is_locked(self.bank, self.data, "write", "l2"))
        self.assertEqual(self.do(p1, "I will take tomorrow off.")["leveled_up"], 2)
        self.assertFalse(practice.is_locked(self.bank, self.data, "write", "l2"))
        tracks = {t["id"]: t for t in practice.meta(self.bank, self.data)["write"]["tracks"]}
        self.assertEqual((tracks["l1"]["good"], tracks["l1"]["done"], tracks["l2"]["locked"]), (5, 1, False))
        self.assertEqual(practice.meta(self.bank, self.data)["toast"]["tracks"][0]["timing"], [60, 90, 120])

    def test_next_prompt_prefers_unseen(self):
        rng = random.Random(3)
        seen = []
        for _ in range(3):
            p = practice.next_prompt(self.bank, self.data, "write", "l1", rng)
            seen.append(p["id"])
            self.do(p, "one two three four five")
        self.assertEqual(len(set(seen)), 3)
        again = practice.next_prompt(self.bank, self.data, "write", "l1", rng)
        self.assertNotEqual(again["id"], seen[-1], "does not repeat the prompt just done")

    def test_session_numbers(self):
        p = self.bank["toast"]["tracks"]["table_topics"]["prompts"][0]
        s = self.do(p, "Um, I think, uh, you know, 这个 it's good. I don't know.", score=3, seconds=30,
                    mode="speak", stuck=2)
        self.assertEqual((s["words"], s["fillers"], s["stuck"], s["issues"]), (11, 3, 2, 1))
        self.assertEqual(s["xp"], 11 + 10 + 15)
        self.assertEqual(self.data["vocab"]["spoken"]["i"], 2)
        self.assertEqual(self.data["vocab"]["write"], {})
        empty = self.do(p, "", seconds=45, mode="speak")
        self.assertEqual((empty["words"], empty["xp"], empty["good"]), (0, 10, False))
        spoken = practice.stats(self.data, D0)["modules"]["spoken"]["all"]
        self.assertEqual(spoken["wpm"], 22, "time without a transcript does not lower the speed")
        only_silent = practice._summary([self.data["sessions"][-1]])
        self.assertIsNone(only_silent["wpm"])

    def test_stats_streak_and_rank(self):
        p = self.bank["write"]["tracks"]["l1"]["prompts"][0]
        for back in (0, 1, 2, 4):
            self.do(p, "word " * 50, score=4, seconds=120, day=D0 - timedelta(days=back))
        self.do(self.bank["toast"]["tracks"]["table_topics"]["prompts"][0], "hello there " * 60,
                seconds=90, mode="speak", day=D0 - timedelta(days=8))
        st = practice.stats(self.data, D0)
        self.assertEqual(st["streak"], 3)
        w = st["modules"]["write"]
        self.assertEqual((w["today"]["words"], w["this_week"]["words"], w["all"]["wpm"]), (50, 200, 25))
        self.assertEqual(w["all"]["issues_per_100"], 2.0)
        self.assertEqual(w["unique_words"], 1)
        sp = st["modules"]["spoken"]
        self.assertEqual((sp["last_week"]["minutes"], sp["all"]["wpm"], sp["this_week"]["sessions"]), (1.5, 80, 0))
        self.assertEqual(len(st["days"]), 14)
        self.assertEqual(st["days"][-1]["write_words"], 50)
        xp = sum(s["xp"] for s in self.data["sessions"])
        self.assertEqual(st["rank"], practice.rank(xp))
        self.assertEqual(practice.rank(0)["level"], 1)
        self.assertEqual(practice.rank(800), {"level": 3, "xp": 800, "next_at": 1800})
        self.assertEqual(practice.streak({(D0 - timedelta(days=1)).isoformat()}, D0), 1)
        self.assertEqual(practice.streak(set(), D0), 0)


class PromptBankTest(unittest.TestCase):
    def test_every_track_has_prompts(self):
        bank = practice.load_prompts(ROOT / "prompts")
        self.assertEqual(set(bank), set(practice.MODULES))
        ids = set()
        for module, info in bank.items():
            for track, t in info["tracks"].items():
                with self.subTest(f"{module}/{track}"):
                    self.assertGreaterEqual(len(t["prompts"]), 20)
                    for p in t["prompts"]:
                        self.assertNotIn(p["id"], ids)
                        ids.add(p["id"])
                        self.assertTrue(p["task"].strip() and p["zh"].strip())
        for module in ("write", "speak"):
            self.assertEqual(list(bank[module]["tracks"]), [f"l{i}" for i in range(1, 7)])
            self.assertTrue(bank[module]["ladder"])
        self.assertEqual(len(bank["toast"]["tracks"]["table_topics"]["prompts"]), 100)
        self.assertIs(practice.find_prompt(bank, "nope"), None)


class AiFeedbackTest(unittest.TestCase):
    def test_feedback_is_cleaned(self):
        seen = {}

        def post(payload, key):
            seen["system"] = payload["messages"][0]["content"]
            seen["user"] = payload["messages"][1]["content"]
            content = ('{"natural":"I went there.","issues":[{"original":"I go","better":"I went","why":"过去"},'
                       '{"better":"no original"},1,2,{"original":"x"},{"original":"y"},{"original":"z"}],'
                       '"vocab":[{"term":"deadline","zh":"截止日期","example":"We missed it."}],'
                       '"score":"9","comment":"不错"}')
            return {"choices": [{"message": {"content": content}}]}

        r = ai.feedback("improv", "Say yes and", "I go there", "speak", "sk", "m", post=post)
        self.assertEqual(r["score"], 5)
        self.assertEqual(len(r["issues"]), 3)
        self.assertEqual(r["issues"][0], {"original": "I go", "better": "I went", "why": "过去"})
        self.assertEqual(r["vocab"][0]["term"], "deadline")
        self.assertIn("transcript", seen["system"])
        self.assertIn("improv", seen["system"])
        self.assertIn("I go there", seen["user"])
        written = ai.feedback("write", "t", "x", "write", "sk", post=lambda p, k: {
            "choices": [{"message": {"content": '{"score": null}'}}]})
        self.assertEqual((written["score"], written["issues"], written["natural"]), (None, [], ""))
        with self.assertRaises(ai.AIError):
            ai.feedback("write", "t", "x", "write", "")

    def test_transcribe_builds_multipart(self):
        seen = {}

        def post(body, content_type, key):
            seen.update(body=body, content_type=content_type, key=key)
            return {"text": " Hello there. "}

        text = ai.transcribe(b"\x00\x01AUDIO", "audio/webm;codecs=opus", "sk", post=post)
        self.assertEqual(text, "Hello there.")
        self.assertTrue(seen["content_type"].startswith("multipart/form-data; boundary="))
        boundary = seen["content_type"].split("boundary=")[1].encode()
        self.assertEqual(seen["body"].count(b"--" + boundary), 4)
        self.assertIn(b'filename="speech.webm"', seen["body"])
        self.assertIn(b"Content-Type: audio/webm\r\n\r\n\x00\x01AUDIO\r\n", seen["body"])
        self.assertIn(b'name="model"\r\n\r\nwhisper-1', seen["body"])
        self.assertIn(b'filename="speech.mp4"', (ai.transcribe(b"x", "audio/mp4", "sk", post=post), seen["body"])[1])
        with self.assertRaises(ai.AIError):
            ai.transcribe(b"x", "audio/webm", "")
        with self.assertRaises(ai.AIError):
            ai.transcribe(b"", "audio/webm", "sk")


class AiSpeechTest(unittest.TestCase):
    def test_tts_model_gets_accent_and_pace(self):
        seen = {}

        def post_speech(payload, key):
            seen.update(payload)
            return b"MP3"

        audio, used = ai.speech("  Hello\n  there ", "cedar", "uk", "slow", "sk", post_speech=post_speech)
        self.assertEqual((audio, used), (b"MP3", ai.TTS_MODEL))
        self.assertEqual((seen["model"], seen["voice"], seen["input"], seen["response_format"]),
                         (ai.TTS_MODEL, "cedar", "Hello there", "mp3"))
        self.assertIn("British", seen["instructions"])
        self.assertIn("slower", seen["instructions"])
        _, _ = ai.speech("Hi", "nope", "us", "normal", "sk", post_speech=post_speech)
        self.assertEqual(seen["voice"], "marin", "unknown voices fall back to the default")
        self.assertIn("American", seen["instructions"])

    def test_falls_back_only_when_the_model_is_gone(self):
        chat = {}

        def gone(payload, key):
            raise ai.AIError("model not found", 404)

        def post(payload, key):
            chat.update(payload)
            return {"choices": [{"message": {"audio": {"data": "TVAz"}}}]}  # base64 of b"MP3"

        audio, used = ai.speech("Hi there.", "marin", "us", "normal", "sk", post_speech=gone, post=post)
        self.assertEqual((audio, used), (b"MP3", ai.TTS_FALLBACK_MODEL))
        self.assertEqual(chat["model"], ai.TTS_FALLBACK_MODEL)
        self.assertEqual(chat["audio"], {"voice": "marin", "format": "mp3"})
        self.assertEqual(chat["messages"][1]["content"], "Hi there.")
        self.assertIn("exactly as written", chat["messages"][0]["content"])

        def bad_key(payload, key):
            raise ai.AIError("bad key", 401)

        with self.assertRaises(ai.AIError):
            ai.speech("Hi", "marin", "us", "normal", "sk", post_speech=bad_key, post=post)
        # Choosing the fallback model directly skips the speech endpoint.
        self.assertEqual(ai.speech("Hi", "marin", "us", "normal", "sk", ai.TTS_FALLBACK_MODEL,
                                   post_speech=bad_key, post=post)[1], ai.TTS_FALLBACK_MODEL)

    def test_speech_errors(self):
        with self.assertRaises(ai.AIError):
            ai.speech("Hi", "marin", "us", "normal", "")
        with self.assertRaises(ai.AIError):
            ai.speech("   ", "marin", "us", "normal", "sk")
        with self.assertRaises(ai.AIError):
            ai.speech("Hi", "marin", "us", "normal", "sk", ai.TTS_FALLBACK_MODEL,
                      post=lambda p, k: {"choices": [{"message": {}}]})
        long_text = "word " * 1000
        seen = {}
        ai.speech(long_text, "marin", "us", "normal", "sk",
                  post_speech=lambda p, k: seen.update(p) or b"x")
        self.assertLessEqual(len(seen["input"]), ai.MAX_TTS_CHARS)


if __name__ == "__main__":
    unittest.main()
