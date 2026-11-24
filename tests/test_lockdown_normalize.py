"""Tests for tools/lockdown_normalize.py.

The role and Audit fixtures are verbatim excerpts of Windows-2022-CIS (main) and
Windows-2022-CIS-Audit (benchmark_v4.0.0), see tests/fixtures/lockdown/. The role fixture's defaults
deliberately lack `netbt_nodetype` (a Task 1 test needs that); the `role_dir` fixture below adds the
real upstream default so the whole fixture role can be normalized, and one test removes it again.
"""

import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from tools.library_output import UnsupportedUpstreamData
from tools.lockdown_normalize import ANSIBLE_STEP_NAME, GOSS_CHECK_NAME, normalize_rules
from tools.lockdown_sources import SOURCES
from tools.odv_placeholders import placeholder_errors
from tools.registry_powershell import registry_check_powershell, registry_fix_powershell
from tools.source_lock import SourceLock
from tools.validate_library import schema_errors

FIXTURES = Path(__file__).parent / "fixtures" / "lockdown"
FIXTURE_SPEC = SOURCES["lockdown_cis_windows2022"]
ROLE_COMMIT = "a" * 40
AUDIT_COMMIT = "b" * 40
LOCK = SourceLock(
    tag="4.2.0",
    commit_sha=ROLE_COMMIT,
    retrieved_date="2026-11-24",
    repository_url=FIXTURE_SPEC.role_url,
    published_date="2026-11-01",
    importer_format="lockdown-cis-1",
    details={
        "audit_repository": FIXTURE_SPEC.audit_repository,
        "audit_branch": FIXTURE_SPEC.audit_branch,
        "audit_commit": AUDIT_COMMIT,
        "benchmark_version": FIXTURE_SPEC.benchmark_version,
    },
)
NETBT_DEFAULT = (
    "\n# 18.4.6\n"
    "# win22cis_netbt_nodetype is the node type value in "
    "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\NetBT\\Parameters:NodeType\n"
    "# Default: 2\n"
    "win22cis_netbt_nodetype: 2\n"
)


@pytest.fixture(scope="module")
def role_dir(tmp_path_factory) -> Path:
    complete_role = tmp_path_factory.mktemp("role") / "role"
    shutil.copytree(FIXTURES / "role", complete_role)
    with open(complete_role / "defaults" / "main" / "main.yml", "a", encoding="utf-8", newline="") as defaults_file:
        defaults_file.write(NETBT_DEFAULT)
    return complete_role


@pytest.fixture(scope="module")
def rules(role_dir) -> dict[str, dict]:
    produced = normalize_rules(FIXTURE_SPEC, role_dir, FIXTURES / "audit", LOCK)
    return {rule["id"].removeprefix("lockdown_cis_windows2022."): rule for rule in produced}


def check_items(rule: dict) -> list[dict]:
    return rule["check"]["Windows"]


def fix_steps(rule: dict) -> list[dict]:
    return rule["remediation"]["Windows"]["steps"]


def languages(items: list[dict]) -> list[str]:
    return [item["language"] for item in items]


