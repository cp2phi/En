"""JSON file persistence. Files live in data/ so progress can be synced with git."""

import copy
import json
import os
from pathlib import Path


class JsonStore:
    def __init__(self, path: Path, default: dict):
        self.path = Path(path)
        self.default = default

    def load(self) -> dict:
        if not self.path.exists():
            return copy.deepcopy(self.default)
        with self.path.open(encoding="utf-8") as f:
            data = json.load(f)
        for key, value in self.default.items():
            data.setdefault(key, copy.deepcopy(value))
        return data

    def save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            # sort_keys + indent keep git diffs small and merges predictable.
            json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        os.replace(tmp, self.path)
