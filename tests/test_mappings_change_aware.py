import copy
import json
from pathlib import Path

import pytest

from tools.mappings import changed_since, validate_mappings

pytestmark = pytest.mark.filterwarnings("default::tools.mappings.MappingWarning")

COMMIT_SHA = "a" * 40
MSCP_RULE = "mscp.os_example"
ISM_RULE = "asd_ism.ism-0001"
LICENSE = {"name": "CC BY 4.0", "url": "https://example.test/licence", "rights_holder": "Someone", "modified": True}


def make_rule(rule_id: str, release_tag: str, **overrides) -> dict:
    rule = {
        "schema_version": 5,
        "id": rule_id,
        "title": "Example rule",
        "discussion": "Discussion.",
        "discussion_format": "markdown",
        "section_path": ["Section"],
        "source": {"name": rule_id.split(".")[0], "release_tag": release_tag, "commit_sha": COMMIT_SHA},
        "assessment": {"status": "manual", "manual_reason": "no_check"},
        "architecture": None,
        "applicability": [
            {"target": "macOS", "version": "26.0", "benchmarks": [{"name": "b", "severity": None}, {"name": "a", "severity": None}]},
            {"target": "macOS", "version": "27.0", "benchmarks": []},
        ],
        "tags": [],
        "references": {},
        "check": {"macOS": {"language": "bash", "default": {"shell": "echo 1", "result": None, "additional_info": None}, "by_version": {}}},
        "odv": None,
        "remediation": None,
    }
    rule.update(overrides)
    return rule


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(value, indent=2) + "\n").encode("utf-8"))


def write_library(baselines_dir: Path, releases_by_source: dict[str, dict[str, dict]]) -> None:
    """releases_by_source: source name -> release tag (oldest first) -> that release's single rule."""
    sources = []
    for source_name, rule_by_tag in releases_by_source.items():
        releases = []
        for position, (tag, rule) in enumerate(rule_by_tag.items()):
            index_path = f"{source_name}/releases/{tag}/_index.json"
            write_json(baselines_dir / index_path, {"schema_version": 5, "source": source_name, "rules": [{"id": rule["id"], "file": "rules/rule.json"}]})
            write_json(baselines_dir / source_name / "releases" / tag / "rules" / "rule.json", rule)
            releases.append({"tag": tag, "label": tag, "published_date": f"2026-0{position + 1}-01", "commit_sha": COMMIT_SHA,
                             "retrieved_date": "2026-10-01", "importer_format": "x-1", "index_path": index_path, "rule_count": 1})
        newest = releases[-1]
        sources.append({"name": source_name, "display_name": source_name, "release_tag": newest["tag"], "commit_sha": COMMIT_SHA,
                        "retrieved_date": "2026-10-01", "repository_url": "https://example.test", "license": LICENSE,
                        "index_path": newest["index_path"], "rule_count": 1, "releases": releases})
    write_json(baselines_dir / "_manifest.json", {"schema_version": 6, "sources": sources})
    write_json(baselines_dir / "_change_ignore.json", {"schema_version": 1, "ignored_fields": ["source", "schema_version", "id", "file"]})


def endpoint(rule_id: str, release: str) -> dict:
    return {"kind": "rule", "id": rule_id, "release": release}


def write_mapping(mappings_dir: Path, mscp_release: str, ism_release: str) -> None:
    write_json(
        mappings_dir / "link.json",
        {"schema_version": 1, "id": "link", "links": [{"relation": "related", "from": [endpoint(MSCP_RULE, mscp_release)], "to": [endpoint(ISM_RULE, ism_release)]}]},
    )


def two_release_library(tmp_path: Path, mscp_old: dict, mscp_new: dict) -> Path:
    baselines_dir = tmp_path / "baselines"
    write_library(
        baselines_dir,
        {"mscp": {"R1": mscp_old, "R2": mscp_new}, "asd_ism": {"V1": make_rule(ISM_RULE, "V1")}},
    )
    return baselines_dir


def test_an_unchanged_rule_gives_no_warning(tmp_path):
    baselines_dir = two_release_library(tmp_path, make_rule(MSCP_RULE, "R1"), make_rule(MSCP_RULE, "R2"))
    write_mapping(tmp_path / "mappings", "R1", "V1")

    assert validate_mappings(tmp_path / "mappings", baselines_dir) == ([], [])
    assert changed_since(baselines_dir, MSCP_RULE, "R1") == []


