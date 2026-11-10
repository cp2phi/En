"""Keep-writing / keep-speaking / improv / Toastmasters practice.

Prompts live in prompts/<module>/<track>.json, with prompts/<module>/_meta.json
naming the module and its tracks. The write and speak modules are ladders:
track "l<N>" opens after UNLOCK_SESSIONS good sessions on track "l<N-1>".
Other tracks in a ladder module (e.g. the small-talk scenes) are always open.
A track may set "group" (a heading in the UI) and "focus" (what the AI
feedback concentrates on, see ai.MODULE_FOCUS).
"""

import json
import random
import re
from datetime import date, timedelta
from pathlib import Path

MODULES = ("write", "speak", "improv", "toast")
SPOKEN = ("speak", "improv", "toast")
UNLOCK_SESSIONS = 5
# Fewest English words for a session to count towards unlocking the next level.
MIN_WORDS = {
    "write": {1: 4, 2: 25, 3: 60, 4: 100, 5: 160, 6: 220},
    "speak": {1: 8, 2: 40, 3: 100, 4: 180, 5: 180, 6: 180},
}
GOOD_SCORE = 3
RANK_STEP = 200

WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
FILLER = re.compile(r"\b(?:um+|uh+|erm*|ah+|hmm+|you know|i mean|kind of|sort of)\b", re.IGNORECASE)

DEFAULT_PRACTICE = {"sessions": [], "done": {}, "vocab": {"write": {}, "spoken": {}}}


def load_prompts(root: Path) -> dict:
    """Return {module: {"name", "ladder", "tracks": {track: {"name", ..., "prompts": [...]}}}}."""
    bank: dict = {}
    for module in MODULES:
        folder = Path(root) / module
        meta_path = folder / "_meta.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        tracks = {}
        for track, info in meta["tracks"].items():
            path = folder / f"{track}.json"
            items = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
            tracks[track] = info | {
                "prompts": [item | {"module": module, "track": track,
                                    "focus": info.get("focus") or module} for item in items]
            }
        bank[module] = {"name": meta["name"], "ladder": bool(meta.get("ladder")), "tracks": tracks}
    return bank


def find_prompt(bank: dict, prompt_id: str) -> dict | None:
    for module in bank.values():
        for track in module["tracks"].values():
            for prompt in track["prompts"]:
                if prompt["id"] == prompt_id:
                    return prompt
    return None


def track_level(track: str) -> int | None:
    m = re.fullmatch(r"l(\d)", track)
    return int(m.group(1)) if m else None


def good_sessions(data: dict, module: str, track: str) -> int:
    return sum(1 for s in data["sessions"] if s["module"] == module and s["track"] == track and s["good"])


def unlocked_level(data: dict, module: str, top: int = 6) -> int:
    level = 1
    while level < top and good_sessions(data, module, f"l{level}") >= UNLOCK_SESSIONS:
        level += 1
    return level


def is_locked(bank: dict, data: dict, module: str, track: str) -> bool:
    level = track_level(track)
    return bool(bank[module]["ladder"] and level and level > unlocked_level(data, module))


def meta(bank: dict, data: dict) -> dict:
    out = {}
    for module, info in bank.items():
        done = set(data["done"].get(module, []))
        tracks = []
        for track, t in info["tracks"].items():
            tracks.append({
                "id": track,
                "name": t["name"],
                "count": len(t["prompts"]),
                "done": sum(1 for p in t["prompts"] if p["id"] in done),
                "locked": is_locked(bank, data, module, track),
                "good": good_sessions(data, module, track),
                "timing": [t[k] for k in ("green", "yellow", "red")] if "green" in t else None,
                "level": track_level(track) if info["ladder"] else None,
                "group": t.get("group") or ("Levels" if info["ladder"] and track_level(track) else ""),
            })
        out[module] = {"name": info["name"], "ladder": info["ladder"], "tracks": tracks,
                       "unlock_sessions": UNLOCK_SESSIONS}
    return out


def next_prompt(bank: dict, data: dict, module: str, track: str,
                rng: random.Random | None = None) -> dict | None:
    """A prompt not done before if there is one, otherwise any prompt except the last one."""
    rng = rng or random
    prompts = bank[module]["tracks"][track]["prompts"]
    if not prompts:
        return None
    done = data["done"].get(module, [])
    fresh = [p for p in prompts if p["id"] not in set(done)]
    if fresh:
        return rng.choice(fresh)
    last = done[-1] if done else None
    return rng.choice([p for p in prompts if p["id"] != last] or prompts)


def count_words(text: str) -> list[str]:
    return [w.lower() for w in WORD.findall(text)]


