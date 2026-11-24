"""Tests for the PowerShell translation, tolerated conditions, ODV rulings and profiles in tools/lockdown_role.py.

Real tasks come from the verbatim Windows-2022-CIS excerpts under tests/fixtures/lockdown/role/.
A few cases have no real task (an ODV in a security policy value, a remove action, a service
with dependents, a workstation profile); those change a real task with dataclasses.replace, or
build a role in a temporary directory, and say so. The golden scripts under
tests/fixtures/lockdown/powershell/ are the exact text the translation produces; the check
scripts among them were also run on a Windows machine (see the task report).
"""

from dataclasses import replace
from pathlib import Path

import pytest

from tools.lockdown_role import (
    RoleOdv,
    RoleTask,
    UnknownRoleVariableError,
    group_by_rule,
    load_role_odvs,
    load_role_tasks,
    odv_range_disagreements,
    powershell_blocker,
    profiles_for,
    registry_blocker,
    registry_number_bounds,
    translate_powershell,
    translate_registry,
)

FIXTURES = Path(__file__).parent / "fixtures" / "lockdown"
ROLE_DIR = FIXTURES / "role"
GOLDEN_DIR = FIXTURES / "powershell"
PREFIX = "win22cis"
RULE_TOGGLE_FORMAT = "win22cis_rule_{}"


@pytest.fixture(scope="module")
def tasks_by_rule() -> dict[str, list[RoleTask]]:
    return group_by_rule(load_role_tasks(ROLE_DIR))


@pytest.fixture(scope="module")
def odvs() -> dict[str, RoleOdv]:
    return load_role_odvs(ROLE_DIR, PREFIX)


def toggle_only(task: RoleTask) -> RoleTask:
    """The task with only its rule toggle as a condition (a real task whose gates are taken away)."""
    return replace(task, when=[RULE_TOGGLE_FORMAT.format(task.rule_id.replace(".", "_"))])


def with_arguments(task: RoleTask, **arguments) -> RoleTask:
    return replace(task, args={**task.args, **arguments})


def service_tasks_of(tasks_by_rule) -> list[RoleTask]:
    """Rule 5.1 without its win_regedit write: the real service_info and win_service tasks."""
    return [task for task in tasks_by_rule["5.1"] if task.module != "win_regedit"]


def golden_cases(tasks_by_rule, odvs) -> dict[str, tuple[str | None, str | None]]:
    """Golden file stem to the (check, fix) text the translation produces."""

    def translated(tasks):
        return translate_powershell(tasks, odvs, PREFIX)

    lockout_count = next(task for task in tasks_by_rule["1.2.2"] if task.module == "win_security_policy")
    rename_admin = tasks_by_rule["2.3.1.3"][0]
    remove_right = with_arguments(tasks_by_rule["2.2.21"][0], action="remove")
    stop_with_dependents = [
        task if task.module != "win_service" else with_arguments(task, force_dependent_services=True)
        for task in service_tasks_of(tasks_by_rule)
    ]
    cases = {
        "user_right_no_one": translated(tasks_by_rule["2.2.1"]),
        "user_right_set": translated(tasks_by_rule["2.2.8"]),
        "user_right_add": translated(tasks_by_rule["2.2.21"]),
        "user_right_remove": translated([remove_right]),
        "security_policy_number": translated(tasks_by_rule["2.3.1.1"]),
        "security_policy_number_odv": translated([toggle_only(lockout_count)]),
        "security_policy_text_odv": translated([toggle_only(rename_admin)]),
        "service": translated(service_tasks_of(tasks_by_rule)),
        "service_with_dependents": translated(stop_with_dependents),
        "shell_only": translated(tasks_by_rule["17.1.1"]),
    }
    return cases


GOLDEN_STEMS = [
    "user_right_no_one",
    "user_right_set",
    "user_right_add",
    "user_right_remove",
    "security_policy_number",
    "security_policy_number_odv",
    "security_policy_text_odv",
    "service",
    "service_with_dependents",
    "shell_only",
]


