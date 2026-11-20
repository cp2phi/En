import base64
import json
import random
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

from app import ai, cloze, images, practice, srs, translate, words
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

    def test_grammar_drills_test_word_and_form_together(self):
        # No base form is shown: only the first letter, like every other word class.
        q = self._q("g1", "She {went} home and {didn't call|did not call}.") | {"pos": "grammar"}
        blanks = [seg for seg in cloze.public_view(q)["segments"] if "blank" in seg]
        self.assertEqual([(b["hint"], "cue" in b) for b in blanks], [("w", False), ("d", False)])
        self.assertTrue(cloze.check(q, ["went", "did not call"])["correct"])
        self.assertEqual(cloze.classify("goed", ["went"]), "grammar")
        self.assertEqual(cloze.classify("go", ["went"]), "grammar")
        self.assertEqual(cloze.classify("walked", ["went"]), "word")

    def test_no_letter_hint_for_prepositions(self):
        q = self._q("p1", "I'm good {at} this.") | {"pos": "preposition"}
        self.assertEqual(cloze.public_view(q)["segments"][1]["hint"], "")

    def test_no_letter_hint_when_the_answer_starts_with_a_particle(self):
        q = self._q("pt1", "We're heading {down} to Hamilton, then {pop over|pop round} to see Sam.") | {"pos": "particle"}
        hints = [seg["hint"] for seg in cloze.public_view(q)["segments"] if "blank" in seg]
        self.assertEqual(hints, ["", "p"], "particle hidden, verb + particle keeps the verb's letter")
        idiom = self._q("o1", "Thanks for the heads {up}.") | {"pos": "other"}
        self.assertEqual(cloze.public_view(idiom)["segments"][1]["hint"], "")

    def test_letter_hint_setting_hides_every_letter(self):
        hints = [seg["hint"] for seg in cloze.public_view(self.q, letter_hint=False)["segments"] if "blank" in seg]
        self.assertEqual(hints, ["", ""])
        self.assertEqual([seg["hint"] for seg in cloze.public_view(self.q)["segments"] if "blank" in seg], ["r", "m"])

    def test_counts_total_and_left(self):
        qs = self.questions | {"s1": self._q("s1", "We {won}.", level=2) | {"pos": "verb", "scene": "sports"},
                               "a1": self._q("a1", "It's {cold}.") | {"pos": "adjective", "scene": "work"}}
        p = {"seq": 0, "items": {}}
        c = cloze.counts(qs, p, {})
        self.assertEqual(c["pos"], {"verb": {"total": 4, "left": 4}, "adjective": {"total": 1, "left": 1}})
        cloze.record(p, "q1", "correct", D0)   # done
        cloze.record(p, "q2", "wrong", D0)     # attempted, in the redo queue: not left
        cloze.record(p, "q3", "never", D0)     # hidden: not left
        c = cloze.counts(qs, p, {})
        self.assertEqual(c["pos"]["verb"], {"total": 4, "left": 1})
        self.assertEqual(c["scenes"], {"work": {"total": 4, "left": 1}, "sports": {"total": 1, "left": 1}})
        self.assertEqual(c["levels"], {"1": {"total": 2, "left": 1}, "2": {"total": 2, "left": 1},
                                       "4": {"total": 1, "left": 0}})
        # Scenes within the word class, levels within word class and scene.
        c = cloze.counts(qs, p, {"pos": "verb", "scene": "sports"})
        self.assertEqual(set(c["scenes"]), {"work", "sports"})
        self.assertEqual(c["levels"], {"2": {"total": 1, "left": 1}})
        self.assertEqual(cloze.counts(qs, p, {"pos": "adjective"})["scenes"], {"work": {"total": 1, "left": 1}})

    def test_solution_parts_mark_the_blank_words(self):
        segments, blanks = cloze.parse("Let's {go over|go through} the numbers.")
        q = {"segments": segments, "blanks": blanks}
        self.assertEqual(cloze.solution_parts(q), [
            {"text": "Let's "}, {"fill": "go over", "blank": 0}, {"text": " the numbers."}])

    def test_reveal_includes_the_note(self):
        q = self.q | {"note": "Run a meeting means lead it."}
        self.assertEqual(cloze.reveal(q)["note"], "Run a meeting means lead it.")
        self.assertEqual(cloze.reveal(self.q)["note"], "")
        self.assertNotIn("note", cloze.public_view(q), "the note is not shown before answering")

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

    def test_remove_from_wrong_book(self):
        p = {"seq": 0, "items": {}}
        cloze.record(p, "q1", "wrong", D0)
        cloze.record(p, "q2", "correct", D0)
        due_before = p["items"]["q1"]["srs"]["due"]
        self.assertTrue(cloze.remove_from_wrong_book(p, "q1"))
        self.assertEqual(cloze.wrong_book(self.questions, p), [])
        self.assertIsNone(cloze.next_question(self.questions, p, {"mode": "wrongbook"}, D0))
        self.assertEqual((p["items"]["q1"]["status"], p["items"]["q1"]["srs"]["due"]), ("learning", due_before),
                         "the redo schedule is kept")
        self.assertFalse(cloze.remove_from_wrong_book(p, "q1"), "already removed")
        self.assertFalse(cloze.remove_from_wrong_book(p, "q2"), "never wrong")
        self.assertFalse(cloze.remove_from_wrong_book(p, "nope"))
        cloze.record(p, "q1", "reveal", D0)
        self.assertEqual([r["id"] for r in cloze.wrong_book(self.questions, p)], ["q1"], "back after another miss")
        # Records written before the flag existed still count as in the book.
        legacy = {"seq": 1, "items": {"q3": {"status": "learning", "attempts": 1, "wrong": 1, "srs": srs.new_state()}}}
        self.assertEqual([r["id"] for r in cloze.wrong_book(self.questions, legacy)], ["q3"])

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
        expected = {"verb": 1750, "combo": 20, "phrasal": 1249, "adjective": 200, "preposition": 200,
                    "adverb": 200, "noun": 500, "nounphrase": 300, "other": 200, "grammar": 420,
                    "particle": 280}
        self.assertEqual(m["pos"], expected)
        topics = {"past": 100, "future": 40, "continuous": 40, "subjunctive": 40, "tenses": 60,
                  "third": 40, "plural": 40, "misc": 60}
        self.assertEqual(m["by_pos"]["grammar"], topics)
        self.assertEqual(m["by_pos"]["particle"],
                         {"calls": 60, "directions": 60, "everyday": 60, "work": 50, "tech": 50})

    def test_particle_questions_explain_themselves(self):
        particle = [q for q in self.questions.values() if q["pos"] == "particle"]
        self.assertTrue(all(q.get("note", "").strip() for q in particle), "every particle question has a note")
        # The two expressions that started this set are covered.
        sentences = " ".join(q["sentence"] for q in particle)
        self.assertRegex(sentences, r"camera back on")
        self.assertRegex(sentences, r"down to Hamilton")

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
                self.assertNotIn("::", q["en"], "base-form cues were removed on purpose")
                self.assertTrue(cloze.check(q, [b[0] for b in q["blanks"]])["correct"])
                if q["pos"] == "combo":
                    self.assertGreaterEqual(len(q["blanks"]), 2)

    def test_no_duplicate_sentences(self):
        seen = {}
        for q in self.questions.values():
            key = (q["pos"], q["sentence"])
            self.assertNotIn(key, seen, f"{q['id']} repeats {seen.get(key)}")
            seen[key] = q["id"]


