"""Whole-sentence translation, Chinese -> English.

Sentences live in translate/<type>.json, one file per sentence type (see
docs/content-guide.md). The learner types the whole English sentence; the AI
grades it (ai.grade_translation), so any correct, natural answer passes.

Progress has the same shape as cloze progress and uses the same rules
(cloze.record, cloze.next_question): a sentence right the first time is done,
a wrong or revealed one comes back at growing intervals, and a starred one goes
to the wrong book for review.
"""

import json
import re
from pathlib import Path

from . import cloze, srs

DEFAULT_PROGRESS = cloze.DEFAULT_PROGRESS
VERDICTS = ("good", "fix", "wrong")
MAX_ANSWER = 600  # characters; one sentence, a little room for a learner's Chinese


def load(root: Path) -> dict[str, dict]:
    sentences: dict[str, dict] = {}
    for path in sorted(Path(root).glob("*.json")):
        for item in json.loads(path.read_text(encoding="utf-8")):
            if item["id"] in sentences:
                raise ValueError(f"duplicate sentence id {item['id']} in {path}")
            sentences[item["id"]] = {**item, "type": path.stem, "alt": item.get("alt", [])}
    return sentences


def public_view(q: dict) -> dict:
    return {k: q[k] for k in ("id", "type", "scene", "level", "zh")}


def reveal(q: dict) -> dict:
    return {"en": q["en"], "alt": q["alt"], "point": q.get("point", ""), "zh": q["zh"]}


CONTRACTIONS = {"'re": ("are",), "'ve": ("have",), "'ll": ("will",), "'m": ("am",),
                "n't": ("not",), "'s": ("is", "has"), "'d": ("would", "had")}
CONTRACTION = re.compile(r"n't|'(?:re|ve|ll|m|s|d)\b")


def _forms(text: str) -> set[str]:
    """Every reading of a sentence as lowercase words with contractions spelled out
    ('s may be is or has), so "The meeting's been cancelled" matches "has been"."""
    text = text.lower().replace("’", "'").replace("can't", "can not").replace("won't", "will not")
    pieces = CONTRACTION.split(text)
    found = CONTRACTION.findall(text)
    forms = [pieces[0]]
    for short, rest in zip(found, pieces[1:]):
        forms = [f + " " + full + rest for f in forms for full in CONTRACTIONS[short]][:64]
    return {" ".join(re.findall(r"[a-z0-9]+", f)) for f in forms} - {""}


def matches_reference(q: dict, answer: str) -> bool:
    """True when the answer is one of the stored translations (ignoring case,
    punctuation and contractions), so it needs no AI check."""
    given = _forms(answer)
    return any(given & _forms(en) for en in [q["en"], *q["alt"]])


def remember_answer(progress: dict, qid: str, answer: str, verdict: str | None) -> None:
    """Keep the learner's latest answer, shown in the wrong book. Without a verdict
    (no key) nothing is recorded yet, so the item may not exist: start it as new."""
    item = progress["items"].setdefault(
        qid, {"status": "new", "attempts": 0, "wrong": 0, "srs": srs.new_state()})
    item["last_answer"] = answer
    item["last_verdict"] = verdict


def counts(sentences: dict, progress: dict, filters: dict) -> dict:
    """{total, left} per option: types over everything, scenes within the chosen
    type, levels within the chosen type and scene."""
    def tally(rows, key):
        out: dict = {}
        for q in rows:
            c = out.setdefault(str(q[key]), {"total": 0, "left": 0})
            c["total"] += 1
            c["left"] += cloze.is_left(progress, q["id"])
        return out

    rows = list(sentences.values())
    in_type = [q for q in rows if not filters.get("type") or q["type"] == filters["type"]]
    in_scene = [q for q in in_type if not filters.get("scene") or q["scene"] == filters["scene"]]
    return {"types": tally(rows, "type"), "scenes": tally(in_type, "scene"),
            "levels": dict(sorted(tally(in_scene, "level").items()))}


def wrong_book(sentences: dict, progress: dict) -> list[dict]:
    rows = []
    for qid, item in progress["items"].items():
        q = sentences.get(qid)
        if q and cloze.in_wrong_book(item):
            rows.append({"id": qid, "zh": q["zh"], "en": q["en"], "point": q.get("point", ""),
                         "type": q["type"], "scene": q["scene"], "level": q["level"],
                         "wrong": item["wrong"], "starred": bool(item.get("starred")),
                         "last_answer": item.get("last_answer", ""), "status": item["status"]})
    return sorted(rows, key=lambda r: (-r["wrong"], r["id"]))


def in_wrong_book(progress: dict, qid: str) -> bool:
    item = progress["items"].get(qid)
    return bool(item and cloze.in_wrong_book(item))
