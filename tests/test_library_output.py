import json
from pathlib import Path

import pytest

from tools.json_output import write_json
from tools.library_output import (
    MANIFEST_FILE_NAME,
    SCHEMA_VERSION,
    index_entry,
    merged_manifest,
    publish_source,
)

COMMIT_SHA = "a" * 40
LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "rights_holder": "Example rights holder",
    "modified": True,
}


def example_rule(source_name: str = "example") -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "id": f"{source_name}.rule_one",
        "title": "Rule one",
        "discussion": "Rule one discussion.",
        "discussion_format": "markdown",
        "section_path": ["Section"],
        "source": {
            "name": source_name,
            "release_tag": "v1",
            "commit_sha": COMMIT_SHA,
            "upstream_rule_id": "rule_one",
            "upstream_path": "rules.json",
            "upstream_revision": None,
            "upstream_updated": None,
            "upstream_url": f"https://example.com/blob/{COMMIT_SHA}/rules.json",
            "license": LICENSE,
        },
        "assessment": {"status": "manual", "manual_reason": "no_check"},
        "architecture": None,
        "applicability": [
            {"target": None, "version": None, "benchmarks": [{"name": "level_one", "severity": None}]}
        ],
        "tags": [],
        "references": {},
        "check": None,
        "odv": None,
        "remediation": None,
    }


def manifest_entry(source_name: str, rule_count: int = 1) -> dict:
    return {
        "name": source_name,
        "display_name": f"{source_name} display name",
        "release_tag": "v1",
        "commit_sha": COMMIT_SHA,
        "retrieved_date": "2026-10-23",
        "repository_url": "https://example.com/repository",
        "license": LICENSE,
        "index_path": f"{source_name}/_index.json",
        "rule_count": rule_count,
    }


def write_rule_tree(tree_dir: Path, source_name: str, rule: dict) -> int:
    rule_file = "rules/rule_one.json"
    (tree_dir / "rules").mkdir(parents=True)
    write_json(tree_dir / rule_file, rule)
    write_json(
        tree_dir / "_index.json",
        {
            "schema_version": SCHEMA_VERSION,
            "source": source_name,
            "rules": [index_entry(rule, rule_file)],
        },
    )
    return 1


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def test_merged_manifest_keeps_other_sources_sorted(tmp_path):
    existing_entry = manifest_entry("mscp", rule_count=350)
    write_json(
        tmp_path / MANIFEST_FILE_NAME,
        {"schema_version": SCHEMA_VERSION, "sources": [existing_entry]},
    )

    manifest = merged_manifest(tmp_path, manifest_entry("asd_ism"))

    assert [source["name"] for source in manifest["sources"]] == ["asd_ism", "mscp"]
    assert manifest["sources"][1] == existing_entry


def test_merged_manifest_replaces_same_source(tmp_path):
    write_json(
        tmp_path / MANIFEST_FILE_NAME,
        {"schema_version": SCHEMA_VERSION, "sources": [manifest_entry("mscp", rule_count=350)]},
    )
    replacement = manifest_entry("mscp", rule_count=351)

    manifest = merged_manifest(tmp_path, replacement)

    assert manifest["sources"] == [replacement]


def test_publish_source_leaves_library_untouched_on_validation_failure(tmp_path):
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    write_json(
        baselines_dir / MANIFEST_FILE_NAME,
        {"schema_version": SCHEMA_VERSION, "sources": []},
    )
    before = snapshot(baselines_dir)

    def build_invalid_rule_tree(tree_dir: Path) -> int:
        invalid_rule = example_rule()
        invalid_rule["title"] = 42
        return write_rule_tree(tree_dir, "example", invalid_rule)

    with pytest.raises(ValueError, match="failed validation"):
        publish_source(
            baselines_dir,
            "example",
            build_invalid_rule_tree,
            lambda rule_count: manifest_entry("example", rule_count),
        )

    assert snapshot(baselines_dir) == before
    assert sorted(path.name for path in tmp_path.iterdir()) == ["baselines"]


def test_publish_source_writes_tree_and_manifest(tmp_path):
    baselines_dir = tmp_path / "baselines"

    rule_count = publish_source(
        baselines_dir,
        "example",
        lambda tree_dir: write_rule_tree(tree_dir, "example", example_rule()),
        lambda rule_count: manifest_entry("example", rule_count),
    )

    assert rule_count == 1
    assert (baselines_dir / "example" / "rules" / "rule_one.json").is_file()
    manifest = json.loads((baselines_dir / MANIFEST_FILE_NAME).read_text(encoding="utf-8"))
    assert [source["name"] for source in manifest["sources"]] == ["example"]
    assert manifest["sources"][0]["rule_count"] == 1


def test_publish_source_never_touches_the_overlays_folder(tmp_path):
    baselines_dir = tmp_path / "baselines"
    overlay_path = baselines_dir / "_overlays" / "kept.json"
    overlay_path.parent.mkdir(parents=True)
    overlay_path.write_text('{"kept": true}\n', encoding="utf-8")

    for _ in range(2):
        publish_source(
            baselines_dir,
            "example",
            lambda tree_dir: write_rule_tree(tree_dir, "example", example_rule()),
            lambda rule_count: manifest_entry("example", rule_count),
        )

    assert overlay_path.read_text(encoding="utf-8") == '{"kept": true}\n'