def read_golden(stem: str, kind: str) -> str | None:
    path = GOLDEN_DIR / f"{stem}_{kind}.ps1"
    return path.read_bytes().decode("utf-8") if path.exists() else None


@pytest.mark.parametrize("stem", GOLDEN_STEMS)
def test_translated_scripts_match_their_golden_files(stem, tasks_by_rule, odvs):
    check, fix = golden_cases(tasks_by_rule, odvs)[stem]
    assert check == read_golden(stem, "check")
    assert fix == read_golden(stem, "fix")


class TestUserRights:
    def test_no_one_checks_for_an_empty_holder_list_and_fixes_with_an_empty_value(self, tasks_by_rule, odvs):
        check, fix = translate_powershell(tasks_by_rule["2.2.1"], odvs, PREFIX)
        assert "$expected = @()" in check
        assert "'SeTrustedCredManAccessPrivilege'" in check
        assert "$desiredByRight['SeTrustedCredManAccessPrivilege'] = @()" in fix

    def test_account_names_are_resolved_to_sids_in_the_script(self, tasks_by_rule, odvs):
        check, fix = translate_powershell(tasks_by_rule["2.2.2"], odvs, PREFIX)
        for script in (check, fix):
            assert "function ConvertTo-AccountSid" in script
            assert "'Administrators', 'Authenticated Users', 'ENTERPRISE DOMAIN CONTROLLERS'" in script

    def test_the_fix_exports_the_current_holders_only_when_an_action_needs_them(self, tasks_by_rule, odvs):
        _, set_fix = translate_powershell(tasks_by_rule["2.2.8"], odvs, PREFIX)
        _, add_fix = translate_powershell(tasks_by_rule["2.2.21"], odvs, PREFIX)
        assert "secedit /export" not in set_fix
        assert "secedit /export" in add_fix

    def test_a_single_string_user_is_one_account(self, tasks_by_rule, odvs):
        task = with_arguments(tasks_by_rule["2.2.8"][0], users="Administrators")
        assert translate_powershell([task], odvs, PREFIX) == translate_powershell(tasks_by_rule["2.2.8"], odvs, PREFIX)

    def test_a_string_odv_account_is_a_single_quoted_placeholder(self, tasks_by_rule, odvs):
        task = with_arguments(toggle_only(tasks_by_rule["2.2.8"][0]), users=["{{ win22cis_admin_username }}"])
        check, fix = translate_powershell([task], odvs, PREFIX)
        assert "@('$ODV_admin_username' | ForEach-Object" in check
        assert "@('$ODV_admin_username' | ForEach-Object" in fix

    def test_a_list_valued_variable_is_not_translatable(self, tasks_by_rule, odvs):
        task = with_arguments(toggle_only(tasks_by_rule["2.2.8"][0]), users="{{ win22cis_ngws }}")
        assert translate_powershell([task], odvs, PREFIX) is None
        assert powershell_blocker([task], odvs, PREFIX) == "boolean variable ngws does not fit user right account"

    def test_an_account_with_jinja_text_is_not_translatable(self, tasks_by_rule, odvs):
        task = with_arguments(tasks_by_rule["2.2.8"][0], users=["{{ item }}\\Admins"])
        assert powershell_blocker([task], odvs, PREFIX).startswith("user right account is Jinja")

    def test_two_tasks_that_set_one_right_differently_are_not_translatable(self, tasks_by_rule, odvs):
        first = tasks_by_rule["2.2.8"][0]
        second = with_arguments(first, users=["Administrators", "Backup Operators"])
        assert powershell_blocker([first, second], odvs, PREFIX) == "conflicting writes to one user right"

    def test_a_when_on_hyper_v_is_not_a_profile_gate(self, tasks_by_rule, odvs):
        assert powershell_blocker(tasks_by_rule["2.2.19"], odvs, PREFIX) == "when: not win22cis_hyperv_installed"

    def test_an_unknown_action_is_not_translatable(self, tasks_by_rule, odvs):
        task = with_arguments(tasks_by_rule["2.2.8"][0], action="replace")
        assert powershell_blocker([task], odvs, PREFIX) == "user right action 'replace'"


