import random
import unittest
from datetime import date, timedelta
from pathlib import Path

from app import ai, cloze, srs, words
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
        self.assertEqual(self.q["segments"][1], {"blank": 0, "hint": "r", "length": 4})

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
        self.assertEqual(m["pos"]["verb"], 200)
        self.assertGreaterEqual(m["pos"]["combo"], 20)

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
                self.assertTrue(cloze.check(q, [b[0] for b in q["blanks"]])["correct"])
                if q["pos"] == "combo":
                    self.assertGreaterEqual(len(q["blanks"]), 2)

    def test_no_duplicate_sentences(self):
        sentences = [q["sentence"] for q in self.questions.values() if q["pos"] == "verb"]
        self.assertEqual(len(sentences), len(set(sentences)))


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


if __name__ == "__main__":
    unittest.main()
