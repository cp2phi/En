import http.client
import json
import subprocess
import tempfile
import threading
import unittest
from datetime import date, datetime
from pathlib import Path

from app import ai
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

        self.server = make_server(self.root, port=0, today=lambda: date(2026, 11, 10), explain=fake_explain,
                                  feedback=fake_feedback, transcribe=fake_transcribe, speech=fake_speech)
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
        _, drill = self.call("GET", "/api/cloze/next?pos=grammar&scene=past")
        blank = next(seg for seg in drill["question"]["segments"] if "blank" in seg)
        self.assertNotIn("cue", blank)
        self.assertRegex(blank["hint"], r"^[A-Za-z]$", "grammar drills show the first letter only")
        _, nxt = self.call("GET", "/api/cloze/next?pos=verb&scene=work&level=3")
        q = nxt["question"]
        self.assertEqual((q["pos"], q["scene"], q["level"]), ("verb", "work", 3))
        self.assertFalse(nxt["redo"])

        _, solution = self.call("GET", f"/api/cloze/solution?id={q['id']}")
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

        self.call("POST", "/api/cloze/mark", {"id": q["id"], "outcome": "never"})
        _, book = self.call("GET", "/api/cloze/wrongbook")
        self.assertEqual(book["items"], [])
        self.assertEqual(self.call("POST", "/api/cloze/answer", {"id": "nope", "answers": []})[0], 404)
        self.assertEqual(self.call("POST", "/api/cloze/mark", {"id": q["id"], "outcome": "correct"})[0], 400)

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

        self.call("PUT", f"/api/words/{word_id}", {"my_examples": ["I was in the zone."]})
        _, listing = self.call("GET", "/api/words")
        self.assertEqual(listing["words"][0]["my_examples"], ["I was in the zone."])
        self.assertEqual(self.call("DELETE", f"/api/words/{word_id}")[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/words/{word_id}")[0], 404)

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
        self.assertEqual(set(meta), {"write", "speak", "improv", "toast"})
        self.assertEqual([t["locked"] for t in meta["write"]["tracks"]], [False] + [True] * 5)
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

        _, stats = self.call("GET", "/api/practice/stats")
        self.assertEqual(stats["modules"]["write"]["all"]["sessions"], 5)
        self.assertEqual(stats["modules"]["spoken"]["today"]["minutes"], 1.2)
        self.assertEqual((stats["levels"]["write"], stats["streak"]), (2, 1))
        journal = json.loads((self.root / "data" / "journal" / "2026-11.json").read_text(encoding="utf-8"))
        self.assertEqual(len(journal["entries"]), 6)
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

        _, s = self.call("PUT", "/api/settings", {"tts": "browser", "voice": "cedar", "pace": "slow"})
        self.assertEqual((s["tts"], s["voice"], s["pace"]), ("browser", "cedar", "slow"))
        for bad in ({"tts": "robot"}, {"voice": "robot"}, {"pace": "fast"}, {"tts_model": "gpt-9"}):
            self.assertEqual(self.call("PUT", "/api/settings", bad)[0], 400, bad)
        self.assertNotIn("sk-secret", (self.root / "data" / "settings.json").read_text(encoding="utf-8"))


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
