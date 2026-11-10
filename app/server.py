"""Local HTTP server: JSON API + static frontend. Standard library only."""

import json
import mimetypes
import threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import ai, cloze, words
from .store import JsonStore
from .sync import sync

DEFAULT_SETTINGS = {"accent": "us", "new_per_day": 20, "model": ai.DEFAULT_MODEL}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class App:
    """All state and request logic. `root` is the repository directory."""

    def __init__(self, root: Path, today=date.today, explain=ai.explain):
        self.root = Path(root)
        self.data_dir = self.root / "data"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.static_dir = Path(__file__).resolve().parent.parent / "static"
        self.questions = cloze.load_questions(Path(__file__).resolve().parent.parent / "questions")
        self.words = JsonStore(self.data_dir / "words.json", words.DEFAULT_WORDS)
        self.cloze = JsonStore(self.data_dir / "cloze.json", cloze.DEFAULT_PROGRESS)
        self.settings = JsonStore(self.data_dir / "settings.json", DEFAULT_SETTINGS)
        # The API key stays out of data/ so the sync button never uploads it.
        self.secrets = JsonStore(self.root / "config.local.json", {"openai_key": ""})
        self.today = today
        self.explain = explain
        self.lock = threading.Lock()

    # ---- helpers -------------------------------------------------------
    def _question(self, qid) -> dict:
        if qid not in self.questions:
            raise ApiError(404, "question not found")
        return self.questions[qid]

    def _settings_view(self) -> dict:
        return self.settings.load() | {"has_key": bool(self.secrets.load()["openai_key"])}

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
        with self.lock:
            return self._handle_locked(method, parts, query, body)

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

            # ---- settings / sync ----
            case ("GET", "settings"):
                return self._settings_view()
            case ("PUT", "settings"):
                settings = self.settings.load()
                if "accent" in body:
                    if body["accent"] not in ("us", "uk"):
                        raise ApiError(400, "accent must be us or uk")
                    settings["accent"] = body["accent"]
                if "new_per_day" in body:
                    try:
                        settings["new_per_day"] = max(0, min(500, int(body["new_per_day"])))
                    except (TypeError, ValueError) as e:
                        raise ApiError(400, "new_per_day must be a number") from e
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
                try:
                    body = json.loads(self.rfile.read(length) or b"{}")
                except ValueError:
                    return self._json(400, {"error": "invalid JSON"})
                if not isinstance(body, dict):
                    return self._json(400, {"error": "body must be an object"})
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                self._json(200, app.handle(method, url.path, query, body))
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
