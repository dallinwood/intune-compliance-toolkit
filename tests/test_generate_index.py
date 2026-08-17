import copy
import json
from pathlib import Path

import pytest

from tools.generate_index import build_index, find_rule_folders, write_index

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINES_DIR = REPO_ROOT / "baselines"
COMMITTED_INDEX_FILES = sorted(BASELINES_DIR.glob("*/*/*/_index.json"))

MINIMAL_RULE = {
    "id": "1.1",
    "title": "Ensure Something",
    "assessment_status": "Automated",
    "benchmark": {"product": "Test Benchmark", "version": "1.0.0", "platform": "Test"},
    "profile_applicability": ["Level 1"],
    "recommended_state": "Disabled",
    "description": "long prose that should not end up in the index",
    "rationale": "more prose",
    "impact": "more prose",
    "audit": {
        "methods": [
            {
                "method_name": "Terminal Method",
                "type": "scripted",
                "description": "...",
                "steps": [
                    {
                        "step_role": "compliance_check",
                        "original_command": None,
                        "check_command": "$test_rule_a_status = 1",
                        "check_command_verified": True,
                        "output_description": "...",
                        "output_check": [
                            {
                                "variable": "test_rule_a_status",
                                "data_type": "integer",
                                "operator": "eq",
                                "value": 1,
                                "value_source": "benchmark",
                            }
                        ],
                    }
                ],
            }
        ]
    },
    "remediation": {"methods": [{"method_name": "x", "type": "manual_steps", "description": "..."}]},
    "default_value": None,
    "references": [],
    "additional_information": None,
}


def write_rule(path, rule_id, filename):
    rule = {**MINIMAL_RULE, "id": rule_id}
    (path / filename).write_text(json.dumps(rule), encoding="utf-8")


def test_find_rule_folders_groups_by_parent_and_skips_index_json(tmp_path):
    folder_a = tmp_path / "benchmark" / "v1"
    folder_a.mkdir(parents=True)
    write_rule(folder_a, "1.1", "rule_a.json")
    write_rule(folder_a, "1.2", "rule_b.json")
    (folder_a / "_index.json").write_text("{}", encoding="utf-8")

    folders = find_rule_folders(tmp_path)

    assert list(folders.keys()) == [folder_a]
    assert {p.name for p in folders[folder_a]} == {"rule_a.json", "rule_b.json"}


def test_find_rule_folders_ignores_non_rule_json_and_skipped_dirs(tmp_path):
    rules_folder = tmp_path / "benchmark" / "v1"
    rules_folder.mkdir(parents=True)
    write_rule(rules_folder, "1.1", "rule_a.json")
    (rules_folder / "not_a_rule.json").write_text(
        json.dumps({"$schema": "...", "properties": {}}), encoding="utf-8"
    )
    (rules_folder / "unparseable.json").write_text("not json at all", encoding="utf-8")
    # Underscore prefix excludes a file by name alone, even if it's shaped
    # exactly like a rule (e.g. baselines/_rule.schema.json is not one).
    write_rule(rules_folder, "9.9", "_not_indexed_despite_shape.json")

    # Any dotfolder is skipped generically, not just a hardcoded .venv/.git list.
    dotfolder = tmp_path / ".some_tool_cache"
    dotfolder.mkdir(parents=True)
    write_rule(dotfolder, "9.9", "coincidentally_shaped.json")

    folders = find_rule_folders(tmp_path)

    assert list(folders.keys()) == [rules_folder]
    assert {p.name for p in folders[rules_folder]} == {"rule_a.json"}


def test_index_omits_prose_fields_and_captures_variables(tmp_path):
    folder = tmp_path / "benchmark" / "v1"
    folder.mkdir(parents=True)
    write_rule(folder, "1.1", "rule_a.json")

    index = build_index(list(folder.glob("*.json")))

    entry = index["rules"][0]
    assert entry["variables"] == ["test_rule_a_status"]
    assert "description" not in entry
    assert "rationale" not in entry


def test_index_marks_rules_requiring_organization_defined_value(tmp_path):
    folder = tmp_path / "benchmark" / "v1"
    folder.mkdir(parents=True)
    write_rule(folder, "1.1", "rule_a.json")  # value_source: benchmark, per MINIMAL_RULE

    org_defined_rule = copy.deepcopy(MINIMAL_RULE)
    org_defined_rule["id"] = "1.2"
    output_check = org_defined_rule["audit"]["methods"][0]["steps"][0]["output_check"][0]
    output_check["value_source"] = "organization_defined"
    output_check["value"] = None
    (folder / "rule_b.json").write_text(json.dumps(org_defined_rule), encoding="utf-8")

    index = build_index(list(folder.glob("*.json")))

    flags = {entry["id"]: entry["requires_organization_defined_value"] for entry in index["rules"]}
    assert flags == {"1.1": False, "1.2": True}


def test_index_is_sorted_by_id(tmp_path):
    folder = tmp_path / "benchmark" / "v1"
    folder.mkdir(parents=True)
    write_rule(folder, "9.9", "rule_c.json")
    write_rule(folder, "1.1", "rule_a.json")
    write_rule(folder, "4.5", "rule_b.json")

    index = build_index(list(folder.glob("*.json")))

    assert [entry["id"] for entry in index["rules"]] == ["1.1", "4.5", "9.9"]


def test_write_index_is_deterministic(tmp_path):
    folder = tmp_path / "benchmark" / "v1"
    folder.mkdir(parents=True)
    write_rule(folder, "1.1", "rule_a.json")
    write_rule(folder, "1.2", "rule_b.json")

    rule_files = [folder / "rule_a.json", folder / "rule_b.json"]
    first_pass = write_index(folder, rule_files).read_text(encoding="utf-8")
    second_pass = write_index(folder, rule_files).read_text(encoding="utf-8")

    assert first_pass == second_pass


@pytest.mark.parametrize("index_path", COMMITTED_INDEX_FILES, ids=lambda p: str(p.relative_to(BASELINES_DIR)))
def test_committed_index_matches_its_folder(index_path):
    """Catches a rule added/edited/removed without re-running generate_index.py -
    nothing else notices a committed _index.json going stale."""
    folder = index_path.parent
    rule_files = [p for p in folder.glob("*.json") if p.name != "_index.json"]

    rebuilt = json.dumps(build_index(rule_files), indent=2) + "\n"
    committed = index_path.read_text(encoding="utf-8")

    assert committed == rebuilt