class TestEveryRule:
    def test_every_rule_passes_the_schema_and_the_placeholder_checks(self, rules):
        assert rules
        for rule in rules.values():
            assert schema_errors(rule) == [], rule["id"]
            assert placeholder_errors(rule) == [], rule["id"]

    def test_ids_carry_the_source_name_and_the_cis_id(self, rules):
        assert rules["18.4.2"]["id"] == "lockdown_cis_windows2022.18.4.2"
        assert rules["18.4.2"]["source"]["upstream_rule_id"] == "18.4.2"
        assert rules["18.4.2"]["references"]["cis"] == {"benchmark_version": "4.0.0", "id": "18.4.2"}

    def test_the_section_path_stops_at_the_parent_section(self, rules):
        assert rules["18.4.2"]["section_path"] == ["18", "18.4"]
        assert rules["2.3.10.6"]["section_path"] == ["2", "2.3", "2.3.10"]

    def test_rules_follow_the_role_order_and_a_rule_with_two_task_groups_appears_once(self, rules):
        identifiers = list(rules)
        assert identifiers.index("1.2.2") < identifiers.index("1.2.1")
        assert len(identifiers) == len(set(identifiers))

    def test_the_source_block_pins_the_role_release(self, rules):
        source = rules["18.4.2"]["source"]
        assert source["name"] == "lockdown_cis_windows2022"
        assert source["release_tag"] == "4.2.0"
        assert source["commit_sha"] == ROLE_COMMIT
        assert source["upstream_path"] == "tasks/section_18/section_18.4.yml"
        assert source["upstream_url"] == f"{FIXTURE_SPEC.role_url}/blob/{ROLE_COMMIT}/tasks/section_18/section_18.4.yml"
        assert source["license"] == {
            "name": "MIT",
            "url": "https://opensource.org/license/mit",
            "rights_holder": "MindPoint Group - A Quantum Sky Company / Ansible Lockdown",
            "modified": True,
        }

    def test_the_discussion_names_the_upstream_files_and_none_of_cis_prose(self, rules):
        discussion = rules["18.4.2"]["discussion"]
        assert rules["18.4.2"]["discussion_format"] == "markdown"
        assert "`tasks/section_18/section_18.4.yml` of `ansible-lockdown/Windows-2022-CIS`" in discussion
        assert "`section_18/section_18.4/cis_18.4.2.yml` of `ansible-lockdown/Windows-2022-CIS-Audit`" in discussion

    def test_the_applicability_is_the_target_the_version_and_the_profiles(self, rules):
        applicability = rules["18.4.2"]["applicability"]
        assert len(applicability) == 1
        assert applicability[0]["target"] == "Windows"
        assert applicability[0]["version"] == "Server-2022"
        assert applicability[0]["benchmarks"] == [
            {"name": "level1_domaincontroller", "severity": None},
            {"name": "level1_memberserver", "severity": None},
        ]

    def test_an_unused_role_variable_is_not_an_odv(self, rules):
        assert rules["18.4.2"]["odvs"] == []


class TestRegistryRule:
    def test_check_items_are_registry_then_powershell_then_the_goss_test(self, rules):
        items = check_items(rules["18.4.2"])
        assert languages(items) == ["registry", "powershell", "goss"]
        assert [item["name"] for item in items] == [None, None, GOSS_CHECK_NAME]

    def test_the_registry_check_item_holds_the_translated_setting(self, rules):
        registry_item = check_items(rules["18.4.2"])[0]
        settings = registry_item["default"]["registry"]
        assert settings == [
            {
                "hive": "HKLM",
                "path": "SYSTEM\\CurrentControlSet\\Services\\mrxsmb10",
                "value_name": "Start",
                "type": "REG_DWORD",
                "data": 4,
                "state": "present",
            }
        ]
        assert registry_item["default"]["result"] is None
        assert registry_item["by_version"] == {}

    def test_the_powershell_check_is_generated_from_the_registry_settings(self, rules):
        settings = check_items(rules["18.4.2"])[0]["default"]["registry"]
        assert check_items(rules["18.4.2"])[1]["default"]["shell"] == registry_check_powershell(settings)

    def test_the_goss_item_is_the_audit_file_verbatim(self, rules):
        expected = (FIXTURES / "audit/section_18/section_18.4/cis_18.4.2.yml").read_bytes().decode("utf-8")
        assert check_items(rules["18.4.2"])[2]["default"]["shell"] == expected

    def test_fix_steps_are_registry_then_powershell_then_the_original_ansible_tasks(self, rules):
        steps = fix_steps(rules["18.4.2"])
        assert languages(steps) == ["registry", "powershell", "ansible"]
        assert [step["name"] for step in steps] == [None, None, ANSIBLE_STEP_NAME]
        settings = check_items(rules["18.4.2"])[0]["default"]["registry"]
        assert steps[0]["registry"] == settings
        assert steps[1]["shell"] == registry_fix_powershell(settings)
        assert all(step["versions"] is None and step["additional_info"] is None for step in steps)

    def test_the_ansible_step_is_the_role_text_verbatim(self, rules):
        ansible_text = fix_steps(rules["18.4.2"])[2]["shell"]
        role_text = (FIXTURES / "role/tasks/section_18/section_18.4.yml").read_bytes().decode("utf-8")
        task_start = role_text.index("- name: \"18.4.2 | PATCH")
        task_end = role_text.index("\n- name:", task_start)
        assert ansible_text == role_text[task_start:task_end].rstrip() + "\n"

    def test_the_rule_is_automated(self, rules):
        assert rules["18.4.2"]["assessment"] == {"status": "automated", "manual_reason": None}

    def test_the_title_comes_from_the_audit_coverage_file(self, rules):
        coverage = json.loads((FIXTURES / "audit/coverage.json").read_text(encoding="utf-8"))
        expected = next(entry["title"] for entry in coverage if entry["rule_id"] == "18.4.2")
        assert rules["18.4.2"]["title"] == expected

    def test_a_multi_string_value_is_a_registry_item(self, rules):
        (setting,) = check_items(rules["2.3.10.6"])[0]["default"]["registry"]
        assert setting["type"] == "REG_MULTI_SZ" and isinstance(setting["data"], list)

    def test_a_per_user_loop_writes_the_current_user_hive(self, rules):
        (setting,) = check_items(rules["19.5.1.1"])[0]["default"]["registry"]
        assert setting["hive"] == "HKCU"


