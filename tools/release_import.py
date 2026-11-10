"""Import any number of releases of one source into baselines/<source>/releases/<tag>/.

Each source has a SourceImporter that says how to fetch a release and which
function turns a stored upstream copy into rule files, per importer format. The
format is recorded in the release's source lock, so a stored release is always
rebuilt by the code that understood it when it was fetched.
"""

import argparse
import datetime
import json
import shutil
import sys
import tempfile
import urllib.error
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from tools.directory_swap import replace_directory
from tools.github_fetch import validate_tag
from tools.library_output import (
    MANIFEST_FILE_NAME,
    UnsupportedUpstreamData,
    publish_release,
    release_entry,
)
from tools.source_lock import SourceLock, read_source_lock
from tools.validate_library import REPOSITORY_ROOT

RELEASES_DIR_NAME = "releases"
DEFAULT_BASELINES_DIR = REPOSITORY_ROOT / "baselines"


@dataclass(frozen=True)
class SourceImporter:
    name: str
    display_name: str
    repository_url: str
    license: dict
    fetch: Callable[[str, Path, str], SourceLock]
    build_rule_tree_by_format: Mapping[str, Callable[[Path, SourceLock, Path], int]]
    release_label: Callable[[str], str]


def generate_release(
    importer: SourceImporter, upstream_dir: Path, lock: SourceLock, baselines_dir: Path
) -> int:
    build_rule_tree = importer.build_rule_tree_by_format.get(lock.importer_format)
    if build_rule_tree is None:
        raise ValueError(f"no importer for format {lock.importer_format!r}")
    source_fields = {
        "name": importer.name,
        "display_name": importer.display_name,
        "repository_url": importer.repository_url,
        "license": importer.license,
    }
    return publish_release(
        baselines_dir,
        source_fields,
        lambda tree_dir: build_rule_tree(upstream_dir, lock, tree_dir),
        lambda rule_count: release_entry(
            importer.name, lock, importer.release_label(lock.tag), rule_count
        ),
    )


def import_stored_release(
    importer: SourceImporter, sources_dir: Path, baselines_dir: Path, tag: str
) -> tuple[SourceLock, int]:
    validate_tag(tag)
    release_sources_dir = sources_dir / RELEASES_DIR_NAME / tag
    lock_path = release_sources_dir / "source.json"
    upstream_dir = release_sources_dir / "upstream"
    if not lock_path.is_file():
        raise ValueError(f"{lock_path}: source lock not found; run with --tag {tag} first")
    if not upstream_dir.is_dir():
        raise ValueError(f"{upstream_dir}: upstream copy not found; run with --tag {tag} first")
    try:
        lock = read_source_lock(lock_path)
    except (ValueError, TypeError) as problem:
        raise ValueError(f"{lock_path}: source lock is unusable ({problem!r})") from problem
    if lock.tag != tag:
        raise ValueError(f"{lock_path}: source lock is for tag {lock.tag!r}, not {tag!r}")
    return lock, generate_release(importer, upstream_dir, lock, baselines_dir)


def stored_release_tags(sources_dir: Path) -> list[str]:
    releases_dir = sources_dir / RELEASES_DIR_NAME
    if not releases_dir.is_dir():
        return []
    return sorted(
        folder.name
        for folder in releases_dir.iterdir()
        if folder.is_dir() and not folder.name.startswith(".")
    )


def import_stored_releases(
    importer: SourceImporter, sources_dir: Path, baselines_dir: Path
) -> list[tuple[SourceLock, int]]:
    tags = stored_release_tags(sources_dir)
    if not tags:
        raise ValueError(
            f"{sources_dir / RELEASES_DIR_NAME}: no stored releases; run with --tag first"
        )
    return [
        import_stored_release(importer, sources_dir, baselines_dir, tag) for tag in tags
    ]


