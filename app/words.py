"""Word bank: cards for words, phrases and sentence patterns, reviewed with SRS."""

import uuid
from datetime import date

from . import srs
from .text import normalize, stem_phrase

DEFAULT_WORDS = {"seq": 0, "words": {}}
EDITABLE = ("term", "respelling", "definition", "examples", "my_examples", "note", "source")


def _clean_examples(examples) -> list[dict]:
    out = []
    for ex in examples or []:
        en = (ex.get("en") or "").strip()
        if en:
            out.append({"en": en, "zh": (ex.get("zh") or "").strip()})
    return out


def find_duplicate(data: dict, term: str) -> dict | None:
    key = stem_phrase(term)
    for word in data["words"].values():
        if word["key"] == key:
            return word
    return None


def add_word(data: dict, payload: dict, today: date) -> tuple[dict, bool]:
    """Add a card. If the term already exists, merge the new examples and note into it.

    Returns (card, was_duplicate).
    """
    term = normalize(payload.get("term") or "")
    if not term:
        raise ValueError("term is required")
    examples = _clean_examples(payload.get("examples"))
    note = (payload.get("note") or "").strip()

    existing = find_duplicate(data, term)
    if existing:
        known = {normalize(ex["en"]) for ex in existing["examples"]}
        existing["examples"] += [ex for ex in examples if normalize(ex["en"]) not in known]
        if note and note not in existing["note"]:
            existing["note"] = (existing["note"] + "\n" + note).strip()
        return existing, True

    word = {
        "id": uuid.uuid4().hex[:10],
        "term": term,
        "key": stem_phrase(term),
        "respelling": (payload.get("respelling") or "").strip(),
        "definition": (payload.get("definition") or "").strip(),
        "examples": examples,
        "my_examples": [e.strip() for e in payload.get("my_examples") or [] if e.strip()],
        "note": note,
        "source": (payload.get("source") or "").strip(),
        "created": today.isoformat(),
        "introduced": None,
        "srs": srs.new_state(),
    }
    data["words"][word["id"]] = word
    return word, False


def update_word(data: dict, word_id: str, payload: dict) -> dict:
    word = data["words"][word_id]
    for field in EDITABLE:
        if field not in payload:
            continue
        value = payload[field]
        if field == "examples":
            value = _clean_examples(value)
        elif field == "my_examples":
            value = [e.strip() for e in value if e.strip()]
        elif field == "term":
            value = normalize(value)
            if not value:
                raise ValueError("term is required")
            word["key"] = stem_phrase(value)
        else:
            value = (value or "").strip()
        word[field] = value
    return word


def rate_word(data: dict, word_id: str, rating: str, today: date) -> dict:
    word = data["words"][word_id]
    data["seq"] += 1
    if word["introduced"] is None:
        word["introduced"] = today.isoformat()
    word["srs"] = srs.rate(word["srs"], rating, today, data["seq"])
    return word


def _is_new(word: dict) -> bool:
    return word["introduced"] is None and not word["srs"]["never"]


def counts(data: dict, today: date, new_limit: int) -> dict:
    words = data["words"].values()
    introduced_today = sum(1 for w in words if w["introduced"] == today.isoformat())
    new_total = sum(1 for w in words if _is_new(w))
    return {
        "total": len(data["words"]),
        "due": sum(1 for w in words if srs.is_due(w["srs"], today)),
        "new_today_left": min(new_total, max(0, new_limit - introduced_today)),
        "new_total": new_total,
        "never": sum(1 for w in words if w["srs"]["never"]),
    }


def next_word(data: dict, today: date, new_limit: int) -> dict | None:
    """Due reviews first, then today's new words, then same-day repeats still waiting."""
    words = data["words"]
    ready, waiting = srs.pick_due([(w["id"], w["srs"]) for w in words.values()], today, data["seq"])
    if ready:
        return words[ready]
    if counts(data, today, new_limit)["new_today_left"] > 0:
        return min((w for w in words.values() if _is_new(w)), key=lambda w: (w["created"], w["id"]))
    if waiting:
        return words[waiting]
    return None