class TestRegistryRuleWithOdvs:
    def test_a_number_odv_carries_the_range_of_its_registry_type_and_is_unquoted(self, rules):
        (odv,) = rules["18.10.57.3.10.1"]["odvs"]
        assert odv["name"] == "idle_rdp_session_disconnect_time"
        assert odv["datatype"] == "number"
        assert odv["quoting"] == "unquoted"
        assert odv["validation"]["min"] >= 0 and odv["validation"]["max"] <= 4294967295
        assert odv["by_benchmark"] == {}
        (setting,) = check_items(rules["18.10.57.3.10.1"])[0]["default"]["registry"]
        assert setting["data"] == "$ODV_idle_rdp_session_disconnect_time"

    def test_the_recommended_value_is_the_role_default(self, rules):
        (odv,) = rules["18.10.57.3.10.1"]["odvs"]
        assert isinstance(odv["recommended"], int)
        assert odv["description"]

    def test_a_string_odv_in_registry_data_is_single_quoted(self, rules):
        (odv,) = rules["2.3.7.5"]["odvs"]
        assert odv["datatype"] == "string"
        assert odv["quoting"] == "single"
        assert odv["validation"] is None
        assert isinstance(odv["recommended"], str)
        assert f"$ODV_{odv['name']}" in json.dumps(rules["2.3.7.5"]["check"])

    def test_a_security_policy_odv_is_declared_with_its_name_without_the_prefix(self, rules):
        names = [odv["name"] for rule in rules.values() for odv in rule["odvs"]]
        assert "max_passwords_saved" in names
        assert all(not name.startswith("win22cis_") for name in names)


class TestPowerShellOnlyRules:
    def test_a_user_right_has_a_translated_check_and_fix_but_no_registry_item(self, rules):
        rule = rules["2.2.1"]
        assert languages(check_items(rule)) == ["powershell", "goss"]
        assert languages(fix_steps(rule)) == ["powershell", "ansible"]
        assert "SeTrustedCredManAccessPrivilege" in check_items(rule)[0]["default"]["shell"]
        assert rule["assessment"] == {"status": "automated", "manual_reason": None}

    def test_a_win_shell_rule_has_a_verbatim_fix_and_no_translated_check(self, rules):
        rule = rules["17.1.1"]
        assert languages(check_items(rule)) == ["goss"]
        assert languages(fix_steps(rule)) == ["powershell", "ansible"]
        assert "AuditPol" in fix_steps(rule)[0]["shell"]
        assert rule["assessment"] == {"status": "manual", "manual_reason": "no_check"}
        assert "have no matching check" in rule["discussion"]

    def test_the_member_server_suffix_becomes_a_note_not_title_text(self, rules):
        assert "Member Server" not in rules["2.3.7.6"]["title"]
        assert "Applies to: Member Server only" in rules["2.3.7.6"]["discussion"]
        assert "Applies to" not in rules["18.4.2"]["discussion"]

    def test_the_domain_controller_suffix_becomes_a_note(self, rules):
        assert "Applies to: Domain Controller only" in rules["2.2.2"]["discussion"]
        assert "(DC only)" not in rules["2.2.2"]["discussion"]


