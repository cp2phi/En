"""Validate one content folder.

    python3 tools/check_bank.py questions/noun     # cloze questions
    python3 tools/check_bank.py prompts/write      # practice prompts
    python3 tools/check_bank.py translate          # sentence translation
    python3 tools/check_bank.py vocab              # word packs
    python3 tools/check_bank.py vocab --online     # also check every "wiki" photo exists
"""

import json
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import cloze  # noqa: E402
from app.text import stem_phrase  # noqa: E402

ANSWER = re.compile(r"^[A-Za-z][A-Za-z' -]*$")
# Filled in from Settings when shown: the learner's own name and where they are from.
PLACEHOLDERS = {"{name}", "{hometown}", "{role}", "{company}"}
CJK = re.compile(r"[一-鿿]")


def check_questions(folder: Path) -> list[str]:
    errors, ids, sentences = [], set(), set()
    for path in sorted(folder.glob("*.json")):
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            errors.append(f"{path.name}: invalid JSON: {e}")
            continue
        for item in items:
            where = f"{path.name}:{item.get('id', '?')}"
            missing = [k for k in ("id", "level", "zh", "en") if k not in item]
            if missing:
                errors.append(f"{where}: missing {missing}")
                continue
            if item["id"] in ids:
                errors.append(f"{where}: duplicate id")
            ids.add(item["id"])
            if item["level"] not in (1, 2, 3, 4, 5):
                errors.append(f"{where}: level must be 1-5")
            if not CJK.search(item["zh"]):
                errors.append(f"{where}: zh has no Chinese")
            if CJK.search(item["en"]):
                errors.append(f"{where}: en contains Chinese")
            _, blanks = cloze.parse(item["en"])
            if not blanks:
                errors.append(f"{where}: no blank")
            for accepted in blanks:
                if len(accepted) != len(set(a.lower() for a in accepted)):
                    errors.append(f"{where}: repeated answer")
                errors += [f"{where}: bad answer {a!r}" for a in accepted if not ANSWER.match(a)]
            if "note" in item:
                note = item["note"]
                if not isinstance(note, str) or not note.strip() or CJK.search(note):
                    errors.append(f"{where}: note must be English text")
                elif not 4 <= len(note.split()) <= 45:
                    errors.append(f"{where}: note should be one short sentence or two (4-45 words)")
            sentence = cloze.solution(item["en"])
            if "{" in sentence or "}" in sentence or "::" in item["en"]:
                errors.append(f"{where}: broken braces")
            if sentence in sentences:
                errors.append(f"{where}: duplicate sentence")
            sentences.add(sentence)
        print(f"{path.name}: {len(items)} questions")
    return errors


def check_prompts(folder: Path) -> list[str]:
    errors, ids = [], set()
    meta_path = folder / "_meta.json"
    tracks = json.loads(meta_path.read_text(encoding="utf-8"))["tracks"] if meta_path.exists() else {}
    for path in sorted(folder.glob("*.json")):
        if path.name.startswith("_"):
            continue
        if tracks and path.stem not in tracks:
            errors.append(f"{path.name}: not declared in _meta.json")
        # A track may allow longer model answers (work writing, presentation scripts).
        longest = tracks.get(path.stem, {}).get("example_words", 60)
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            errors.append(f"{path.name}: invalid JSON: {e}")
            continue
        for item in items:
            where = f"{path.name}:{item.get('id', '?')}"
            missing = [k for k in ("id", "level", "task", "zh") if not item.get(k)]
            if missing:
                errors.append(f"{where}: missing {missing}")
                continue
            if item["id"] in ids:
                errors.append(f"{where}: duplicate id")
            ids.add(item["id"])
            if item["level"] not in (1, 2, 3, 4, 5, 6):
                errors.append(f"{where}: level must be 1-6")
            if not CJK.search(item["zh"]):
                errors.append(f"{where}: zh has no Chinese")
            if "say" in item and CJK.search(item["say"]):
                errors.append(f"{where}: say must be English")
            if "example" in item:
                example = item["example"]
                if not isinstance(example, str) or not example.strip() or CJK.search(example):
                    errors.append(f"{where}: example must be English text")
                elif not 3 <= len(example.split()) <= longest:
                    errors.append(f"{where}: example should be 3-{longest} words "
                                  f"(set example_words on the track in _meta.json for longer ones)")
                elif set(re.findall(r"\{[^}]*\}", example)) - PLACEHOLDERS or re.search(r"\{[^}]*$|^[^{]*\}", example):
                    errors.append(f"{where}: example may only use the placeholders {', '.join(sorted(PLACEHOLDERS))}")
            if folder.name == "talk":  # conversation scenarios: the AI plays `role`
                for field in ("role", "setting", "say"):
                    value = item.get(field)
                    if not isinstance(value, str) or not value.strip() or CJK.search(value):
                        errors.append(f"{where}: {field} must be English text")
                if item.get("turns") not in (2, 3, 4, 5, 6):
                    errors.append(f"{where}: turns must be 2-6")
        print(f"{path.name}: {len(items)} prompts")
    return errors


