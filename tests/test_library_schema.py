import copy
import json
from pathlib import Path

import pytest

from tools.script_types import check_types, remediation_types
from tools.validate_library import applicability_errors, duplicate_term_errors, schema_errors, validate_library

BACKSLASH = chr(92)

COMMIT_SHA = "a" * 40
LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "rights_holder": "NIST macOS Security Compliance Project contributors",
    "modified": True,
}

MINIMAL_RULE = {
    "schema_version": 7,
    "id": "mscp.os_gatekeeper_enable",
    "title": "Enable Gatekeeper",
    "discussion": "Gatekeeper _MUST_ be enabled.",
    "discussion_format": "asciidoc",
    "section_path": ["os"],
    "source": {
        "name": "mscp",
        "release_tag": "release_27.0",
        "commit_sha": COMMIT_SHA,
        "upstream_rule_id": "os_gatekeeper_enable",
        "upstream_path": "rules/os/os_gatekeeper_enable.yaml",
        "upstream_revision": None,
        "upstream_updated": None,
        "upstream_url": (
            "https://github.com/usnistgov/macos_security/blob/"
            + COMMIT_SHA
            + "/src/mscp/data/rules/os/os_gatekeeper_enable.yaml"
        ),
        "license": LICENSE,
    },
    "assessment": {"status": "automated", "manual_reason": None},
    "architecture": None,
    "applicability": [
        {
            "target": "macOS",
            "version": "26.0",
            "benchmarks": [
                {"name": "cis_lvl1", "severity": None},
                {"name": "disa_stig", "severity": "high"},
            ],
        }
    ],
    "tags": ["800-53r5_low", "cisv8"],
    "references": {"nist": {"800-53r5": ["CM-14"]}},
    "check": {
        "macOS": [
            {
                "name": None,
                "language": "bash",
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
            }
        ]
    },
    "odvs": [],
    "remediation": {
        "macOS": {
            "steps": [
                {
                    "name": None,
                    "language": "bash",
                    "shell": "/usr/sbin/spctl --global-enable",
                    "additional_info": None,
                    "versions": None,
                }
            ],
            "payloads": [{"kind": "mobileconfig", "versions": ["26.0"], "data": [{"PayloadType": "a.b"}]}],
        }
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
        "section": "os",
        "section_path": ["os"],
        "assessment": rule["assessment"],
        "architecture": rule["architecture"],
        "applicability": rule["applicability"],
        "tags": rule["tags"],
        "has_odv": len(rule["odvs"]) > 0,
        "check_types": check_types(rule["check"]),
        "remediation_types": remediation_types(rule["remediation"]),
    }


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


MSCP_RELEASE_DIR = "mscp/releases/release_27.0"
MSCP_RELEASE = {
    "tag": "release_27.0",
    "label": "27.0",
    "published_date": "2026-09-11",
    "commit_sha": COMMIT_SHA,
    "retrieved_date": "2026-10-20",
    "importer_format": "mscp-2",
    "index_path": f"{MSCP_RELEASE_DIR}/_index.json",
    "rule_count": 1,
}


def make_manifest(releases=None):
    releases = copy.deepcopy(releases or [MSCP_RELEASE])
    newest = releases[-1]
    return {
        "schema_version": 7,
        "sources": [
            {
                "name": "mscp",
                "display_name": "NIST macOS Security Compliance Project",
                "provenance": "official",
                "release_tag": newest["tag"],
                "commit_sha": newest["commit_sha"],
                "retrieved_date": newest["retrieved_date"],
                "repository_url": "https://github.com/usnistgov/macos_security",
                "license": LICENSE,
                "index_path": newest["index_path"],
                "rule_count": newest["rule_count"],
                "releases": releases,
            }
        ],
    }


def write_library(baselines_dir: Path, rule=None, index_file="rules/os_gatekeeper_enable.json"):
    rule = rule or make_rule()
    write_json(baselines_dir / "_manifest.json", make_manifest())
    write_json(
        baselines_dir / MSCP_RELEASE_DIR / "_index.json",
        {
            "schema_version": 7,
            "source": "mscp",
            "rules": [index_entry_for(rule, index_file)],
        },
    )
    return rule


def test_minimal_rule_is_valid():
    assert schema_errors(MINIMAL_RULE) == []


def instructions_rule(**entry_overrides):
    rule = make_rule()
    entry = {"shell": None, "additional_info": "Read the setting.", "result": None}
    entry.update(entry_overrides)
    rule["check"] = {"macOS": [{"name": None, "language": "instructions", "default": entry, "by_version": {"15.0": dict(entry)}}]}
    rule["remediation"]["macOS"]["steps"] = [
        {"name": None, "language": "instructions", "shell": None, "additional_info": "Do it.", "versions": None}
    ]
    return rule


def test_instructions_language_is_valid_without_a_script():
    assert schema_errors(instructions_rule()) == []


def test_instructions_check_rejects_shell():
    assert schema_errors(instructions_rule(shell="echo hi")) != []


def test_instructions_check_rejects_shell_file():
    rule = instructions_rule()
    del rule["check"]["macOS"][0]["default"]["shell"]
    rule["check"]["macOS"][0]["default"]["shell_file"] = "baselines/x/check.sh"
    assert schema_errors(rule) != []


def test_instructions_check_rejects_result():
    assert schema_errors(instructions_rule(result={"type": "integer", "value": 1})) != []


def test_instructions_step_rejects_shell():
    rule = instructions_rule()
    rule["remediation"]["macOS"]["steps"][0]["shell"] = "echo hi"
    assert schema_errors(rule) != []


def test_instructions_step_rejects_shell_file():
    rule = instructions_rule()
    step = rule["remediation"]["macOS"]["steps"][0]
    del step["shell"]
    step["shell_file"] = "baselines/x/fix.sh"
    assert schema_errors(rule) != []


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


def test_manual_reason_openscap_is_valid():
    rule = make_rule(assessment={"status": "manual", "manual_reason": "openscap"})
    assert schema_errors(rule) == []


def test_odv_placeholder_allowed_as_integer_value():
    rule = make_rule()
    rule["check"]["macOS"][0]["default"]["result"] = {"type": "integer", "value": "$ODV_value"}
    assert schema_errors(rule) == []
    for bad_value in ("7", "$ODV", "$ODV_Value", "$ODV_value extra", "$ODV_value\n"):
        rule["check"]["macOS"][0]["default"]["result"] = {"type": "integer", "value": bad_value}
        assert schema_errors(rule), bad_value


def make_odv(**overrides):
    odv = {
        "name": "value",
        "datatype": "number",
        "description": "Minimum length",
        "validation": None,
        "recommended": 6,
        "by_benchmark": {},
        "quoting": "unquoted",
    }
    return {**odv, **overrides}


def test_odvs_with_valid_items_are_accepted():
    assert schema_errors(make_rule(odvs=[make_odv(), make_odv(name="max_age", quoting="single")])) == []


@pytest.mark.parametrize("bad_name", ["Value", "1value", "va-lue", "", "value ", "value\n"])
def test_bad_odv_name_rejected(bad_name):
    assert schema_errors(make_rule(odvs=[make_odv(name=bad_name)]))


def test_unknown_quoting_rejected():
    assert schema_errors(make_rule(odvs=[make_odv(quoting="backtick")]))


def test_accepts_unversioned_untargeted_rule():
    rule = make_rule(
        id="asd_ism.ism-1667",
        applicability=[{"target": None, "version": None, "benchmarks": []}],
        remediation=None,
    )
    assert schema_errors(rule) == []


def test_rejects_version_without_target():
    rule = make_rule(applicability=[{"target": None, "version": "15.0", "benchmarks": []}])
    assert schema_errors(rule)


def test_rejects_platform_key():
    assert schema_errors(make_rule(platform="macOS"))


@pytest.mark.parametrize("bad_version", ["15 .0", "15.0\n", "", " 15.0"])
def test_rejects_version_with_whitespace_or_empty(bad_version):
    rule = make_rule(applicability=[{"target": "macOS", "version": bad_version, "benchmarks": []}])
    assert schema_errors(rule)


def test_rejects_applicability_entry_missing_a_key():
    rule = make_rule(applicability=[{"target": "macOS", "version": "15.0"}])
    assert schema_errors(rule)


@pytest.mark.parametrize("bad_format", ["html", None])
def test_rejects_unknown_discussion_format(bad_format):
    assert schema_errors(make_rule(discussion_format=bad_format))


def test_accepts_markdown_discussion_format():
    assert schema_errors(make_rule(discussion_format="markdown")) == []


@pytest.mark.parametrize("bad_section_path", [[], [""], ["os\nx"], "os"])
def test_rejects_bad_section_path(bad_section_path):
    assert schema_errors(make_rule(section_path=bad_section_path))


def test_rejects_source_without_upstream_revision():
    rule = make_rule()
    del rule["source"]["upstream_revision"]
    assert schema_errors(rule)


def test_accepts_revision_and_update_strings():
    rule = make_rule()
    rule["source"]["upstream_revision"] = "Revision 5"
    rule["source"]["upstream_updated"] = "2026-09-01"
    assert schema_errors(rule) == []


def test_duplicate_target_version_is_reported():
    rule = make_rule(
        applicability=[
            {"target": "macOS", "version": "15.0", "benchmarks": []},
            {"target": "macOS", "version": "15.0", "benchmarks": []},
        ]
    )
    errors = applicability_errors(rule)
    assert len(errors) == 1
    assert "mscp.os_gatekeeper_enable" in errors[0]


def test_same_version_under_different_targets_is_not_a_duplicate():
    rule = make_rule(
        applicability=[
            {"target": "macOS", "version": "27.0", "benchmarks": []},
            {"target": "Windows", "version": "27.0", "benchmarks": []},
        ]
    )
    assert applicability_errors(rule) == []


def test_validate_library_reports_duplicate_applicability(tmp_path):
    duplicated = make_rule(
        applicability=[
            {"target": "macOS", "version": "15.0", "benchmarks": []},
            {"target": "macOS", "version": "15.0", "benchmarks": []},
        ]
    )
    write_library(tmp_path, duplicated)
    write_json(tmp_path / MSCP_RELEASE_DIR / "rules" / "os_gatekeeper_enable.json", duplicated)
    errors = validate_library(tmp_path)
    assert len(errors) == 1
    assert "mscp.os_gatekeeper_enable" in errors[0]


def test_non_mscp_source_rule_is_valid():
    rule = make_rule(id="asd_ism.ism-1667")
    rule["source"]["name"] = "asd_ism"
    assert schema_errors(rule) == []


def test_rejects_unknown_top_level_key():
    assert schema_errors(make_rule(surprise=True))


def test_validate_library_clean_library(tmp_path):
    write_library(tmp_path)
    write_json(tmp_path / MSCP_RELEASE_DIR / "rules" / "os_gatekeeper_enable.json", make_rule())
    assert validate_library(tmp_path) == []


def test_validate_library_reports_missing_rule_file(tmp_path):
    write_library(tmp_path)
    errors = validate_library(tmp_path)
    assert any("os_gatekeeper_enable.json" in error for error in errors)


def test_validate_library_reports_id_mismatch(tmp_path):
    write_library(tmp_path)
    write_json(
        tmp_path / MSCP_RELEASE_DIR / "rules" / "os_gatekeeper_enable.json",
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
    rule_path = tmp_path / MSCP_RELEASE_DIR / "rules" / "os_gatekeeper_enable.json"
    rule_path.parent.mkdir(parents=True, exist_ok=True)
    rule_path.write_text("null", encoding="utf-8")
    assert validate_library(tmp_path)


@pytest.mark.parametrize(
    "unsafe_path",
    ["../escape.json", "rules/../../escape.json", "/abs.json", "rules" + BACKSLASH + "x.json", "C:/x.json", "C:x.json", "rules/x.json\n"],
)
def test_index_rejects_unsafe_file_path(unsafe_path):
    index = {
        "schema_version": 7,
        "source": "mscp",
        "rules": [index_entry_for(MINIMAL_RULE, unsafe_path)],
    }
    assert schema_errors(index, "index")


def test_index_accepts_safe_file_path():
    index = {
        "schema_version": 7,
        "source": "mscp",
        "rules": [index_entry_for(MINIMAL_RULE, "rules/os..x.json")],
    }
    assert schema_errors(index, "index") == []


def test_index_rejects_platform_key():
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    entry["platform"] = "macOS"
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index")


def test_index_rejects_entry_missing_section():
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    del entry["section"]
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index")


def test_index_rejects_entry_missing_section_path():
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    del entry["section_path"]
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index")


@pytest.mark.parametrize("bad_section_path", [[], [""], ["os\nx"], "os"])
def test_index_rejects_bad_section_path(bad_section_path):
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    entry["section_path"] = bad_section_path
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index")


@pytest.mark.parametrize("bad_section", ["", "os\n"])
def test_index_rejects_bad_section(bad_section):
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    entry["section"] = bad_section
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index")


@pytest.mark.parametrize("section", ["os", "Access Control", "3.1 Policy"])
def test_index_accepts_any_single_line_section(section):
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    entry["section"] = section
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index") == []


def test_index_rejects_entry_missing_required_key():
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    del entry["has_odv"]
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index")


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


def older_mscp_release():
    return {
        **MSCP_RELEASE,
        "tag": "release_26.0",
        "label": "26.0",
        "published_date": "2025-09-11",
        "index_path": "mscp/releases/release_26.0/_index.json",
    }


def write_older_release(baselines_dir: Path, tag: str = "release_26.0") -> None:
    older_rule = make_rule()
    older_rule["source"]["release_tag"] = tag
    write_json(
        baselines_dir / "mscp" / "releases" / tag / "_index.json",
        {"schema_version": 7, "source": "mscp", "rules": [index_entry_for(older_rule, "rules/os_gatekeeper_enable.json")]},
    )
    write_json(baselines_dir / "mscp" / "releases" / tag / "rules" / "os_gatekeeper_enable.json", older_rule)


def write_two_release_library(baselines_dir: Path) -> None:
    write_library(baselines_dir)
    write_json(baselines_dir / MSCP_RELEASE_DIR / "rules" / "os_gatekeeper_enable.json", make_rule())
    write_older_release(baselines_dir)
    write_json(baselines_dir / "_manifest.json", make_manifest([older_mscp_release(), MSCP_RELEASE]))


def test_manifest_with_a_release_list_is_valid():
    assert schema_errors(make_manifest([older_mscp_release(), MSCP_RELEASE]), "manifest") == []


def test_manifest_rejects_a_release_missing_importer_format():
    manifest = make_manifest()
    del manifest["sources"][0]["releases"][0]["importer_format"]
    assert schema_errors(manifest, "manifest")


def test_manifest_rejects_a_source_without_releases():
    manifest = make_manifest()
    del manifest["sources"][0]["releases"]
    assert schema_errors(manifest, "manifest")


def test_validate_library_accepts_two_releases(tmp_path):
    write_two_release_library(tmp_path)
    assert validate_library(tmp_path) == []


def test_validate_library_reports_a_rule_with_the_wrong_release_tag(tmp_path):
    write_two_release_library(tmp_path)
    write_older_release(tmp_path, tag="release_26.0")
    mislabelled_rule = make_rule()
    mislabelled_rule["source"]["release_tag"] = "release_99.0"
    write_json(tmp_path / "mscp/releases/release_26.0/rules/os_gatekeeper_enable.json", mislabelled_rule)
    errors = validate_library(tmp_path)
    assert any("release_99.0" in error and "release_26.0" in error for error in errors)


@pytest.mark.parametrize("duplicated_field", ["tag", "label"])
def test_validate_library_reports_duplicate_release_tags_and_labels(tmp_path, duplicated_field):
    write_two_release_library(tmp_path)
    manifest = read_manifest(tmp_path)
    releases = manifest["sources"][0]["releases"]
    releases[0][duplicated_field] = releases[1][duplicated_field]
    write_json(tmp_path / "_manifest.json", manifest)
    assert any(f"release {duplicated_field}" in error for error in validate_library(tmp_path))


def test_validate_library_reports_top_level_fields_that_differ_from_the_newest_release(tmp_path):
    write_two_release_library(tmp_path)
    manifest = read_manifest(tmp_path)
    manifest["sources"][0]["release_tag"] = "release_26.0"
    write_json(tmp_path / "_manifest.json", manifest)
    assert any("newest release" in error for error in validate_library(tmp_path))


def release_with(tag: str, published_date: str, label: str, **overrides) -> dict:
    return {**MSCP_RELEASE, "tag": tag, "label": label, "published_date": published_date,
            "index_path": f"mscp/releases/{tag}/_index.json", **overrides}


def test_manifest_rejects_a_source_missing_provenance():
    manifest = make_manifest()
    del manifest["sources"][0]["provenance"]
    assert schema_errors(manifest, "manifest") != []


@pytest.mark.parametrize("provenance", ["Official", "unofficial", "", None])
def test_manifest_rejects_an_unknown_provenance(provenance):
    manifest = make_manifest()
    manifest["sources"][0]["provenance"] = provenance
    assert schema_errors(manifest, "manifest") != []


@pytest.mark.parametrize("provenance", ["official", "community"])
def test_manifest_accepts_each_provenance(provenance):
    manifest = make_manifest()
    manifest["sources"][0]["provenance"] = provenance
    assert schema_errors(manifest, "manifest") == []


def manifest_errors_for(releases: list[dict]) -> list[str]:
    from tools.validate_library import manifest_consistency_errors

    return manifest_consistency_errors(make_manifest(releases))


def test_releases_must_be_listed_oldest_first_by_published_date():
    newer_first = [release_with("b", "2026-02-01", "B"), release_with("a", "2026-01-01", "A")]

    assert any("sorted" in error for error in manifest_errors_for(newer_first))
    assert manifest_errors_for(list(reversed(newer_first))) == []


def test_releases_published_on_the_same_day_are_ordered_by_tag():
    # Documented tie-break: the same (published_date, tag) order merged_manifest sorts by.
    first_tag = release_with("a", "2026-01-01", "A")
    second_tag = release_with("b", "2026-01-01", "B")

    assert manifest_errors_for([first_tag, second_tag]) == []
    assert any("sorted" in error for error in manifest_errors_for([second_tag, first_tag]))


@pytest.mark.parametrize("field", ["published_date", "retrieved_date"])
@pytest.mark.parametrize("not_a_date", ["2026-02-30", "2026-13-01", "0000-00-00"])
def test_a_release_date_must_be_a_real_calendar_date(field, not_a_date):
    release = {**release_with("a", "2026-01-01", "A"), field: not_a_date}

    assert any(field in error and not_a_date in error for error in manifest_errors_for([release]))


def test_validate_library_reports_unsorted_releases_and_bad_dates(tmp_path):
    write_two_release_library(tmp_path)
    manifest = read_manifest(tmp_path)
    manifest["sources"][0]["releases"].reverse()
    manifest["sources"][0]["releases"][0]["published_date"] = "2026-02-30"
    write_json(tmp_path / "_manifest.json", manifest)

    errors = validate_library(tmp_path)

    assert any("sorted" in error for error in errors)
    assert any("2026-02-30" in error for error in errors)


def test_validate_library_reports_a_release_folder_missing_from_the_manifest(tmp_path):
    write_library(tmp_path)
    write_json(tmp_path / MSCP_RELEASE_DIR / "rules" / "os_gatekeeper_enable.json", make_rule())
    write_older_release(tmp_path, tag="release_25.0")
    errors = validate_library(tmp_path)
    assert any("release_25.0" in error and "no entry in the manifest" in error for error in errors)


def test_validate_library_reports_rule_count_mismatch(tmp_path):
    write_library(tmp_path)
    write_json(tmp_path / MSCP_RELEASE_DIR / "rules" / "os_gatekeeper_enable.json", make_rule())
    manifest = read_manifest(tmp_path)
    manifest["sources"][0]["rule_count"] = 5
    write_json(tmp_path / "_manifest.json", manifest)
    assert any("rule_count" in error for error in validate_library(tmp_path))


def test_rejects_id_with_trailing_newline():
    assert schema_errors(make_rule(id="mscp.foo\n"))


def test_hyphenated_rule_id_is_valid():
    assert schema_errors(make_rule(id="mscp.os_mfa_network_non-priv")) == []


ACCEPTED_RULE_IDS = [
    "mscp.os_gatekeeper_enable",
    "asd_ism.ism-1803",
    "nist_800_53.ac-2",
    "nist_800_53.ac-2.1",
    "asd_e4eit.it.pro-13.1",
]
REJECTED_RULE_IDS = [
    "nist_800_53.ac-2..1",
    "asd_e4eit.it..pro",
    "nist_800_53.ac-2.",
    "nist_800_53..ac-2",
    "nist_800_53.",
    "nist_800_53.ac-2.1\n",
]


@pytest.mark.parametrize("rule_id", ACCEPTED_RULE_IDS)
def test_rule_and_index_schemas_accept_dotted_rule_ids(rule_id):
    assert schema_errors(make_rule(id=rule_id)) == []
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    entry["id"] = rule_id
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index") == []


@pytest.mark.parametrize("rule_id", REJECTED_RULE_IDS)
def test_rule_and_index_schemas_reject_empty_dot_segments_in_rule_ids(rule_id):
    assert schema_errors(make_rule(id=rule_id))
    entry = index_entry_for(MINIMAL_RULE, "rules/x.json")
    entry["id"] = rule_id
    assert schema_errors({"schema_version": 7, "source": "mscp", "rules": [entry]}, "index")


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
    write_json(baselines_dir / MSCP_RELEASE_DIR / "rules" / "os_gatekeeper_enable.json", make_rule())
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


@pytest.mark.parametrize("term", ["macOS 27.0", "Microsoft 365 2026.1"])
def test_version_term_of_a_target_and_a_version_is_accepted(term):
    assert schema_errors(make_vocabulary(versions=[{"label": "Label", "terms": [term]}]), "vocabulary") == []


@pytest.mark.parametrize("term", ["none", "27.0", " 27.0", "macOS ", "macOS 27.0\n"])
def test_version_term_without_a_target_and_a_version_is_rejected(term):
    assert schema_errors(make_vocabulary(versions=[{"label": "Label", "terms": [term]}]), "vocabulary")


def test_other_vocabularies_still_accept_a_term_without_a_space():
    assert schema_errors(make_vocabulary(targets=[{"label": "Label", "terms": ["none"]}]), "vocabulary") == []


@pytest.mark.parametrize("vocabulary_name", ["targets", "sources"])
def test_target_and_source_vocabularies_are_accepted(vocabulary_name):
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


WINDOWS_CHECK = {
    "name": None,
    "language": "powershell",
    "default": {"shell": "Get-Item x", "additional_info": None, "result": {"type": "string", "value": "ok"}},
    "by_version": {},
}

WINDOWS_STEP = {
    "name": "BlockCerts",
    "language": "powershell",
    "shell": "Remove-Item x",
    "additional_info": "From the ASD Blueprint.",
    "versions": None,
}


def test_rule_with_checks_and_remediation_for_two_targets_is_valid():
    rule = make_rule()
    rule["check"]["Windows"] = [copy.deepcopy(WINDOWS_CHECK)]
    rule["remediation"]["Windows"] = {"steps": [copy.deepcopy(WINDOWS_STEP)], "payloads": []}
    assert schema_errors(rule) == []


def test_null_check_and_remediation_are_valid():
    assert schema_errors(make_rule(check=None, remediation=None)) == []


@pytest.mark.parametrize("language", ["bash", "powershell", "zsh", "python"])
def test_accepts_each_known_language(language):
    rule = make_rule()
    rule["check"]["macOS"][0]["language"] = language
    rule["remediation"]["macOS"]["steps"][0]["language"] = language
    assert schema_errors(rule) == []


@pytest.mark.parametrize("language", ["cmd", "Bash", None])
def test_rejects_unknown_check_language(language):
    rule = make_rule()
    rule["check"]["macOS"][0]["language"] = language
    assert schema_errors(rule)


def test_rejects_unknown_step_language():
    rule = make_rule()
    rule["remediation"]["macOS"]["steps"][0]["language"] = "cmd"
    assert schema_errors(rule)


@pytest.mark.parametrize("bad_target", ["", "mac\nOS", "macOS\n"])
def test_rejects_empty_or_multi_line_target_keys(bad_target):
    check_rule = make_rule()
    check_rule["check"][bad_target] = [copy.deepcopy(WINDOWS_CHECK)]
    assert schema_errors(check_rule)
    remediation_rule = make_rule()
    remediation_rule["remediation"][bad_target] = {"steps": [], "payloads": []}
    assert schema_errors(remediation_rule)


def test_accepts_a_target_key_with_a_space():
    rule = make_rule()
    rule["check"]["Microsoft 365"] = [copy.deepcopy(WINDOWS_CHECK)]
    assert schema_errors(rule) == []


def test_accepts_a_non_numeric_check_version_key():
    rule = make_rule()
    windows_check = copy.deepcopy(WINDOWS_CHECK)
    windows_check["by_version"]["24H2"] = copy.deepcopy(windows_check["default"])
    rule["check"]["Windows"] = [windows_check]
    assert schema_errors(rule) == []


@pytest.mark.parametrize("bad_key", ["", "24 H2", "15.0\n"])
def test_rejects_check_version_keys_with_whitespace_or_empty(bad_key):
    rule = make_rule()
    rule["check"]["macOS"][0]["by_version"][bad_key] = copy.deepcopy(rule["check"]["macOS"][0]["default"])
    assert schema_errors(rule)


@pytest.mark.parametrize("bad_versions", [[], ["15 .0"], [""], ["15.0\n"], "15.0", [15.0]])
def test_rejects_bad_step_versions(bad_versions):
    rule = make_rule()
    rule["remediation"]["macOS"]["steps"][0]["versions"] = bad_versions
    assert schema_errors(rule)


@pytest.mark.parametrize("bad_versions", [[], ["15 .0"], "15.0"])
def test_rejects_bad_payload_versions(bad_versions):
    rule = make_rule()
    rule["remediation"]["macOS"]["payloads"][0]["versions"] = bad_versions
    assert schema_errors(rule)


@pytest.mark.parametrize("missing_key", ["name", "language", "shell", "additional_info", "versions"])
def test_rejects_step_missing_a_key(missing_key):
    rule = make_rule()
    del rule["remediation"]["macOS"]["steps"][0][missing_key]
    assert schema_errors(rule)


@pytest.mark.parametrize("missing_key", ["kind", "versions", "data"])
def test_rejects_payload_missing_a_key(missing_key):
    rule = make_rule()
    del rule["remediation"]["macOS"]["payloads"][0][missing_key]
    assert schema_errors(rule)


@pytest.mark.parametrize("bad_data", [None, "text", 3])
def test_rejects_payload_data_that_is_not_an_object_or_list(bad_data):
    rule = make_rule()
    rule["remediation"]["macOS"]["payloads"][0]["data"] = bad_data
    assert schema_errors(rule)


@pytest.mark.parametrize("bad_kind", ["", "mobile\nconfig", None])
def test_rejects_empty_or_multi_line_payload_kind(bad_kind):
    rule = make_rule()
    rule["remediation"]["macOS"]["payloads"][0]["kind"] = bad_kind
    assert schema_errors(rule)


def test_accepts_any_payload_kind():
    rule = make_rule()
    rule["remediation"]["macOS"]["payloads"][0]["kind"] = "registry"
    assert schema_errors(rule) == []


@pytest.mark.parametrize(
    "location",
    [
        ("check", "macOS", 0),
        ("remediation", "macOS"),
        ("remediation", "macOS", "steps", 0),
        ("remediation", "macOS", "payloads", 0),
    ],
)
def test_rejects_unknown_keys_in_target_entries(location):
    rule = make_rule()
    container = rule
    for key in location:
        container = container[key]
    container["surprise"] = True
    assert schema_errors(rule)


@pytest.mark.parametrize("missing_key", ["language", "default", "by_version"])
def test_rejects_target_check_missing_a_key(missing_key):
    rule = make_rule()
    del rule["check"]["macOS"][0][missing_key]
    assert schema_errors(rule)


@pytest.mark.parametrize("missing_key", ["steps", "payloads"])
def test_rejects_target_remediation_missing_a_key(missing_key):
    rule = make_rule()
    del rule["remediation"]["macOS"][missing_key]
    assert schema_errors(rule)


def test_rejects_the_v4_check_and_remediation_shapes():
    assert schema_errors(make_rule(check={"default": None, "by_version": {}}))
    v4_remediation = {
        "default": {"shell": None, "additional_info": None},
        "by_version": {},
        "mobileconfig_info": None,
        "mobileconfig_by_version": {},
        "ddm_info": None,
    }
    assert schema_errors(make_rule(remediation=v4_remediation))


@pytest.mark.parametrize("field", ["check", "remediation"])
def test_rejects_an_empty_target_map(field):
    assert schema_errors(make_rule(**{field: {}}))


SCRIPT_PATH = "baselines/_overlays/scripts/Example.ps1"


def test_a_check_entry_and_a_step_may_reference_a_script_file():
    rule = make_rule()
    rule["check"]["macOS"][0]["default"] = {"shell_file": "baselines/x/scripts/check.sh", "result": None, "additional_info": None}
    rule["remediation"]["macOS"]["steps"][0] = {
        "name": None, "language": "powershell", "shell_file": SCRIPT_PATH, "additional_info": None, "versions": None,
    }
    assert schema_errors(rule) == []


@pytest.mark.parametrize("location", ["check", "step"])
def test_both_or_neither_of_shell_and_shell_file_is_rejected(location):
    for keys in ({"shell": "echo", "shell_file": SCRIPT_PATH}, {}):
        rule = make_rule()
        entry = rule["check"]["macOS"][0]["default"] if location == "check" else rule["remediation"]["macOS"]["steps"][0]
        entry.pop("shell")
        entry.update(keys)
        assert schema_errors(rule), keys


@pytest.mark.parametrize(
    "bad_path",
    ["scripts/Example.ps1", "/baselines/a.ps1", "baselines/../tools/a.ps1", "baselines/a/../b.ps1", "baselines/a.txt", "baselines/a.ps1\n"],
)
def test_rejects_a_bad_shell_file_path(bad_path):
    rule = make_rule()
    del rule["remediation"]["macOS"]["steps"][0]["shell"]
    rule["remediation"]["macOS"]["steps"][0]["shell_file"] = bad_path
    assert schema_errors(rule)


@pytest.mark.parametrize("extension", ["mobileconfig", "plist", "json", "xml", "reg", "admx", "adml", "pol", "intunewin"])
def test_a_payload_may_reference_a_data_file(extension):
    rule = make_rule()
    payload = rule["remediation"]["macOS"]["payloads"][0]
    del payload["data"]
    payload["data_file"] = f"baselines/_overlays/payloads/Example.{extension}"
    assert schema_errors(rule) == []


@pytest.mark.parametrize("bad_path", ["baselines/_overlays/payloads/Example.txt", "payloads/Example.json", "baselines/../Example.json"])
def test_rejects_a_bad_data_file_path(bad_path):
    rule = make_rule()
    payload = rule["remediation"]["macOS"]["payloads"][0]
    del payload["data"]
    payload["data_file"] = bad_path
    assert schema_errors(rule)


def test_both_or_neither_of_data_and_data_file_is_rejected():
    both = make_rule()
    both["remediation"]["macOS"]["payloads"][0]["data_file"] = "baselines/_overlays/payloads/Example.json"
    assert schema_errors(both)
    neither = make_rule()
    del neither["remediation"]["macOS"]["payloads"][0]["data"]
    assert schema_errors(neither)


def test_a_target_may_hold_several_check_items_with_names():
    rule = make_rule()
    second_item = copy.deepcopy(WINDOWS_CHECK)
    second_item["name"] = "Registry check"
    rule["check"]["macOS"].append(second_item)
    assert schema_errors(rule) == []


def test_rejects_an_empty_check_list_for_a_target():
    assert schema_errors(make_rule(check={"macOS": []}))


def test_rejects_a_bare_check_object_for_a_target():
    bare_check = copy.deepcopy(MINIMAL_RULE["check"]["macOS"][0])
    assert schema_errors(make_rule(check={"macOS": bare_check}))


def test_rejects_a_check_item_name_that_is_not_a_string_or_null():
    rule = make_rule()
    rule["check"]["macOS"][0]["name"] = 3
    assert schema_errors(rule)


def test_instructions_constraints_apply_to_every_check_item():
    rule = instructions_rule()
    second_item = copy.deepcopy(rule["check"]["macOS"][0])
    second_item["default"]["shell"] = "echo hi"
    rule["check"]["macOS"].append(second_item)
    assert schema_errors(rule)


def registry_setting(**overrides) -> dict:
    setting = {
        "hive": "HKLM",
        "path": "SOFTWARE\\Policies\\Example",
        "value_name": "Enabled",
        "type": "REG_DWORD",
        "data": 1,
        "state": "present",
    }
    setting.update(overrides)
    return setting


def registry_rule(*settings: dict) -> dict:
    rule = make_rule()
    registry_entry = {"registry": list(settings), "additional_info": None, "result": None}
    rule["check"] = {
        "Windows": [{"name": None, "language": "registry", "default": registry_entry, "by_version": {"11": dict(registry_entry)}}]
    }
    rule["remediation"] = {
        "Windows": {
            "steps": [
                {"name": None, "language": "registry", "registry": list(settings), "additional_info": None, "versions": None}
            ],
            "payloads": [],
        }
    }
    return rule


VALID_REGISTRY_SETTINGS = [
    registry_setting(),
    registry_setting(type="REG_DWORD", data=4294967295),
    registry_setting(type="REG_DWORD", data="$ODV_max_age"),
    registry_setting(type="REG_QWORD", data=18446744073709551615),
    registry_setting(type="REG_SZ", data="text"),
    registry_setting(type="REG_SZ", data="$ODV_banner"),
    registry_setting(type="REG_EXPAND_SZ", data="%SystemRoot%\\system32"),
    registry_setting(type="REG_MULTI_SZ", data=["a", "b"]),
    registry_setting(type="REG_MULTI_SZ", data=[]),
    registry_setting(type="REG_BINARY", data="00ffA1"),
    registry_setting(type="REG_BINARY", data=""),
    registry_setting(type=None, data=None, state="absent"),
    registry_setting(value_name="", type="REG_SZ", data="x"),
    registry_setting(hive="HKU", path=".DEFAULT\\Software\\X"),
    registry_setting(hive="HKCU"),
    registry_setting(hive="HKCR"),
]


@pytest.mark.parametrize("setting", VALID_REGISTRY_SETTINGS, ids=lambda setting: f"{setting['type']}-{setting['state']}-{setting['data']!r}")
def test_registry_settings_are_valid(setting):
    assert schema_errors(registry_rule(setting)) == []


INVALID_REGISTRY_SETTINGS = {
    "string data for a dword": registry_setting(data="1"),
    "integer data for a string": registry_setting(type="REG_SZ", data=1),
    "string data for a multi string": registry_setting(type="REG_MULTI_SZ", data="a"),
    "an odv for a multi string": registry_setting(type="REG_MULTI_SZ", data=["$ODV_x"]),
    "list data for a binary": registry_setting(type="REG_BINARY", data=["00"]),
    "data on an absent setting": registry_setting(type=None, data=1, state="absent"),
    "a type on an absent setting": registry_setting(type="REG_DWORD", data=None, state="absent"),
    "a null type on a present setting": registry_setting(type=None, data=1),
    "null data on a present setting": registry_setting(data=None),
    "a negative dword": registry_setting(data=-1),
    "a dword over 32 bits": registry_setting(data=4294967296),
    "a qword over 64 bits": registry_setting(type="REG_QWORD", data=18446744073709551616),
    "a negative qword": registry_setting(type="REG_QWORD", data=-1),
    "a boolean dword": registry_setting(data=True),
    "an odd-length binary": registry_setting(type="REG_BINARY", data="abc"),
    "a non-hex binary": registry_setting(type="REG_BINARY", data="zz"),
    "an odv for a binary": registry_setting(type="REG_BINARY", data="$ODV_x"),
    "an unknown type": registry_setting(type="REG_NONE", data=1),
    "an unknown hive": registry_setting(hive="HKEY_LOCAL_MACHINE"),
    "an unknown state": registry_setting(state="maybe"),
    "a leading backslash in the path": registry_setting(path="\\SOFTWARE"),
    "a trailing backslash in the path": registry_setting(path="SOFTWARE\\"),
    "an empty path": registry_setting(path=""),
    "a newline in the path": registry_setting(path="SOFTWARE\nExample"),
    "a carriage return in the path": registry_setting(path="SOFTWARE\rExample"),
    "a NUL in the path": registry_setting(path="SOFTWARE\x00Example"),
    "a closing bracket in the path": registry_setting(path="SOFTWARE\\Ex]ample"),
    "a newline in the value name": registry_setting(value_name="a\nb"),
    "a carriage return in the value name": registry_setting(value_name="a\rb"),
    "a NUL in the value name": registry_setting(value_name="a\x00b"),
    "a newline in string data": registry_setting(type="REG_SZ", data="a\nb"),
    "a carriage return in expandable string data": registry_setting(type="REG_EXPAND_SZ", data="a\rb"),
    "a NUL in string data": registry_setting(type="REG_SZ", data="a\x00b"),
    "a newline in a multi string item": registry_setting(type="REG_MULTI_SZ", data=["ok", "a\nb"]),
    "a NUL in a multi string item": registry_setting(type="REG_MULTI_SZ", data=["a\x00b"]),
    "an extra key": {**registry_setting(), "comment": "x"},
    "a missing key": {key: value for key, value in registry_setting().items() if key != "state"},
}


@pytest.mark.parametrize("setting", INVALID_REGISTRY_SETTINGS.values(), ids=INVALID_REGISTRY_SETTINGS.keys())
def test_invalid_registry_settings_are_rejected(setting):
    assert schema_errors(registry_rule(setting)) != []


def test_an_empty_registry_list_is_rejected():
    assert schema_errors(registry_rule()) != []


def test_a_registry_body_with_shell_is_rejected():
    rule = registry_rule(registry_setting())
    rule["check"]["Windows"][0]["default"]["shell"] = "echo hi"
    assert schema_errors(rule) != []
    rule = registry_rule(registry_setting())
    rule["remediation"]["Windows"]["steps"][0]["shell"] = "echo hi"
    assert schema_errors(rule) != []


def test_a_registry_body_with_shell_file_is_rejected():
    rule = registry_rule(registry_setting())
    rule["check"]["Windows"][0]["default"]["shell_file"] = "baselines/x/check.ps1"
    assert schema_errors(rule) != []
    rule = registry_rule(registry_setting())
    rule["remediation"]["Windows"]["steps"][0]["shell_file"] = "baselines/x/fix.ps1"
    assert schema_errors(rule) != []


def test_a_registry_language_without_a_registry_body_is_rejected():
    rule = registry_rule(registry_setting())
    entry = rule["check"]["Windows"][0]["default"]
    del entry["registry"]
    entry["shell"] = "echo hi"
    assert schema_errors(rule) != []
    rule = registry_rule(registry_setting())
    step = rule["remediation"]["Windows"]["steps"][0]
    del step["registry"]
    step["shell"] = "echo hi"
    assert schema_errors(rule) != []


def test_a_registry_check_must_have_no_result():
    rule = registry_rule(registry_setting())
    rule["check"]["Windows"][0]["default"]["result"] = {"type": "integer", "value": 1}
    assert schema_errors(rule) != []


@pytest.mark.parametrize("language", ["powershell", "bash", "zsh", "python", "instructions", "ansible", "goss"])
def test_a_registry_body_on_another_language_is_rejected(language):
    rule = registry_rule(registry_setting())
    rule["check"]["Windows"][0]["language"] = language
    assert schema_errors(rule) != []
    rule = registry_rule(registry_setting())
    rule["remediation"]["Windows"]["steps"][0]["language"] = language
    assert schema_errors(rule) != []


def display_language_rule(language: str, **body) -> dict:
    rule = make_rule()
    check_entry = {"shell": "- name: x\n  win_regedit: {}", "additional_info": None, "result": None}
    check_entry.update(body)
    rule["check"] = {"Windows": [{"name": None, "language": language, "default": check_entry, "by_version": {}}]}
    step = {"name": None, "language": language, "shell": "- name: x", "additional_info": None, "versions": None}
    step.update(body)
    rule["remediation"] = {"Windows": {"steps": [step], "payloads": []}}
    return rule


@pytest.mark.parametrize("language", ["ansible", "goss"])
def test_display_languages_take_an_inline_shell(language):
    assert schema_errors(display_language_rule(language)) == []


@pytest.mark.parametrize("language", ["ansible", "goss"])
def test_display_languages_reject_shell_file(language):
    rule = display_language_rule(language)
    del rule["check"]["Windows"][0]["default"]["shell"]
    rule["check"]["Windows"][0]["default"]["shell_file"] = "baselines/x/check.sh"
    assert schema_errors(rule) != []
    step = rule["remediation"]["Windows"]["steps"][0]
    del step["shell"]
    step["shell_file"] = "baselines/x/fix.sh"
    assert schema_errors(rule) != []


@pytest.mark.parametrize("language", ["ansible", "goss"])
def test_display_languages_reject_a_registry_body(language):
    rule = display_language_rule(language, registry=[registry_setting()])
    assert schema_errors(rule) != []