class TranslateTest(unittest.TestCase):
    def setUp(self):
        self.sentences = {
            "t1": {"id": "t1", "type": "passive", "scene": "work", "level": 1, "zh": "会议取消了。",
                   "en": "The meeting's been cancelled.", "alt": ["The meeting was called off."], "point": "被动"},
            "t2": {"id": "t2", "type": "compare", "scene": "home", "level": 2, "zh": "这个更便宜。",
                   "en": "This one's cheaper.", "alt": [], "point": "比较"},
        }

    def test_exact_match_ignores_case_punctuation_and_contractions(self):
        q = self.sentences["t1"]
        self.assertTrue(translate.matches_reference(q, "the meeting has been cancelled"))
        self.assertTrue(translate.matches_reference(q, "The meeting was called off!"))
        self.assertFalse(translate.matches_reference(q, "The meeting is cancelled."))
        self.assertFalse(translate.matches_reference(q, "  "))

    def test_star_saves_without_counting_a_mistake(self):
        p = {"seq": 0, "items": {}}
        item = cloze.record(p, "t1", "star", D0)
        self.assertEqual((item["status"], item["wrong"], item["attempts"]), ("learning", 0, 0))
        self.assertEqual(item["srs"]["due"], (D0 + timedelta(days=1)).isoformat(), "first review tomorrow")
        self.assertTrue(translate.in_wrong_book(p, "t1"))
        self.assertIsNone(cloze.next_question(self.sentences, p, {"type": "passive"}, D0),
                          "not due again today")
        row, = translate.wrong_book(self.sentences, p)
        self.assertTrue(row["starred"])
        self.assertTrue(cloze.remove_from_wrong_book(p, "t1"))
        self.assertNotIn("starred", p["items"]["t1"])
        self.assertEqual(translate.wrong_book(self.sentences, p), [])

    def test_star_on_a_passed_sentence_restarts_its_schedule(self):
        p = {"seq": 0, "items": {}}
        cloze.record(p, "t2", "correct", D0)
        cloze.record(p, "t2", "star", D0)
        self.assertEqual(p["items"]["t2"]["srs"]["interval"], 1)
        # Starring something already being redone keeps its schedule.
        cloze.record(p, "t1", "wrong", D0)
        before = dict(p["items"]["t1"]["srs"])
        cloze.record(p, "t1", "star", D0)
        self.assertEqual(p["items"]["t1"]["srs"], before)

    def test_filters_counts_and_outcomes(self):
        p = {"seq": 0, "items": {}}
        self.assertEqual(cloze.next_question(self.sentences, p, {"type": "compare"}, D0)["id"], "t2")
        cloze.record(p, "t2", "correct", D0)
        translate.remember_answer(p, "t2", "This is cheaper.", "good")
        self.assertEqual(p["items"]["t2"]["last_answer"], "This is cheaper.")
        c = translate.counts(self.sentences, p, {"type": "compare"})
        self.assertEqual(c["types"], {"passive": {"total": 1, "left": 1}, "compare": {"total": 1, "left": 0}})
        self.assertEqual(list(c["scenes"]), ["home"])

    def test_tried_moves_on_without_the_wrong_book(self):
        p = {"seq": 0, "items": {}}
        item = cloze.record(p, "t1", "tried", D0)
        self.assertEqual((item["status"], item["wrong"]), ("tried", 1))
        self.assertFalse(translate.in_wrong_book(p, "t1"))
        self.assertFalse(cloze.is_left(p, "t1"))
        self.assertIsNone(cloze.next_question(self.sentences, p, {"type": "passive"}, D0), "done, not served again")
        stats = cloze.stats(self.sentences, p, D0)
        self.assertEqual((stats["tried"], stats["unseen"]), (1, 1))
        # A sentence already being redone stays scheduled and in the book.
        cloze.record(p, "t2", "wrong", D0)
        cloze.record(p, "t2", "tried", D0)
        self.assertEqual(p["items"]["t2"]["status"], "learning")
        self.assertTrue(translate.in_wrong_book(p, "t2"))

    def test_grade_translation_parses_and_trims(self):
        def post(payload, key):
            self.assertIn("Learner: I has gone", payload["messages"][1]["content"])
            return {"choices": [{"message": {"content": json.dumps({
                "verdict": "fix", "issues": [{"original": "has", "better": "have", "why": "主谓一致"}] * 5,
                "fixed": "I have gone."})}}]}
        r = ai.grade_translation("我走了", "I'm off.", " I has gone ", "k", post=post)
        self.assertEqual((r["verdict"], len(r["issues"]), r["fixed"]), ("fix", 3, "I have gone."))

        def good(payload, key):
            return {"choices": [{"message": {"content": json.dumps({
                "verdict": "good", "issues": [{"original": "a", "better": "b", "why": "c"}], "fixed": "x"})}}]}
        self.assertEqual(ai.grade_translation("z", "e", "a", "k", post=good),
                         {"verdict": "good", "issues": [], "fixed": ""})

        def odd(payload, key):
            return {"choices": [{"message": {"content": json.dumps({"verdict": "great"})}}]}
        self.assertEqual(ai.grade_translation("z", "e", "a", "k", post=odd)["verdict"], "fix")
        with self.assertRaises(ai.AIError):
            ai.grade_translation("z", "e", "a", "", post=good)