def record_session(data: dict, prompt: dict, text: str, seconds: float, mode: str,
                   stuck: int, feedback: dict | None, today: date) -> dict:
    module, track = prompt["module"], prompt["track"]
    words = count_words(text)
    score = feedback.get("score") if feedback else None
    level = track_level(track)
    minimum = MIN_WORDS.get(module, {}).get(level or 0, 1)
    good = len(words) >= minimum and (score is None or score >= GOOD_SCORE)
    before = unlocked_level(data, module) if module in MIN_WORDS else None

    session = {
        "id": len(data["sessions"]) + 1,
        "date": today.isoformat(),
        "module": module,
        "track": track,
        "prompt_id": prompt["id"],
        "mode": mode,
        "words": len(words),
        "seconds": round(max(0.0, float(seconds))),
        "score": score,
        "issues": len(feedback["issues"]) if feedback else None,
        "fillers": len(FILLER.findall(text)) if mode == "speak" else 0,
        "stuck": max(0, int(stuck)),
        "good": good,
    }
    session["xp"] = len(words) + (10 if words or session["seconds"] >= 10 else 0) + 5 * (score or 0)
    data["sessions"].append(session)

    done = data["done"].setdefault(module, [])
    if prompt["id"] in done:
        done.remove(prompt["id"])
    done.append(prompt["id"])
    vocab = data["vocab"]["write" if mode == "write" else "spoken"]
    for word in words:
        vocab[word] = vocab.get(word, 0) + 1

    after = unlocked_level(data, module) if before is not None else None
    session_view = dict(session)
    session_view["leveled_up"] = after if before is not None and after > before else None
    return session_view


def rank(xp: int) -> dict:
    level = int((xp / RANK_STEP) ** 0.5) + 1
    return {"level": level, "xp": xp, "next_at": RANK_STEP * level * level}


def streak(dates: set[str], today: date) -> int:
    """Consecutive practice days ending today (or yesterday if today has none yet)."""
    day = today if today.isoformat() in dates else today - timedelta(days=1)
    n = 0
    while day.isoformat() in dates:
        n += 1
        day -= timedelta(days=1)
    return n


def _summary(sessions: list[dict]) -> dict:
    words = sum(s["words"] for s in sessions)
    seconds = sum(s["seconds"] for s in sessions)
    # Speed only uses sessions that have words: an untranscribed recording (no API key)
    # has time but no text and would drag the speed down.
    timed = sum(s["seconds"] for s in sessions if s["words"])
    scored = [s["score"] for s in sessions if s["score"]]
    issue_sessions = [s for s in sessions if s["issues"] is not None and s["words"]]
    issue_words = sum(s["words"] for s in issue_sessions)
    return {
        "sessions": len(sessions),
        "words": words,
        "minutes": round(seconds / 60, 1),
        "wpm": round(words / (timed / 60)) if timed >= 30 and words else None,
        "avg_score": round(sum(scored) / len(scored), 1) if scored else None,
        "issues_per_100": round(100 * sum(s["issues"] for s in issue_sessions) / issue_words, 1)
        if issue_words else None,
        "fillers": sum(s["fillers"] for s in sessions),
        "stuck": sum(s["stuck"] for s in sessions),
        "longest_seconds": max((s["seconds"] for s in sessions), default=0),
        "most_words": max((s["words"] for s in sessions), default=0),
    }


def growth(sessions: list[dict], word_dates: list[str], today: date) -> list[dict]:
    """Running totals per day, from the first day with any activity up to today:
    words in the word bank, minutes spoken (speak, improv, toast) and minutes written."""
    days = [s["date"] for s in sessions] + [d for d in word_dates if d]
    if not days:
        return []
    start = date.fromisoformat(min(days))
    spoken: dict[str, float] = {}
    written: dict[str, float] = {}
    for s in sessions:
        target = written if s["module"] == "write" else spoken if s["module"] in SPOKEN else None
        if target is not None:
            target[s["date"]] = target.get(s["date"], 0) + s["seconds"]
    added: dict[str, int] = {}
    for d in word_dates:
        if d:
            added[d] = added.get(d, 0) + 1
    out, words, speak_s, write_s = [], 0, 0.0, 0.0
    day = start
    while day <= today:
        key = day.isoformat()
        words += added.get(key, 0)
        speak_s += spoken.get(key, 0)
        write_s += written.get(key, 0)
        out.append({"date": key, "words": words,
                    "speak_minutes": round(speak_s / 60, 1), "write_minutes": round(write_s / 60, 1)})
        day += timedelta(days=1)
    return out


def stats(data: dict, today: date) -> dict:
    sessions = data["sessions"]
    week_ago = (today - timedelta(days=6)).isoformat()
    two_weeks_ago = (today - timedelta(days=13)).isoformat()
    groups = {"write": ("write",), "spoken": SPOKEN}
    out: dict = {"modules": {}}
    for name, modules in groups.items():
        mine = [s for s in sessions if s["module"] in modules]
        out["modules"][name] = {
            "all": _summary(mine),
            "today": _summary([s for s in mine if s["date"] == today.isoformat()]),
            "this_week": _summary([s for s in mine if s["date"] >= week_ago]),
            "last_week": _summary([s for s in mine if two_weeks_ago <= s["date"] < week_ago]),
            "unique_words": len(data["vocab"][name]),
        }
    out["by_module"] = {m: _summary([s for s in sessions if s["module"] == m]) for m in MODULES}
    out["levels"] = {m: unlocked_level(data, m) for m in MIN_WORDS}
    out["rank"] = rank(sum(s["xp"] for s in sessions))
    out["streak"] = streak({s["date"] for s in sessions}, today)
    days = []
    for back in range(13, -1, -1):
        day = (today - timedelta(days=back)).isoformat()
        mine = [s for s in sessions if s["date"] == day]
        days.append({
            "date": day,
            "write_words": sum(s["words"] for s in mine if s["module"] == "write"),
            "spoken_minutes": round(sum(s["seconds"] for s in mine if s["module"] in SPOKEN) / 60, 1),
            "xp": sum(s["xp"] for s in mine),
        })
    out["days"] = days
    return out