class TestSecurityPolicy:
    def test_check_compares_the_exported_value_and_fix_writes_an_inf(self, tasks_by_rule, odvs):
        check, fix = translate_powershell(tasks_by_rule["2.3.1.1"], odvs, PREFIX)
        assert "secedit /export /cfg $exportPath /areas SECURITYPOLICY" in check
        assert "$current -ne [string]0" in check
        assert "'EnableGuestAccount = 0'" in fix
        assert "secedit /configure" in fix

    def test_temporary_files_are_removed_in_finally(self, tasks_by_rule, odvs):
        for script in translate_powershell(tasks_by_rule["2.3.1.1"], odvs, PREFIX):
            assert "finally {" in script and "Remove-Item -LiteralPath $workDirectory -Recurse -Force" in script

    def test_a_number_odv_stays_bare(self, tasks_by_rule, odvs):
        check, fix = golden_cases(tasks_by_rule, odvs)["security_policy_number_odv"]
        assert "$current -ne [string]$ODV_bad_login_lockout_count" in check
        assert "('LockoutBadCount = ' + $ODV_bad_login_lockout_count)" in fix
        assert "'$ODV_bad_login_lockout_count'" not in check + fix

    def test_a_string_odv_is_single_quoted_and_quoted_in_the_inf(self, tasks_by_rule, odvs):
        check, fix = golden_cases(tasks_by_rule, odvs)["security_policy_text_odv"]
        assert "$current -cne '$ODV_admin_username'" in check
        assert "('newadministratorname = \"' + '$ODV_admin_username' + '\"')" in fix

    def test_a_domain_scoped_account_policy_is_a_profile_gate(self, tasks_by_rule, odvs):
        assert powershell_blocker(tasks_by_rule["1.1.1"], odvs, PREFIX) is None
        assert translate_powershell(tasks_by_rule["1.1.1"], odvs, PREFIX) is not None

    def test_two_keys_become_two_lines_of_one_section(self, tasks_by_rule, odvs):
        first = tasks_by_rule["2.3.1.1"][0]
        second = with_arguments(first, key="ClearTextPassword")
        _, fix = translate_powershell([first, second], odvs, PREFIX)
        assert fix.index("'EnableGuestAccount = 0'") < fix.index("'ClearTextPassword = 0'")
        assert fix.count("'[System Access]'") == 1

    def test_the_same_key_written_twice_with_different_values_is_not_translatable(self, tasks_by_rule, odvs):
        first = tasks_by_rule["2.3.1.1"][0]
        second = with_arguments(first, value=1)
        assert powershell_blocker([first, second], odvs, PREFIX) == "conflicting writes to one security policy key"

    def test_other_sections_are_not_translatable(self, tasks_by_rule, odvs):
        task = with_arguments(tasks_by_rule["2.3.1.1"][0], section="Registry Values")
        assert powershell_blocker([task], odvs, PREFIX) == "security policy section 'Registry Values'"

    def test_a_computed_registry_value_is_not_translatable(self, tasks_by_rule, odvs):
        task = with_arguments(
            toggle_only(tasks_by_rule["2.3.1.1"][0]),
            section="System Access",
            value="{{ '7,' ~ win22cis_legal_notice_caption }}",
        )
        assert translate_powershell([task], odvs, PREFIX) is None

    def test_a_number_odv_in_a_text_key_does_not_fit(self, tasks_by_rule, odvs):
        task = with_arguments(toggle_only(tasks_by_rule["2.3.1.3"][0]), value="{{ win22cis_bad_login_lockout_count }}")
        assert powershell_blocker([task], odvs, PREFIX) == (
            "number variable bad_login_lockout_count does not fit security policy newadministratorname"
        )

    def test_an_unknown_variable_raises(self, tasks_by_rule, odvs):
        task = with_arguments(toggle_only(tasks_by_rule["2.3.1.1"][0]), value="{{ win22cis_missing_value }}")
        with pytest.raises(UnknownRoleVariableError, match="win22cis_missing_value"):
            translate_powershell([task], odvs, PREFIX)


