"""Word bank: cards for words, phrases and sentence patterns, reviewed with SRS.

Each card carries `tags` (where it came from, e.g. "Keep speaking" or "Manual", and
any themes such as "Restaurant" or "Restaurant/Café & coffee"). A filter tag matches
itself and everything below it, so "Restaurant" also picks "Restaurant/Café & coffee".

Word packs (vocab/<pack>.json) are themed card lists added to the bank with one click.
"""

import json
import uuid
from datetime import date
from pathlib import Path

from . import srs
from .text import normalize, stem_phrase

DEFAULT_WORDS = {"seq": 0, "words": {}}
EDITABLE = ("term", "respelling", "definition", "zh", "examples", "my_examples", "note",
            "source", "tags", "wiki", "emoji")
UNTAGGED = "~untagged"  # filter value for cards with no tags (made before tags existed)
MAX_TAG = 60


def _clean_examples(examples) -> list[dict]:
    out = []
    for ex in examples or []:
        en = (ex.get("en") or "").strip()
        if en:
            out.append({"en": en, "zh": (ex.get("zh") or "").strip()})
    return out


def clean_tags(tags) -> list[str]:
    """Trimmed, de-duplicated tags. "a / b" becomes "a/b"; empty parts are dropped."""
    if isinstance(tags, str):
        tags = tags.split(",")
    out = []
    for tag in tags or []:
        parts = [" ".join(p.split()) for p in str(tag).split("/")]
        tag = "/".join(p for p in parts if p)[:MAX_TAG]
        if tag and tag != UNTAGGED and tag.lower() not in (t.lower() for t in out):
            out.append(tag)
    return out


def find_duplicate(data: dict, term: str) -> dict | None:
    key = stem_phrase(term)
    for word in data["words"].values():
        if word["key"] == key:
            return word
    return None


def add_word(data: dict, payload: dict, today: date) -> tuple[dict, bool]:
    """Add a card. If the term already exists, merge the new examples, note and tags into it.

    Returns (card, was_duplicate).
    """
    term = normalize(payload.get("term") or "")
    if not term:
        raise ValueError("term is required")
    if payload.get("keep_case"):  # pack cards keep "I'm …", "Kia ora", "KPI" as written
        term = " ".join(str(payload["term"]).replace("’", "'").replace("‘", "'").split())
    examples = _clean_examples(payload.get("examples"))
    note = (payload.get("note") or "").strip()
    tags = clean_tags(payload.get("tags"))

    existing = find_duplicate(data, term)
    if existing:
        known = {normalize(ex["en"]) for ex in existing["examples"]}
        existing["examples"] += [ex for ex in examples if normalize(ex["en"]) not in known]
        if note and note not in existing["note"]:
            existing["note"] = (existing["note"] + "\n" + note).strip()
        existing["tags"] = clean_tags(existing.get("tags", []) + tags)
        for field in ("respelling", "definition", "zh", "wiki", "emoji"):
            if not existing.get(field) and payload.get(field):
                existing[field] = str(payload[field]).strip()
        return existing, True

    word = {
        "id": uuid.uuid4().hex[:10],
        "term": term,
        "key": stem_phrase(term),
        "respelling": (payload.get("respelling") or "").strip(),
        "definition": (payload.get("definition") or "").strip(),
        "zh": (payload.get("zh") or "").strip(),
        "examples": examples,
        "my_examples": [e.strip() for e in payload.get("my_examples") or [] if e.strip()],
        "note": note,
        "source": (payload.get("source") or "").strip(),
        "tags": tags,
        "wiki": (payload.get("wiki") or "").strip(),  # Wikipedia title for a free photo
        "emoji": (payload.get("emoji") or "").strip(),
        "image": None,  # {"file", "by": "wiki" | "ai" | "upload", "credit"}
        "order": int(payload.get("order") or 0),  # position in its pack: new cards follow it
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
        elif field == "tags":
            value = clean_tags(value)
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


# ---- tag filter -----------------------------------------------------------

def parse_filter(value) -> list[str]:
    """Filter tags from a query string ("Restaurant,Data reporting") or a list."""
    if isinstance(value, str):
        value = value.split(",")
    return [t for t in (" ".join(str(v).split()) for v in value or []) if t]


def matches(word: dict, wanted: list[str]) -> bool:
    if not wanted:
        return True
    tags = [t.lower() for t in word.get("tags") or []]
    for want in (w.lower() for w in wanted):
        if want == UNTAGGED and not tags:
            return True
        if any(t == want or t.startswith(want + "/") for t in tags):
            return True
    return False


def tag_counts(data: dict) -> dict:
    """{tag: number of visible cards}, parents included ("A/B" also counts towards "A")."""
    counts: dict[str, int] = {}
    for word in data["words"].values():
        if word["srs"]["never"]:
            continue
        names = set()
        for tag in word.get("tags") or []:
            parts = tag.split("/")
            names.update("/".join(parts[:i]) for i in range(1, len(parts) + 1))
        for name in names or {UNTAGGED}:
            counts[name] = counts.get(name, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: kv[0].lower()))


