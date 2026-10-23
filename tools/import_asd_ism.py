"""Import an ASD ISM OSCAL release into the normalized rule library under baselines/asd_ism/."""

import argparse
import datetime
import json
import shutil
import sys
import tempfile
import urllib.error
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.asd_ism_fetch import fetch
from tools.asd_ism_normalize import CATALOG_FILE_NAME, LICENSE, SOURCE_NAME, normalize_catalog
from tools.directory_swap import replace_directory
from tools.json_output import write_json
from tools.library_output import (
    SCHEMA_VERSION,
    UnsupportedUpstreamData,
    index_entry,
    publish_source,
)
from tools.source_lock import SourceLock, read_source_lock
from tools.validate_library import REPOSITORY_ROOT

DEFAULT_SOURCES_DIR = REPOSITORY_ROOT / "sources" / SOURCE_NAME
DEFAULT_BASELINES_DIR = REPOSITORY_ROOT / "baselines"
SOURCE_DISPLAY_NAME = "ASD Information Security Manual"


def read_catalog(upstream_dir: Path) -> dict:
    catalog_path = upstream_dir / CATALOG_FILE_NAME
    if not catalog_path.is_file():
        raise ValueError(f"{catalog_path}: upstream catalog not found")
    try:
        return json.loads(catalog_path.read_text(encoding="utf-8"))
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


def manifest_entry(lock: SourceLock, rule_count: int) -> dict:
    return {
        "name": SOURCE_NAME,
        "display_name": SOURCE_DISPLAY_NAME,
        "release_tag": lock.tag,
        "commit_sha": lock.commit_sha,
        "retrieved_date": lock.retrieved_date,
        "repository_url": lock.repository_url,
        "license": LICENSE,
        "index_path": f"{SOURCE_NAME}/_index.json",
        "rule_count": rule_count,
    }


def generate_library(upstream_dir: Path, lock: SourceLock, baselines_dir: Path) -> int:
    return publish_source(
        baselines_dir,
        SOURCE_NAME,
        lambda tree_dir: build_rule_tree(upstream_dir, lock, tree_dir),
        lambda rule_count: manifest_entry(lock, rule_count),
    )


def import_offline(sources_dir: Path, baselines_dir: Path) -> tuple[SourceLock, int]:
    lock_path = sources_dir / "source.json"
    upstream_dir = sources_dir / "upstream"
    if not lock_path.is_file():
        raise ValueError(f"{lock_path}: source lock not found; run with --tag first")
    if not upstream_dir.is_dir():
        raise ValueError(f"{upstream_dir}: upstream copy not found; run with --tag first")
    try:
        lock = read_source_lock(lock_path)
    except (ValueError, TypeError) as problem:
        raise ValueError(f"{lock_path}: source lock is unusable ({problem!r})") from problem
    return lock, generate_library(upstream_dir, lock, baselines_dir)


def import_tag(
    tag: str, sources_dir: Path, baselines_dir: Path, today: str
) -> tuple[SourceLock, int]:
    sources_dir.parent.mkdir(parents=True, exist_ok=True)
    staging_sources_dir = Path(
        tempfile.mkdtemp(prefix=f".{SOURCE_NAME}-sources-staging-", dir=sources_dir.parent)
    )
    try:
        lock = fetch(tag, staging_sources_dir, today)
        rule_count = generate_library(staging_sources_dir / "upstream", lock, baselines_dir)
        replace_directory(staging_sources_dir, sources_dir)
    finally:
        shutil.rmtree(staging_sources_dir, ignore_errors=True)
    return lock, rule_count


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--tag", help="ism-oscal release tag to fetch, for example v2026.09.4")
    mode.add_argument(
        "--offline",
        action="store_true",
        help=f"regenerate from the existing sources/{SOURCE_NAME} copy",
    )
    parser.add_argument("--sources-dir", type=Path, default=DEFAULT_SOURCES_DIR)
    parser.add_argument("--baselines-dir", type=Path, default=DEFAULT_BASELINES_DIR)
    return parser


def read_rule_ids(index_path: Path) -> set[str] | None:
    if not index_path.is_file():
        return None
    try:
        rules = json.loads(index_path.read_text(encoding="utf-8"))["rules"]
        return {rule["id"] for rule in rules}
    except (ValueError, KeyError, TypeError):
        return None


def print_change_summary(previous_ids: set[str] | None, current_ids: set[str] | None) -> None:
    if previous_ids is None or current_ids is None:
        return
    changes = (
        ("Added rules", current_ids - previous_ids),
        ("Removed rules", previous_ids - current_ids),
    )
    for label, values in changes:
        if values:
            print(f"{label}: {', '.join(sorted(values))}")


def main(argv: list[str] | None = None) -> int:
    arguments = build_argument_parser().parse_args(argv)
    index_path = arguments.baselines_dir / SOURCE_NAME / "_index.json"
    previous_ids = read_rule_ids(index_path)
    try:
        if arguments.offline:
            lock, rule_count = import_offline(arguments.sources_dir, arguments.baselines_dir)
        else:
            today = datetime.date.today().isoformat()
            lock, rule_count = import_tag(
                arguments.tag, arguments.sources_dir, arguments.baselines_dir, today
            )
    except (UnsupportedUpstreamData, ValueError, OSError, urllib.error.URLError) as problem:
        print(f"Import failed: {problem}", file=sys.stderr)
        return 1
    print(f"Imported {rule_count} ASD ISM controls from {lock.tag} ({lock.commit_sha[:7]})")
    print_change_summary(previous_ids, read_rule_ids(index_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
