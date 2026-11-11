"""Import an ASD ISM OSCAL release into the normalized rule library under baselines/asd_ism/releases/."""

import json
import re
import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.asd_ism_fetch import IMPORTER_FORMAT, fetch
from tools.asd_ism_normalize import (
    CATALOG_FILE_NAME,
    LICENSE,
    REPOSITORY_URL,
    SOURCE_NAME,
    normalize_catalog,
)
from tools.json_output import write_json
from tools.library_output import SCHEMA_VERSION, index_entry
from tools.release_import import SourceImporter, run_cli
from tools.source_lock import SourceLock

SOURCE_DISPLAY_NAME = "ASD Information Security Manual"


def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    keys = [key for key, _ in pairs]
    duplicates = sorted({key for key in keys if keys.count(key) > 1})
    if duplicates:
        raise ValueError(f"duplicate key {duplicates[0]!r}")
    return dict(pairs)


def read_catalog(upstream_dir: Path) -> dict:
    catalog_path = upstream_dir / CATALOG_FILE_NAME
    if not catalog_path.is_file():
        raise ValueError(f"{catalog_path}: upstream catalog not found")
    try:
        return json.loads(catalog_path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
    except ValueError as problem:
        raise ValueError(f"{catalog_path}: invalid JSON ({problem})") from problem


def build_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
    rules = normalize_catalog(read_catalog(upstream_dir), lock)
    (tree_dir / "rules").mkdir(parents=True)
    entries = []
    for rule in rules:
        control_id = rule["source"]["upstream_rule_id"]
        rule_file = f"rules/{control_id}.json"
        write_json(tree_dir / rule_file, rule)
        entries.append(index_entry(rule, rule_file))
    write_json(
        tree_dir / "_index.json",
        {"schema_version": SCHEMA_VERSION, "source": SOURCE_NAME, "rules": entries},
    )
    return len(entries)


MONTH_ABBREVIATIONS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
TAG_YEAR_AND_MONTH_PATTERN = re.compile(r"^v(\d{4})\.(0[1-9]|1[0-2])\.")


def release_label(tag: str, upstream_dir: Path) -> str:
    match = TAG_YEAR_AND_MONTH_PATTERN.match(tag)
    if match is None:
        raise ValueError(f"cannot derive a release label from tag {tag!r}")
    year, month = match.groups()
    return f"{MONTH_ABBREVIATIONS[int(month) - 1]} {year}"


IMPORTER = SourceImporter(
    name=SOURCE_NAME,
    display_name=SOURCE_DISPLAY_NAME,
    repository_url=REPOSITORY_URL,
    license=LICENSE,
    fetch=fetch,
    build_rule_tree_by_format={IMPORTER_FORMAT: build_rule_tree},
    release_label=release_label,
)


def main(argv: list[str] | None = None) -> int:
    return run_cli(IMPORTER, argv)


if __name__ == "__main__":
    sys.exit(main())
