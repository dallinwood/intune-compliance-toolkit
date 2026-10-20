import copy
import json
from pathlib import Path

import pytest

from tools.validate_library import schema_errors, validate_library

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
            "result": {"type": "string", "value": "PASS"},
        },
        "by_version": {
            "15.0": {
                "shell": "defaults read com.apple.x",
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
