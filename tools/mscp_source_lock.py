import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class SourceLock:
    tag: str
    commit_sha: str
    retrieved_date: str
    repository_url: str


def read_source_lock(path: Path) -> SourceLock:
    with open(path, encoding="utf-8") as lock_file:
        return SourceLock(**json.load(lock_file))


def write_source_lock(path: Path, lock: SourceLock) -> None:
    text = json.dumps(asdict(lock), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as lock_file:
        lock_file.write(text)
