import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from tools.json_output import write_json


@dataclass(frozen=True)
class SourceLock:
    tag: str
    commit_sha: str
    retrieved_date: str
    repository_url: str
    published_date: str
    importer_format: str
    # Pins that belong to one importer only (a second repository's branch and commit); left out of the file when empty.
    details: dict = field(default_factory=dict)


def read_source_lock(path: Path) -> SourceLock:
    with open(path, encoding="utf-8") as lock_file:
        return SourceLock(**json.load(lock_file))


def write_source_lock(path: Path, lock: SourceLock) -> None:
    fields = asdict(lock)
    if not fields["details"]:
        del fields["details"]
    write_json(path, fields)
