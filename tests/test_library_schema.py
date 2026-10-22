import copy
import json
from pathlib import Path

import pytest

from tools.validate_library import duplicate_term_errors, schema_errors, validate_library

BACKSLASH = chr(92)

COMMIT_SHA = "a" * 40
LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "rights_holder": "NIST macOS Security Compliance Project contributors",
    "modified": True,
}

MINIMAL_RULE = {
    "schema_version": 3,
    "id": "mscp.os_gatekeeper_enable",
    "platform": "macOS",
    "title": "Enable Gatekeeper",
    "discussion": "Gatekeeper _MUST_ be enabled.",
    "source": {
        "name": "mscp",
        "release_tag": "release_27.0",
        "commit_sha": COMMIT_SHA,
        "upstream_rule_id": "os_gatekeeper_enable",
        "upstream_path": "rules/os/os_gatekeeper_enable.yaml",
        "upstream_url": (
            "https://github.com/usnistgov/macos_security/blob/"
            + COMMIT_SHA
            + "/src/mscp/data/rules/os/os_gatekeeper_enable.yaml"
        ),
        "license": LICENSE,
    },
    "assessment": {"status": "automated", "manual_reason": None},
    "architecture": None,
    "applicability": {
        "26.0": [
            {"name": "cis_lvl1", "severity": None},
            {"name": "disa_stig", "severity": "high"},
        ]
    },
    "tags": ["800-53r5_low", "cisv8"],
    "references": {"nist": {"800-53r5": ["CM-14"]}},
    "check": {
        "default": {
            "shell": "/usr/sbin/spctl --status",
            "additional_info": None,
            "result": {"type": "string", "value": "PASS"},
        },
        "by_version": {
            "15.0": {
                "shell": "defaults read com.apple.x",
                "additional_info": None,
                "result": {"type": "integer", "value": 1},
            }
        },
    },
    "odv": None,
    "remediation": {
        "default": {"shell": None, "additional_info": None},
        "by_version": {},
        "mobileconfig_info": None,
        "mobileconfig_by_version": {},
        "ddm_info": None,
    },
}


def make_rule(**overrides):
    rule = copy.deepcopy(MINIMAL_RULE)
    rule.update(overrides)
    return rule


def index_entry_for(rule, file_path):
    return {
        "id": rule["id"],
        "title": rule["title"],
        "file": file_path,
        "platform": rule["platform"],
        "section": "os",
        "assessment": rule["assessment"],
        "architecture": rule["architecture"],
        "applicability": rule["applicability"],
        "tags": rule["tags"],
        "has_odv": rule["odv"] is not None,
    }


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def write_library(baselines_dir: Path, rule=None, index_file="rules/os_gatekeeper_enable.json"):
    rule = rule or make_rule()
    write_json(
        baselines_dir / "_manifest.json",
        {
            "schema_version": 3,
            "sources": [
                {
                    "name": "mscp",
                    "display_name": "NIST macOS Security Compliance Project",
                    "release_tag": "release_27.0",
                    "commit_sha": COMMIT_SHA,
                    "retrieved_date": "2026-10-20",
                    "repository_url": "https://github.com/usnistgov/macos_security",
                    "license": LICENSE,
                    "index_path": "mscp/_index.json",
                    "rule_count": 1,
                }
            ],
        },
    )
    write_json(
        baselines_dir / "mscp" / "_index.json",
        {
            "schema_version": 3,
            "source": "mscp",
            "rules": [index_entry_for(rule, index_file)],
        },
    )
    return rule


def test_minimal_rule_is_valid():
    assert schema_errors(MINIMAL_RULE) == []


def test_rejects_numeric_id():
    assert schema_errors(make_rule(id="12"))


def test_manual_reason_required_for_manual():
    rule = make_rule(assessment={"status": "manual", "manual_reason": None})
    assert schema_errors(rule)


def test_manual_reason_null_for_automated():
    rule = make_rule(assessment={"status": "automated", "manual_reason": "manual"})
    assert schema_errors(rule)


