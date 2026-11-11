import json
from pathlib import Path


def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    keys = [key for key, _ in pairs]
    duplicates = sorted({key for key in keys if keys.count(key) > 1})
    if duplicates:
        raise ValueError(f"duplicate key {duplicates[0]!r}")
    return dict(pairs)


def read_json_rejecting_duplicates(path: Path, description: str):
    if not path.is_file():
        raise ValueError(f"{path}: {description} not found")
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
    except ValueError as problem:
        raise ValueError(f"{path}: invalid JSON ({problem})") from problem


def write_json(path: Path, value) -> None:
    text = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as output_file:
        output_file.write(text)