def import_tag(
    importer: SourceImporter, tag: str, sources_dir: Path, baselines_dir: Path, today: str
) -> tuple[SourceLock, int]:
    validate_tag(tag)
    releases_dir = sources_dir / RELEASES_DIR_NAME
    releases_dir.mkdir(parents=True, exist_ok=True)
    staging_sources_dir = Path(tempfile.mkdtemp(prefix=f".{tag}-staging-", dir=releases_dir))
    try:
        lock = importer.fetch(tag, staging_sources_dir, today)
        if lock.tag != tag:
            raise ValueError(f"fetched release is tagged {lock.tag!r}, not {tag!r}")
        rule_count = generate_release(importer, staging_sources_dir / "upstream", lock, baselines_dir)
        replace_directory(staging_sources_dir, releases_dir / tag)
    finally:
        shutil.rmtree(staging_sources_dir, ignore_errors=True)
    return lock, rule_count


def release_change_summary(
    baselines_dir: Path, source_name: str, tag: str
) -> tuple[list[str], list[str]] | None:
    manifest = json.loads((baselines_dir / MANIFEST_FILE_NAME).read_text(encoding="utf-8"))
    source = next(source for source in manifest["sources"] if source["name"] == source_name)
    releases = source["releases"]
    position = next(
        position for position, release in enumerate(releases) if release["tag"] == tag
    )
    if position == 0:
        return None
    previous_ids = rule_ids_of_release(baselines_dir, releases[position - 1])
    current_ids = rule_ids_of_release(baselines_dir, releases[position])
    return sorted(current_ids - previous_ids), sorted(previous_ids - current_ids)


def rule_ids_of_release(baselines_dir: Path, release: dict) -> set[str]:
    index = json.loads((baselines_dir / release["index_path"]).read_text(encoding="utf-8"))
    return {rule["id"] for rule in index["rules"]}


def build_argument_parser(importer: SourceImporter) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=f"Import releases of {importer.display_name} into baselines/{importer.name}/."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--tag", help="release tag to fetch from upstream and import")
    mode.add_argument(
        "--offline",
        action="store_true",
        help=f"regenerate from the releases already stored under sources/{importer.name}/releases/",
    )
    parser.add_argument(
        "--release", help="with --offline, regenerate only this stored release instead of all of them"
    )
    parser.add_argument(
        "--sources-dir", type=Path, default=REPOSITORY_ROOT / "sources" / importer.name
    )
    parser.add_argument("--baselines-dir", type=Path, default=DEFAULT_BASELINES_DIR)
    return parser


def print_change_summary(summary: tuple[list[str], list[str]] | None) -> None:
    if summary is None:
        return
    added_ids, removed_ids = summary
    for label, rule_ids in (("Added rules", added_ids), ("Removed rules", removed_ids)):
        if rule_ids:
            print(f"{label} ({len(rule_ids)}): {', '.join(rule_ids)}")


def run_cli(importer: SourceImporter, argv: list[str] | None) -> int:
    parser = build_argument_parser(importer)
    arguments = parser.parse_args(argv)
    if arguments.release is not None and not arguments.offline:
        parser.error("--release can only be used with --offline")
    try:
        if arguments.offline and arguments.release is not None:
            imported = [
                import_stored_release(
                    importer, arguments.sources_dir, arguments.baselines_dir, arguments.release
                )
            ]
        elif arguments.offline:
            imported = import_stored_releases(
                importer, arguments.sources_dir, arguments.baselines_dir
            )
        else:
            today = datetime.date.today().isoformat()
            imported = [
                import_tag(
                    importer, arguments.tag, arguments.sources_dir, arguments.baselines_dir, today
                )
            ]
    except (UnsupportedUpstreamData, ValueError, OSError, urllib.error.URLError) as problem:
        print(f"Import failed: {problem}", file=sys.stderr)
        return 1
    for lock, rule_count in imported:
        print(f"Imported {rule_count} {importer.display_name} rules from {lock.tag} ({lock.commit_sha[:7]})")
        # The releases are already published, so a summary that cannot be made is a warning, not a failed import.
        try:
            print_change_summary(release_change_summary(arguments.baselines_dir, importer.name, lock.tag))
        except (ValueError, OSError, KeyError, StopIteration) as problem:
            print(f"Could not summarise the changes in {lock.tag}: {problem!r}", file=sys.stderr)
    return 0
