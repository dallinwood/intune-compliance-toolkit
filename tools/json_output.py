import json
from pathlib import Path


def write_json(path: Path, value) -> None:
    text = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as output_file:
        output_file.write(text)