class TestServices:
    def test_check_reads_start_type_and_status_and_a_missing_service_passes(self, tasks_by_rule, odvs):
        check, fix = translate_powershell(service_tasks_of(tasks_by_rule), odvs, PREFIX)
        assert "Get-Service -Name 'Spooler' -ErrorAction SilentlyContinue" in check
        assert "if ($service.StartType -ne 'Disabled')" in check
        assert "if ($service.Status -ne 'Stopped')" in check
        assert "Set-Service -Name 'Spooler' -StartupType Disabled" in fix
        assert "Stop-Service -Name 'Spooler'" in fix

    def test_dependent_services_are_stopped_only_when_the_task_forces_it(self, tasks_by_rule, odvs):
        _, plain_fix = translate_powershell(service_tasks_of(tasks_by_rule), odvs, PREFIX)
        _, forced_fix = golden_cases(tasks_by_rule, odvs)["service_with_dependents"]
        assert "-Force" not in plain_fix
        assert "Stop-Service -Name 'Spooler' -Force" in forced_fix

    def test_the_exists_guard_of_the_rules_own_service_info_task_is_tolerated(self, tasks_by_rule, odvs):
        service = next(task for task in tasks_by_rule["5.1"] if task.module == "win_service")
        assert "spooler_service_info.exists" in service.when
        assert powershell_blocker(service_tasks_of(tasks_by_rule), odvs, PREFIX) is None

    def test_a_guard_on_something_the_rule_did_not_register_is_not_tolerated(self, tasks_by_rule, odvs):
        service = next(task for task in tasks_by_rule["5.1"] if task.module == "win_service")
        assert powershell_blocker([service], odvs, PREFIX) == "when: spooler_service_info.exists"

    def test_a_service_rule_that_also_writes_registry_is_not_translated_here(self, tasks_by_rule, odvs):
        assert translate_powershell(tasks_by_rule["5.1"], odvs, PREFIX) is None
        assert powershell_blocker(tasks_by_rule["5.1"], odvs, PREFIX) == "primary writes mix win_regedit, win_service"

    def test_removing_a_service_is_not_translatable(self, tasks_by_rule, odvs):
        service = next(task for task in tasks_by_rule["5.1"] if task.module == "win_service")
        removal = replace(service, args={"name": "Spooler", "state": "absent"})
        assert powershell_blocker([toggle_only(removal)], odvs, PREFIX) == "service state 'absent'"

    def test_other_start_modes_and_arguments_are_not_translatable(self, tasks_by_rule, odvs):
        service = toggle_only(next(task for task in tasks_by_rule["5.1"] if task.module == "win_service"))
        assert powershell_blocker([with_arguments(service, start_mode="delayed")], odvs, PREFIX) == (
            "service start_mode 'delayed'"
        )
        assert powershell_blocker([with_arguments(service, username="LocalSystem")], odvs, PREFIX) == (
            "service argument username"
        )


