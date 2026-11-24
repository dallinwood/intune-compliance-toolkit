"""Tests for tools/lockdown_audit.py.

tests/fixtures/lockdown/audit/ holds verbatim excerpts of the real Windows-2022-CIS-Audit repo
(branch benchmark_v4.0.0, MIT, see the LICENSE beside them): a coverage.json with the entries
of the chosen controls and their `cis_<ID>.yml` files at their real paths.
"""

import json
from pathlib import Path

import pytest
import yaml

from tools.lockdown_audit import AuditControl, AuditParseError, load_audit, meta_block_of

AUDIT_DIR = Path(__file__).parent / "fixtures" / "lockdown" / "audit"


@pytest.fixture(scope="module")
def controls() -> dict[str, AuditControl]:
    return load_audit(AUDIT_DIR)


def test_every_coverage_entry_is_a_control_in_coverage_order(controls):
    assert list(controls) == ["1.1.1", "2.2.1", "2.2.2", "2.2.34", "2.2.44", "2.3.1.1", "2.3.9.5", "5.1", "17.1.1", "18.4.2"]


def test_titles_come_from_coverage_json_intact(controls):
    assert controls["1.1.1"].title == "Ensure 'Enforce password history' is set to '24 or more password(s)'"
    assert controls["2.2.44"].title == "Ensure 'Profile system performance' is set to 'Administrators, NT SERVICE\\WdiServiceHost'"
    assert controls["2.2.34"].title == (
        "Ensure 'Increase scheduling priority' is set to 'Administrators, Window Manager\\Window Manager Group'"
    )
    coverage = json.loads((AUDIT_DIR / "coverage.json").read_text(encoding="utf-8"))
    assert [control.title for control in controls.values()] == [entry["title"] for entry in coverage]


def test_goss_text_is_the_control_file_verbatim(controls):
    expected = (AUDIT_DIR / "section_2/section_2.2/cis_2.2.1.yml").read_bytes().decode("utf-8")
    assert controls["2.2.1"].goss_text == expected
    assert expected.startswith("---\n\n{{ if .Vars.win22cis_level_1 }}")
    assert "\n  {{ end }}\n{{ end }}" in expected


def test_goss_text_that_is_not_yaml_is_kept(controls):
    with pytest.raises(yaml.YAMLError):
        yaml.safe_load(controls["2.2.1"].goss_text)
    assert controls["2.2.1"].goss_text


def test_template_syntax_and_windows_paths_survive_untouched(controls):
    assert "path: '{{ .Vars.win22cis_snapshot_dir }}\\PrivilegeRights.SeTrustedCredManAccessPrivilege'" in (
        controls["2.2.1"].goss_text
    )
    assert "HKLM\\SYSTEM\\CurrentControlSet\\Services\\mrxsmb10\\Start:" in controls["18.4.2"].goss_text


def test_the_control_file_path_is_the_coverage_path_and_none_without_a_test(controls):
    assert controls["2.2.1"].file == "section_2/section_2.2/cis_2.2.1.yml"
    assert controls["2.2.34"].file is None


def test_the_gate_is_the_coverage_gate(controls):
    assert controls["1.1.1"].gate == "win22cis_level_1"
    assert controls["2.2.2"].gate == 'and (eq .Vars.win22cis_system_role "domaincontroller") .Vars.win22cis_level_1'


def test_meta_is_read_from_the_meta_block(controls):
    assert controls["2.2.1"].meta == {
        "domaincontroller": 1,
        "memberserver": 1,
        "server": 1,
        "CIS_ID": ["2.2.1"],
        "NIST800-53R5": ["AC-2", "AC-3", "AC-6", "AC-6(1)", "AC-6(7)", "AU-9(4)"],
    }


def test_meta_levels_tell_which_profiles_a_control_is_in(controls):
    assert controls["2.2.2"].meta["domaincontroller"] == 1 and "memberserver" not in controls["2.2.2"].meta
    assert controls["2.3.9.5"].meta["memberserver"] == 1 and "domaincontroller" not in controls["2.3.9.5"].meta


def test_a_template_line_inside_the_meta_block_does_not_hide_it(controls):
    assert controls["2.3.9.5"].meta["CIS_ID"] == ["2.3.9.5"]
    assert "CM-7(1)" in controls["2.3.9.5"].meta["NIST800-53R5"]


def test_a_rule_the_audit_cannot_assert_has_no_text_gate_or_meta(controls):
    control = controls["2.2.34"]
    assert (control.goss_text, control.gate, control.meta) == (None, None, {})


def test_a_control_with_a_string_value_in_meta_keeps_it(controls):
    assert controls["1.1.1"].meta["skip_reason"].startswith("domain scoped")


def test_meta_of_text_without_a_meta_block_is_empty():
    assert meta_block_of("registry:\n  HKLM\\X:\n    exists: true\n") == {}


def test_only_the_first_meta_block_is_read():
    text = "a:\n  meta:\n    server: 1\nb:\n  meta:\n    server: 2\n"
    assert meta_block_of(text) == {"server": 1}


def test_a_missing_coverage_file_fails_loudly(tmp_path):
    with pytest.raises(AuditParseError, match="coverage.json"):
        load_audit(tmp_path)


def test_a_rule_listed_twice_fails_loudly(tmp_path):
    entry = {"rule_id": "1.1.1", "title": "A", "emitted": False}
    (tmp_path / "coverage.json").write_text(json.dumps([entry, entry]), encoding="utf-8")
    with pytest.raises(AuditParseError, match="listed twice"):
        load_audit(tmp_path)


def test_a_missing_control_file_fails_loudly(tmp_path):
    entry = {"rule_id": "1.1.1", "title": "A", "emitted": True, "gate": "g", "file": "section_1/cis_1.1.1.yml"}
    (tmp_path / "coverage.json").write_text(json.dumps([entry]), encoding="utf-8")
    with pytest.raises(AuditParseError, match="cis_1.1.1.yml"):
        load_audit(tmp_path)


def test_a_control_file_outside_the_repo_is_refused(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (tmp_path / "secret.yml").write_text("x", encoding="utf-8")
    entry = {"rule_id": "1.1.1", "title": "A", "emitted": True, "gate": "g", "file": "../secret.yml"}
    (repo / "coverage.json").write_text(json.dumps([entry]), encoding="utf-8")
    with pytest.raises(AuditParseError, match="outside the repo"):
        load_audit(repo)


def test_windows_line_endings_are_kept_in_goss_text(tmp_path):
    (tmp_path / "section_1").mkdir()
    (tmp_path / "section_1" / "cis_1.1.1.yml").write_bytes(b"---\r\n\r\nregistry:\r\n")
    entry = {"rule_id": "1.1.1", "title": "A", "emitted": True, "gate": "g", "file": "section_1/cis_1.1.1.yml"}
    (tmp_path / "coverage.json").write_text(json.dumps([entry]), encoding="utf-8")
    assert load_audit(tmp_path)["1.1.1"].goss_text == "---\r\n\r\nregistry:\r\n"


@pytest.mark.parametrize("rule_id", ["../../x", "1.1/../x", "1.1.", "a.b", "", "1.1\n"])
def test_a_rule_id_that_is_not_a_dotted_number_is_refused(tmp_path, rule_id):
    entry = {"rule_id": rule_id, "title": "A", "emitted": False}
    (tmp_path / "coverage.json").write_text(json.dumps([entry]), encoding="utf-8")
    with pytest.raises(AuditParseError, match="not a dotted number"):
        load_audit(tmp_path)