TRANSLATE_FIELDS = {"id", "level", "scene", "zh", "en", "alt", "point"}
TRANSLATE_SCENES = ("work", "tech", "restaurant", "sports", "shopping",
                    "travel", "health", "home", "social", "money",
                    "renting", "driving", "family", "admin", "utilities",
                    "neighbours", "outdoors", "leisure", "emergency", "jobhunt",
                    "study", "pets", "repairs", "occasions", "feelings")
TRANSLATE_LEVELS = (1, 2, 3, 4, 5, 6)
TRANSLATE_PER_SCENE = 3  # per level, so 75 sentences per level and 450 per type
# English words in the main translation, per level (alt sentences may differ a little).
TRANSLATE_WORDS = {1: (2, 11), 2: (5, 17), 3: (8, 20), 4: (12, 28), 5: (14, 32), 6: (16, 35)}


def check_translate(folder: Path) -> list[str]:
    errors, ids, sentences = [], set(), {}
    for path in sorted(folder.glob("*.json")):
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            errors.append(f"{path.name}: invalid JSON: {e}")
            continue
        spread: dict[tuple[int, str], int] = {}
        for item in items:
            where = f"{path.name}:{item.get('id', '?')}"
            missing = [k for k in ("id", "level", "scene", "zh", "en", "point") if not item.get(k)]
            if missing:
                errors.append(f"{where}: missing {missing}")
                continue
            if set(item) - TRANSLATE_FIELDS:
                errors.append(f"{where}: unknown fields {sorted(set(item) - TRANSLATE_FIELDS)}")
            if not re.fullmatch(rf"t-{re.escape(path.stem)}-\d{{2,3}}", item["id"]):
                errors.append(f"{where}: id must be t-{path.stem}-NN")
            if item["id"] in ids:
                errors.append(f"{where}: duplicate id")
            ids.add(item["id"])
            if item["level"] not in TRANSLATE_LEVELS:
                errors.append(f"{where}: level must be 1-6")
                continue
            if item["scene"] not in TRANSLATE_SCENES:
                errors.append(f"{where}: scene must be one of {', '.join(TRANSLATE_SCENES)}")
            spread[(item["level"], item["scene"])] = spread.get((item["level"], item["scene"]), 0) + 1
            if not CJK.search(item["zh"]) or not CJK.search(item["point"]):
                errors.append(f"{where}: zh and point must be Chinese")
            if not 4 <= len(item["point"]) <= 60:
                errors.append(f"{where}: point should be 4-60 characters")
            alt = item.get("alt", [])
            if not isinstance(alt, list) or len(alt) > 3 or not all(isinstance(a, str) and a for a in alt):
                errors.append(f"{where}: alt must be a list of up to 3 sentences")
                alt = []
            for en in [item["en"], *alt]:
                if CJK.search(en) or "{" in en:
                    errors.append(f"{where}: English may not contain Chinese or braces: {en!r}")
                if not re.search(r"[.?!]['\"]?$", en):
                    errors.append(f"{where}: English should end with . ? or !: {en!r}")
                if not 2 <= len(en.split()) <= 35:
                    errors.append(f"{where}: English should be 2-35 words: {en!r}")
            low, high = TRANSLATE_WORDS[item["level"]]
            if not low <= len(item["en"].split()) <= high:
                errors.append(f"{where}: L{item['level']} English should be {low}-{high} words")
            if len({a.lower() for a in [item["en"], *alt]}) != 1 + len(alt):
                errors.append(f"{where}: alt repeats a sentence")
            for key in (item["en"].lower(), item["zh"]):
                if key in sentences:
                    errors.append(f"{where}: duplicate sentence (also {sentences[key]})")
                sentences[key] = item["id"]
        for level in TRANSLATE_LEVELS:
            for scene in TRANSLATE_SCENES:
                n = spread.get((level, scene), 0)
                if n != TRANSLATE_PER_SCENE:
                    errors.append(f"{path.name}: L{level} {scene} has {n} sentences, "
                                  f"want {TRANSLATE_PER_SCENE}")
        print(f"{path.name}: {len(items)} sentences")
    return errors


PACK_FIELDS = {"term", "topic", "zh", "definition", "examples", "respelling", "note", "wiki", "emoji"}
WIKI_CACHE = Path(tempfile.gettempdir()) / "english-practice-wiki-check.json"


WIKI_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "EnglishPractice/1.0 (personal learning tool)"


def _wiki_query(titles: list[str]) -> dict:
    query = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2", "redirects": "1",
        "prop": "pageimages|pageprops", "piprop": "thumbnail", "pithumbsize": "330",
        "pilicense": "any",  # the page summary the app uses includes non-free lead images too
        "ppprop": "disambiguation", "titles": "|".join(titles)})
    request = urllib.request.Request(f"{WIKI_API}?{query}", headers={"User-Agent": USER_AGENT})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                raise
            wait = e.headers.get("Retry-After")
            time.sleep(min(60, int(wait)) if wait and wait.isdigit() else 2 ** attempt)
        except (OSError, ValueError):
            time.sleep(2 ** attempt)
    return {}