def test_a_rule_differing_only_in_source_fields_gives_no_warning(tmp_path):
    older = make_rule(MSCP_RULE, "R1")
    newer = make_rule(MSCP_RULE, "R2")
    newer["source"]["commit_sha"] = "b" * 40
    baselines_dir = two_release_library(tmp_path, older, newer)
    write_mapping(tmp_path / "mappings", "R1", "V1")

    assert validate_mappings(tmp_path / "mappings", baselines_dir) == ([], [])


def test_a_reordered_applicability_is_not_a_change(tmp_path):
    older = make_rule(MSCP_RULE, "R1")
    newer = make_rule(MSCP_RULE, "R2")
    newer["applicability"] = list(reversed(copy.deepcopy(older["applicability"])))
    newer["applicability"][1]["benchmarks"].reverse()
    baselines_dir = two_release_library(tmp_path, older, newer)

    assert changed_since(baselines_dir, MSCP_RULE, "R1") == []


def test_a_changed_check_gives_one_warning_naming_the_field(tmp_path):
    changed_check = {"macOS": {"language": "bash", "default": {"shell": "echo 2", "result": None, "additional_info": None}, "by_version": {}}}
    baselines_dir = two_release_library(tmp_path, make_rule(MSCP_RULE, "R1"), make_rule(MSCP_RULE, "R2", check=changed_check))
    write_mapping(tmp_path / "mappings", "R1", "V1")

    errors, mapping_warnings = validate_mappings(tmp_path / "mappings", baselines_dir)

    assert errors == []
    assert len(mapping_warnings) == 1
    assert "link.json" in mapping_warnings[0]
    assert f"rule {MSCP_RULE} was mapped against mscp R1, and has changed since (check)" in mapping_warnings[0]
    assert "review the link for accuracy" in mapping_warnings[0]
    assert changed_since(baselines_dir, MSCP_RULE, "R1") == ["check"]


def test_changed_fields_are_listed_sorted(tmp_path):
    baselines_dir = two_release_library(tmp_path, make_rule(MSCP_RULE, "R1"), make_rule(MSCP_RULE, "R2", title="New", tags=["t"]))

    assert changed_since(baselines_dir, MSCP_RULE, "R1") == ["tags", "title"]


def test_an_unknown_mapped_release_still_warns_as_before(tmp_path):
    baselines_dir = two_release_library(tmp_path, make_rule(MSCP_RULE, "R1"), make_rule(MSCP_RULE, "R2"))
    write_mapping(tmp_path / "mappings", "R0", "V1")

    _, mapping_warnings = validate_mappings(tmp_path / "mappings", baselines_dir)

    assert len(mapping_warnings) == 1
    assert f"rule {MSCP_RULE} was mapped against mscp R0, but the library is at R2" in mapping_warnings[0]
    assert changed_since(baselines_dir, MSCP_RULE, "R0") is None


def test_a_rule_missing_from_the_mapped_release_counts_as_added(tmp_path):
    baselines_dir = tmp_path / "baselines"
    write_library(baselines_dir, {"mscp": {"R1": make_rule("mscp.other", "R1"), "R2": make_rule(MSCP_RULE, "R2")}})

    assert changed_since(baselines_dir, MSCP_RULE, "R1") == ["added"]


def test_a_release_that_is_current_is_unchanged(tmp_path):
    baselines_dir = two_release_library(tmp_path, make_rule(MSCP_RULE, "R1"), make_rule(MSCP_RULE, "R2", title="New"))
    write_mapping(tmp_path / "mappings", "R2", "V1")

    assert changed_since(baselines_dir, MSCP_RULE, "R2") == []
    assert validate_mappings(tmp_path / "mappings", baselines_dir) == ([], [])


def test_a_missing_value_and_a_null_are_the_same_so_this_agrees_with_the_web_ui(tmp_path):
    older = make_rule(MSCP_RULE, "R1")
    newer = make_rule(MSCP_RULE, "R2")
    del older["check"]["macOS"]["default"]["additional_info"]
    baselines_dir = two_release_library(tmp_path, older, newer)

    assert changed_since(baselines_dir, MSCP_RULE, "R1") == []


def test_a_top_level_null_and_a_missing_field_are_the_same(tmp_path):
    older = make_rule(MSCP_RULE, "R1")
    newer = make_rule(MSCP_RULE, "R2")
    del older["odv"]
    baselines_dir = two_release_library(tmp_path, older, newer)

    assert changed_since(baselines_dir, MSCP_RULE, "R1") == []
