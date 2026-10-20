"""Import an mSCP release into the normalized rule library under baselines/mscp/."""

import argparse
import datetime
import json
import os
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
from tools.mscp_fetch import fetch
from tools.mscp_normalize import (
    LICENSE,
    UnsupportedUpstreamData,
    index_entry,
    load_mscp_yaml,
    normalize_rule,
)
from tools.mscp_source_lock import SourceLock, read_source_lock
from tools.validate_library import REPOSITORY_ROOT, schema_errors, validate_library

DEFAULT_SOURCES_DIR = REPOSITORY_ROOT / "sources" / "mscp"
DEFAULT_BASELINES_DIR = REPOSITORY_ROOT / "baselines"
SOURCE_NAME = "mscp"
SOURCE_DISPLAY_NAME = "NIST macOS Security Compliance Project"
SCHEMA_VERSION = 3
SAFE_UPSTREAM_ID = re.compile(r"^[A-Za-z0-9_.-]+$")
MANIFEST_FILE_NAME = "_manifest.json"


def discover_rule_paths(upstream_dir: Path) -> list[Path]:
    rules_dir = upstream_dir / "rules"
    if not rules_dir.is_dir():
        raise ValueError(f"{rules_dir}: upstream rules directory not found")
    rule_paths = sorted(
        (path for path in rules_dir.rglob("*") if path.is_file()),
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
        if not SAFE_UPSTREAM_ID.match(upstream_id):
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


def merged_manifest(baselines_dir: Path, entry: dict) -> dict:
    manifest_path = baselines_dir / MANIFEST_FILE_NAME
    other_sources = []
    if manifest_path.exists():
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        other_sources = [source for source in existing["sources"] if source["name"] != SOURCE_NAME]
    sources = sorted([*other_sources, entry], key=lambda source: source["name"])
    return {"schema_version": SCHEMA_VERSION, "sources": sources}


def generate_library(upstream_dir: Path, lock: SourceLock, baselines_dir: Path) -> int:
    baselines_dir.mkdir(parents=True, exist_ok=True)
    validation_dir = Path(tempfile.mkdtemp(prefix=".mscp-validate-", dir=baselines_dir.parent))
    manifest_temp_path = None
    try:
        rule_count = build_rule_tree(upstream_dir, lock, validation_dir / SOURCE_NAME)
        entry = mscp_manifest_entry(lock, rule_count)
        write_json(
            validation_dir / MANIFEST_FILE_NAME,
            {"schema_version": SCHEMA_VERSION, "sources": [entry]},
        )
        errors = validate_library(validation_dir)
        final_manifest = merged_manifest(baselines_dir, entry)
        errors += schema_errors(final_manifest, "manifest")
        if errors:
            raise ValueError("generated library failed validation:\n" + "\n".join(errors))

        descriptor, manifest_temp_name = tempfile.mkstemp(
            prefix=".manifest-", suffix=".tmp", dir=baselines_dir
        )
        os.close(descriptor)
        manifest_temp_path = Path(manifest_temp_name)
        write_json(manifest_temp_path, final_manifest)
        replace_directory(validation_dir / SOURCE_NAME, baselines_dir / SOURCE_NAME)
        os.replace(manifest_temp_path, baselines_dir / MANIFEST_FILE_NAME)
        manifest_temp_path = None
    finally:
        shutil.rmtree(validation_dir, ignore_errors=True)
        if manifest_temp_path is not None:
            manifest_temp_path.unlink(missing_ok=True)
    return rule_count


def import_offline(sources_dir: Path, baselines_dir: Path) -> tuple[SourceLock, int]:
    lock_path = sources_dir / "source.json"
    upstream_dir = sources_dir / "upstream"
    if not lock_path.is_file():
        raise ValueError(f"{lock_path}: source lock not found; run with --tag first")
    if not upstream_dir.is_dir():
        raise ValueError(f"{upstream_dir}: upstream copy not found; run with --tag first")
    lock = read_source_lock(lock_path)
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


def main(argv: list[str] | None = None) -> int:
    arguments = build_argument_parser().parse_args(argv)
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
