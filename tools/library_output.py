import json
import os
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

from tools.directory_swap import rename_directory, replace_directory, replace_file
from tools.json_output import write_json
from tools.source_lock import SourceLock
from tools.validate_library import manifest_consistency_errors, schema_errors, validate_library

SCHEMA_VERSION = 5
MANIFEST_SCHEMA_VERSION = 6
MANIFEST_FILE_NAME = "_manifest.json"
BUILD_DIR_NAME = ".build"


class UnsupportedUpstreamData(Exception):
    """Raised for any upstream shape an importer does not understand."""


def index_entry(rule: dict, file: str) -> dict:
    return {
        "id": rule["id"],
        "title": rule["title"],
        "file": file,
        "section": rule["section_path"][0],
        "section_path": rule["section_path"],
        "assessment": rule["assessment"],
        "architecture": rule["architecture"],
        "applicability": rule["applicability"],
        "tags": rule["tags"],
        "has_odv": rule["odv"] is not None,
    }


def release_dir(source_name: str, tag: str) -> str:
    return f"{source_name}/releases/{tag}"


def release_entry(source_name: str, lock: SourceLock, label: str, rule_count: int) -> dict:
    return {
        "tag": lock.tag,
        "label": label,
        "published_date": lock.published_date,
        "commit_sha": lock.commit_sha,
        "retrieved_date": lock.retrieved_date,
        "importer_format": lock.importer_format,
        "index_path": f"{release_dir(source_name, lock.tag)}/_index.json",
        "rule_count": rule_count,
    }


def merged_manifest(baselines_dir: Path, source_fields: dict, release: dict) -> dict:
    manifest_path = baselines_dir / MANIFEST_FILE_NAME
    other_sources = []
    other_releases = []
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            for source in existing["sources"]:
                if source["name"] != source_fields["name"]:
                    other_sources.append(source)
                else:
                    other_releases = [
                        existing_release
                        for existing_release in source["releases"]
                        if existing_release["tag"] != release["tag"]
                    ]
        except (ValueError, KeyError, TypeError) as problem:
            raise ValueError(f"{manifest_path}: existing manifest is unusable ({problem!r})") from problem
    releases = sorted(
        [*other_releases, release], key=lambda entry: (entry["published_date"], entry["tag"])
    )
    newest = releases[-1]
    source_entry = {
        **source_fields,
        "release_tag": newest["tag"],
        "commit_sha": newest["commit_sha"],
        "retrieved_date": newest["retrieved_date"],
        "index_path": newest["index_path"],
        "rule_count": newest["rule_count"],
        "releases": releases,
    }
    sources = sorted([*other_sources, source_entry], key=lambda source: source["name"])
    return {"schema_version": MANIFEST_SCHEMA_VERSION, "sources": sources}


def publish_release(
    baselines_dir: Path,
    source_fields: dict,
    build_rule_tree: Callable[[Path], int],
    release_entry_for: Callable[[int], dict],
) -> int:
    source_name = source_fields["name"]
    baselines_dir.mkdir(parents=True, exist_ok=True)
    validation_dir = Path(
        tempfile.mkdtemp(prefix=f".{source_name}-validate-", dir=baselines_dir.parent)
    )
    manifest_temp_path = None
    try:
        rule_count = build_rule_tree(validation_dir / BUILD_DIR_NAME)
        release = release_entry_for(rule_count)
        release_relative_dir = release_dir(source_name, release["tag"])
        (validation_dir / release_relative_dir).parent.mkdir(parents=True)
        rename_directory(validation_dir / BUILD_DIR_NAME, validation_dir / release_relative_dir)

        validation_manifest = merged_manifest(validation_dir, source_fields, release)
        write_json(validation_dir / MANIFEST_FILE_NAME, validation_manifest)
        errors = validate_library(validation_dir)
        final_manifest = merged_manifest(baselines_dir, source_fields, release)
        errors += schema_errors(final_manifest, "manifest")
        errors += manifest_consistency_errors(final_manifest)
        if errors:
            raise ValueError("generated library failed validation:\n" + "\n".join(errors))

        descriptor, manifest_temp_name = tempfile.mkstemp(
            prefix=".manifest-", suffix=".tmp", dir=baselines_dir
        )
        os.close(descriptor)
        manifest_temp_path = Path(manifest_temp_name)
        write_json(manifest_temp_path, final_manifest)
        target_release_dir = baselines_dir / release_relative_dir
        target_release_dir.parent.mkdir(parents=True, exist_ok=True)
        replace_directory(validation_dir / release_relative_dir, target_release_dir)
        replace_file(manifest_temp_path, baselines_dir / MANIFEST_FILE_NAME)
        manifest_temp_path = None
    finally:
        shutil.rmtree(validation_dir, ignore_errors=True)
        if manifest_temp_path is not None:
            manifest_temp_path.unlink(missing_ok=True)
    return rule_count
