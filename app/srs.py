"""Spaced repetition shared by word cards and cloze questions.

Rules:
- forget:   the item comes back at least FORGET_REPEATS more times today,
            then tomorrow.
- fuzzy:    the item comes back at least FUZZY_REPEATS more time today,
            its interval is not lengthened.
- remember: counts down the same-day repeats; once they are done the item
            moves along LADDER (days).
- never:    the item is never shown again.
"""

from datetime import date, timedelta

LADDER = [1, 3, 7, 15, 30, 60, 120]
FORGET_REPEATS = 2
FUZZY_REPEATS = 1
# A same-day repeat waits until this many other items have been shown.
SAME_DAY_GAP = 3

RATINGS = ("forget", "fuzzy", "remember", "never")


def new_state() -> dict:
    return {
        "interval": 0,
        "due": None,
        "same_day_left": 0,
        "never": False,
        "reps": 0,
        "lapses": 0,
        "last_seq": 0,
        "last_reviewed": None,
    }


def next_interval(current: int) -> int:
    for step in LADDER:
        if step > current:
            return step
    return LADDER[-1]


def rate(state: dict, rating: str, today: date, seq: int) -> dict:
    """Return the new state after one review. `seq` is a global review counter."""
    if rating not in RATINGS:
        raise ValueError(f"unknown rating: {rating}")
    s = dict(state)
    s["reps"] += 1
    s["last_seq"] = seq
    s["last_reviewed"] = today.isoformat()

    if rating == "never":
        s["never"] = True
    elif rating == "forget":
        s["lapses"] += 1
        s["interval"] = 1
        s["same_day_left"] = max(s["same_day_left"], FORGET_REPEATS)
        s["due"] = today.isoformat()
    elif rating == "fuzzy":
        s["interval"] = max(s["interval"], 1)
        s["same_day_left"] = max(s["same_day_left"], FUZZY_REPEATS)
        s["due"] = today.isoformat()
    elif s["same_day_left"] > 0:
        s["same_day_left"] -= 1
        if s["same_day_left"] == 0:
            s["due"] = (today + timedelta(days=s["interval"])).isoformat()
    else:
        s["interval"] = next_interval(s["interval"])
        s["due"] = (today + timedelta(days=s["interval"])).isoformat()
    return s


def is_due(state: dict, today: date) -> bool:
    if state["never"]:
        return False
    if state["same_day_left"] > 0:
        return True
    return state["due"] is not None and date.fromisoformat(state["due"]) <= today


def is_ready(state: dict, seq: int) -> bool:
    """A same-day repeat is ready once enough other items were shown in between."""
    if state["same_day_left"] == 0:
        return True
    return seq - state["last_seq"] >= SAME_DAY_GAP


def pick_due(states: list[tuple[str, dict]], today: date, seq: int) -> tuple[str | None, str | None]:
    """Split (id, state) pairs into the best ready item and the best waiting item.

    Returns (ready_id, waiting_id); either may be None. Least recently seen first.
    """
    due = sorted(
        ((item_id, s) for item_id, s in states if is_due(s, today)),
        key=lambda pair: pair[1]["last_seq"],
    )
    ready = next((i for i, s in due if is_ready(s, seq)), None)
    waiting = next((i for i, s in due if not is_ready(s, seq)), None)
    return ready, waiting