class TranslateBankTest(unittest.TestCase):
    def test_bank_passes_the_checker(self):
        sys.path.insert(0, str(ROOT / "tools"))
        import check_bank
        self.assertEqual(check_bank.check_translate(ROOT / "translate"), [])

    def test_every_type_has_twenty_per_level(self):
        sentences = translate.load(ROOT / "translate")
        types = {q["type"] for q in sentences.values()}
        self.assertEqual(types, {"subjectless", "topic", "existential", "questions", "polite", "relative",
                                 "time_if", "reason_contrast", "tense", "passive", "compare"})
        for t in types:
            for level in (1, 2, 3):
                n = sum(1 for q in sentences.values() if q["type"] == t and q["level"] == level)
                self.assertEqual(n, 20, f"{t} L{level}")


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


    def test_tags_are_cleaned_and_merged(self):
        self.assertEqual(words.clean_tags(" Manual , restaurant / Café  &  coffee,,manual"),
                         ["Manual", "restaurant/Café & coffee"])
        w, _ = self.add("flat white", tags=["Manual"])
        self.add("Flat whites", tags=["Restaurant", "Restaurant/Coffee"], zh="馥芮白", wiki="Flat white")
        self.assertEqual(w["tags"], ["Manual", "Restaurant", "Restaurant/Coffee"])
        self.assertEqual((w["zh"], w["wiki"]), ("馥芮白", "Flat white"))
        words.update_word(self.data, w["id"], {"tags": "Work/Meetings"})
        self.assertEqual(w["tags"], ["Work/Meetings"])

    def test_tag_filter_and_counts(self):
        self.add("aioli", tags=["Restaurant", "Restaurant/Sauces"])
        self.add("excavator", tags=["Construction"])
        legacy, _ = self.add("in the zone")
        del legacy["tags"]  # made before tags existed
        self.assertEqual(words.tag_counts(self.data),
                         {"Construction": 1, "Restaurant": 1, "Restaurant/Sauces": 1, words.UNTAGGED: 1})
        self.assertEqual(words.next_word(self.data, D0, 5, ["restaurant"])["term"], "aioli")
        self.assertEqual(words.next_word(self.data, D0, 5, ["Restaurant/Sauces"])["term"], "aioli")
        self.assertIsNone(words.next_word(self.data, D0, 5, ["Restaurant/Coffee"]))
        self.assertIsNone(words.next_word(self.data, D0, 5, ["Rest"]))  # whole tag parts only
        self.assertEqual(words.next_word(self.data, D0, 5, [words.UNTAGGED])["term"], "in the zone")
        self.assertEqual(words.counts(self.data, D0, 5, ["Construction"])["total"], 1)
        self.assertEqual(words.parse_filter(" Restaurant, ,Data  reporting"), ["Restaurant", "Data reporting"])

    def test_daily_new_limit_is_shared_by_all_tags(self):
        a, _ = self.add("aioli", tags=["Restaurant"])
        self.add("excavator", tags=["Construction"])
        words.rate_word(self.data, a["id"], "remember", D0)
        self.assertIsNone(words.next_word(self.data, D0, 1, ["Construction"]))
        self.assertEqual(words.counts(self.data, D0, 1, ["Construction"])["new_today_left"], 0)

    def test_packs_add_in_order_with_topic_tags(self):
        pack = {"tag": "Restaurant", "name": "R", "description": "", "words": [
            {"term": "long black", "topic": "Coffee", "zh": "长黑", "definition": "d", "examples": []},
            {"term": "aioli", "topic": "Sauces", "zh": "蒜泥蛋黄酱", "definition": "d", "examples": [], "wiki": "Aioli"},
            {"term": "flat white", "topic": "Coffee", "zh": "馥芮白", "definition": "d", "examples": []},
        ]}
        self.add("aioli", tags=["Manual"])
        self.assertEqual(words.add_pack(self.data, pack, D0, ["Coffee"]), {"added": 2, "merged": 0})
        self.assertEqual(words.add_pack(self.data, pack, D0), {"added": 0, "merged": 3})
        aioli = words.find_duplicate(self.data, "aioli")
        self.assertEqual(aioli["tags"], ["Manual", "Restaurant", "Restaurant/Sauces"])
        self.assertEqual(aioli["wiki"], "Aioli")
        order = []
        while (w := words.next_word(self.data, D0, 10, ["Restaurant/Coffee"])) is not None:
            order.append(w["term"])
            words.rate_word(self.data, w["id"], "remember", D0)
        self.assertEqual(order, ["long black", "flat white"])
        words.add_pack(self.data, {"tag": "T", "words": [{"term": "I’m  KPI", "topic": "x"}]}, D0)
        self.assertIsNotNone(next(w for w in self.data["words"].values() if w["term"] == "I'm KPI"))
        self.assertEqual(words.add_pack(self.data, pack, D0 + timedelta(days=1), terms=["nope"]), {"added": 0, "merged": 0})
        summary = words.pack_summaries({"r": pack}, self.data)[0]
        self.assertEqual((summary["count"], summary["in_bank"], summary["topics"]), (3, 3, {"Coffee": 2, "Sauces": 1}))


