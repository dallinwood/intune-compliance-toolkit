import copy
import json
import shutil
import warnings
from pathlib import Path

import pytest

from tools import overlays
from tools.overlays import (
    InvalidOverlay,
    OverlayWarning,
    apply_overlay_fields,
    apply_overlay_to_index_entry,
    load_overlays,
    validate_overlays,
)

# Unknown keys and collisions are reported as warnings by design; without
# this, `python -m pytest -W error` would turn them into failures. A mark
# outranks the command-line -W, an ini or conftest filter does not.
pytestmark = pytest.mark.filterwarnings("default::tools.overlays.OverlayWarning")

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINES_DIR = REPO_ROOT / "baselines"
OVERLAYS_DIR = REPO_ROOT / "overlays"
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures" / "overlays"
CASES = json.loads((FIXTURES_DIR / "cases.json").read_text(encoding="utf-8"))
INVALID_SAMPLES = sorted((FIXTURES_DIR / "invalid").glob("*.json"))

ISM_1622 = "asd_ism.ism-1622"
ISM_1622_RELEASE = "v2026.09.4"


def write_overlay(directory: Path, file_name: str, overlay: dict) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / file_name).write_text(json.dumps(overlay), encoding="utf-8")


def ism_1622_overlay(overlay_id: str, fields: dict) -> dict:
    return {
        "schema_version": 1,
        "id": overlay_id,
        "targets": [{"rule": ISM_1622, "release": ISM_1622_RELEASE}],
        "fields": fields,
    }


@pytest.mark.parametrize("case", CASES["merge_cases"], ids=lambda case: case["name"])
def test_shared_merge_case(case):
    rule_before = copy.deepcopy(case["rule"])
    fields_before = copy.deepcopy(case["fields"])
    known_fields = set(case["known_fields"]) if "known_fields" in case else None

    if case.get("error"):
        with pytest.raises(InvalidOverlay):
            apply_overlay_fields(case["rule"], case["fields"], known_fields)
    else:
        assert apply_overlay_fields(case["rule"], case["fields"], known_fields) == case["expected"]

    assert case["rule"] == rule_before
    assert case["fields"] == fields_before


@pytest.mark.parametrize("case", CASES["index_cases"], ids=lambda case: case["name"])
def test_shared_index_case(case):
    entry_before = copy.deepcopy(case["entry"])

    if case.get("error"):
        with pytest.raises(InvalidOverlay):
            apply_overlay_to_index_entry(case["entry"], case["fields"])
    else:
        assert apply_overlay_to_index_entry(case["entry"], case["fields"]) == case["expected"]

    assert case["entry"] == entry_before


def test_merge_result_shares_no_objects_with_its_inputs():
    rule = {"id": "x.rule", "tags": ["a"], "references": {"nist": ["AC-1"]}}
    fields = {"tags": ["b"], "references": {"cis": ["1.1"]}, "check": {"$replace": {"by_version": {}}}}

    merged = apply_overlay_fields(rule, fields)
    merged["tags"].append("mutated")
    merged["references"]["nist"].append("mutated")
    merged["check"]["by_version"]["mutated"] = True

    assert rule == {"id": "x.rule", "tags": ["a"], "references": {"nist": ["AC-1"]}}
    assert fields["check"] == {"$replace": {"by_version": {}}}


def test_committed_overlays_are_valid():
    errors, overlay_warnings = validate_overlays(OVERLAYS_DIR, BASELINES_DIR)
    for message in overlay_warnings:
        warnings.warn(message, OverlayWarning)
    assert errors == []


def test_valid_samples_have_no_errors_or_warnings():
    assert validate_overlays(FIXTURES_DIR / "valid", BASELINES_DIR) == ([], [])


@pytest.mark.parametrize("sample", INVALID_SAMPLES, ids=lambda path: path.stem)
def test_invalid_sample_is_an_error(tmp_path, sample):
    shutil.copy(sample, tmp_path / sample.name)

    errors, _ = validate_overlays(tmp_path, BASELINES_DIR)

    assert errors != []
    assert all(sample.name in error for error in errors)


def test_missing_or_empty_overlay_folder_is_valid(tmp_path):
    assert validate_overlays(tmp_path / "missing", BASELINES_DIR) == ([], [])
    assert validate_overlays(tmp_path, BASELINES_DIR) == ([], [])


