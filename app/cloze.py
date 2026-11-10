"""Translation fill-in-the-blank practice.

Question files live in questions/<pos>/<scene>.json. Each question:
    {"id": "v-work-01", "level": 2, "g": "3sg",
     "zh": "她每周一主持团队例会。",
     "en": "She {runs|chairs} the team meeting every Monday."}
Each {...} is one blank; alternatives are separated by "|", the first one is
the main answer (used for the first-letter hint and shown as the solution).
"""

import json
import random
import re
from datetime import date
from pathlib import Path

from . import srs
from .text import edit_distance, normalize, stem_phrase

BLANK = re.compile(r"\{([^{}]+)\}")
# A wrong question leaves the review loop once its interval reaches this many days.
GRADUATE_INTERVAL = 15
OUTCOMES = ("correct", "wrong", "reveal", "guessed", "never")
# Word classes where the first letter would give the answer away.
NO_LETTER_HINT = {"preposition"}
# Particles: "d" for "down" would decide "down to Hamilton" vs "up to Auckland" for the
# learner. In the particle word class a blank starting with one gets no letter hint; in other
# classes only a blank that is just a particle does ("heads {up}"), not "{in advance}".
PARTICLES = {"up", "down", "over", "out", "in", "into", "on", "off", "back", "across", "round",
             "around", "away", "through", "along", "by", "about"}
LONE_PARTICLES = PARTICLES - {"round", "by", "about"}  # also nouns/prepositions elsewhere

DEFAULT_PROGRESS = {"seq": 0, "items": {}}


def parse(en: str) -> tuple[list[dict], list[list[str]]]:
    """Split a sentence into text/blank segments and the accepted answers per blank."""
    segments: list[dict] = []
    blanks: list[list[str]] = []
    pos = 0
    for m in BLANK.finditer(en):
        if m.start() > pos:
            segments.append({"text": en[pos:m.start()]})
        accepted = [a.strip() for a in m.group(1).split("|") if a.strip()]
        segments.append({"blank": len(blanks), "hint": accepted[0][0], "length": len(accepted[0])})
        blanks.append(accepted)
        pos = m.end()
    if pos < len(en):
        segments.append({"text": en[pos:]})
    return segments, blanks


def solution(en: str) -> str:
    return BLANK.sub(lambda m: m.group(1).split("|")[0].strip(), en)


def load_questions(root: Path) -> dict[str, dict]:
    questions: dict[str, dict] = {}
    for path in sorted(Path(root).glob("*/*.json")):
        with path.open(encoding="utf-8") as f:
            items = json.load(f)
        for item in items:
            if item["id"] in questions:
                raise ValueError(f"duplicate question id {item['id']} in {path}")
            segments, blanks = parse(item["en"])
            if not blanks:
                raise ValueError(f"question {item['id']} has no blank")
            questions[item["id"]] = {
                **item,
                "pos": path.parent.name,
                "scene": path.stem,
                "segments": segments,
                "blanks": blanks,
                "sentence": solution(item["en"]),
            }
    return questions


def public_view(q: dict, letter_hint: bool = True) -> dict:
    """What the browser gets before answering: no answers, only hints.
    letter_hint=False (a setting) hides the first letter of every blank."""
    segments = []
    for seg in q["segments"]:
        if "blank" in seg:
            words = q["blanks"][seg["blank"]][0].lower().split()
            if (not letter_hint
                    or q["pos"] in NO_LETTER_HINT
                    or (q["pos"] == "particle" and words[0] in PARTICLES)
                    or (len(words) == 1 and words[0] in LONE_PARTICLES)):
                seg = seg | {"hint": ""}
        segments.append(seg)
    return {k: q[k] for k in ("id", "pos", "scene", "level", "zh")} | {"g": q.get("g", ""), "segments": segments}


def classify(given: str, accepted: list[str]) -> str:
    """correct | grammar (right word, wrong form) | spelling | word | empty."""
    g = normalize(given)
    if not g:
        return "empty"
    targets = [normalize(a) for a in accepted]
    if g in targets:
        return "correct"
    if any(stem_phrase(g) == stem_phrase(t) for t in targets):
        return "grammar"
    if any(edit_distance(g, t) <= (1 if len(t) <= 4 else 2) for t in targets):
        return "spelling"
    return "word"


def check(q: dict, answers: list[str]) -> dict:
    results = []
    for i, accepted in enumerate(q["blanks"]):
        given = answers[i] if i < len(answers) else ""
        results.append({"given": given, "kind": classify(given, accepted)})
    return {"correct": all(r["kind"] == "correct" for r in results), "blanks": results}


def reveal(q: dict) -> dict:
    # "note" (optional): a one-sentence explanation shown with the answer.
    return {"sentence": q["sentence"], "answers": [b[0] for b in q["blanks"]], "zh": q["zh"],
            "note": q.get("note", "")}


