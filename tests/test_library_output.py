import json
from pathlib import Path

import pytest

from tools.json_output import write_json
from tools.library_output import (
    MANIFEST_FILE_NAME,
    MANIFEST_SCHEMA_VERSION,
    SCHEMA_VERSION,
    index_entry,
    merged_manifest,
    publish_release,
    release_dir,
    release_entry,
)
from tools.source_lock import SourceLock

COMMIT_SHA = "a" * 40
LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "rights_holder": "Example rights holder",
    "modified": True,
}


def example_rule(source_name: str = "example", tag: str = "v1") -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "id": f"{source_name}.rule_one",
        "title": "Rule one",
        "discussion": "Rule one discussion.",
        "discussion_format": "markdown",
        "section_path": ["Section"],
        "source": {
            "name": source_name,
            "release_tag": tag,
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


def source_fields_for(source_name: str) -> dict:
    return {
        "name": source_name,
        "display_name": f"{source_name} display name",
        "repository_url": "https://example.com/repository",
        "license": LICENSE,
    }


def release_entry_for(
    source_name: str, tag: str, published_date: str, rule_count: int = 1
) -> dict:
    return {
        "tag": tag,
        "label": f"label {tag}",
        "published_date": published_date,
        "commit_sha": COMMIT_SHA,
        "retrieved_date": "2026-10-23",
        "importer_format": "example-1",
        "index_path": f"{source_name}/releases/{tag}/_index.json",
        "rule_count": rule_count,
    }


def manifest_with_releases(source_name: str, releases: list[dict]) -> dict:
    newest = releases[-1]
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "sources": [
            {
                **source_fields_for(source_name),
                "release_tag": newest["tag"],
                "commit_sha": newest["commit_sha"],
                "retrieved_date": newest["retrieved_date"],
                "index_path": newest["index_path"],
                "rule_count": newest["rule_count"],
                "releases": releases,
            }
        ],
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


def publish_example_release(
    baselines_dir: Path, tag: str, published_date: str, source_name: str = "example"
) -> int:
    def build_rule_tree(tree_dir: Path) -> int:
        return write_rule_tree(tree_dir, source_name, example_rule(source_name, tag))

    return publish_release(
        baselines_dir,
        source_fields_for(source_name),
        build_rule_tree,
        lambda rule_count: release_entry_for(source_name, tag, published_date, rule_count),
    )


def read_manifest(baselines_dir: Path) -> dict:
    return json.loads((baselines_dir / MANIFEST_FILE_NAME).read_text(encoding="utf-8"))


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def test_release_dir_and_release_entry():
    lock = SourceLock(
        tag="v1",
        commit_sha=COMMIT_SHA,
        retrieved_date="2026-10-23",
        repository_url="https://example.com/repository",
        published_date="2026-09-03",
        importer_format="example-1",
    )

    assert release_dir("example", "v1") == "example/releases/v1"
    assert release_entry("example", lock, "Label", 7) == {
        "tag": "v1",
        "label": "Label",
        "published_date": "2026-09-03",
        "commit_sha": COMMIT_SHA,
        "retrieved_date": "2026-10-23",
        "importer_format": "example-1",
        "index_path": "example/releases/v1/_index.json",
        "rule_count": 7,
    }


def test_merged_manifest_adds_release_and_current_is_newest(tmp_path):
    newer = release_entry_for("example", "B", "2026-09-03")
    write_json(tmp_path / MANIFEST_FILE_NAME, manifest_with_releases("example", [newer]))
    older = release_entry_for("example", "A", "2025-12-09")

    manifest = merged_manifest(tmp_path, source_fields_for("example"), older)

    (source,) = manifest["sources"]
    assert manifest["schema_version"] == MANIFEST_SCHEMA_VERSION
    assert source["releases"] == [older, newer]
    assert source["release_tag"] == "B"
    assert source["index_path"] == "example/releases/B/_index.json"
    assert source["rule_count"] == newer["rule_count"]


def test_merged_manifest_reimport_replaces_same_tag_without_changing_current(tmp_path):
    older = release_entry_for("example", "A", "2025-12-09")
    newer = release_entry_for("example", "B", "2026-09-03")
    write_json(tmp_path / MANIFEST_FILE_NAME, manifest_with_releases("example", [older, newer]))
    reimported = release_entry_for("example", "A", "2025-12-09", rule_count=9)

    manifest = merged_manifest(tmp_path, source_fields_for("example"), reimported)

    (source,) = manifest["sources"]
    assert source["releases"] == [reimported, newer]
    assert source["release_tag"] == "B"


def test_merged_manifest_orders_releases_by_date_then_tag(tmp_path):
    later_tag_same_day = release_entry_for("example", "b", "2026-01-01")
    write_json(tmp_path / MANIFEST_FILE_NAME, manifest_with_releases("example", [later_tag_same_day]))

    manifest = merged_manifest(
        tmp_path, source_fields_for("example"), release_entry_for("example", "a", "2026-01-01")
    )

    assert [release["tag"] for release in manifest["sources"][0]["releases"]] == ["a", "b"]


def test_merged_manifest_keeps_other_sources(tmp_path):
    existing = manifest_with_releases("mscp", [release_entry_for("mscp", "v1", "2026-01-01", 350)])
    write_json(tmp_path / MANIFEST_FILE_NAME, existing)

    manifest = merged_manifest(
        tmp_path, source_fields_for("asd_ism"), release_entry_for("asd_ism", "v1", "2026-02-01")
    )

    assert [source["name"] for source in manifest["sources"]] == ["asd_ism", "mscp"]
    assert manifest["sources"][1] == existing["sources"][0]


def test_publish_release_leaves_library_untouched_on_validation_failure(tmp_path):
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    write_json(
        baselines_dir / MANIFEST_FILE_NAME,
        {"schema_version": MANIFEST_SCHEMA_VERSION, "sources": []},
    )
    before = snapshot(baselines_dir)

    def build_invalid_rule_tree(tree_dir: Path) -> int:
        invalid_rule = example_rule()
        invalid_rule["title"] = 42
        return write_rule_tree(tree_dir, "example", invalid_rule)

    with pytest.raises(ValueError, match="failed validation"):
        publish_release(
            baselines_dir,
            source_fields_for("example"),
            build_invalid_rule_tree,
            lambda rule_count: release_entry_for("example", "v1", "2026-01-01", rule_count),
        )

    assert snapshot(baselines_dir) == before
    assert sorted(path.name for path in tmp_path.iterdir()) == ["baselines"]


def test_publish_release_writes_tree_and_manifest(tmp_path):
    baselines_dir = tmp_path / "baselines"

    rule_count = publish_example_release(baselines_dir, "v1", "2026-01-01")

    assert rule_count == 1
    assert (baselines_dir / "example" / "releases" / "v1" / "rules" / "rule_one.json").is_file()
    (source,) = read_manifest(baselines_dir)["sources"]
    assert source["name"] == "example"
    assert source["release_tag"] == "v1"
    assert [release["tag"] for release in source["releases"]] == ["v1"]


def test_publish_release_leaves_other_release_folders_untouched(tmp_path):
    baselines_dir = tmp_path / "baselines"
    publish_example_release(baselines_dir, "A", "2025-12-09")
    first_release_before = snapshot(baselines_dir / "example" / "releases" / "A")

    publish_example_release(baselines_dir, "B", "2026-09-03")

    assert snapshot(baselines_dir / "example" / "releases" / "A") == first_release_before
    (source,) = read_manifest(baselines_dir)["sources"]
    assert [release["tag"] for release in source["releases"]] == ["A", "B"]
    assert source["release_tag"] == "B"


def test_publish_release_rejects_a_rule_stamped_with_another_release_tag(tmp_path):
    baselines_dir = tmp_path / "baselines"

    def build_mislabelled_rule_tree(tree_dir: Path) -> int:
        return write_rule_tree(tree_dir, "example", example_rule("example", "other"))

    with pytest.raises(ValueError, match="release_tag"):
        publish_release(
            baselines_dir,
            source_fields_for("example"),
            build_mislabelled_rule_tree,
            lambda rule_count: release_entry_for("example", "v1", "2026-01-01", rule_count),
        )


def test_publish_release_rejects_a_label_already_used_by_another_release(tmp_path):
    baselines_dir = tmp_path / "baselines"
    publish_example_release(baselines_dir, "A", "2025-12-09")
    before = snapshot(baselines_dir)

    def build_rule_tree(tree_dir: Path) -> int:
        return write_rule_tree(tree_dir, "example", example_rule("example", "B"))

    def duplicate_label_entry(rule_count: int) -> dict:
        return {**release_entry_for("example", "B", "2026-09-03", rule_count), "label": "label A"}

    with pytest.raises(ValueError, match="label"):
        publish_release(
            baselines_dir, source_fields_for("example"), build_rule_tree, duplicate_label_entry
        )

    assert snapshot(baselines_dir) == before


@pytest.mark.parametrize("maintainer_dir_name", ["_overlays", "_mappings"])
def test_publish_release_never_touches_a_maintainer_folder(tmp_path, maintainer_dir_name):
    baselines_dir = tmp_path / "baselines"
    kept_path = baselines_dir / maintainer_dir_name / "rules" / "kept.json"
    kept_path.parent.mkdir(parents=True)
    kept_path.write_text('{"kept": true}\n', encoding="utf-8")

    for publish_run in range(2):
        publish_example_release(baselines_dir, "v1", "2026-01-01")

    assert kept_path.read_text(encoding="utf-8") == '{"kept": true}\n'
    manifest = read_manifest(baselines_dir)
    assert maintainer_dir_name not in [source["name"] for source in manifest["sources"]]