class TestShell:
    def test_win_shell_commands_are_the_fix_verbatim_and_there_is_no_check(self, tasks_by_rule, odvs):
        check, fix = translate_powershell(tasks_by_rule["17.1.1"], odvs, PREFIX)
        assert check is None
        assert fix == (
            'AuditPol /set /subcategory:"{0cce923f-69ae-11d9-bed3-505054503030}" /success:enable\n'
            'AuditPol /set /subcategory:"{0cce923f-69ae-11d9-bed3-505054503030}" /failure:enable\n'
        )

    def test_the_guards_on_the_audit_result_are_tolerated_but_other_conditions_are_not(self, tasks_by_rule, odvs):
        patches = [task for task in tasks_by_rule["17.1.1"] if task.verb == "PATCH" and task.module == "win_shell"]
        assert all("discovered_17_1_1_audit.stdout" in task.when[-1] for task in patches)
        extra_condition = replace(patches[0], when=patches[0].when + ["something_unrelated"])
        rule_tasks = [extra_condition if task is patches[0] else task for task in tasks_by_rule["17.1.1"]]
        assert powershell_blocker(rule_tasks, odvs, PREFIX) == "when: something_unrelated"

    def test_a_command_with_jinja_is_not_translatable(self, tasks_by_rule, odvs):
        patch = next(task for task in tasks_by_rule["17.1.1"] if task.verb == "PATCH" and task.module == "win_shell")
        templated = replace(patch, args={"_raw_params": "AuditPol /set /subcategory:{{ item }}"}, when=[patch.when[0]])
        assert powershell_blocker([templated], odvs, PREFIX) == "win_shell command has Jinja"

    def test_a_shell_option_the_script_cannot_keep_is_not_translatable(self, tasks_by_rule, odvs):
        patch = next(task for task in tasks_by_rule["17.1.1"] if task.verb == "PATCH" and task.module == "win_shell")
        with_executable = replace(patch, args={**patch.args, "executable": "cmd"}, when=[patch.when[0]])
        assert powershell_blocker([with_executable], odvs, PREFIX) == "win_shell has arguments other than the command"

    def test_a_rule_that_writes_registry_and_runs_win_shell_is_not_translated(self, tasks_by_rule, odvs):
        shell = next(task for task in tasks_by_rule["17.1.1"] if task.module == "win_shell" and task.verb == "PATCH")
        mixed = [tasks_by_rule["18.4.2"][0], replace(shell, rule_id="18.4.2", when=["win22cis_rule_18_4_2"])]
        assert translate_powershell(mixed, odvs, PREFIX) is None
        assert powershell_blocker(mixed, odvs, PREFIX) == "primary writes mix win_regedit, win_shell"

    def test_registry_only_rules_have_their_own_translation(self, tasks_by_rule, odvs):
        assert translate_powershell(tasks_by_rule["18.4.2"], odvs, PREFIX) is None
        assert powershell_blocker(tasks_by_rule["18.4.2"], odvs, PREFIX) == (
            "registry settings have their own translation"
        )

    def test_a_rule_with_no_primary_write_is_not_translated(self, tasks_by_rule, odvs):
        audit_only = [task for task in tasks_by_rule["1.2.2"] if task.verb == "AUDIT"]
        assert powershell_blocker(audit_only, odvs, PREFIX) == "no primary write"

    def test_an_unknown_module_is_not_translated(self, tasks_by_rule, odvs):
        task = replace(tasks_by_rule["2.2.8"][0], module="win_audit_policy_system")
        assert powershell_blocker([task], odvs, PREFIX) == "primary write is win_audit_policy_system"

    def test_a_loop_is_not_translated(self, tasks_by_rule, odvs):
        task = replace(tasks_by_rule["2.2.8"][0], loop=["a", "b"])
        assert powershell_blocker([task], odvs, PREFIX) == "loop"