def test_manual_with_reason_is_valid():
    rule = make_rule(assessment={"status": "manual", "manual_reason": "inherent"})
    assert schema_errors(rule) == []


def test_odv_placeholder_allowed_as_integer_value():
    rule = make_rule()
    rule["check"]["default"]["result"] = {"type": "integer", "value": "$ODV"}
    assert schema_errors(rule) == []
    rule["check"]["default"]["result"] = {"type": "integer", "value": "7"}
    assert schema_errors(rule)


def test_rejects_unknown_top_level_key():
    assert schema_errors(make_rule(surprise=True))


def test_validate_library_clean_library(tmp_path):
    write_library(tmp_path)
    write_json(tmp_path / "mscp" / "rules" / "os_gatekeeper_enable.json", make_rule())
    assert validate_library(tmp_path) == []


def test_validate_library_reports_missing_rule_file(tmp_path):
    write_library(tmp_path)
    errors = validate_library(tmp_path)
    assert any("os_gatekeeper_enable.json" in error for error in errors)


def test_validate_library_reports_id_mismatch(tmp_path):
    write_library(tmp_path)
    write_json(
        tmp_path / "mscp" / "rules" / "os_gatekeeper_enable.json",
        make_rule(id="mscp.something_else"),
    )
    errors = validate_library(tmp_path)
    assert any("mscp.something_else" in error for error in errors)


def test_validate_library_rejects_malformed_manifest(tmp_path):
    (tmp_path / "_manifest.json").write_text("{not json", encoding="utf-8")
    assert validate_library(tmp_path)


def test_validate_library_rejects_null_manifest(tmp_path):
    (tmp_path / "_manifest.json").write_text("null", encoding="utf-8")
    assert validate_library(tmp_path)


def test_validate_library_rejects_null_rule_file(tmp_path):
    write_library(tmp_path)
    rule_path = tmp_path / "mscp" / "rules" / "os_gatekeeper_enable.json"
    rule_path.parent.mkdir(parents=True, exist_ok=True)
    rule_path.write_text("null", encoding="utf-8")
    assert validate_library(tmp_path)


@pytest.mark.parametrize(
    "unsafe_path",
    ["../escape.json", "rules/../../escape.json", "/abs.json", "rules" + BACKSLASH + "x.json", "C:/x.json", "C:x.json", "rules/x.json\n"],
)
def test_index_rejects_unsafe_file_path(unsafe_path):
    index = {
        "schema_version": 3,
        "source": "mscp",
        "rules": [index_entry_for(MINIMAL_RULE, unsafe_path)],
    }
    assert schema_errors(index, "index")


def test_index_accepts_safe_file_path():
    index = {
        "schema_version": 3,
        "source": "mscp",
        "rules": [index_entry_for(MINIMAL_RULE, "rules/os..x.json")],
    }
    assert schema_errors(index, "index") == []


def test_index_rejects_entry_missing_platform():
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    del entry["platform"]
    assert schema_errors({"schema_version": 3, "source": "mscp", "rules": [entry]}, "index")


@pytest.mark.parametrize("bad_platform", ["", "macOS\n"])
def test_index_rejects_bad_platform(bad_platform):
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    entry["platform"] = bad_platform
    assert schema_errors({"schema_version": 3, "source": "mscp", "rules": [entry]}, "index")


def test_index_rejects_entry_missing_section():
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    del entry["section"]
    assert schema_errors({"schema_version": 3, "source": "mscp", "rules": [entry]}, "index")


@pytest.mark.parametrize("bad_section", ["", "OS", "os/x", "os\n"])
def test_index_rejects_bad_section(bad_section):
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    entry["section"] = bad_section
    assert schema_errors({"schema_version": 3, "source": "mscp", "rules": [entry]}, "index")


def test_index_rejects_entry_missing_required_key():
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    del entry["has_odv"]
    assert schema_errors({"schema_version": 3, "source": "mscp", "rules": [entry]}, "index")


