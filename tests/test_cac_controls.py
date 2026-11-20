from pathlib import Path

import pytest
import yaml

from tools.cac_benchmarks import BenchmarkSpec
from tools.cac_controls import (
    assessment,
    benchmark_name,
    levels_with_inheritance,
    read_controls,
    section_path,
)
from tools.library_output import UnsupportedUpstreamData

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "cis_cac" / "controls.yml"

FIXTURE_SPEC = BenchmarkSpec(
    source_name="cis_fixture",
    display_name="CIS Fixture",
    provenance="community",
    product="fixture",
    controls_path="controls/cis_fixture.yml",
    level_profiles={
        "l1_server": "p_l1s",
        "l2_server": "p_l2s",
        "l1_workstation": "p_l1w",
        "l2_workstation": "p_l2w",
    },
    target="Linux",
    version="Fixture-1",
    helper_control_ids=frozenset({"reload_dconf_db"}),
)


def load_fixture_document() -> dict:
    return yaml.safe_load(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_reads_cis_controls_and_skips_listed_helpers():
    version, controls = read_controls(load_fixture_document(), FIXTURE_SPEC)
    assert version == "9.9.9"
    assert [control.cis_id for control in controls] == ["1.1.1", "1.2.1", "1.2.2", "2.1", "3.1", "4.1", "5.1"]
    partial_control = controls[4]
    assert partial_control.status == "partial"
    assert partial_control.related_rule_ids == ("sshd_disable_root_password_login",)
    assert controls[3].notes == "Review by hand."
    assert controls[3].rule_ids == ()


def test_unknown_non_cis_id_fails():
    document = load_fixture_document()
    document["controls"].append({"id": "mystery_helper", "title": "x", "levels": ["l1_server"], "status": "automated"})
    with pytest.raises(UnsupportedUpstreamData, match="mystery_helper"):
        read_controls(document, FIXTURE_SPEC)


def test_non_string_id_fails():
    document = load_fixture_document()
    document["controls"][0]["id"] = 1.1
    with pytest.raises(UnsupportedUpstreamData, match="1.1"):
        read_controls(document, FIXTURE_SPEC)


def test_variable_settings_are_dropped():
    _, controls = read_controls(load_fixture_document(), FIXTURE_SPEC)
    password_control = next(control for control in controls if control.cis_id == "1.2.1")
    assert password_control.rule_ids == ("accounts_password_pam_minlen",)


def test_section_path_stops_at_the_parent():
    assert section_path("1.1.1.1") == ["1", "1.1", "1.1.1"]
    assert section_path("2.1") == ["2"]


def test_section_path_of_a_top_level_id_fails():
    with pytest.raises(UnsupportedUpstreamData, match="'7'"):
        section_path("7")


def test_levels_with_inheritance():
    assert levels_with_inheritance(("l1_server", "l2_workstation")) == ["l1_server", "l2_server", "l2_workstation"]


@pytest.mark.parametrize(
    "status, expected",
    [
        ("automated", {"status": "manual", "manual_reason": "openscap"}),
        ("partial", {"status": "manual", "manual_reason": "openscap"}),
        ("supported", {"status": "manual", "manual_reason": "openscap"}),
        ("manual", {"status": "manual", "manual_reason": "manual"}),
        ("pending", {"status": "manual", "manual_reason": "no_check"}),
        ("not applicable", {"status": "manual", "manual_reason": "n_a"}),
        ("inherently met", {"status": "manual", "manual_reason": "inherent"}),
    ],
)
def test_assessment_mapping(status, expected):
    assert assessment(status, "control 1.1", links_rules=True) == expected


@pytest.mark.parametrize(
    "status, expected_reason",
    [
        ("automated", "no_check"),
        ("partial", "no_check"),
        ("supported", "no_check"),
        ("manual", "manual"),
        ("pending", "no_check"),
        ("not applicable", "n_a"),
        ("inherently met", "inherent"),
    ],
)
def test_assessment_without_linked_rules_never_claims_openscap(status, expected_reason):
    assert assessment(status, "control 1.1", links_rules=False) == {"status": "manual", "manual_reason": expected_reason}


def test_assessment_rejects_unknown_status():
    with pytest.raises(UnsupportedUpstreamData, match="bogus"):
        assessment("bogus", "control 1.1", links_rules=True)


def test_benchmark_name():
    assert benchmark_name("l1_server") == "cis_l1_server"


def test_unknown_level_or_key_fails():
    unknown_level_document = load_fixture_document()
    unknown_level_document["controls"][0]["levels"] = ["l3_server"]
    with pytest.raises(UnsupportedUpstreamData, match="1.1.1"):
        read_controls(unknown_level_document, FIXTURE_SPEC)

    unknown_key_document = load_fixture_document()
    unknown_key_document["controls"][1]["new_key"] = True
    with pytest.raises(UnsupportedUpstreamData, match="new_key"):
        read_controls(unknown_key_document, FIXTURE_SPEC)