class TestToleratedConditions:
    def gated_registry_task(self, tasks_by_rule, condition: str) -> RoleTask:
        task = tasks_by_rule["18.4.2"][0]
        return replace(task, when=["win22cis_rule_18_4_2", condition])

    @pytest.mark.parametrize(
        "condition",
        [
            "prelim_win22cis_is_domain_controller",
            "not prelim_win22cis_is_domain_controller",
            "prelim_win22cis_is_domain_member",
            "not prelim_win22cis_is_domain_member",
            "win22cis_ngws",
            "not win22cis_ngws",
            "win22cis_bitlocker",
            "not prelim_win22cis_account_policy_is_domain_scoped",
            "prelim_win22cis_account_policy_is_domain_scoped",
            "not discovered_account_policy_is_domain_scoped",
            "not prelim_win22cis_is_standalone",
            "prelim_win22cis_is_standalone",
            "not win_skip_for_test",
            "not (win_skip_for_test | bool)",
            "win_skip_for_test",
        ],
    )
    def test_profile_gates_and_the_test_switch_are_tolerated_by_default(self, tasks_by_rule, odvs, condition):
        task = self.gated_registry_task(tasks_by_rule, condition)
        assert translate_registry([task], odvs, PREFIX) is not None

    @pytest.mark.parametrize(
        "condition",
        [
            "not prelim_win19cis_is_standalone",
            "not prelim_win22cis_account_policy_is_domain_scoped and x",
            "win22cis_hyperv_installed",
            "discovered_value > 3",
            "prelim_win22cis_is_domain_controller and something_else",
        ],
    )
    def test_any_other_condition_still_blocks_translation(self, tasks_by_rule, odvs, condition):
        task = self.gated_registry_task(tasks_by_rule, condition)
        assert translate_registry([task], odvs, PREFIX) is None

    def test_an_explicit_set_replaces_the_defaults(self, tasks_by_rule, odvs):
        task = self.gated_registry_task(tasks_by_rule, "prelim_win22cis_is_domain_controller")
        assert translate_registry([task], odvs, PREFIX, frozenset()) is None
        only_member = frozenset({"prelim_win22cis_is_domain_member"})
        assert translate_registry([task], odvs, PREFIX, only_member) is None
        assert registry_blocker([task], odvs, PREFIX, only_member) == "when: prelim_win22cis_is_domain_controller"

    def test_the_same_tolerance_applies_to_the_powershell_translation(self, tasks_by_rule, odvs):
        assert translate_powershell(tasks_by_rule["2.2.2"], odvs, PREFIX) is not None
        assert translate_powershell(tasks_by_rule["2.2.2"], odvs, PREFIX, frozenset()) is None

    def test_two_registry_writes_to_one_value_that_disagree_are_not_translatable(self, tasks_by_rule, odvs):
        first = tasks_by_rule["18.4.2"][0]
        second = with_arguments(first, data=1)
        assert translate_registry([first, second], odvs, PREFIX) is None
        assert registry_blocker([first, second], odvs, PREFIX) == "conflicting writes to one registry value"


class TestProfiles:
    def test_a_server_rule_has_a_benchmark_per_profile_tag(self, tasks_by_rule):
        (user_right,) = tasks_by_rule["2.2.2"]
        assert profiles_for([user_right]) == ["level1_domaincontroller"]
        both_roles = profiles_for(tasks_by_rule["2.2.8"])
        assert both_roles == ["level1_memberserver"]

    def test_tags_that_are_not_profiles_are_ignored(self, tasks_by_rule):
        (user_right,) = tasks_by_rule["2.2.2"]
        assert "rule_2.2.2" in user_right.tags and "userrights" in user_right.tags
        assert all(name.startswith(("level", "ngws")) for name in profiles_for([user_right]))

    def test_workstation_tags_become_benchmarks(self, tasks_by_rule):
        # No Windows 11 role in the fixtures: a real task given the tags a Windows 11 rule carries.
        task = replace(
            tasks_by_rule["18.4.2"][0],
            tags=["level1-corporate-enterprise-environment", "level2-bitlocker", "level1-bitlocker", "rule_18.4.2", "patch"],
        )
        assert profiles_for([task]) == [
            "level1_corporate_enterprise_environment",
            "level2_bitlocker",
            "level1_bitlocker",
        ]

    def test_next_generation_windows_security_tags_are_profiles(self, tasks_by_rule):
        task = replace(tasks_by_rule["18.4.2"][0], tags=["ngws-memberserver", "ngws-domaincontroller", "patch"])
        assert profiles_for([task]) == ["ngws_memberserver", "ngws_domaincontroller"]

    def test_tags_of_every_task_of_a_rule_are_merged_without_repeats(self, tasks_by_rule):
        first = replace(tasks_by_rule["18.4.2"][0], tags=["level1-memberserver", "patch"])
        second = replace(first, tags=["level1-memberserver", "level2-memberserver"])
        assert profiles_for([first, second]) == ["level1_memberserver", "level2_memberserver"]

    def test_a_rule_without_profile_tags_has_none(self, tasks_by_rule):
        task = replace(tasks_by_rule["18.4.2"][0], tags=["patch"])
        assert profiles_for([task]) == []