class TestAnsibleOnlyRules:
    def test_a_number_odv_written_as_text_is_ansible_only(self, rules):
        rule = rules["2.3.7.6"]
        assert rule["assessment"] == {"status": "manual", "manual_reason": "no_check"}
        assert languages(fix_steps(rule)) == ["ansible"]
        assert fix_steps(rule)[0]["name"] == ANSIBLE_STEP_NAME
        assert rule["odvs"] == []

    def test_the_ansible_only_rule_keeps_the_goss_test_when_the_audit_has_one(self, rules):
        assert languages(check_items(rules["5.1"])) == ["goss"]

    def test_a_rule_without_an_audit_control_has_no_check_at_all(self, rules):
        assert rules["2.3.7.6"]["check"] is None

    def test_the_discussion_says_in_plain_english_why_it_was_not_translated(self, rules):
        discussion = rules["2.3.7.6"]["discussion"]
        assert "Manual: the Ansible role applies this only under conditions we cannot translate" in discussion
        assert "shown as the original Ansible." in discussion
        assert "when:" not in discussion and "variable" not in discussion and "No runnable check" not in discussion

    def test_the_manual_note_names_the_goss_test_only_when_the_rule_has_one(self, rules):
        assert "original Ansible and goss test" in rules["5.1"]["discussion"]
        assert "goss" not in rules["2.3.7.6"]["discussion"]

    def test_jinja_data_that_is_not_a_single_role_variable_is_ansible_only_never_raw_jinja(self, rules):
        rule = rules["2.3.10.9"]
        assert rule["assessment"]["status"] == "manual"
        assert languages(fix_steps(rule)) == ["ansible"]
        assert "{{" not in json.dumps(rule["check"]) or "goss" in json.dumps(rule["check"])
        assert all(step["language"] == "ansible" for step in fix_steps(rule))

    def test_a_rule_mixing_registry_and_service_tasks_has_no_registry_item_claiming_the_whole_fix(self, rules):
        rule = rules["5.1"]
        assert "registry" not in languages(fix_steps(rule))
        assert rule["assessment"]["status"] == "manual"

    def test_the_ansible_step_keeps_the_audit_and_warning_subtasks(self, rules):
        ansible_text = fix_steps(rules["1.2.1"])[-1]["shell"]
        assert "AUDIT" in ansible_text


class TestTitlesAndAuditOnlyRules:
    def test_titles_with_quotes_and_backslashes_come_from_coverage_json_intact(self, rules):
        assert rules["2.2.44"]["title"] == (
            "Ensure 'Profile system performance' is set to 'Administrators, NT SERVICE\\WdiServiceHost'"
        )

    def test_a_control_the_audit_cannot_assert_is_a_rule_without_a_goss_check(self, rules):
        rule = rules["2.2.34"]
        assert rule["title"].endswith("'Administrators, Window Manager\\Window Manager Group'")
        assert rule["check"] is None or GOSS_CHECK_NAME not in [item["name"] for item in check_items(rule)]

    def test_a_rule_only_the_audit_repo_lists_is_a_manual_rule_with_its_goss_test(self, rules):
        rule = rules["2.3.9.5"]
        assert rule["assessment"]["status"] == "manual"
        assert languages(check_items(rule)) == ["goss"]
        assert rule["remediation"] is None
        assert rule["applicability"][0]["benchmarks"] == []
        assert rule["source"]["commit_sha"] == AUDIT_COMMIT
        assert rule["source"]["upstream_path"] == "section_2/section_2.3.9/cis_2.3.9.5.yml"
        assert schema_errors(rule) == [] and placeholder_errors(rule) == []

    def test_a_title_falls_back_to_the_task_name_without_the_suffix(self, rules):
        assert rules["2.3.7.6"]["title"].startswith("Ensure")
        assert "MS only" not in rules["2.3.7.6"]["title"]


class TestRoleConditionNotes:
    def test_a_bitlocker_gated_rule_says_the_role_needs_its_bitlocker_option(self, rules):
        notes = [rule for rule in rules.values() if "BitLocker option" in rule["discussion"]]
        assert notes == [] or all("only when its BitLocker option is turned on" in rule["discussion"] for rule in notes)

    def test_a_domain_scoped_account_policy_rule_says_the_role_skips_it_on_domain_joined_hosts(self, rules):
        skipped = [rule for rule in rules.values() if "skips this on domain-joined hosts" in rule["discussion"]]
        assert skipped, "the fixtures have account policy rules gated on domain scope"
        assert all(rule["id"].startswith("lockdown_cis_windows2022.1.") for rule in skipped)


class TestSecurityPolicyNumbersAreValidated:
    def test_a_number_without_a_range_gets_a_minimum_of_zero_and_no_maximum(self, rules):
        (odv,) = rules["1.1.1"]["odvs"]
        assert odv["name"] == "max_passwords_saved"
        assert odv["validation"] == {"min": 0}

    def test_a_derived_range_is_kept(self, rules):
        (odv,) = rules["1.2.2"]["odvs"]
        assert odv["validation"] == {"min": 1, "max": 5}