class ImagesTest(unittest.TestCase):
    JPEG = b"\xff\xd8\xff\xe0 fake jpeg"

    def test_sniff(self):
        self.assertEqual(images.sniff(self.JPEG), "jpg")
        self.assertEqual(images.sniff(b"RIFF\0\0\0\0WEBPVP8 "), "webp")
        for bad in (b"", b"<svg/>", b"\xff\xd8\xff" + b"0" * images.MAX_IMAGE_BYTES):
            with self.assertRaises(images.ImageError):
                images.sniff(bad)

    def test_wiki_photo_falls_back_to_search_and_checks_host(self):
        def get(url):
            if "summary/Flat_whites" in url:
                return b'{"type": "disambiguation"}'
            if "srsearch=" in url:
                return json.dumps({"query": {"search": [{"title": "Flat white"}]}}).encode()
            if "summary/Flat_white" in url:
                return json.dumps({"type": "standard", "title": "Flat white",
                                   "thumbnail": {"source": "https://upload.wikimedia.org/x.jpg"}}).encode()
            if url == "https://upload.wikimedia.org/x.jpg":
                return self.JPEG
            raise AssertionError(url)

        image, credit = images.wiki_photo("Flat whites", "flat white", get=get)
        self.assertEqual((image, credit), (self.JPEG, "Photo: Wikipedia, Flat white"))

        def evil(url):
            return json.dumps({"type": "standard", "thumbnail": {"source": "https://evil.example/x.jpg"}}).encode()
        with self.assertRaises(images.ImageError):
            images.wiki_photo("X", get=evil)

        def busy(url):
            raise images.ImageError("Wikipedia is busy", 429)
        with self.assertRaisesRegex(images.ImageError, "busy"):
            images.wiki_photo("Flat white", get=busy)

    def test_ai_picture(self):
        sent = {}

        def post(payload, key):
            sent.update(payload)
            return {"data": [{"b64_json": base64.b64encode(b"RIFF\0\0\0\0WEBPVP8 ").decode()}]}

        word = {"term": "excavator", "definition": "A digging machine.", "zh": "挖掘机",
                "tags": ["Construction", "Construction/Plant"]}
        image, credit = images.ai_picture(word, "sk", post=post)
        self.assertTrue(image.startswith(b"RIFF"))
        self.assertEqual((sent["model"], sent["quality"]), (images.IMAGE_MODEL, "low"))
        self.assertIn('"excavator"', sent["prompt"])
        self.assertIn("context of Construction.", sent["prompt"])
        with self.assertRaises(ai.AIError):
            images.ai_picture(word, "", post=post)


