import json
from dataclasses import asdict, dataclass
from pathlib import Path

from tools.json_output import write_json


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
    write_json(path, asdict(lock))