def write_role(tmp_path: Path, defaults: str, tasks: str) -> Path:
    """A one-rule role in a temporary directory, for ODV cases no fixture covers."""
    (tmp_path / "defaults" / "main").mkdir(parents=True)
    (tmp_path / "tasks" / "section_9").mkdir(parents=True)
    (tmp_path / "defaults" / "main" / "main.yml").write_text(defaults, encoding="utf-8")
    (tmp_path / "tasks" / "section_9" / "section_9.1.yml").write_text(tasks, encoding="utf-8")
    return tmp_path


class TestOdvRulings:
    def test_a_name_that_starts_with_a_digit_becomes_value_name(self, tmp_path):
        role = write_role(
            tmp_path,
            "win22cis_48_digit_setting: 48\nwin22cis_plain_setting: 1\n",
            '- name: "9.1.1 | PATCH | A rule"\n'
            "  when: win22cis_rule_9_1_1\n"
            "  ansible.windows.win_regedit:\n"
            "    path: HKLM:\\SOFTWARE\\Example\n"
            "    name: Digits\n"
            '    data: "{{ win22cis_48_digit_setting }}"\n'
            "    type: dword\n",
        )
        role_odvs = load_role_odvs(role, PREFIX)
        assert list(role_odvs) == ["value_48_digit_setting", "plain_setting"]
        tasks = load_role_tasks(role)
        (setting,) = translate_registry(tasks, role_odvs, PREFIX)
        assert setting["data"] == "$ODV_value_48_digit_setting"

    def test_an_equality_when_is_not_a_range(self, tmp_path):
        role = write_role(
            tmp_path,
            "win22cis_exact: 24\n",
            '- name: "9.1.1 | PATCH | A rule"\n'
            "  when:\n"
            "    - win22cis_rule_9_1_1\n"
            "    - win22cis_exact == 24\n"
            "  ansible.windows.win_regedit:\n"
            "    path: HKLM:\\SOFTWARE\\Example\n"
            "    name: Exact\n"
            '    data: "{{ win22cis_exact }}"\n'
            "    type: dword\n",
        )
        odv = load_role_odvs(role, PREFIX)["exact"]
        assert (odv.min, odv.max) == (None, None)
        assert registry_number_bounds(odv, "REG_DWORD") == (0, 2**32 - 1)
        assert registry_number_bounds(odv, "REG_QWORD") == (0, 2**64 - 1)

    def test_a_range_can_come_from_the_warning_task_alone(self, tmp_path):
        role = write_role(
            tmp_path,
            "win22cis_limit: 10\n",
            '- name: "9.1.1 | PATCH | A rule"\n'
            "  when: win22cis_rule_9_1_1\n"
            "  block:\n"
            '    - name: "9.1.1 | PATCH | A rule | Set"\n'
            "      ansible.windows.win_regedit:\n"
            "        path: HKLM:\\SOFTWARE\\Example\n"
            "        name: Limit\n"
            '        data: "{{ win22cis_limit }}"\n'
            "        type: dword\n"
            '    - name: "9.1.1 | AUDIT | A rule | Warn"\n'
            "      when: win22cis_limit > 365 or win22cis_limit == 0\n"
            "      ansible.builtin.debug:\n"
            "        msg: out of range\n",
        )
        odv = load_role_odvs(role, PREFIX)["limit"]
        assert (odv.min, odv.max) == (None, 365)

    def test_a_patch_and_a_warning_range_that_disagree_take_the_narrower_bound_of_each(self, tmp_path):
        role = write_role(
            tmp_path,
            "win22cis_limit: 10\n",
            '- name: "9.1.1 | PATCH | A rule"\n'
            "  when: win22cis_rule_9_1_1\n"
            "  block:\n"
            '    - name: "9.1.1 | PATCH | A rule | Set"\n'
            "      when:\n"
            "        - win22cis_limit >= 1\n"
            "        - win22cis_limit <= 365\n"
            "      ansible.windows.win_regedit:\n"
            "        path: HKLM:\\SOFTWARE\\Example\n"
            "        name: Limit\n"
            '        data: "{{ win22cis_limit }}"\n'
            "        type: dword\n"
            '    - name: "9.1.1 | AUDIT | A rule | Warn"\n'
            "      when: win22cis_limit > 300 or win22cis_limit < 0\n"
            "      ansible.builtin.debug:\n"
            "        msg: out of range\n",
        )
        odv = load_role_odvs(role, PREFIX)["limit"]
        assert (odv.min, odv.max) == (1, 300)
        assert odv_range_disagreements(role, PREFIX) == {"limit": ((1, 365), (0, 300))}

    def test_the_real_roles_patch_and_warning_ranges_agree_for_the_fixture_variables(self):
        assert odv_range_disagreements(ROLE_DIR, PREFIX) == {}

    def test_a_not_in_warning_leaves_the_listed_values_valid(self, tmp_path):
        role = write_role(
            tmp_path,
            "win22cis_mode: 1\n",
            '- name: "9.1.1 | PATCH | A rule"\n'
            "  when: win22cis_rule_9_1_1\n"
            "  block:\n"
            '    - name: "9.1.1 | AUDIT | A rule | Warn"\n'
            "      when: win22cis_mode not in [1, 2, 4, 8]\n"
            "      ansible.builtin.debug:\n"
            "        msg: out of range\n",
        )
        odv = load_role_odvs(role, PREFIX)["mode"]
        assert (odv.min, odv.max) == (1, 8)