class VocabPackTest(unittest.TestCase):
    def test_packs_pass_the_checker(self):
        sys.path.insert(0, str(ROOT / "tools"))
        import check_bank
        self.assertEqual(check_bank.check_vocab(ROOT / "vocab"), [])
        packs = words.load_packs(ROOT / "vocab")
        self.assertEqual({p["tag"] for p in packs.values()},
                         {"Restaurant", "Construction", "Data reporting", "Self-introduction", "Meeting language"})

    def test_data_speaking_tracks(self):
        bank = practice.load_prompts(ROOT / "prompts")
        data = {k: t for k, t in bank["speak"]["tracks"].items() if k.startswith("data_")}
        self.assertEqual(set(data), {"data_numbers", "data_charts", "data_meeting"})
        for t in data.values():
            self.assertEqual((t["group"], t["focus"]), ("Presenting data", "data"))
            self.assertTrue(all(p.get("example") for p in t["prompts"]))

    def test_self_introduction_tracks(self):
        bank = practice.load_prompts(ROOT / "prompts")
        intro = {k: t for k, t in bank["speak"]["tracks"].items() if k.startswith("intro_")}
        self.assertEqual(set(intro), {"intro_client", "intro_role", "intro_more"})
        packs = words.load_packs(ROOT / "vocab")
        for t in intro.values():
            self.assertEqual((t["group"], t["focus"]), ("Introducing yourself", "intro"))
            self.assertIn(t["pack"], packs)
            self.assertTrue(all(p.get("example") for p in t["prompts"]))
        # Every track's phrase panel points at a pack that exists.
        for module in bank.values():
            for t in module["tracks"].values():
                if t.get("pack"):
                    self.assertIn(t["pack"], packs)


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

    def test_extra_tracks_in_a_ladder_are_always_open(self):
        self.bank["write"]["tracks"]["st_chat"] = {
            "name": "Chat", "group": "Small talk", "focus": "smalltalk",
            "prompts": [{"id": "st-1", "level": 3, "task": "t", "zh": "说", "module": "write",
                         "track": "st_chat", "focus": "smalltalk"}]}
        self.assertFalse(practice.is_locked(self.bank, self.data, "write", "st_chat"))
        tracks = {t["id"]: t for t in practice.meta(self.bank, self.data)["write"]["tracks"]}
        self.assertEqual((tracks["l1"]["group"], tracks["l1"]["level"]), ("Levels", 1))
        self.assertEqual((tracks["st_chat"]["group"], tracks["st_chat"]["level"], tracks["st_chat"]["locked"]),
                         ("Small talk", None, False))
        self.assertTrue(tracks["l2"]["locked"])
        # Sessions on an extra track never unlock ladder levels.
        for _ in range(practice.UNLOCK_SESSIONS + 2):
            self.do(self.bank["write"]["tracks"]["st_chat"]["prompts"][0], "Not bad thanks, busy week.", score=5)
        self.assertTrue(practice.is_locked(self.bank, self.data, "write", "l2"))
        toast = practice.meta(self.bank, self.data)["toast"]["tracks"][0]
        self.assertEqual((toast["group"], toast["level"]), ("", None))

    def test_growth_is_cumulative_per_day(self):
        sessions = [
            {"date": "2026-11-08", "module": "write", "seconds": 120},
            {"date": "2026-11-08", "module": "speak", "seconds": 60},
            {"date": "2026-11-10", "module": "toast", "seconds": 90},
            {"date": "2026-11-10", "module": "improv", "seconds": 30},
            {"date": "2026-11-10", "module": "write", "seconds": 30},
        ]
        g = practice.growth(sessions, ["2026-11-07", "2026-11-09", "2026-11-09", ""], D0)
        self.assertEqual([d["date"] for d in g], ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10"])
        self.assertEqual([d["words"] for d in g], [1, 1, 3, 3])
        self.assertEqual([d["speak_minutes"] for d in g], [0, 1.0, 1.0, 3.0])
        self.assertEqual([d["write_minutes"] for d in g], [0, 2.0, 2.0, 2.5])
        self.assertEqual(practice.growth([], [], D0), [])
        self.assertEqual(len(practice.growth([], ["2026-11-10"], D0)), 1, "a single day still gives a point")

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
                    # Conversations run several turns each, so a scenario track needs fewer.
                    self.assertGreaterEqual(len(t["prompts"]), 7 if module == "talk" else 20)
                    for p in t["prompts"]:
                        self.assertNotIn(p["id"], ids)
                        ids.add(p["id"])
                        self.assertTrue(p["task"].strip() and p["zh"].strip())
        levels = [f"l{i}" for i in range(1, 7)]
        self.assertEqual(list(bank["write"]["tracks"]),
                         levels + ["ww_teams", "ww_status", "ww_risk", "ww_notes", "ww_email"])
        self.assertTrue(all(t["focus"] == "workwriting" and all(p.get("example") for p in t["prompts"])
                            for k, t in bank["write"]["tracks"].items() if k.startswith("ww_")))
        meeting = {k: t for k, t in bank["speak"]["tracks"].items() if k.startswith("mt_")}
        self.assertEqual(len(meeting), 6)
        self.assertTrue(all(p.get("say") and p.get("example") for t in meeting.values() for p in t["prompts"]))
        self.assertEqual(list(bank["speak"]["tracks"])[:6], levels)
        self.assertTrue(bank["write"]["ladder"] and bank["speak"]["ladder"])
        self.assertEqual(len(bank["toast"]["tracks"]["table_topics"]["prompts"]), 100)

    def test_small_talk_section(self):
        bank = practice.load_prompts(ROOT / "prompts")
        small = {k: t for k, t in bank["speak"]["tracks"].items() if k.startswith("st_")}
        self.assertEqual(len(small), 10)
        prompts = [p for t in small.values() for p in t["prompts"]]
        self.assertEqual(len(prompts), 400)
        for t in small.values():
            self.assertEqual((t["group"], t["focus"], t["green"] < t["red"] <= 30), ("Small talk", "smalltalk", True))
        self.assertTrue(all(p["focus"] == "smalltalk" and p["example"].strip() for p in prompts))
        self.assertGreaterEqual(sum(1 for p in prompts if p.get("say")), 350, "most prompts give a line to answer")
        self.assertEqual(bank["speak"]["tracks"]["l3"]["prompts"][0]["focus"], "speak")
        intro = [p for p in prompts if "{name}" in p["example"]]
        self.assertGreaterEqual(len(intro), 8, "self-introductions use the learner's own name")
        invented = ("I'm Wei", "I'm Jun", "Chengdu, in China", "my wife", "Ben's dad")
        self.assertFalse([p["id"] for p in prompts if any(x in p["example"] for x in invented)])
        self.assertIs(practice.find_prompt(bank, "nope"), None)


class CheckerTest(unittest.TestCase):
    def test_question_notes_are_validated(self):
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "questions" / "particle"
            folder.mkdir(parents=True)
            base = {"level": 1, "g": "-", "zh": "我们开车去汉密尔顿。"}
            rows = [base | {"id": "pt-x-01", "en": "We drove {down} to Hamilton.", "note": "Down means south: Hamilton is south of Auckland."},
                    base | {"id": "pt-x-02", "en": "We flew {up} to Auckland.", "note": "向北"},
                    base | {"id": "pt-x-03", "en": "We went {over} to the Shore.", "note": "Over."}]
            (folder / "x.json").write_text(json.dumps(rows, ensure_ascii=False))
            out = subprocess.run([sys.executable, str(ROOT / "tools" / "check_bank.py"), str(folder)],
                                 capture_output=True, text=True).stdout
        self.assertIn("2 errors", out)
        self.assertIn("pt-x-02: note must be English", out)
        self.assertIn("pt-x-03: note should be", out)

    def test_prompt_examples_are_validated(self):
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "prompts" / "speak"
            folder.mkdir(parents=True)
            good = {"id": "s-st_x-01", "level": 1, "task": "Reply.", "zh": "回答。", "say": "Hi!",
                    "example": "Hey, not bad thanks. You?"}
            rows = [good, good | {"id": "s-st_x-02", "example": "你好"},
                    good | {"id": "s-st_x-03", "example": "Hi"}, good | {"id": "s-st_x-04", "example": ""},
                    good | {"id": "s-st_x-05", "example": "Hi, I'm {name} from {hometown}. You?"},
                    good | {"id": "s-st_x-06", "example": "Hi, I'm {first_name}, nice to meet you."}]
            (folder / "st_x.json").write_text(json.dumps(rows))
            out = subprocess.run([sys.executable, str(ROOT / "tools" / "check_bank.py"), str(folder)],
                                 capture_output=True, text=True).stdout
        self.assertIn("4 errors", out)
        self.assertIn("s-st_x-06: example may only use the placeholders", out)
        self.assertNotIn("s-st_x-05", out)
        self.assertIn("s-st_x-02: example must be English", out)
        self.assertIn("s-st_x-03: example should be 3-60 words", out)
        self.assertNotIn("s-st_x-01", out)


class PrivateTracksTest(unittest.TestCase):
    def test_private_tracks_are_added_and_marked(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "speak"
            folder.mkdir()
            (folder / "_meta.json").write_text(json.dumps({"tracks": {"mine": {"name": "Mine", "focus": "showcase"}}}))
            (folder / "mine.json").write_text(json.dumps([{"id": "p-1", "level": 3, "task": "Talk.", "zh": "说。"}]))
            bank = practice.load_prompts(ROOT / "prompts", Path(tmp))
            mine = bank["speak"]["tracks"]["mine"]
            self.assertTrue(mine["private"])
            self.assertEqual(mine["prompts"][0] | {}, mine["prompts"][0])
            self.assertTrue(mine["prompts"][0]["private"])
            self.assertEqual(mine["prompts"][0]["focus"], "showcase")
            self.assertNotIn("private", bank["speak"]["tracks"]["l1"]["prompts"][0])
            self.assertTrue(practice.meta(bank, practice.DEFAULT_PRACTICE | {"done": {}, "sessions": []})
                            ["speak"]["tracks"][-1]["private"])
            (folder / "_meta.json").write_text(json.dumps({"tracks": {"l1": {"name": "Clash"}}}))
            with self.assertRaises(ValueError):
                practice.load_prompts(ROOT / "prompts", Path(tmp))


class TalkAiTest(unittest.TestCase):
    scenario = {"role": "Tom, your manager.", "setting": "Desk.", "task": "Give an update.", "brief": "40 servers."}

    def test_reply_last_line_and_brief(self):
        seen = {}

        def post(payload, key):
            seen["system"], seen["user"] = payload["messages"][0]["content"], payload["messages"][1]["content"]
            return {"choices": [{"message": {"content": '{"line": "  Thanks,   talk soon. "}'}}]}

        history = [{"who": "ai", "text": "How's it going?"}, {"who": "me", "text": "Good."}]
        line = ai.talk_reply(self.scenario, history, 0, "Ping", "k", post=post)
        self.assertEqual(line, "Thanks, talk soon.")
        self.assertIn("Tom, your manager.", seen["system"])
        self.assertIn("40 servers.", seen["system"])
        self.assertIn("The learner's name is Ping.", seen["system"])
        self.assertIn("Learner: Good.", seen["user"])
        self.assertIn("last line", seen["user"])
        ai.talk_reply(self.scenario, [], 3, "", "k", post=post)
        self.assertIn("Open the conversation", seen["user"])

        def empty(payload, key):
            return {"choices": [{"message": {"content": '{"line": ""}'}}]}

        with self.assertRaises(ai.AIError):
            ai.talk_reply(self.scenario, history, 1, "", "k", post=empty)

    def test_hint_and_feedback_are_cleaned(self):
        def post(payload, key):
            content = ('{"score": 9, "comment": "好", "handling": "先回答", "turns": [{"you": "a", "better": "b"}, 3],'
                       '"issues": [{"original": "x", "better": "y", "why": "z"}], "vocab": "none",'
                       '"starter": "So…", "points": ["a", "b", "c", "d"], "zh": "说"}')
            return {"choices": [{"message": {"content": content}}]}

        f = ai.talk_feedback(self.scenario, [{"who": "me", "text": "hi"}], "k", post=post)
        self.assertEqual(f["score"], 5)
        self.assertEqual(f["turns"], [{"you": "a", "better": "b"}])
        self.assertEqual(f["vocab"], [])
        h = ai.talk_hint(self.scenario, [], "k", post=post)
        self.assertEqual(h, {"starter": "So…", "points": ["a", "b", "c"], "zh": "说"})


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