def test_load_overlays_reads_json_files_in_file_name_order_skipping_hidden_and_manifest(tmp_path):
    write_overlay(tmp_path, "b.json", ism_1622_overlay("b", {}))
    write_overlay(tmp_path, "a.json", ism_1622_overlay("a", {}))
    write_overlay(tmp_path, ".hidden.json", ism_1622_overlay("hidden", {}))
    write_overlay(tmp_path, "_manifest.json", {"files": []})
    (tmp_path / "notes.txt").write_text("not an overlay", encoding="utf-8")
    (tmp_path / "broken.json").write_text("{", encoding="utf-8")

    loaded = load_overlays(tmp_path)

    assert [entry["file_name"] for entry in loaded] == ["a.json", "b.json", "broken.json"]
    assert loaded[0]["overlay"]["id"] == "a"
    assert "overlay" not in loaded[2]
    assert loaded[2]["error"]


def test_missing_target_rule_is_an_error_naming_the_rule(tmp_path):
    overlay = ism_1622_overlay("missing-target", {"tags": ["a"]})
    overlay["targets"].append({"rule": "asd_ism.ism-0000", "release": ISM_1622_RELEASE})
    write_overlay(tmp_path, "missing-target.json", overlay)

    errors, _ = validate_overlays(tmp_path, BASELINES_DIR)

    assert len(errors) == 1
    assert "asd_ism.ism-0000" in errors[0]


def test_duplicate_overlay_ids_are_an_error(tmp_path):
    write_overlay(tmp_path, "first.json", ism_1622_overlay("same-id", {"tags": ["a"]}))
    write_overlay(tmp_path, "second.json", ism_1622_overlay("same-id", {"tags": ["b"]}))

    errors, _ = validate_overlays(tmp_path, BASELINES_DIR)

    assert len(errors) == 1
    assert "second.json" in errors[0] and "same-id" in errors[0]


def test_unknown_keys_are_warnings_and_dropped_before_schema_validation(tmp_path):
    fields = {
        "not_a_rule_field": True,
        "assessment": {"manual_reason": "manual", "reviewer": "someone"},
        "references": {"free_form": ["allowed, references is an open object"]},
    }
    write_overlay(tmp_path, "unknown-keys.json", ism_1622_overlay("unknown-keys", fields))

    errors, overlay_warnings = validate_overlays(tmp_path, BASELINES_DIR)

    assert errors == []
    assert len(overlay_warnings) == 2
    assert any("not_a_rule_field" in warning for warning in overlay_warnings)
    assert any("assessment.reviewer" in warning for warning in overlay_warnings)
    assert all("unknown-keys.json" in warning for warning in overlay_warnings)


def test_two_overlays_setting_the_same_single_value_are_a_collision_warning(tmp_path):
    write_overlay(tmp_path, "a.json", ism_1622_overlay("first", {"title": "One", "tags": ["a"], "assessment": {"manual_reason": "manual"}}))
    write_overlay(tmp_path, "b.json", ism_1622_overlay("second", {"title": {"$replace": "Two"}, "tags": ["b"], "assessment": {"manual_reason": "inherent"}}))

    errors, overlay_warnings = validate_overlays(tmp_path, BASELINES_DIR)

    assert errors == []
    assert len(overlay_warnings) == 2
    assert any("title" in warning for warning in overlay_warnings)
    assert any("assessment.manual_reason" in warning for warning in overlay_warnings)
    assert all(ISM_1622 in warning and "a.json" in warning and "b.json" in warning for warning in overlay_warnings)


def test_overlay_warnings_are_reported_without_failing_under_warnings_as_errors(tmp_path):
    write_overlay(tmp_path, "unknown.json", ism_1622_overlay("unknown", {"not_a_rule_field": 1}))
    _, overlay_warnings = validate_overlays(tmp_path, BASELINES_DIR)

    with pytest.warns(OverlayWarning):
        for message in overlay_warnings:
            warnings.warn(message, OverlayWarning)


def test_merged_index_entry_is_checked_against_the_index_schema(tmp_path):
    write_overlay(tmp_path, "empty-path.json", ism_1622_overlay("empty-path", {"section_path": {"$replace": []}}))

    errors, _ = validate_overlays(tmp_path, BASELINES_DIR)

    assert any("index entry" in error and "section_path" in error for error in errors)


def test_later_file_wins_for_a_single_value(tmp_path):
    write_overlay(tmp_path, "a.json", ism_1622_overlay("first", {"title": "One"}))
    write_overlay(tmp_path, "b.json", ism_1622_overlay("second", {"title": "Two"}))

    merged = overlays.merged_rules(tmp_path, BASELINES_DIR)

    assert merged[ISM_1622]["title"] == "Two"


def test_a_check_does_not_change_the_assessment(tmp_path):
    shutil.copy(FIXTURES_DIR / "valid" / "ism-1622-constrained-language-mode.json", tmp_path)

    merged = overlays.merged_rules(tmp_path, BASELINES_DIR)

    assert merged[ISM_1622]["check"] is not None
    assert merged[ISM_1622]["assessment"] == {"status": "manual", "manual_reason": "no_check"}