class TestDiscoveredFacts:
    """A variable a task sets with set_fact (win25cis_hyperv_installed in the real 2025 role) has no default."""

    ROLE_TASKS = (
        '- name: "9.1.1 | PATCH | A rule"\n'
        "  when:\n"
        "    - win22cis_rule_9_1_1\n"
        "    - win22cis_found_out\n"
        "  ansible.windows.win_regedit:\n"
        "    path: HKLM:\\SOFTWARE\\Example\n"
        "    name: Value\n"
        "    data: 1\n"
        "    type: dword\n"
    )

    def role_with_a_fact(self, tmp_path: Path) -> Path:
        role = write_role(tmp_path, "win22cis_plain_setting: 1\n", self.ROLE_TASKS)
        (role / "tasks" / "prelim.yml").write_text(
            '- name: "PRELIM | Set the facts"\n'
            "  ansible.builtin.set_fact:\n"
            '    win22cis_found_out: "{{ something | default(false) }}"\n',
            encoding="utf-8",
        )
        return role

    def test_a_condition_on_a_fact_blocks_translation_without_failing(self, tmp_path):
        role = self.role_with_a_fact(tmp_path)
        role_odvs = load_role_odvs(role, PREFIX)
        assert "found_out" not in role_odvs
        assert role_odvs.discovered_facts == {"win22cis_found_out"}
        tasks = load_role_tasks(role)
        assert translate_registry(tasks, role_odvs, PREFIX) is None
        assert registry_blocker(tasks, role_odvs, PREFIX) == "when: win22cis_found_out"

    def test_a_variable_that_is_neither_a_default_nor_a_fact_still_fails(self, tmp_path):
        role = write_role(tmp_path, "win22cis_plain_setting: 1\n", self.ROLE_TASKS)
        role_odvs = load_role_odvs(role, PREFIX)
        with pytest.raises(UnknownRoleVariableError, match="win22cis_found_out"):
            translate_registry(load_role_tasks(role), role_odvs, PREFIX)