# ---- review queue -----------------------------------------------------------

def _is_new(word: dict) -> bool:
    return word["introduced"] is None and not word["srs"]["never"]


def counts(data: dict, today: date, new_limit: int, tags=None) -> dict:
    """Counts within the tag filter. The daily new-word limit is shared by all tags."""
    everything = data["words"].values()
    introduced_today = sum(1 for w in everything if w["introduced"] == today.isoformat())
    words = [w for w in everything if matches(w, tags)]
    new_total = sum(1 for w in words if _is_new(w))
    return {
        "total": len(words),
        "due": sum(1 for w in words if srs.is_due(w["srs"], today)),
        "new_today_left": min(new_total, max(0, new_limit - introduced_today)),
        "new_total": new_total,
        "never": sum(1 for w in words if w["srs"]["never"]),
    }


def next_word(data: dict, today: date, new_limit: int, tags=None) -> dict | None:
    """Due reviews first, then today's new words, then same-day repeats still waiting."""
    words = {k: w for k, w in data["words"].items() if matches(w, tags)}
    ready, waiting = srs.pick_due([(w["id"], w["srs"]) for w in words.values()], today, data["seq"])
    if ready:
        return words[ready]
    if counts(data, today, new_limit, tags)["new_today_left"] > 0:
        return min((w for w in words.values() if _is_new(w)),
                   key=lambda w: (w["created"], w.get("order", 0), w["id"]))
    if waiting:
        return words[waiting]
    return None


# ---- word packs -------------------------------------------------------------

def load_packs(folder: Path) -> dict:
    """{pack id (file stem): {"tag", "name", "description", "words": [...]}}."""
    packs = {}
    for path in sorted(Path(folder).glob("*.json")):
        pack = json.loads(path.read_text(encoding="utf-8"))
        packs[path.stem] = {"tag": pack["tag"], "name": pack["name"],
                            "description": pack.get("description", ""), "words": pack.get("words", [])}
    return packs


def pack_card(pack: dict, item: dict, index: int) -> dict:
    """The add_word payload for one pack entry."""
    tags = [pack["tag"]] + ([f"{pack['tag']}/{item['topic']}"] if item.get("topic") else [])
    return {"term": item["term"], "respelling": item.get("respelling", ""),
            "definition": item.get("definition", ""), "zh": item.get("zh", ""),
            "examples": item.get("examples", []), "note": item.get("note", ""),
            "wiki": item.get("wiki", ""), "emoji": item.get("emoji", ""),
            "tags": tags, "order": index + 1, "source": "pack", "keep_case": True}


def pack_summaries(packs: dict, data: dict) -> list[dict]:
    keys = {w["key"] for w in data["words"].values()}
    out = []
    for pack_id, pack in packs.items():
        topics: dict[str, int] = {}
        for item in pack["words"]:
            topics[item.get("topic") or ""] = topics.get(item.get("topic") or "", 0) + 1
        out.append({"id": pack_id, "tag": pack["tag"], "name": pack["name"],
                    "description": pack["description"], "count": len(pack["words"]),
                    "in_bank": sum(1 for item in pack["words"] if stem_phrase(item["term"]) in keys),
                    "topics": topics})
    return out


def pack_preview(pack: dict, data: dict) -> list[dict]:
    """The pack's cards, each marked with whether it is already in the word bank."""
    keys = {w["key"] for w in data["words"].values()}
    return [item | {"in_bank": stem_phrase(item["term"]) in keys} for item in pack["words"]]


def add_pack(data: dict, pack: dict, today: date, topics=None, terms=None) -> dict:
    """Add a pack's cards: all of them, only some topics, or only the listed terms.

    Cards already in the bank get the pack's tags.
    """
    added = merged = 0
    wanted = set(terms) if terms is not None else None
    for index, item in enumerate(pack["words"]):
        if topics and item.get("topic") not in topics:
            continue
        if wanted is not None and item["term"] not in wanted:
            continue
        _, duplicate = add_word(data, pack_card(pack, item, index), today)
        merged += duplicate
        added += not duplicate
    return {"added": added, "merged": merged}