def read_manifest(baselines_dir: Path) -> dict:
    return json.loads((baselines_dir / "_manifest.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("unsafe_path", ["../_index.json", "/abs/_index.json", "C:/_index.json", "a" + BACKSLASH + "b.json"])
def test_manifest_rejects_unsafe_index_path(tmp_path, unsafe_path):
    write_library(tmp_path)
    manifest = read_manifest(tmp_path)
    manifest["sources"][0]["index_path"] = unsafe_path
    assert schema_errors(manifest, "manifest")


def test_manifest_valid_after_write_library(tmp_path):
    write_library(tmp_path)
    assert schema_errors(read_manifest(tmp_path), "manifest") == []


def test_validate_library_reports_rule_count_mismatch(tmp_path):
    write_library(tmp_path)
    write_json(tmp_path / "mscp" / "rules" / "os_gatekeeper_enable.json", make_rule())
    manifest = read_manifest(tmp_path)
    manifest["sources"][0]["rule_count"] = 5
    write_json(tmp_path / "_manifest.json", manifest)
    assert any("rule_count" in error for error in validate_library(tmp_path))


def test_rejects_id_with_trailing_newline():
    assert schema_errors(make_rule(id="mscp.foo\n"))


def test_hyphenated_rule_id_is_valid():
    assert schema_errors(make_rule(id="mscp.os_mfa_network_non-priv")) == []


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
COMMITTED_VOCABULARY = REPOSITORY_ROOT / "baselines" / "_vocabulary.json"

MINIMAL_VOCABULARY = {
    "schema_version": 1,
    "vocabularies": {
        "benchmarks": [
            {"label": "CIS Level 1", "terms": ["cis_lvl1", "cislevel1"], "metadata": ["benchmark"]},
        ],
        "sections": [
            {"label": "Supplemental", "terms": ["supplemental"]},
        ],
        "manual_reasons": [
            {"label": "supplemental", "terms": ["supplemental"], "description": "Supplemental guidance with no check."},
        ],
        "tags": [],
    },
}


def make_vocabulary(**vocabularies):
    vocabulary = copy.deepcopy(MINIMAL_VOCABULARY)
    vocabulary["vocabularies"].update(vocabularies)
    return vocabulary


def write_clean_library_with_vocabulary(baselines_dir: Path, vocabulary) -> None:
    write_library(baselines_dir)
    write_json(baselines_dir / "mscp" / "rules" / "os_gatekeeper_enable.json", make_rule())
    write_json(baselines_dir / "_vocabulary.json", vocabulary)


def test_committed_vocabulary_is_valid():
    vocabulary = json.loads(COMMITTED_VOCABULARY.read_text(encoding="utf-8"))
    assert schema_errors(vocabulary, "vocabulary") == []
    assert duplicate_term_errors(vocabulary) == []


def test_minimal_vocabulary_is_valid():
    assert schema_errors(MINIMAL_VOCABULARY, "vocabulary") == []


def test_same_term_in_two_vocabularies_is_allowed():
    assert duplicate_term_errors(MINIMAL_VOCABULARY) == []


def test_duplicate_term_within_one_vocabulary_is_rejected():
    vocabulary = make_vocabulary(
        benchmarks=[
            {"label": "CIS Level 1", "terms": ["cis_lvl1"]},
            {"label": "CIS Level 1 (old)", "terms": ["cislevel1", "cis_lvl1"]},
        ]
    )
    errors = duplicate_term_errors(vocabulary)
    assert len(errors) == 1
    assert "benchmarks" in errors[0]
    assert "cis_lvl1" in errors[0]


def test_severities_vocabulary_is_allowed():
    vocabulary = make_vocabulary(severities=[{"label": "CAT I", "terms": ["high", "cat_i"], "metadata": ["severity"]}])
    assert schema_errors(vocabulary, "vocabulary") == []


def test_committed_vocabulary_orders_severities_low_medium_high():
    vocabulary = json.loads(COMMITTED_VOCABULARY.read_text(encoding="utf-8"))
    severities = vocabulary["vocabularies"]["severities"]
    assert [entry["terms"] for entry in severities] == [["low"], ["medium"], ["high"]]
    assert [entry["label"] for entry in severities] == ["low", "medium", "high"]


@pytest.mark.parametrize("vocabulary_name", ["platforms", "sources"])
def test_platform_and_source_vocabularies_are_accepted(vocabulary_name):
    vocabulary = make_vocabulary(**{vocabulary_name: [{"label": "Label", "terms": ["raw"]}]})
    assert schema_errors(vocabulary, "vocabulary") == []


def test_unknown_vocabulary_key_is_rejected():
    assert schema_errors(make_vocabulary(frameworks=[{"label": "X", "terms": ["x"]}]), "vocabulary")


@pytest.mark.parametrize(
    "bad_entry",
    [
        {"label": "No terms"},
        {"label": "Empty terms", "terms": []},
        {"label": "Empty term", "terms": [""]},
        {"label": "Repeated term", "terms": ["a", "a"]},
        {"label": "", "terms": ["a"]},
        {"terms": ["a"]},
        {"label": "Extra key", "terms": ["a"], "colour": "red"},
        {"label": "Empty metadata tag", "terms": ["a"], "metadata": [""]},
        {"label": "Repeated metadata", "terms": ["a"], "metadata": ["x", "x"]},
        {"label": "Empty description", "terms": ["a"], "description": ""},
        {"label": "Trailing newline\n", "terms": ["a"]},
        {"label": "Term with newline", "terms": ["a\n"]},
    ],
)
def test_malformed_entry_is_rejected(bad_entry):
    assert schema_errors(make_vocabulary(sections=[bad_entry]), "vocabulary")


@pytest.mark.parametrize(
    "bad_top_level",
    [
        {"vocabularies": {}},
        {"schema_version": 2, "vocabularies": {}},
        {"schema_version": 1},
        {"schema_version": 1, "vocabularies": {}, "extra": True},
        {"schema_version": 1, "vocabularies": {"sections": {}}},
    ],
)
def test_malformed_top_level_is_rejected(bad_top_level):
    assert schema_errors(bad_top_level, "vocabulary")


def test_validate_library_accepts_valid_vocabulary(tmp_path):
    write_clean_library_with_vocabulary(tmp_path, MINIMAL_VOCABULARY)
    assert validate_library(tmp_path) == []


def test_validate_library_reports_duplicate_term(tmp_path):
    vocabulary = make_vocabulary(sections=[{"label": "A", "terms": ["os"]}, {"label": "B", "terms": ["os"]}])
    write_clean_library_with_vocabulary(tmp_path, vocabulary)
    errors = validate_library(tmp_path)
    assert len(errors) == 1
    assert "_vocabulary.json" in errors[0]
    assert "sections" in errors[0]


def test_validate_library_reports_schema_problem_in_vocabulary(tmp_path):
    write_clean_library_with_vocabulary(tmp_path, make_vocabulary(frameworks=[]))
    errors = validate_library(tmp_path)
    assert errors
    assert all("_vocabulary.json" in error for error in errors)


def test_validate_library_reports_malformed_vocabulary_json(tmp_path):
    write_clean_library_with_vocabulary(tmp_path, MINIMAL_VOCABULARY)
    (tmp_path / "_vocabulary.json").write_text("{not json", encoding="utf-8")
    assert any("_vocabulary.json" in error for error in validate_library(tmp_path))


def test_validate_library_checks_vocabulary_even_when_manifest_is_broken(tmp_path):
    write_json(tmp_path / "_vocabulary.json", make_vocabulary(frameworks=[]))
    (tmp_path / "_manifest.json").write_text("null", encoding="utf-8")
    assert any("_vocabulary.json" in error for error in validate_library(tmp_path))