def in_wrong_book(item: dict) -> bool:
    # Older records have no flag: they are in the book if they were ever answered wrong.
    return item.get("in_wrong_book", item["wrong"] > 0) and item["status"] != "never"


def remove_from_wrong_book(progress: dict, qid: str) -> bool:
    """Take a question off the wrong book. Its redo schedule is unchanged, and it
    comes back to the book if it is answered wrong again. Returns False if absent."""
    item = progress["items"].get(qid)
    if not item or not in_wrong_book(item):
        return False
    item["in_wrong_book"] = False
    return True


def record(progress: dict, qid: str, outcome: str, today: date) -> dict:
    """Update progress for one question and return its item."""
    if outcome not in OUTCOMES:
        raise ValueError(f"unknown outcome: {outcome}")
    progress["seq"] += 1
    seq = progress["seq"]
    item = progress["items"].setdefault(
        qid, {"status": "new", "attempts": 0, "wrong": 0, "srs": srs.new_state()}
    )
    item["attempts"] += 1

    if outcome == "never":
        item["status"] = "never"
        item["srs"] = srs.rate(item["srs"], "never", today, seq)
    elif outcome == "correct":
        if item["status"] == "learning":
            item["srs"] = srs.rate(item["srs"], "remember", today, seq)
            if item["srs"]["same_day_left"] == 0 and item["srs"]["interval"] >= GRADUATE_INTERVAL:
                item["status"] = "passed"
        else:
            # Right the first time: passed, no replay.
            item["status"] = "passed"
            item["srs"]["last_seq"] = seq
            item["srs"]["last_reviewed"] = today.isoformat()
    else:  # wrong, reveal, guessed
        item["status"] = "learning"
        item["wrong"] += 1
        item["in_wrong_book"] = True
        item["srs"] = srs.rate(item["srs"], "forget", today, seq)
    return item


def _matches(q: dict, filters: dict) -> bool:
    for key in ("pos", "scene"):
        if filters.get(key) and q[key] != filters[key]:
            return False
    if filters.get("level") and q["level"] != int(filters["level"]):
        return False
    return True


def next_question(questions: dict, progress: dict, filters: dict, today: date,
                  rng: random.Random | None = None) -> dict | None:
    """Pick the next question.

    mode "mix" (default): due redo items first, then unseen ones (easiest levels first).
    mode "wrongbook": cycle through every question ever answered wrong.
    """
    rng = rng or random
    items = progress["items"]
    seq = progress["seq"]
    pool = [q for q in questions.values() if _matches(q, filters)]

    if filters.get("mode") == "wrongbook":
        wrong = [q for q in pool if q["id"] in items and in_wrong_book(items[q["id"]])]
        if not wrong:
            return None
        return min(wrong, key=lambda q: items[q["id"]]["srs"]["last_seq"])

    learning = [(q["id"], items[q["id"]]["srs"]) for q in pool
                if items.get(q["id"], {}).get("status") == "learning"]
    ready, waiting = srs.pick_due(learning, today, seq)
    if ready:
        return questions[ready]

    unseen = [q for q in pool if q["id"] not in items or items[q["id"]]["status"] == "new"]
    if unseen:
        lowest = min(q["level"] for q in unseen)
        return rng.choice([q for q in unseen if q["level"] <= lowest + 1])
    if waiting:
        return questions[waiting]
    return None


def wrong_book(questions: dict, progress: dict) -> list[dict]:
    rows = []
    for qid, item in progress["items"].items():
        q = questions.get(qid)
        if q and in_wrong_book(item):
            rows.append({"id": qid, "zh": q["zh"], "sentence": q["sentence"], "pos": q["pos"],
                         "scene": q["scene"], "wrong": item["wrong"], "status": item["status"]})
    return sorted(rows, key=lambda r: (-r["wrong"], r["id"]))


def meta(questions: dict) -> dict:
    pos: dict[str, int] = {}
    by_pos: dict[str, dict[str, int]] = {}
    levels: dict[int, int] = {}
    for q in questions.values():
        pos[q["pos"]] = pos.get(q["pos"], 0) + 1
        scenes = by_pos.setdefault(q["pos"], {})
        scenes[q["scene"]] = scenes.get(q["scene"], 0) + 1
        levels[q["level"]] = levels.get(q["level"], 0) + 1
    return {"pos": pos, "by_pos": by_pos, "levels": dict(sorted(levels.items())), "total": len(questions)}


def stats(questions: dict, progress: dict, today: date) -> dict:
    out = {"total": len(questions), "passed": 0, "learning": 0, "never": 0, "due": 0}
    for qid, item in progress["items"].items():
        if qid not in questions:
            continue
        if item["status"] in out:
            out[item["status"]] += 1
        if item["status"] == "learning" and srs.is_due(item["srs"], today):
            out["due"] += 1
    out["unseen"] = out["total"] - out["passed"] - out["learning"] - out["never"]
    return out
