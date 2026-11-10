"""Validate one content folder.

    python3 tools/check_bank.py questions/noun     # cloze questions
    python3 tools/check_bank.py prompts/write      # practice prompts
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import cloze  # noqa: E402

ANSWER = re.compile(r"^[A-Za-z][A-Za-z' -]*$")
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
            sentence = cloze.solution(item["en"])
            if "{" in sentence or "}" in sentence or "::" in sentence:
                errors.append(f"{where}: broken braces")
            if sentence in sentences:
                errors.append(f"{where}: duplicate sentence")
            sentences.add(sentence)
        print(f"{path.name}: {len(items)} questions")
    return errors


def check_prompts(folder: Path) -> list[str]:
    errors, ids = [], set()
    for path in sorted(folder.glob("*.json")):
        if path.name.startswith("_"):
            continue
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
        print(f"{path.name}: {len(items)} prompts")
    return errors


def main() -> int:
    folder = Path(sys.argv[1])
    if not folder.is_dir():
        print(f"no such folder: {folder}")
        return 1
    errors = check_prompts(folder) if folder.parts[-2:-1] == ("prompts",) else check_questions(folder)
    for e in errors:
        print("ERROR", e)
    print("OK" if not errors else f"{len(errors)} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
