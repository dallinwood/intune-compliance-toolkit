"""Import an mSCP release into the normalized rule library under baselines/mscp/."""

import argparse
import datetime
import json
import re
import shutil
import sys
import tempfile
import urllib.error
from pathlib import Path

import yaml

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.directory_swap import replace_directory
from tools.json_output import write_json
from tools.library_output import (
    SCHEMA_VERSION,
    UnsupportedUpstreamData,
    index_entry,
    publish_source,
)
from tools.mscp_fetch import fetch
from tools.mscp_normalize import LICENSE, load_mscp_yaml, normalize_rule
from tools.source_lock import SourceLock, read_source_lock
from tools.validate_library import REPOSITORY_ROOT

DEFAULT_SOURCES_DIR = REPOSITORY_ROOT / "sources" / "mscp"
DEFAULT_BASELINES_DIR = REPOSITORY_ROOT / "baselines"
SOURCE_NAME = "mscp"
SOURCE_DISPLAY_NAME = "NIST macOS Security Compliance Project"
SAFE_UPSTREAM_ID = re.compile(r"^[A-Za-z0-9_.-]+$")


def discover_rule_paths(upstream_dir: Path) -> list[Path]:
    rules_dir = upstream_dir / "rules"
    if not rules_dir.is_dir():
        raise ValueError(f"{rules_dir}: upstream rules directory not found")
    rule_paths = sorted(
        (
            path
            for path in rules_dir.rglob("*")
            if path.is_file() and not path.name.startswith(".")
        ),
        key=lambda path: path.relative_to(upstream_dir).as_posix(),
    )
    for path in rule_paths:
        if path.suffix != ".yaml":
            raise ValueError(f"{path}: unexpected non-YAML file among upstream rules")
    return rule_paths


def build_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
    (tree_dir / "rules").mkdir(parents=True)
    entries_by_id: dict[str, dict] = {}
    for rule_path in discover_rule_paths(upstream_dir):
        upstream_path = rule_path.relative_to(upstream_dir).as_posix()
        try:
            upstream = load_mscp_yaml(rule_path.read_text(encoding="utf-8"))
        except yaml.YAMLError as problem:
            raise ValueError(f"{upstream_path}: invalid YAML ({problem})") from problem
        rule = normalize_rule(upstream, upstream_path, lock)
        if rule is None:
            continue
        upstream_id = rule["id"].removeprefix(f"{SOURCE_NAME}.")
        if not SAFE_UPSTREAM_ID.fullmatch(upstream_id):
            raise ValueError(f"{upstream_path}: unsafe upstream rule id {upstream_id!r}")
        if upstream_id in entries_by_id:
            raise ValueError(f"{upstream_path}: duplicate upstream rule id {upstream_id}")
        rule_file = f"rules/{upstream_id}.json"
        write_json(tree_dir / rule_file, rule)
        entries_by_id[upstream_id] = index_entry(rule, rule_file)

    ordered_entries = [entries_by_id[upstream_id] for upstream_id in sorted(entries_by_id)]
    write_json(
        tree_dir / "_index.json",
        {"schema_version": SCHEMA_VERSION, "source": SOURCE_NAME, "rules": ordered_entries},
    )
    return len(ordered_entries)


def mscp_manifest_entry(lock: SourceLock, rule_count: int) -> dict:
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
        lambda rule_count: mscp_manifest_entry(lock, rule_count),
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
        tempfile.mkdtemp(prefix=".mscp-sources-staging-", dir=sources_dir.parent)
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
    mode.add_argument("--tag", help="mSCP release tag to fetch, for example release_27.0")
    mode.add_argument(
        "--offline", action="store_true", help="regenerate from the existing sources/mscp copy"
    )
    parser.add_argument("--sources-dir", type=Path, default=DEFAULT_SOURCES_DIR)
    parser.add_argument("--baselines-dir", type=Path, default=DEFAULT_BASELINES_DIR)
    return parser


def read_index_summary(index_path: Path) -> tuple[set[str], set[str]] | None:
    if not index_path.is_file():
        return None
    try:
        rules = json.loads(index_path.read_text(encoding="utf-8"))["rules"]
        return (
            {rule["id"] for rule in rules},
            {tag for rule in rules for tag in rule["tags"]},
        )
    except (ValueError, KeyError, TypeError):
        return None


def print_change_summary(
    previous: tuple[set[str], set[str]] | None, current: tuple[set[str], set[str]] | None
) -> None:
    if previous is None or current is None:
        return
    previous_ids, previous_tags = previous
    current_ids, current_tags = current
    changes = (
        ("Added rules", current_ids - previous_ids),
        ("Removed rules", previous_ids - current_ids),
        ("New tags", current_tags - previous_tags),
        ("Tags no longer present", previous_tags - current_tags),
    )
    for label, values in changes:
        if values:
            print(f"{label}: {', '.join(sorted(values))}")


def main(argv: list[str] | None = None) -> int:
    arguments = build_argument_parser().parse_args(argv)
    index_path = arguments.baselines_dir / SOURCE_NAME / "_index.json"
    previous_summary = read_index_summary(index_path)
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
    print(f"Imported {rule_count} mSCP rules from {lock.tag} ({lock.commit_sha[:7]})")
    print_change_summary(previous_summary, read_index_summary(index_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
