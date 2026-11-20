import shutil
from pathlib import Path

import pytest

from tests.test_cac_controls import FIXTURE_SPEC
from tools.cac_normalize import normalize_benchmark
from tools.library_output import UnsupportedUpstreamData
from tools.odv_placeholders import placeholder_errors
from tools.source_lock import SourceLock
from tools.validate_library import schema_errors

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "cis_cac"
LOCK = SourceLock(
    tag="v0.0.0",
    commit_sha="a" * 40,
    retrieved_date="2026-11-19",
    repository_url="https://github.com/ComplianceAsCode/content",
    published_date="2026-11-01",
    importer_format="1",
)


@pytest.fixture
def upstream_dir(tmp_path) -> Path:
    upstream = tmp_path / "upstream"
    (upstream / "controls").mkdir(parents=True)
    (upstream / "release").mkdir()
    shutil.copy(FIXTURE_DIRECTORY / "controls.yml", upstream / FIXTURE_SPEC.controls_path)
    shutil.copy(FIXTURE_DIRECTORY / "ssg-fixture-ds.xml", upstream / "release" / "ssg-fixture-ds.xml")
    return upstream


def rules_by_cis_id(upstream: Path) -> dict[str, dict]:
    _, rules = normalize_benchmark(upstream, FIXTURE_SPEC, LOCK)
    return {rule["references"]["cis"]["id"]: rule for rule in rules}


def edit_datastream(upstream: Path, old: str, new: str) -> None:
    path = upstream / "release" / "ssg-fixture-ds.xml"
    text = path.read_text(encoding="utf-8")
    assert old in text
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def test_rule_ids_and_count(upstream_dir):
    version, rules = normalize_benchmark(upstream_dir, FIXTURE_SPEC, LOCK)
    assert version == "9.9.9"
    assert [rule["id"] for rule in rules] == [
        f"cis_fixture.{cis_id}" for cis_id in ["1.1.1", "1.2.1", "1.2.2", "2.1", "3.1", "4.1", "5.1"]
    ]


def test_minlen_rule(upstream_dir):
    rule = rules_by_cis_id(upstream_dir)["1.2.1"]
    all_levels = ["cis_l1_server", "cis_l2_server", "cis_l1_workstation", "cis_l2_workstation"]
    assert rule["odvs"] == [
        {
            "name": "var_password_pam_minlen",
            "datatype": "number",
            "description": "minlen",
            "validation": None,
            "recommended": 14,
            "by_benchmark": {name: 14 for name in all_levels},
            "quoting": "single",
        },
        {
            "name": "var_ocil_only",
            "datatype": "number",
            "description": "ocil only",
            "validation": None,
            "recommended": 3,
            "by_benchmark": {name: 3 for name in all_levels},
            "quoting": "unquoted",
        },
    ]
    check_text = rule["check"]["Linux"]["default"]["additional_info"]
    assert (
        "Expected values: var_password_pam_minlen = $ODV_var_password_pam_minlen, "
        "var_ocil_only = $ODV_var_ocil_only"
    ) in check_text
    assert "'$ODV_var_password_pam_minlen'" in rule["remediation"]["Linux"]["steps"][0]["shell"]
    assert rule["references"]["complianceascode"]["cce"] == {"accounts_password_pam_minlen": "CCE-00000-1"}


def test_banner_odv_is_double_quoted(upstream_dir):
    banner = rules_by_cis_id(upstream_dir)["5.1"]["odvs"][0]
    assert banner["name"] == "login_banner_text"
    assert banner["quoting"] == "double"
    assert banner["recommended"] == "Authorized use only"


def test_double_quoted_value_with_quote_fails(upstream_dir):
    edit_datastream(upstream_dir, "<xccdf-1.2:value>Authorized use only", '<xccdf-1.2:value>Say "hi"')
    with pytest.raises(UnsupportedUpstreamData, match="5.1"):
        normalize_benchmark(upstream_dir, FIXTURE_SPEC, LOCK)


def test_non_integer_number_value_fails(upstream_dir):
    edit_datastream(upstream_dir, "<xccdf-1.2:value>3</xccdf-1.2:value>", "<xccdf-1.2:value>3.5</xccdf-1.2:value>")
    with pytest.raises(UnsupportedUpstreamData, match="1.2.1"):
        normalize_benchmark(upstream_dir, FIXTURE_SPEC, LOCK)


def test_shared_rule_in_two_controls(upstream_dir):
    rules = rules_by_cis_id(upstream_dir)
    for cis_id in ("1.1.1", "1.2.2"):
        step = rules[cis_id]["remediation"]["Linux"]["steps"][0]
        assert step["name"] == "Disable cramfs"
        assert "install cramfs" in step["shell"]
    assert rules["1.2.2"]["applicability"][0]["benchmarks"] == [{"name": "cis_l2_server", "severity": None}]


def test_multi_rule_partial_control(upstream_dir):
    rule = rules_by_cis_id(upstream_dir)["3.1"]
    steps = rule["remediation"]["Linux"]["steps"]
    assert len(steps) == 2
    assert steps[1]["shell"] is None
    assert steps[1]["additional_info"] == "No fix in ComplianceAsCode (rule `rule_without_fix_or_ocil`)."
    assert "No audit procedure in ComplianceAsCode." in rule["check"]["Linux"]["default"]["additional_info"]
    assert rule["assessment"] == {"status": "manual", "manual_reason": "openscap"}
    assert rule["references"]["complianceascode"]["related_rules"] == ["sshd_disable_root_password_login"]
    assert all("Password" not in step["name"] for step in steps)


def test_ruleless_controls(upstream_dir):
    rules = rules_by_cis_id(upstream_dir)
    for cis_id in ("2.1", "4.1"):
        assert rules[cis_id]["check"] is None
        assert rules[cis_id]["remediation"] is None
        assert rules[cis_id]["odvs"] == []
    assert rules["2.1"]["discussion"] == "Review by hand."
    assert rules["4.1"]["assessment"]["manual_reason"] == "inherent"
    assert rules["4.1"]["discussion"] == "ComplianceAsCode links no rule to this recommendation."


def test_cis_reference_mismatch_fails(upstream_dir):
    path = upstream_dir / "release" / "ssg-fixture-ds.xml"
    text = path.read_text(encoding="utf-8")
    start = text.index('rule_sshd_disable_root_login"')
    edited = text[start:].replace(">3.1<", ">9.9<", 1)
    path.write_text(text[:start] + edited, encoding="utf-8")
    with pytest.raises(UnsupportedUpstreamData, match="3.1"):
        normalize_benchmark(upstream_dir, FIXTURE_SPEC, LOCK)


def test_discussion_and_source(upstream_dir):
    rule = rules_by_cis_id(upstream_dir)["1.2.1"]
    assert rule["discussion"].startswith("## Ensure PAM Enforces Password Requirements - Minimum Length\n\n")
    assert "\n\n**Rationale:**\n\nLonger passwords resist guessing." in rule["discussion"]
    assert rule["section_path"] == ["1", "1.2", "1.2.1"]
    assert rule["source"]["upstream_url"] == (
        f"https://github.com/ComplianceAsCode/content/blob/{'a' * 40}/controls/cis_fixture.yml"
    )


def test_every_rule_validates(upstream_dir):
    _, rules = normalize_benchmark(upstream_dir, FIXTURE_SPEC, LOCK)
    for rule in rules:
        assert schema_errors(rule) == [], rule["id"]
        assert placeholder_errors(rule) == [], rule["id"]
