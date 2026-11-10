"""Local HTTP server: JSON API + static frontend. Standard library only."""

import base64
import binascii
import hashlib
import json
import math
import mimetypes
import threading
from dataclasses import dataclass
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import ai, cloze, practice, words
from .store import JsonStore
from .sync import sync

DEFAULT_SETTINGS = {
    "accent": "us", "new_per_day": 20, "model": ai.DEFAULT_MODEL,
    # Read-aloud: "openai" (natural voice, cached) or "browser" (built-in speech synthesis).
    "tts": "openai", "voice": ai.TTS_VOICES[0], "pace": "normal", "tts_model": ai.TTS_MODEL,
    # Filled into example answers that contain {name} / {hometown} (small talk introductions).
    "my_name": "", "hometown": "",
}
TTS_ENGINES = ("openai", "browser")
MAX_BODY = 40 * 1024 * 1024  # a few minutes of recorded audio, base64 encoded
MAX_SESSION_SECONDS = 4 * 3600  # caps a clock left running by mistake
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


@dataclass
class RawResponse:
    body: bytes
    content_type: str


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class App:
    """All state and request logic. `root` is the repository directory."""

    def __init__(self, root: Path, today=date.today, explain=ai.explain,
                 feedback=ai.feedback, transcribe=ai.transcribe, speech=ai.speech):
        self.root = Path(root)
        self.data_dir = self.root / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.static_dir = Path(__file__).resolve().parent.parent / "static"
        content = Path(__file__).resolve().parent.parent
        self.questions = cloze.load_questions(content / "questions")
        self.prompts = practice.load_prompts(content / "prompts")
        self.practice = JsonStore(self.data_dir / "practice.json", practice.DEFAULT_PRACTICE)
        self.words = JsonStore(self.data_dir / "words.json", words.DEFAULT_WORDS)
        self.cloze = JsonStore(self.data_dir / "cloze.json", cloze.DEFAULT_PROGRESS)
        self.settings = JsonStore(self.data_dir / "settings.json", DEFAULT_SETTINGS)
        # The API key stays out of data/ so the sync button never uploads it.
        self.secrets = JsonStore(self.root / "config.local.json", {"openai_key": ""})
        self.today = today
        self.explain = explain
        self.feedback = feedback
        self.transcribe = transcribe
        self.speech = speech
        # Generated speech is cached here (git-ignored), so each sentence is paid for once.
        self.tts_cache = self.root / "cache" / "tts"
        self.tts_model_fallback = None  # set once the chosen speech model stops working
        self.lock = threading.Lock()

    # ---- helpers -------------------------------------------------------
    def _question(self, qid) -> dict:
        if qid not in self.questions:
            raise ApiError(404, "question not found")
        return self.questions[qid]

    def _settings_view(self) -> dict:
        return self.settings.load() | {"has_key": bool(self.secrets.load()["openai_key"]),
                                       "voices": list(ai.TTS_VOICES), "tts_models": list(ai.TTS_MODELS)}

    # ---- routes --------------------------------------------------------
    def handle(self, method: str, path: str, query: dict, body: dict) -> dict:
        parts = [p for p in path.split("/") if p][1:]  # drop "api"
        route = (method, *parts[:2])
        if route == ("POST", "ai", "explain"):
            # No lock: the network call can take a while.
            secrets, settings = self.secrets.load(), self.settings.load()
            try:
                return self.explain(str(body.get("focus", "")), str(body.get("sentence", "")),
                                    secrets["openai_key"], settings["model"])
            except ai.AIError as e:
                raise ApiError(502, str(e)) from e
        if route == ("POST", "practice", "transcribe"):
            try:
                audio = base64.b64decode(str(body.get("audio_b64", "")), validate=True)
            except (binascii.Error, ValueError) as e:
                raise ApiError(400, "audio_b64 is not valid base64") from e
            try:
                text = self.transcribe(audio, str(body.get("mime") or "audio/webm"),
                                       self.secrets.load()["openai_key"])
            except ai.AIError as e:
                raise ApiError(502, str(e)) from e
            return {"text": text}
        if route == ("POST", "tts"):
            return self._tts(body)
        if route == ("POST", "practice", "submit"):
            return self._practice_submit(body)
        with self.lock:
            return self._handle_locked(method, parts, query, body)

    def _tts(self, body: dict) -> RawResponse:
        """MP3 for one piece of text. POST + JSON so other websites cannot spend API credits."""
        settings = self.settings.load()
        text = " ".join(str(body.get("text") or "").split())[:ai.MAX_TTS_CHARS]
        if not text:
            raise ApiError(400, "text is required")
        # voice/pace/accent may be overridden for the preview button in settings.
        voice = body.get("voice") or settings["voice"]
        accent = body.get("accent") or settings["accent"]
        pace = body.get("pace") or settings["pace"]
        if voice not in ai.TTS_VOICES or accent not in ai.ACCENTS or pace not in ai.PACES:
            raise ApiError(400, "unknown voice, accent or pace")
        key = hashlib.sha256(json.dumps([voice, accent, pace, text]).encode("utf-8")).hexdigest()
        path = self.tts_cache / f"{key}.mp3"
        if path.is_file():
            return RawResponse(path.read_bytes(), "audio/mpeg")
        model = self.tts_model_fallback or settings["tts_model"]
        try:
            audio, used = self.speech(text, voice, accent, pace, self.secrets.load()["openai_key"], model)
        except ai.AIError as e:
            raise ApiError(502, str(e)) from e
        if used != model:
            self.tts_model_fallback = used
        self.tts_cache.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")  # unique per concurrent request
        tmp.write_bytes(audio)
        tmp.replace(path)
        return RawResponse(audio, "audio/mpeg")

    def _practice_submit(self, body: dict) -> dict:
        prompt = practice.find_prompt(self.prompts, body.get("prompt_id"))
        if prompt is None:
            raise ApiError(404, "prompt not found")
        mode = body.get("mode")
        if mode not in ("write", "speak"):
            raise ApiError(400, "mode must be write or speak")
        text = str(body.get("text") or "").strip()
        try:
            seconds = float(body.get("seconds") or 0)
            stuck = int(body.get("stuck") or 0)
        except (TypeError, ValueError) as e:
            raise ApiError(400, "seconds and stuck must be numbers") from e
        if not math.isfinite(seconds):
            raise ApiError(400, "seconds must be a finite number")
        seconds = min(seconds, MAX_SESSION_SECONDS)
        with self.lock:
            # Checked before the paid AI call, and again when recording.
            if practice.is_locked(self.prompts, self.practice.load(), prompt["module"], prompt["track"]):
                raise ApiError(400, "this level is still locked")

        # The AI call runs outside the lock; practice still counts if it fails.
        feedback, ai_error = None, None
        key = self.secrets.load()["openai_key"]
        if key and practice.count_words(text):
            task = prompt["task"] + (f'\nLine given to the learner: "{prompt["say"]}"' if prompt.get("say") else "")
            if prompt["task"].startswith("Translate"):
                task += f"\nChinese sentence: {prompt['zh']}"
            try:
                feedback = self.feedback(prompt["focus"], task, text, mode, key, self.settings.load()["model"])
            except ai.AIError as e:
                ai_error = str(e)

        with self.lock:
            today = self.today()
            data = self.practice.load()
            if practice.is_locked(self.prompts, data, prompt["module"], prompt["track"]):
                raise ApiError(400, "this level is still locked")
            session = practice.record_session(data, prompt, text, seconds, mode, stuck, feedback, today)
            self.practice.save(data)
            journal = JsonStore(self.data_dir / "journal" / f"{today:%Y-%m}.json", {"entries": []})
            entries = journal.load()
            entries["entries"].append({"session": session["id"], "date": session["date"],
                                       "prompt_id": prompt["id"], "task": prompt["task"],
                                       "text": text, "feedback": feedback})
            journal.save(entries)
            total_xp = sum(s["xp"] for s in data["sessions"])
        return {"session": session, "feedback": feedback, "ai_error": ai_error,
                "rank": practice.rank(total_xp)}

    def _handle_locked(self, method: str, parts: list[str], query: dict, body: dict) -> dict:
        today = self.today()
        route = (method, *parts)
        match route:
            case ("GET", "summary"):
                settings = self._settings_view()
                return {
                    "words": words.counts(self.words.load(), today, settings["new_per_day"]),
                    "cloze": cloze.stats(self.questions, self.cloze.load(), today),
                    "has_key": settings["has_key"],
                }

            # ---- cloze ----
            case ("GET", "cloze", "meta"):
                return cloze.meta(self.questions)
            case ("GET", "cloze", "next"):
                progress = self.cloze.load()
                q = cloze.next_question(self.questions, progress, query, today)
                if q is None:
                    return {"question": None}
                status = progress["items"].get(q["id"], {}).get("status", "new")
                return {"question": cloze.public_view(q), "redo": status == "learning"}
            case ("POST", "cloze", "answer"):
                q = self._question(body.get("id"))
                answers = body.get("answers")
                if not isinstance(answers, list):
                    raise ApiError(400, "answers must be a list")
                result = cloze.check(q, [str(a) for a in answers])
                if body.get("record", True):
                    progress = self.cloze.load()
                    cloze.record(progress, q["id"], "correct" if result["correct"] else "wrong", today)
                    self.cloze.save(progress)
                if result["correct"]:
                    result |= cloze.reveal(q)
                return result
            case ("POST", "cloze", "mark"):
                q = self._question(body.get("id"))
                outcome = body.get("outcome")
                if outcome not in ("reveal", "guessed", "never"):
                    raise ApiError(400, "bad outcome")
                progress = self.cloze.load()
                cloze.record(progress, q["id"], outcome, today)
                self.cloze.save(progress)
                return cloze.reveal(q)
            case ("GET", "cloze", "solution"):
                return cloze.reveal(self._question(query.get("id")))
            case ("POST", "cloze", "wrongbook", "remove"):
                progress = self.cloze.load()
                if not cloze.remove_from_wrong_book(progress, str(body.get("id"))):
                    raise ApiError(404, "not in the wrong book")
                self.cloze.save(progress)
                return {"ok": True}
            case ("GET", "cloze", "wrongbook"):
                return {"items": cloze.wrong_book(self.questions, self.cloze.load())}

            # ---- words ----
            case ("GET", "words"):
                data = self.words.load()
                return {"words": sorted(data["words"].values(), key=lambda w: w["created"], reverse=True)}
            case ("POST", "words"):
                data = self.words.load()
                try:
                    word, duplicate = words.add_word(data, body, today)
                except ValueError as e:
                    raise ApiError(400, str(e)) from e
                self.words.save(data)
                return {"word": word, "duplicate": duplicate}
            case ("GET", "words", "next"):
                data = self.words.load()
                limit = self.settings.load()["new_per_day"]
                return {"word": words.next_word(data, today, limit),
                        "counts": words.counts(data, today, limit)}
            case ("POST", "words", "rate"):
                data = self.words.load()
                if body.get("id") not in data["words"]:
                    raise ApiError(404, "word not found")
                try:
                    word = words.rate_word(data, body["id"], body.get("rating"), today)
                except ValueError as e:
                    raise ApiError(400, str(e)) from e
                self.words.save(data)
                return {"word": word}
            case ("PUT", "words", word_id):
                data = self.words.load()
                if word_id not in data["words"]:
                    raise ApiError(404, "word not found")
                try:
                    word = words.update_word(data, word_id, body)
                except ValueError as e:
                    raise ApiError(400, str(e)) from e
                self.words.save(data)
                return {"word": word}
            case ("DELETE", "words", word_id):
                data = self.words.load()
                if data["words"].pop(word_id, None) is None:
                    raise ApiError(404, "word not found")
                self.words.save(data)
                return {"ok": True}

            # ---- practice ----
            case ("GET", "practice", "meta"):
                return practice.meta(self.prompts, self.practice.load())
            case ("GET", "practice", "next"):
                module, track = query.get("module"), query.get("track")
                if module not in self.prompts or track not in self.prompts[module]["tracks"]:
                    raise ApiError(404, "unknown module or track")
                data = self.practice.load()
                if practice.is_locked(self.prompts, data, module, track):
                    raise ApiError(400, "this level is still locked")
                prompt = practice.next_prompt(self.prompts, data, module, track)
                return {"prompt": prompt}
            case ("GET", "practice", "stats"):
                data = self.practice.load()
                word_dates = [w["created"] for w in self.words.load()["words"].values()]
                return practice.stats(data, today) | {
                    "growth": practice.growth(data["sessions"], word_dates, today)}

            # ---- settings / sync ----
            case ("GET", "settings"):
                return self._settings_view()
            case ("PUT", "settings"):
                settings = self.settings.load()
                if "accent" in body:
                    if body["accent"] not in ("us", "uk"):
                        raise ApiError(400, "accent must be us or uk")
                    settings["accent"] = body["accent"]
                for field in ("my_name", "hometown"):
                    if field in body:
                        value = " ".join(str(body[field] or "").split())
                        if len(value) > 40 or any(c in value for c in "{}<>"):
                            raise ApiError(400, f"{field} must be at most 40 characters, without {{}} or <>")
                        settings[field] = value
                if "new_per_day" in body:
                    try:
                        settings["new_per_day"] = max(0, min(500, int(body["new_per_day"])))
                    except (TypeError, ValueError) as e:
                        raise ApiError(400, "new_per_day must be a number") from e
                for field, allowed in (("tts", TTS_ENGINES), ("voice", ai.TTS_VOICES),
                                       ("pace", tuple(ai.PACES)), ("tts_model", ai.TTS_MODELS)):
                    if field in body:
                        if body[field] not in allowed:
                            raise ApiError(400, f"{field} must be one of {', '.join(allowed)}")
                        settings[field] = body[field]
                if body.get("tts_model"):
                    self.tts_model_fallback = None  # an explicit choice is tried again
                if body.get("model"):
                    settings["model"] = str(body["model"]).strip()
                self.settings.save(settings)
                if "openai_key" in body:
                    self.secrets.save({"openai_key": str(body["openai_key"]).strip()})
                return self._settings_view()
            case ("POST", "sync"):
                return sync(self.root)
        raise ApiError(404, "not found")


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):  # keep the terminal quiet
            pass

        def _send(self, status: int, body: bytes, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: dict):
            self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                       "application/json; charset=utf-8")

        def _static(self, path: str):
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            target = (app.static_dir / rel).resolve()
            if not target.is_relative_to(app.static_dir.resolve()) or not target.is_file():
                return self._send(404, b"not found", "text/plain")
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            self._send(200, target.read_bytes(), ctype)

        def _dispatch(self, method: str):
            # Only answer requests addressed to this machine (blocks DNS rebinding).
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            if host not in LOCAL_HOSTS:
                return self._json(403, {"error": "forbidden host"})
            url = urlparse(self.path)
            if not url.path.startswith("/api/"):
                if method != "GET":
                    return self._json(405, {"error": "method not allowed"})
                return self._static(url.path)
            body = {}
            if method != "GET":
                # Requiring JSON stops other websites from posting to this server
                # (PUT and DELETE already need a CORS preflight, which is never granted).
                is_json = "application/json" in (self.headers.get("Content-Type") or "")
                if method == "POST" and not is_json:
                    return self._json(415, {"error": "expected application/json"})
                length = int(self.headers.get("Content-Length") or 0)
                if length > MAX_BODY:
                    return self._json(413, {"error": "request too large"})
                try:
                    body = json.loads(self.rfile.read(length) or b"{}")
                except ValueError:
                    return self._json(400, {"error": "invalid JSON"})
                if not isinstance(body, dict):
                    return self._json(400, {"error": "body must be an object"})
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                result = app.handle(method, url.path, query, body)
                if isinstance(result, RawResponse):
                    self._send(200, result.body, result.content_type)
                else:
                    self._json(200, result)
            except ApiError as e:
                self._json(e.status, {"error": e.message})
            except Exception as e:  # noqa: BLE001 - report instead of dropping the connection
                self._json(500, {"error": f"{type(e).__name__}: {e}"})

        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

        def do_PUT(self):
            self._dispatch("PUT")

        def do_DELETE(self):
            self._dispatch("DELETE")

    return Handler


def make_server(root: Path, port: int = 8765, **app_kwargs) -> ThreadingHTTPServer:
    app = App(root, **app_kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    server.app = app
    return server
