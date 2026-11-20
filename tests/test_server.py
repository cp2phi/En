import http.client
import json
import subprocess
import tempfile
import threading
import unittest
from datetime import date, datetime
from pathlib import Path

import base64

from app import ai, images
from app.server import make_server
from app.sync import sync


def practice_prompt(app, module, track):
    return app.prompts[module]["tracks"][track]["prompts"][0]


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.explained = []

        def fake_explain(focus, sentence, key, model):
            self.explained.append((focus, sentence, key, model))
            return {"term": focus, "notes": []}

        self.feedback_calls = []

        def fake_feedback(module, task, text, mode, key, model):
            self.feedback_calls.append((module, task, text, mode))
            return {"natural": "Better.", "issues": [], "vocab": [], "score": 4, "comment": "好"}

        def fake_transcribe(audio, mime, key):
            if not key:
                raise ai.AIError("no key")
            return f"heard {len(audio)} bytes of {mime}"

        self.speech_calls = []

        def fake_speech(text, voice, accent, pace, key, model):
            if not key:
                raise ai.AIError("no key")
            self.speech_calls.append((text, voice, accent, pace, model))
            used = ai.TTS_FALLBACK_MODEL if text == "old model gone" else model
            return f"ID3 {text}|{voice}|{accent}|{pace}".encode(), used

        self.grade_calls = []

        def fake_grade(zh, reference, answer, key, model):
            self.grade_calls.append(answer)
            if answer == "boom":
                raise ai.AIError("AI down")
            return {"verdict": "fix", "issues": [{"original": "x", "better": "y", "why": "原因"}], "fixed": "Fixed."}

        self.photo_calls = []

        def fake_wiki_photo(title, search=""):
            self.photo_calls.append(("wiki", title, search))
            if title == "Nothing":
                raise images.ImageError("No Wikipedia photo found.")
            return b"\xff\xd8\xff wiki", f"Photo: Wikipedia, {title}"

        def fake_ai_picture(word, key):
            if not key:
                raise ai.AIError("No OpenAI key yet.")
            self.photo_calls.append(("ai", word["term"], key))
            return b"\x89PNG\r\n\x1a\n ai", "AI picture"

        self.server = make_server(self.root, port=0, today=lambda: date(2026, 11, 10), explain=fake_explain,
                                  feedback=fake_feedback, transcribe=fake_transcribe, speech=fake_speech,
                                  wiki_photo=fake_wiki_photo, ai_picture=fake_ai_picture, grade=fake_grade)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = dict(headers or {})
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=data, headers=hdrs)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        ctype = response.getheader("Content-Type", "")
        return response.status, (json.loads(raw) if "json" in ctype else raw)

    def test_static_files_and_traversal(self):
        status, body = self.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"English Practice", body)
        self.assertEqual(self.call("GET", "/app.js")[0], 200)
        self.assertEqual(self.call("GET", "/../run.py")[0], 404)
        self.assertEqual(self.call("GET", "/%2e%2e/run.py")[0], 404)

    def test_rejects_foreign_host_and_non_json_posts(self):
        self.assertEqual(self.call("GET", "/api/summary", headers={"Host": "evil.example"})[0], 403)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("POST", "/api/sync", body="x=1", headers={"Content-Type": "text/plain"})
        self.assertEqual(conn.getresponse().status, 415)
        conn.close()

    def test_cloze_flow(self):
        status, meta = self.call("GET", "/api/cloze/meta")
        self.assertEqual((status, meta["pos"]["verb"]), (200, 200))
        self.assertEqual(meta["by_pos"]["grammar"]["past"], 100)
        self.assertEqual(meta["counts"]["pos"]["verb"], {"total": 200, "left": 200})
        _, scoped = self.call("GET", "/api/cloze/meta?pos=grammar&scene=past")
        self.assertEqual(sum(c["total"] for c in scoped["counts"]["levels"].values()), 100)
        self.assertIn("past", scoped["counts"]["scenes"])
        self.assertNotIn("work", scoped["counts"]["scenes"], "scenes are limited to the word class")
        _, drill = self.call("GET", "/api/cloze/next?pos=grammar&scene=past")
        blank = next(seg for seg in drill["question"]["segments"] if "blank" in seg)
        self.assertNotIn("cue", blank)
        self.assertRegex(blank["hint"], r"^[A-Za-z]$", "grammar drills show the first letter only")
        _, s = self.call("GET", "/api/settings")
        self.assertIs(s["letter_hint"], True, "on by default")
        self.call("PUT", "/api/settings", {"letter_hint": False})
        _, hidden = self.call("GET", "/api/cloze/next?pos=verb&scene=work")
        self.assertEqual({seg["hint"] for seg in hidden["question"]["segments"] if "blank" in seg}, {""})
        self.assertEqual(self.call("PUT", "/api/settings", {"letter_hint": "no"})[0], 400)
        self.call("PUT", "/api/settings", {"letter_hint": True})
        _, nxt = self.call("GET", "/api/cloze/next?pos=verb&scene=work&level=3")
        q = nxt["question"]
        self.assertEqual((q["pos"], q["scene"], q["level"]), ("verb", "work", 3))
        self.assertFalse(nxt["redo"])

        _, solution = self.call("GET", f"/api/cloze/solution?id={q['id']}")
        self.assertIn("note", solution)
        _, wrong = self.call("POST", "/api/cloze/answer", {"id": q["id"], "answers": ["zzzzzz"]})
        self.assertFalse(wrong["correct"])
        self.assertNotIn("sentence", wrong, "the answer is not leaked on a wrong attempt")
        # A retry with record=false must not change progress.
        _, retry = self.call("POST", "/api/cloze/answer",
                             {"id": q["id"], "answers": solution["answers"], "record": False})
        self.assertTrue(retry["correct"])
        _, book = self.call("GET", "/api/cloze/wrongbook")
        self.assertEqual([i["id"] for i in book["items"]], [q["id"]])
        _, summary = self.call("GET", "/api/summary")
        self.assertEqual((summary["cloze"]["learning"], summary["cloze"]["due"]), (1, 1))
        _, after = self.call("GET", "/api/cloze/meta")
        self.assertEqual(after["counts"]["pos"]["verb"], {"total": 200, "left": 199})

        self.assertEqual(self.call("POST", "/api/cloze/wrongbook/remove", {"id": q["id"]})[0], 200)
        self.assertEqual(self.call("GET", "/api/cloze/wrongbook")[1]["items"], [])
        self.assertEqual(self.call("POST", "/api/cloze/wrongbook/remove", {"id": q["id"]})[0], 404)
        self.call("POST", "/api/cloze/answer", {"id": q["id"], "answers": ["zzzzzz"]})
        self.assertEqual(len(self.call("GET", "/api/cloze/wrongbook")[1]["items"]), 1, "back after another miss")

        self.call("POST", "/api/cloze/mark", {"id": q["id"], "outcome": "never"})
        _, book = self.call("GET", "/api/cloze/wrongbook")
        self.assertEqual(book["items"], [])
        self.assertEqual(self.call("POST", "/api/cloze/answer", {"id": "nope", "answers": []})[0], 404)
        self.assertEqual(self.call("POST", "/api/cloze/mark", {"id": q["id"], "outcome": "correct"})[0], 400)

    def test_translate_flow(self):
        _, meta = self.call("GET", "/api/translate/meta")
        self.assertGreater(meta["total"], 0)
        some_type = next(iter(meta["counts"]["types"]))
        _, nxt = self.call("GET", f"/api/translate/next?type={some_type}&level=1")
        q = nxt["question"]
        self.assertEqual((q["type"], q["level"]), (some_type, 1))
        self.assertNotIn("en", q, "the answer is not sent before answering")
        self.assertFalse(nxt["in_wrong_book"])

        # No key: no AI call, no verdict, the learner marks it.
        _, r = self.call("POST", "/api/translate/check", {"id": q["id"], "answer": "something else entirely"})
        self.assertEqual((r["verdict"], self.grade_calls), (None, []))
        self.assertTrue(r["en"])
        self.assertEqual(self.call("POST", "/api/translate/check", {"id": q["id"], "answer": " "})[0], 400)
        _, m = self.call("POST", "/api/translate/mark", {"id": q["id"], "outcome": "wrong"})
        self.assertTrue(m["in_wrong_book"])
        _, book = self.call("GET", "/api/translate/wrongbook")
        self.assertEqual(book["items"][0]["last_answer"], "something else entirely")

        # The reference itself passes without asking the AI, even with a key.
        self.call("PUT", "/api/settings", {"openai_key": "sk-test"})
        _, r = self.call("POST", "/api/translate/check", {"id": q["id"], "answer": r["en"].upper()})
        self.assertEqual((r["verdict"], self.grade_calls), ("good", []))
        _, r = self.call("POST", "/api/translate/check", {"id": q["id"], "answer": "my own try"})
        self.assertEqual((r["verdict"], r["fixed"], self.grade_calls), ("fix", "Fixed.", ["my own try"]))

        # A wrong answer is not recorded until the learner picks Next or Save & next.
        _, fresh = self.call("GET", f"/api/translate/next?type={some_type}&level=3")
        fid = fresh["question"]["id"]
        _, r = self.call("POST", "/api/translate/check", {"id": fid, "answer": "a wrong try"})
        self.assertEqual((r["verdict"], r["in_wrong_book"]), ("fix", False))
        _, m = self.call("POST", "/api/translate/mark", {"id": fid, "outcome": "tried"})
        self.assertFalse(m["in_wrong_book"])
        _, book = self.call("GET", "/api/translate/wrongbook")
        self.assertNotIn(fid, [i["id"] for i in book["items"]])
        _, r = self.call("POST", "/api/translate/check", {"id": q["id"], "answer": "boom"})
        self.assertEqual((r["verdict"], r["ai_error"]), (None, "AI down"))

        # Star, remove, reveal, never.
        _, other = self.call("GET", f"/api/translate/next?type={some_type}&level=2")
        oid = other["question"]["id"]
        self.assertTrue(self.call("POST", "/api/translate/mark", {"id": oid, "outcome": "star"})[1]["in_wrong_book"])
        _, book = self.call("GET", "/api/translate/wrongbook")
        self.assertIn(oid, [i["id"] for i in book["items"] if i["starred"]])
        self.assertEqual(self.call("POST", "/api/translate/wrongbook/remove", {"id": oid})[0], 200)
        self.assertEqual(self.call("POST", "/api/translate/wrongbook/remove", {"id": oid})[0], 404)
        self.assertEqual(self.call("POST", "/api/translate/mark", {"id": oid, "outcome": "bogus"})[0], 400)
        self.assertEqual(self.call("POST", "/api/translate/mark", {"id": "nope", "outcome": "star"})[0], 404)
        _, summary = self.call("GET", "/api/summary")
        self.assertEqual(summary["translate"]["total"], meta["total"])
        self.assertTrue((self.root / "data" / "translate.json").exists())

    def test_words_flow(self):
        status, added = self.call("POST", "/api/words", {
            "term": "in the zone", "examples": [{"en": "You're in the zone.", "zh": "你很专注"}]})
        self.assertEqual((status, added["duplicate"]), (200, False))
        word_id = added["word"]["id"]
        self.assertTrue(self.call("POST", "/api/words", {"term": "In the zone"})[1]["duplicate"])
        self.assertEqual(self.call("POST", "/api/words", {"term": ""})[0], 400)

        _, nxt = self.call("GET", "/api/words/next")
        self.assertEqual(nxt["word"]["id"], word_id)
        _, rated = self.call("POST", "/api/words/rate", {"id": word_id, "rating": "forget"})
        self.assertEqual(rated["word"]["srs"]["same_day_left"], 2)
        self.assertEqual(self.call("POST", "/api/words/rate", {"id": word_id, "rating": "x"})[0], 400)
        self.assertEqual(self.call("POST", "/api/words/rate", {"id": "nope", "rating": "forget"})[0], 404)

        # "Previous card": take ratings back, newest first; failed ratings are not on the stack.
        self.assertTrue(self.call("GET", "/api/words/next")[1]["can_undo"])
        self.call("POST", "/api/words/rate", {"id": word_id, "rating": "never"})
        _, undone = self.call("POST", "/api/words/undo", {})
        self.assertEqual(undone["rating"], "never")
        self.assertFalse(undone["word"]["srs"]["never"])
        self.assertEqual(undone["word"]["srs"]["same_day_left"], 2)
        self.assertTrue(undone["can_undo"])
        _, undone = self.call("POST", "/api/words/undo", {})
        self.assertEqual(undone["rating"], "forget")
        self.assertIsNone(undone["word"]["introduced"])
        self.assertEqual(undone["word"]["srs"]["reps"], 0)
        self.assertFalse(undone["can_undo"])
        self.assertEqual(self.call("POST", "/api/words/undo", {})[0], 409)
        self.assertFalse(self.call("GET", "/api/words/next")[1]["can_undo"])

        self.call("PUT", f"/api/words/{word_id}", {"my_examples": ["I was in the zone."]})
        _, listing = self.call("GET", "/api/words")
        self.assertEqual(listing["words"][0]["my_examples"], ["I was in the zone."])
        self.assertEqual(self.call("DELETE", f"/api/words/{word_id}")[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/words/{word_id}")[0], 404)

    def test_word_tags_and_filter(self):
        self.call("POST", "/api/words", {"term": "aioli", "tags": "Restaurant/Sauces, Manual"})
        self.call("POST", "/api/words", {"term": "excavator", "tags": ["Construction"]})
        _, listing = self.call("GET", "/api/words")
        self.assertEqual(listing["tags"], {"Construction": 1, "Manual": 1, "Restaurant": 1, "Restaurant/Sauces": 1})
        _, nxt = self.call("GET", "/api/words/next?tags=Construction")
        self.assertEqual((nxt["word"]["term"], nxt["counts"]["total"]), ("excavator", 1))
        _, nxt = self.call("GET", "/api/words/next?tags=Restaurant,Nope")
        self.assertEqual(nxt["word"]["term"], "aioli")

    def test_word_packs(self):
        _, r = self.call("GET", "/api/words/packs")
        pack = r["packs"][0]
        self.assertEqual(pack["in_bank"], 0)
        topic = next(iter(pack["topics"]))
        _, added = self.call("POST", "/api/words/packs/add", {"id": pack["id"], "topics": [topic]})
        self.assertEqual(added, {"added": pack["topics"][topic], "merged": 0})
        _, tags = self.call("GET", "/api/words/tags")
        self.assertEqual(tags["tags"][f"{pack['tag']}/{topic}"], pack["topics"][topic])
        self.assertEqual(self.call("POST", "/api/words/packs/add", {"id": "nope"})[0], 404)
        _, full = self.call("GET", f"/api/words/packs/{pack['id']}")
        self.assertEqual((full["tag"], len(full["words"])), (pack["tag"], pack["count"]))
        in_bank = [w["term"] for w in full["words"] if w["in_bank"]]
        self.assertEqual(len(in_bank), pack["topics"][topic])
        # Preview, then add just two chosen cards from another topic.
        chosen = [w["term"] for w in full["words"] if not w["in_bank"]][:2]
        _, added = self.call("POST", "/api/words/packs/add", {"id": pack["id"], "terms": chosen})
        self.assertEqual(added, {"added": 2, "merged": 0})
        _, full = self.call("GET", f"/api/words/packs/{pack['id']}")
        self.assertEqual(sum(w["in_bank"] for w in full["words"]), pack["topics"][topic] + 2)
        self.assertEqual(self.call("POST", "/api/words/packs/add", {"id": pack["id"], "terms": "x"})[0], 400)
        self.assertEqual(self.call("GET", "/api/words/packs/nope")[0], 404)
        self.assertEqual(self.call("POST", "/api/words/packs/add", {"id": pack["id"], "topics": "x"})[0], 400)

    def test_word_pictures(self):
        _, added = self.call("POST", "/api/words", {"term": "flat white", "wiki": "Flat white"})
        wid = added["word"]["id"]
        images_dir = self.root / "data" / "images"

        _, r = self.call("POST", f"/api/words/{wid}/image", {"source": "wiki"})
        self.assertEqual(r["word"]["image"]["by"], "wiki")
        self.assertEqual(self.photo_calls[-1], ("wiki", "Flat white", "flat white"))
        status, raw = self.call("GET", f"/api/words/{wid}/image")
        self.assertEqual((status, raw), (200, b"\xff\xd8\xff wiki"))
        self.assertTrue((images_dir / f"{wid}.jpg").is_file())

        # AI needs a key; a new picture replaces the old file.
        self.assertEqual(self.call("POST", f"/api/words/{wid}/image", {"source": "ai"})[0], 502)
        self.call("PUT", "/api/settings", {"openai_key": "sk-k"})
        _, r = self.call("POST", f"/api/words/{wid}/image", {"source": "ai"})
        self.assertEqual(r["word"]["image"]["file"], f"{wid}.png")
        self.assertFalse((images_dir / f"{wid}.jpg").exists())

        upload = base64.b64encode(b"GIF89a mine").decode()
        _, r = self.call("POST", f"/api/words/{wid}/image", {"source": "upload", "data_b64": upload})
        self.assertEqual((r["word"]["image"]["file"], r["word"]["image"]["credit"]), (f"{wid}.gif", "Your picture"))
        bad = base64.b64encode(b"<svg onload=alert(1)>").decode()
        self.assertEqual(self.call("POST", f"/api/words/{wid}/image", {"source": "upload", "data_b64": bad})[0], 400)
        self.assertEqual(self.call("POST", f"/api/words/{wid}/image", {"source": "upload", "data_b64": "!!"})[0], 400)
        self.assertEqual(self.call("POST", f"/api/words/{wid}/image", {"source": "x"})[0], 400)
        self.assertEqual(self.call("POST", "/api/words/nope/image", {"source": "wiki"})[0], 404)
        self.assertEqual(self.call("POST", f"/api/words/{wid}/image", {"source": "wiki", "title": "Nothing"})[0], 502)

        # Preview photos come from the same cache, so Wikipedia is asked once per title.
        calls = len(self.photo_calls)
        status, raw = self.call("GET", "/api/wiki/photo?title=Flat%20white")
        self.assertEqual((status, raw, len(self.photo_calls)), (200, b"\xff\xd8\xff wiki", calls))
        self.assertEqual(self.call("GET", "/api/wiki/photo?title=Nothing")[0], 404)
        self.assertEqual(self.call("GET", "/api/wiki/photo")[0], 400)

        _, r = self.call("DELETE", f"/api/words/{wid}/image")
        self.assertIsNone(r["word"]["image"])
        self.assertEqual(self.call("GET", f"/api/words/{wid}/image")[0], 404)
        self.call("POST", f"/api/words/{wid}/image", {"source": "upload", "data_b64": upload})
        self.call("DELETE", f"/api/words/{wid}")
        self.assertEqual(list(images_dir.iterdir()), [])

    def test_settings_role_and_company(self):
        _, s = self.call("PUT", "/api/settings", {"my_role": "  Data   Engineer ", "my_company": "Acme"})
        self.assertEqual((s["my_role"], s["my_company"]), ("Data Engineer", "Acme"))
        self.assertEqual(self.call("PUT", "/api/settings", {"my_role": "{name}"})[0], 400)
        self.assertEqual(self.call("PUT", "/api/settings", {"my_company": "x" * 61})[0], 400)

    def test_settings_keep_key_out_of_data(self):
        _, s = self.call("PUT", "/api/settings", {"accent": "uk", "new_per_day": "7", "openai_key": "sk-secret"})
        self.assertEqual((s["accent"], s["new_per_day"], s["has_key"]), ("uk", 7, True))
        self.assertNotIn("sk-secret", json.dumps(s))
        for path in (self.root / "data").glob("*"):
            self.assertNotIn("sk-secret", path.read_text(encoding="utf-8"))
        self.assertIn("sk-secret", (self.root / "config.local.json").read_text(encoding="utf-8"))
        self.assertEqual(self.call("PUT", "/api/settings", {"accent": "fr"})[0], 400)

        self.call("POST", "/api/ai/explain", {"focus": "zone", "sentence": "In the zone."})
        self.assertEqual(self.explained[0][:3], ("zone", "In the zone.", "sk-secret"))


    def test_practice_flow(self):
        _, meta = self.call("GET", "/api/practice/meta")
        self.assertEqual(set(meta), {"write", "speak", "improv", "toast", "talk"})
        self.assertEqual([t["locked"] for t in meta["write"]["tracks"]], [False] + [True] * 5 + [False] * 5,
                         "levels unlock in turn; the work-writing tracks are always open")
        self.assertFalse(any(t["locked"] for t in meta["improv"]["tracks"]))
        self.assertEqual(self.call("GET", "/api/practice/next?module=write&track=l2")[0], 400)
        self.assertEqual(self.call("GET", "/api/practice/next?module=write&track=zz")[0], 404)

        _, nxt = self.call("GET", "/api/practice/next?module=write&track=l1")
        prompt = nxt["prompt"]
        body = {"prompt_id": prompt["id"], "text": "I will take 请假 tomorrow.", "seconds": 20, "mode": "write"}

        # Without a key: the session is counted, no feedback.
        status, r = self.call("POST", "/api/practice/submit", body)
        self.assertEqual(status, 200)
        self.assertEqual((r["feedback"], r["ai_error"], r["session"]["words"]), (None, None, 4))
        self.assertEqual(self.feedback_calls, [])
        self.assertEqual(self.call("POST", "/api/practice/transcribe", {"audio_b64": "AAAA"})[0], 502)

        self.call("PUT", "/api/settings", {"openai_key": "sk-secret"})
        for _ in range(4):
            _, r = self.call("POST", "/api/practice/submit", body)
        self.assertEqual(r["feedback"]["score"], 4)
        self.assertEqual(r["session"]["leveled_up"], 2)
        self.assertIn(prompt["zh"], self.feedback_calls[0][1], "translation tasks send the Chinese sentence")
        self.assertEqual(self.call("GET", "/api/practice/next?module=write&track=l2")[0], 200)

        _, heard = self.call("POST", "/api/practice/transcribe", {"audio_b64": "AAAA", "mime": "audio/mp4"})
        self.assertEqual(heard["text"], "heard 3 bytes of audio/mp4")
        self.assertEqual(self.call("POST", "/api/practice/transcribe", {"audio_b64": "!!"})[0], 400)

        _, topic = self.call("GET", "/api/practice/next?module=toast&track=table_topics")
        _, spoken = self.call("POST", "/api/practice/submit", {
            "prompt_id": topic["prompt"]["id"], "text": "Um, well, I think so.", "seconds": 75,
            "mode": "speak", "stuck": 1})
        self.assertEqual((spoken["session"]["fillers"], spoken["session"]["stuck"]), (1, 1))
        self.assertIn(topic["prompt"]["say"], self.feedback_calls[-1][1])
        self.assertEqual(self.feedback_calls[-1][0], "toast")

        # Small-talk tracks are open from the start and get small-talk feedback.
        _, chat = self.call("GET", "/api/practice/next?module=speak&track=st_basics")
        self.assertTrue(chat["prompt"]["example"])
        _, reply = self.call("POST", "/api/practice/submit", {
            "prompt_id": chat["prompt"]["id"], "text": "Not bad thanks, pretty busy week. How about you?",
            "seconds": 8, "mode": "speak"})
        self.assertEqual(self.feedback_calls[-1][0], "smalltalk")
        self.assertEqual(reply["session"]["track"], "st_basics")

        _, stats = self.call("GET", "/api/practice/stats")
        self.assertEqual(stats["modules"]["write"]["all"]["sessions"], 5)
        self.assertEqual(stats["modules"]["spoken"]["today"]["minutes"], 1.4)  # 75 s + 8 s small talk
        self.assertEqual((stats["levels"]["write"], stats["streak"]), (2, 1))
        self.assertEqual(stats["growth"], [{"date": "2026-11-10", "words": 0, "speak_minutes": 1.4, "write_minutes": 1.7}])
        journal = json.loads((self.root / "data" / "journal" / "2026-11.json").read_text(encoding="utf-8"))
        self.assertEqual(len(journal["entries"]), 7)  # 5 writing, 1 Table Topics, 1 small talk
        self.assertEqual(journal["entries"][0]["text"], body["text"])
        self.assertNotIn("sk-secret", (self.root / "data" / "practice.json").read_text(encoding="utf-8"))

        self.assertEqual(self.call("POST", "/api/practice/submit", {**body, "seconds": float("nan")})[0], 400)
        calls = len(self.feedback_calls)
        l3_prompt = practice_prompt(self.server.app, "write", "l3")
        self.assertEqual(self.call("POST", "/api/practice/submit", {**body, "prompt_id": l3_prompt["id"]})[0], 400)
        self.assertEqual(len(self.feedback_calls), calls, "no paid AI call for a locked level")
        self.assertEqual(self.call("POST", "/api/practice/submit", {"prompt_id": "nope", "mode": "write"})[0], 404)
        self.assertEqual(self.call("POST", "/api/practice/submit", {**body, "mode": "sing"})[0], 400)
        locked = meta["write"]["tracks"][5]["id"]
        _, deep = self.call("GET", "/api/practice/meta")
        self.assertTrue(next(t for t in deep["write"]["tracks"] if t["id"] == locked)["locked"])


    def test_tts_cache_fallback_and_settings(self):
        _, s = self.call("GET", "/api/settings")
        self.assertEqual((s["tts"], s["voice"], s["pace"], s["tts_model"]), ("openai", "marin", "normal", ai.TTS_MODEL))
        self.assertIn("cedar", s["voices"])
        self.assertEqual(self.call("POST", "/api/tts", {"text": "Hello."})[0], 502, "no key yet")

        self.call("PUT", "/api/settings", {"openai_key": "sk-secret", "accent": "uk"})
        status, audio = self.call("POST", "/api/tts", {"text": "  Hello   there. "})
        self.assertEqual((status, audio), (200, b"ID3 Hello there.|marin|uk|normal"))
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("POST", "/api/tts", body=json.dumps({"text": "Hello there."}),
                     headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        self.assertEqual((response.status, response.getheader("Content-Type"), response.read()),
                         (200, "audio/mpeg", b"ID3 Hello there.|marin|uk|normal"))
        conn.close()
        self.assertEqual(len(self.speech_calls), 1, "the second request is served from the cache")
        self.assertEqual(len(list((self.root / "cache" / "tts").glob("*.mp3"))), 1)

        # Preview overrides and a different voice are separate cache entries.
        self.assertEqual(self.call("POST", "/api/tts", {"text": "Hello there.", "voice": "cedar", "pace": "slow",
                                                        "accent": "us"})[1], b"ID3 Hello there.|cedar|us|slow")
        self.assertEqual(len(self.speech_calls), 2)
        for bad in ({"text": ""}, {"text": "x", "voice": "robot"}, {"text": "x", "accent": "fr"},
                    {"text": "x", "pace": "fast"}):
            self.assertEqual(self.call("POST", "/api/tts", bad)[0], 400, bad)
        self.assertEqual(self.call("GET", "/api/tts")[0], 404, "GET cannot trigger paid speech")

        # Once the chosen model is gone, later requests go straight to the fallback.
        self.call("POST", "/api/tts", {"text": "old model gone"})
        self.call("POST", "/api/tts", {"text": "Next one."})
        self.assertEqual(self.speech_calls[-1][4], ai.TTS_FALLBACK_MODEL)
        # Saving a model choice tries it again.
        self.call("PUT", "/api/settings", {"tts_model": ai.TTS_MODEL})
        self.call("POST", "/api/tts", {"text": "Third one."})
        self.assertEqual(self.speech_calls[-1][4], ai.TTS_MODEL)

        _, s = self.call("PUT", "/api/settings", {"my_name": "  Ping ", "hometown": "Hangzhou"})
        self.assertEqual((s["my_name"], s["hometown"]), ("Ping", "Hangzhou"))
        for bad in ({"my_name": "x" * 41}, {"hometown": "{name}"}, {"my_name": "<b>"}):
            self.assertEqual(self.call("PUT", "/api/settings", bad)[0], 400, bad)
        _, s = self.call("PUT", "/api/settings", {"tts": "browser", "voice": "cedar", "pace": "slow"})
        self.assertEqual((s["tts"], s["voice"], s["pace"]), ("browser", "cedar", "slow"))
        for bad in ({"tts": "robot"}, {"voice": "robot"}, {"pace": "fast"}, {"tts_model": "gpt-9"}):
            self.assertEqual(self.call("PUT", "/api/settings", bad)[0], 400, bad)
        self.assertNotIn("sk-secret", (self.root / "data" / "settings.json").read_text(encoding="utf-8"))


class TalkTest(unittest.TestCase):
    """Conversation practice, and private tracks that stay out of data/ and the synced cache."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        folder = self.root / "private" / "prompts" / "talk"
        folder.mkdir(parents=True)
        (folder / "_meta.json").write_text(json.dumps({"tracks": {"proj": {"name": "My project", "group": "Mine"}}}))
        (folder / "proj.json").write_text(json.dumps([{
            "id": "p-proj-01", "level": 4, "task": "Explain the project.", "zh": "讲项目。", "role": "A colleague.",
            "setting": "Kitchen.", "say": "So what's this project?", "turns": 2, "brief": "It moves 40 servers."}]))
        self.calls = []

        def fake_reply(scenario, history, turns_left, name, key, model):
            self.calls.append(("reply", scenario.get("brief"), len(history), turns_left, name))
            return "Bye then." if turns_left <= 0 else "Why?"

        def fake_hint(scenario, history, key, model):
            return {"starter": "Well, basically…", "points": ["what", "why"], "zh": "先回答"}

        def fake_feedback(scenario, history, key, model):
            self.calls.append(("feedback", [m["who"] for m in history]))
            return {"score": 4, "comment": "好", "handling": "不错", "turns": [{"you": "a", "better": "b"}],
                    "issues": [], "vocab": []}

        def fake_speech(text, voice, accent, pace, key, model):
            return b"ID3 " + text.encode(), model

        self.server = make_server(self.root, port=0, today=lambda: date(2026, 11, 10), speech=fake_speech,
                                  talk_reply=fake_reply, talk_hint=fake_hint, talk_feedback=fake_feedback)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    call = ServerTest.call

    def journal(self, folder):
        path = self.root / folder / "journal" / "2026-11.json"
        return json.loads(path.read_text(encoding="utf-8"))["entries"] if path.exists() else []

    def test_needs_a_key(self):
        status, r = self.call("POST", "/api/talk/turn", {"prompt_id": "c-updates-01", "history": []})
        self.assertEqual(status, 400)
        self.assertIn("OpenAI key", r["error"])

    def test_private_scenario_round_trip(self):
        self.call("PUT", "/api/settings", {"openai_key": "sk-test", "my_name": "Ping"})
        _, meta = self.call("GET", "/api/practice/meta")
        track = next(t for t in meta["talk"]["tracks"] if t["id"] == "proj")
        self.assertTrue(track["private"])
        self.assertFalse(next(t for t in meta["talk"]["tracks"] if t["id"] == "updates")["private"])

        history = [{"who": "ai", "text": "So what's this project?"}]
        status, r = self.call("POST", "/api/talk/turn", {"prompt_id": "p-proj-01", "history": history})
        self.assertEqual(status, 400, "the learner speaks next")
        history.append({"who": "me", "text": "It moves servers   to Azure."})
        _, r = self.call("POST", "/api/talk/turn", {"prompt_id": "p-proj-01", "history": history})
        self.assertEqual(r, {"line": "Why?", "done": False})
        self.assertEqual(self.calls[-1], ("reply", "It moves 40 servers.", 2, 1, "Ping"))
        history += [{"who": "ai", "text": r["line"]}, {"who": "me", "text": "Cost."}]
        _, r = self.call("POST", "/api/talk/turn", {"prompt_id": "p-proj-01", "history": history})
        self.assertEqual(r, {"line": "Bye then.", "done": True})
        _, hint = self.call("POST", "/api/talk/hint", {"prompt_id": "p-proj-01", "history": history})
        self.assertEqual(hint["points"], ["what", "why"])

        status, r = self.call("POST", "/api/talk/finish", {"prompt_id": "p-proj-01", "history": history,
                                                           "seconds": 42, "stuck": 1})
        self.assertEqual(status, 200, r)
        self.assertEqual(r["session"]["words"], 6)
        self.assertEqual(r["session"]["seconds"], 42)
        self.assertEqual(r["feedback"]["score"], 4)
        # What was said stays in private/, never in the synced data/journal.
        self.assertEqual(self.journal("data"), [])
        [entry] = self.journal("private")
        self.assertEqual(entry["conversation"][1]["text"], "It moves servers to Azure.")
        _, stats = self.call("GET", "/api/practice/stats")
        self.assertEqual(stats["by_module"]["talk"]["sessions"], 1)

    def test_public_scenario_journal_and_custom_is_private(self):
        self.call("PUT", "/api/settings", {"openai_key": "sk-test"})
        history = [{"who": "ai", "text": "Hi"}, {"who": "me", "text": "All good."}]
        status, _ = self.call("POST", "/api/talk/finish", {"prompt_id": "c-updates-01", "history": history})
        self.assertEqual(status, 200)
        self.assertEqual(len(self.journal("data")), 1)

        custom = {"role": "Your manager.", "setting": "Desk.", "task": "Talk about my project.", "turns": 9}
        _, r = self.call("POST", "/api/talk/turn", {"custom": custom, "history": []})
        self.assertEqual(r["done"], False, "an empty history asks for the opening line")
        self.assertEqual(self.calls[-1][3], 6, "turns are capped at 6")
        self.assertEqual(self.call("POST", "/api/talk/finish", {"custom": custom, "history": history})[0], 200)
        self.assertEqual(len(self.journal("data")), 1)
        self.assertEqual(len(self.journal("private")), 1)

    def test_bad_requests(self):
        self.call("PUT", "/api/settings", {"openai_key": "sk-test"})
        self.assertEqual(self.call("POST", "/api/talk/turn", {"prompt_id": "s-st_basics-01", "history": []})[0], 404)
        self.assertEqual(self.call("POST", "/api/talk/turn", {"history": []})[0], 400)
        self.assertEqual(self.call("POST", "/api/talk/turn", {"custom": {"role": "x"}, "history": []})[0], 400)
        self.assertEqual(self.call("POST", "/api/talk/turn", {"prompt_id": "c-updates-01",
                                                              "history": [{"who": "boss", "text": "x"}]})[0], 400)
        self.assertEqual(self.call("POST", "/api/talk/finish", {"prompt_id": "c-updates-01",
                                                                "history": [{"who": "ai", "text": "Hi"}]})[0], 400)

    def test_private_audio_is_cached_in_private(self):
        self.call("PUT", "/api/settings", {"openai_key": "sk-test"})
        self.assertEqual(self.call("POST", "/api/tts", {"text": "secret plan", "private": True})[0], 200)
        self.assertEqual(self.call("POST", "/api/tts", {"text": "public line"})[0], 200)
        self.assertEqual(len(list((self.root / "private" / "tts").glob("*.mp3"))), 1)
        self.assertEqual(len(list((self.root / "cache" / "tts").glob("*.mp3"))), 1)


class SyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.remote = base / "remote.git"
        self.repo = base / "repo"
        git(base, "init", "--bare", "-b", "main", str(self.remote))
        git(base, "clone", str(self.remote), str(self.repo))
        for cwd in (self.repo,):
            git(cwd, "config", "user.email", "t@example.com")
            git(cwd, "config", "user.name", "T")
            git(cwd, "config", "commit.gpgsign", "false")
        (self.repo / ".gitignore").write_text("config.local.json\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-m", "init")
        git(self.repo, "push", "-u", "origin", "HEAD")

    def tearDown(self):
        self.tmp.cleanup()

    def pushed(self):
        return sorted(git(self.remote, "ls-tree", "-r", "--name-only", "main").split())

    def test_private_folder_is_never_uploaded(self):
        (self.repo / "private" / "journal").mkdir(parents=True)
        (self.repo / "private" / "journal" / "2026-11.json").write_text("{}")
        (self.repo / "notes.txt").write_text("public\n")
        result = sync(self.repo)  # .gitignore here does not list private/
        self.assertTrue(result["ok"], result)
        self.assertEqual(self.pushed(), [".gitignore", "notes.txt"])
        # Once tracked by hand, sync refuses instead of uploading it again.
        git(self.repo, "add", "-f", "private")
        git(self.repo, "commit", "-m", "oops")
        result = sync(self.repo)
        self.assertFalse(result["ok"])
        self.assertIn("private/ is tracked", result["message"])

    def test_nothing_to_sync(self):
        result = sync(self.repo)
        self.assertTrue(result["ok"], result)
        self.assertIn("No new changes", result["message"])

    def test_commits_the_whole_repo_except_the_key(self):
        (self.repo / "data").mkdir()
        (self.repo / "data" / "words.json").write_text("{}\n")
        (self.repo / "cache" / "tts").mkdir(parents=True)
        audio = bytes(range(256)) * 4
        (self.repo / "cache" / "tts" / "abc.mp3").write_bytes(audio)
        (self.repo / "app.py").write_text("print('new code')\n")
        (self.repo / "config.local.json").write_text('{"openai_key": "sk-secret"}')

        result = sync(self.repo, now=datetime(2026, 11, 10, 21, 30))
        self.assertTrue(result["ok"], result)
        self.assertEqual(git(self.repo, "log", "-1", "--format=%s").strip(), "sync: 2026-11-10 21:30")
        self.assertEqual(self.pushed(), [".gitignore", "app.py", "cache/tts/abc.mp3", "data/words.json"])
        blob = subprocess.run(["git", "show", "main:cache/tts/abc.mp3"], cwd=self.remote,
                              capture_output=True, check=True).stdout
        self.assertEqual(blob, audio, "binary audio arrives unchanged")

        # Deletions and edits are synced too.
        (self.repo / "app.py").unlink()
        (self.repo / "data" / "words.json").write_text('{"words": {}}\n')
        self.assertTrue(sync(self.repo)["ok"])
        self.assertEqual(self.pushed(), [".gitignore", "cache/tts/abc.mp3", "data/words.json"])

        again = sync(self.repo)
        self.assertTrue(again["ok"])
        self.assertIn("No new changes", again["message"])

    def test_key_stays_local_even_if_gitignore_changes(self):
        (self.repo / ".gitignore").write_text("")
        (self.repo / "config.local.json").write_text('{"openai_key": "sk-secret"}')
        self.assertTrue(sync(self.repo)["ok"])
        self.assertNotIn("config.local.json", self.pushed())

    def test_refuses_when_the_key_file_is_tracked(self):
        (self.repo / "config.local.json").write_text('{"openai_key": "sk-secret"}')
        git(self.repo, "add", "-f", "config.local.json")
        git(self.repo, "commit", "-m", "oops")
        result = sync(self.repo)
        self.assertFalse(result["ok"])
        self.assertIn("git rm --cached config.local.json", result["message"])
        self.assertNotIn("config.local.json", self.pushed(), "nothing was pushed")

    def test_pulls_changes_from_another_computer(self):
        other = Path(self.tmp.name) / "other"
        git(self.tmp.name, "clone", str(self.remote), str(other))
        git(other, "config", "user.email", "o@example.com")
        git(other, "config", "user.name", "O")
        (other / "data").mkdir()
        (other / "data" / "cloze.json").write_text("{}\n")
        self.assertTrue(sync(other)["ok"])

        (self.repo / "data").mkdir()
        (self.repo / "data" / "words.json").write_text("{}\n")
        result = sync(self.repo)
        self.assertTrue(result["ok"], result)
        self.assertTrue((self.repo / "data" / "cloze.json").exists())
        pushed = git(self.remote, "ls-tree", "-r", "--name-only", "main").split()
        self.assertIn("data/words.json", pushed)

    def test_no_remote(self):
        git(self.repo, "remote", "remove", "origin")
        (self.repo / "data").mkdir()
        (self.repo / "data" / "words.json").write_text("{}\n")
        result = sync(self.repo)
        self.assertFalse(result["ok"])
        self.assertIn("no remote", result["message"])


if __name__ == "__main__":
    unittest.main()