SCHEDULING_PRIORITY_DEFAULT = (
    "\nwin22cis_increase_scheduling_priority_users: "
    "'{{ [\"Administrators\"] if (prelim_windows_installation_type == \"Server Core\") "
    "else ([\"Administrators\", \"Window Manager\\Window Manager Group\"]) }}'\n"
)
SCHEDULING_PRIORITY_TASK = (
    '- name: "2.2.34 | PATCH | Increase scheduling priority"\n'
    "  when: win22cis_rule_2_2_34\n"
    "  ansible.windows.win_user_right:\n"
    "    name: SeIncreaseBasePriorityPrivilege\n"
    '    users: "{{ win22cis_increase_scheduling_priority_users }}"\n'
    "    action: set\n"
)


class TestJinjaNeverReachesTranslatedText:
    def role_with_the_real_2_2_34(self, role_dir, tmp_path) -> Path:
        role = tmp_path / "role"
        shutil.copytree(role_dir, role)
        with open(role / "defaults" / "main" / "main.yml", "a", encoding="utf-8", newline="") as defaults_file:
            defaults_file.write(SCHEDULING_PRIORITY_DEFAULT)
        (role / "tasks" / "section_2" / "section_2.2.34.yml").write_text(SCHEDULING_PRIORITY_TASK, encoding="utf-8")
        return role

    def test_a_rule_using_a_jinja_default_is_manual_with_no_translated_script(self, role_dir, tmp_path):
        role = self.role_with_the_real_2_2_34(role_dir, tmp_path)
        produced = normalize_rules(FIXTURE_SPEC, role, FIXTURES / "audit", LOCK)
        rule = next(rule for rule in produced if rule["id"].endswith(".2.2.34"))
        assert rule["assessment"] == {"status": "manual", "manual_reason": "no_check"}
        assert rule["odvs"] == []
        assert languages(fix_steps(rule)) == ["ansible"]
        assert all(item["language"] == "goss" for item in rule["check"] or [])

    def test_no_translated_text_or_odv_default_anywhere_has_jinja(self, rules):
        for rule in rules.values():
            for odv in rule["odvs"]:
                assert "{{" not in json.dumps(odv["recommended"]) and "{%" not in json.dumps(odv["recommended"])
            checks = check_items(rule) if rule["check"] else []
            fixes = fix_steps(rule) if rule["remediation"] else []
            for item in [*checks, *fixes]:
                if item["language"] in ("registry", "powershell"):
                    assert "{{" not in json.dumps(item) and "{%" not in json.dumps(item)

    def test_translated_text_with_jinja_fails_the_import_loudly(self, role_dir, monkeypatch):
        from tools import lockdown_normalize

        monkeypatch.setattr(lockdown_normalize, "registry_check_powershell", lambda registry: "Write-Output '{{ x }}'")
        with pytest.raises(UnsupportedUpstreamData, match="contains Jinja"):
            normalize_rules(FIXTURE_SPEC, role_dir, FIXTURES / "audit", LOCK)

    def test_an_odv_default_with_jinja_that_still_reaches_a_script_fails_the_import_loudly(self, role_dir):
        from tools.lockdown_normalize import _odvs_used
        from tools.lockdown_role import load_role_odvs

        odvs = load_role_odvs(role_dir, FIXTURE_SPEC.variable_prefix)
        odvs["max_passwords_saved"] = replace(odvs["max_passwords_saved"], default="{{ x }}")
        rule_text = {"check": [{"language": "powershell", "default": {"shell": "$ODV_max_passwords_saved"}}], "fix": []}
        with pytest.raises(UnsupportedUpstreamData, match="default with Jinja"):
            _odvs_used(rule_text, odvs, None, "rule 1.1.1")


class TestFailuresAreLoud:
    def test_a_role_variable_missing_from_the_defaults_fails_the_import_naming_the_rule(self, tmp_path):
        role_without_default = tmp_path / "role"
        shutil.copytree(FIXTURES / "role", role_without_default)
        with pytest.raises(UnsupportedUpstreamData, match=r"18\.4\.6.*netbt_nodetype"):
            normalize_rules(FIXTURE_SPEC, role_without_default, FIXTURES / "audit", LOCK)

    def test_the_result_is_deterministic(self, role_dir):
        first = normalize_rules(FIXTURE_SPEC, role_dir, FIXTURES / "audit", LOCK)
        second = normalize_rules(FIXTURE_SPEC, role_dir, FIXTURES / "audit", LOCK)
        assert first == second