def check_wiki(titles: set[str]) -> dict[str, bool | None]:
    """{title: has a lead photo (and is not a disambiguation page)}, None if Wikipedia didn't answer.

    Asks 50 titles per request (the app shows the same lead image via the page summary).
    Only definite answers are cached between runs.
    """
    cache = json.loads(WIKI_CACHE.read_text()) if WIKI_CACHE.exists() else {}
    results = dict(cache)
    todo = sorted(t for t in titles if t not in cache)
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        data = _wiki_query(batch).get("query")
        if not data:
            results.update((t, None) for t in batch)
            continue
        # Follow normalisation ("flat white" -> "Flat white") and redirects to the final page.
        hop = {x["from"]: x["to"] for x in data.get("normalized", []) + data.get("redirects", [])}
        pages = {page["title"]: page for page in data.get("pages", [])}
        for title in batch:
            final, seen = title, set()
            while final in hop and final not in seen:
                seen.add(final)
                final = hop[final]
            page = pages.get(final, {})
            ok = (not page.get("missing") and not page.get("invalid")
                  and "disambiguation" not in page.get("pageprops", {}) and bool(page.get("thumbnail")))
            results[title] = cache[title] = ok
        time.sleep(1)
    WIKI_CACHE.write_text(json.dumps(cache))
    return results


def check_vocab(folder: Path, online: bool = False) -> list[str]:
    errors, keys, wiki = [], {}, {}
    for path in sorted(folder.glob("*.json")):
        try:
            pack = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            errors.append(f"{path.name}: invalid JSON: {e}")
            continue
        if not isinstance(pack, dict) or not all(isinstance(pack.get(k), str) and pack[k].strip()
                                                 for k in ("tag", "name", "description")):
            errors.append(f"{path.name}: needs non-empty tag, name and description")
            continue
        if "/" in pack["tag"]:
            errors.append(f"{path.name}: tag may not contain /")
        for item in pack.get("words") or []:
            where = f"{path.name}:{item.get('term', '?')}"
            missing = [k for k in ("term", "topic", "zh", "definition", "examples") if not item.get(k)]
            if missing:
                errors.append(f"{where}: missing {missing}")
                continue
            if set(item) - PACK_FIELDS:
                errors.append(f"{where}: unknown fields {sorted(set(item) - PACK_FIELDS)}")
            for field in ("term", "definition", "respelling", "topic"):
                if CJK.search(str(item.get(field, ""))):
                    errors.append(f"{where}: {field} must be English")
            if "/" in item["topic"]:
                errors.append(f"{where}: topic may not contain /")
            if not CJK.search(item["zh"]):
                errors.append(f"{where}: zh has no Chinese")
            if not 2 <= len(item["definition"].split()) <= 35:
                errors.append(f"{where}: definition should be 2-35 words")
            examples = item["examples"]
            if not isinstance(examples, list) or not 1 <= len(examples) <= 3:
                errors.append(f"{where}: give 1-3 examples")
            else:
                for ex in examples:
                    if not isinstance(ex, dict) or not ex.get("en") or CJK.search(ex["en"]):
                        errors.append(f"{where}: example en must be English")
                    elif not CJK.search(ex.get("zh") or ""):
                        errors.append(f"{where}: example zh has no Chinese")
            key = (pack["tag"], stem_phrase(item["term"]))
            if key in keys:
                errors.append(f"{where}: duplicate term (also in {keys[key]})")
            keys[key] = path.name
            if item.get("wiki"):
                wiki.setdefault(item["wiki"], []).append(where)
        print(f"{path.name}: {len(pack.get('words') or [])} words ({pack['tag']})")
    if online and wiki:
        results = check_wiki(set(wiki))
        unknown = sorted(t for t in wiki if results.get(t) is None)
        for title, places in sorted(wiki.items()):
            if results.get(title) is False:
                errors += [f"{w}: wiki {title!r} has no Wikipedia photo (wrong title, disambiguation "
                           f"page or no image): fix the title or drop the field" for w in places]
        print(f"wiki photos checked: {len(wiki) - len(unknown)} of {len(wiki)}")
        if unknown:
            print(f"WARNING: {len(unknown)} wiki titles could not be checked (Wikipedia busy); "
                  f"run again later. Do not remove them because of this: {', '.join(unknown[:20])}"
                  + (" …" if len(unknown) > 20 else ""))
    return errors


def main() -> int:
    folder = Path(sys.argv[1])
    if not folder.is_dir():
        print(f"no such folder: {folder}")
        return 1
    if folder.name == "vocab":
        errors = check_vocab(folder, "--online" in sys.argv[2:])
    elif folder.name == "translate":
        errors = check_translate(folder)
    elif folder.parts[-2:-1] == ("prompts",):
        errors = check_prompts(folder)
    else:
        errors = check_questions(folder)
    for e in errors:
        print("ERROR", e)
    print("OK" if not errors else f"{len(errors)} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
