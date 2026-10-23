import json
import os
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

from tools.directory_swap import replace_directory
from tools.json_output import write_json
from tools.validate_library import schema_errors, validate_library

SCHEMA_VERSION = 4
MANIFEST_FILE_NAME = "_manifest.json"


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


def merged_manifest(baselines_dir: Path, entry: dict) -> dict:
    manifest_path = baselines_dir / MANIFEST_FILE_NAME
    other_sources = []
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
            other_sources = [
                source for source in existing["sources"] if source["name"] != entry["name"]
            ]
        except (ValueError, KeyError, TypeError) as problem:
            raise ValueError(f"{manifest_path}: existing manifest is unusable ({problem!r})") from problem
    sources = sorted([*other_sources, entry], key=lambda source: source["name"])
    return {"schema_version": SCHEMA_VERSION, "sources": sources}


def publish_source(
    baselines_dir: Path,
    source_name: str,
    build_rule_tree: Callable[[Path], int],
    manifest_entry_for: Callable[[int], dict],
) -> int:
    baselines_dir.mkdir(parents=True, exist_ok=True)
    validation_dir = Path(
        tempfile.mkdtemp(prefix=f".{source_name}-validate-", dir=baselines_dir.parent)
    )
    manifest_temp_path = None
    try:
        rule_count = build_rule_tree(validation_dir / source_name)
        entry = manifest_entry_for(rule_count)
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
        replace_directory(validation_dir / source_name, baselines_dir / source_name)
        os.replace(manifest_temp_path, baselines_dir / MANIFEST_FILE_NAME)
        manifest_temp_path = None
    finally:
        shutil.rmtree(validation_dir, ignore_errors=True)
        if manifest_temp_path is not None:
            manifest_temp_path.unlink(missing_ok=True)
    return rule_count
