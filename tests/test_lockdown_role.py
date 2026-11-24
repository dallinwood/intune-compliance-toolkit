"""Tests for tools/lockdown_role.py.

The fixture role under tests/fixtures/lockdown/role/ holds verbatim excerpts of the real
ansible-lockdown Windows-2022-CIS role (MIT, see the LICENSE beside them). A few cases have no
real task in any of the four roles (QWORD, expandable string, binary, an empty value name, a
filtered or arithmetic Jinja value, a task that mixes win_regedit with win_shell); those build a
RoleTask by hand, or change a real one, and say so.
"""

from dataclasses import replace
from pathlib import Path

import pytest
import yaml

from tools.lockdown_role import (
    RoleParseError,
    RoleTask,
    UnknownRoleVariableError,
    group_by_rule,
    load_role_odvs,
    load_role_tasks,
    parse_task_name,
    registry_blocker,
    registry_number_bounds,
    translate_registry,
)

ROLE_DIR = Path(__file__).parent / "fixtures" / "lockdown" / "role"
PREFIX = "win22cis"


@pytest.fixture(scope="module")
def role_tasks() -> list[RoleTask]:
    return load_role_tasks(ROLE_DIR)


@pytest.fixture(scope="module")
def tasks_by_rule(role_tasks) -> dict[str, list[RoleTask]]:
    return group_by_rule(role_tasks)


@pytest.fixture(scope="module")
def odvs():
    return load_role_odvs(ROLE_DIR, PREFIX)


def hand_built_registry_task(arguments: dict, **overrides) -> RoleTask:
    """A win_regedit task for a case that no real role task covers."""
    fields = dict(
        rule_id="9.9.9",
        verb="PATCH",
        title="A synthetic registry task",
        step=None,
        applicability=None,
        name="9.9.9 | PATCH | A synthetic registry task",
        module="win_regedit",
        args={"path": "HKLM:\\SOFTWARE\\Example", "name": "Value", **arguments},
        when=["win22cis_rule_9_9_9"],
        loop=None,
        tags=[],
        source_yaml="",
        rule_yaml="",
        file=Path("tasks/section_9/synthetic.yml"),
    )
    return RoleTask(**{**fields, **overrides})


def translate_one(task: RoleTask, odvs) -> list[dict] | None:
    return translate_registry([task], odvs, PREFIX)


class TestTaskNames:
    def test_plain_rule_name(self):
        parsed = parse_task_name("18.4.7 | PATCH | Ensure WDigest Authentication is set to Disabled")
        assert (parsed.rule_id, parsed.verb, parsed.title) == (
            "18.4.7",
            "PATCH",
            "Ensure WDigest Authentication is set to Disabled",
        )
        assert parsed.step is None and parsed.applicability is None

    def test_sub_task_name_keeps_the_step_apart_from_the_title(self):
        parsed = parse_task_name(
            "1.2.2 | AUDIT | Ensure Account lockout threshold is set to 5 or fewer invalid logon attempt(s), "
            "but not 0 | Set warning count"
        )
        assert parsed.verb == "AUDIT"
        assert parsed.title.endswith("but not 0")
        assert parsed.step == "Set warning count"

    def test_member_server_suffix_becomes_applicability_not_title(self):
        parsed = parse_task_name(
            "2.3.7.6 | PATCH | Ensure Interactive logon Number of previous logons to cache is set to 4 or fewer "
            "logons MS only | Member Server"
        )
        assert parsed.title.endswith("4 or fewer logons")
        assert parsed.applicability == "Member Server"
        assert parsed.step is None

    def test_domain_controller_suffix_on_a_sub_task(self):
        parsed = parse_task_name(
            "17.2.2 | PATCH | Ensure Audit Computer Account Management is set to include Success DC only | "
            "Enable Success for Computer Account Management | Domain Controller"
        )
        assert parsed.title.endswith("include Success")
        assert parsed.applicability == "Domain Controller"
        assert parsed.step == "Enable Success for Computer Account Management"

    def test_upstream_typos_in_the_separators_still_parse(self):
        assert parse_task_name("18.5.12 | PATCH |Ensure MSS: (WarningLevel) is set").title == (
            "Ensure MSS: (WarningLevel) is set"
        )
        assert parse_task_name("18.10.42.6.1.1  | PATCH | Ensure ASR rules").rule_id == "18.10.42.6.1.1"
        assert parse_task_name("18.9.25.7 | AUDIT Ensure Post-authentication actions").verb == "AUDIT"

    def test_names_without_a_rule_id_are_not_rules(self):
        assert parse_task_name("SECTION | 1.1 | Password Policy") is None
        assert parse_task_name("AUDIT | Obtain Current Interactive User Hives") is None


class TestLoadRoleTasks:
    def test_tasks_follow_the_order_the_role_runs_them(self, role_tasks):
        first_seen = list(dict.fromkeys(task.rule_id for task in role_tasks))
        assert first_seen[:5] == ["1.1.1", "1.2.2", "1.2.1", "2.2.2", "2.3.7.5"]
        assert first_seen.index("5.1") < first_seen.index("17.1.1") < first_seen.index("18.4.2")
        assert first_seen[-1] == "19.5.1.1"

    def test_leaf_tasks_carry_module_arguments_and_the_short_module_name(self, tasks_by_rule):
        (wdigest,) = tasks_by_rule["18.4.7"]
        assert wdigest.module == "win_regedit"
        assert wdigest.args == {
            "path": "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\Wdigest",
            "value": "UseLogonCredential",
            "data": 0,
            "datatype": "dword",
        }
        assert wdigest.file == Path("tasks/section_18/section_18.4.yml")

    def test_block_tasks_inherit_the_blocks_conditions_and_tags(self, tasks_by_rule):
        set_variable = next(task for task in tasks_by_rule["1.2.2"] if task.step == "Set Variable")
        assert set_variable.verb == "PATCH"
        assert set_variable.when == [
            "win22cis_rule_1_2_2",
            "not prelim_win22cis_account_policy_is_domain_scoped",
            "win22cis_bad_login_lockout_count <= 5",
            "win22cis_bad_login_lockout_count > 0",
        ]
        assert "level1-memberserver" in set_variable.tags and "rule_1.2.2" in set_variable.tags

    def test_warning_sub_tasks_are_kept_with_their_verb(self, tasks_by_rule):
        verbs = [(task.verb, task.module) for task in tasks_by_rule["1.2.2"]]
        assert verbs == [("PATCH", "win_security_policy"), ("AUDIT", "debug"), ("AUDIT", "import_tasks")]

    def test_a_multi_line_when_is_one_string(self, tasks_by_rule):
        warning = next(task for task in tasks_by_rule["1.2.2"] if task.module == "debug")
        assert warning.when[-1] == "win22cis_bad_login_lockout_count > 5 or win22cis_bad_login_lockout_count == 0"

    def test_loop_is_kept_as_written(self, tasks_by_rule):
        (toast,) = tasks_by_rule["19.5.1.1"]
        assert toast.loop == "{{ prelim_hku_loaded_list }}"
        (reduction_rules,) = tasks_by_rule["18.10.43.6.1.2"]
        assert isinstance(reduction_rules.loop, list)

    def test_title_and_applicability_come_from_the_task_name(self, tasks_by_rule):
        (domain_controller_rule,) = tasks_by_rule["2.2.2"]
        assert domain_controller_rule.applicability == "Domain Controller"
        assert not domain_controller_rule.title.endswith("DC only")

    def test_a_task_file_that_is_not_yaml_fails_loudly(self, tmp_path):
        section_dir = tmp_path / "tasks" / "section_1"
        section_dir.mkdir(parents=True)
        (section_dir / "section_1.1.x.yml").write_text("- name: [unclosed\n", encoding="utf-8")
        with pytest.raises(RoleParseError, match="section_1.1.x.yml"):
            load_role_tasks(tmp_path)

    def test_windows_line_endings_do_not_change_the_found_text(self, tmp_path):
        section_dir = tmp_path / "tasks" / "section_1"
        section_dir.mkdir(parents=True)
        task_text = '- name: "1.1.1 | PATCH | A rule"\r\n  ansible.windows.win_regedit:\r\n    path: HKLM:\\A\r\n'
        (section_dir / "section_1.1.x.yml").write_bytes(("---\r\n\r\n" + task_text + "\r\n").encode("utf-8"))
        (task,) = load_role_tasks(tmp_path)
        assert task.source_yaml == task_text

    def test_section_files_that_main_does_not_import_are_still_read(self, tmp_path):
        section_dir = tmp_path / "tasks" / "section_1"
        section_dir.mkdir(parents=True)
        (section_dir / "section_1.1.x.yml").write_text(
            '- name: "1.1.1 | PATCH | A rule"\n  ansible.windows.win_regedit:\n    path: HKLM:\\A\n',
            encoding="utf-8",
        )
        assert [task.rule_id for task in load_role_tasks(tmp_path)] == ["1.1.1"]


class TestSourceYaml:
    def test_top_level_task_text_is_the_file_text_verbatim(self, tasks_by_rule):
        (toast,) = tasks_by_rule["19.5.1.1"]
        file_text = (ROLE_DIR / toast.file).read_bytes().decode("utf-8")
        assert file_text == "---\n\n" + toast.source_yaml
        assert toast.rule_yaml == toast.source_yaml
        assert toast.source_yaml.startswith('- name: "19.5.1.1 | PATCH |')

    def test_nested_task_text_is_its_own_lines_and_rule_yaml_is_the_whole_block(self, tasks_by_rule):
        retrieve = next(task for task in tasks_by_rule["5.1"] if task.module == "win_service")
        assert retrieve.source_yaml.startswith('    - name: "5.1 | PATCH |')
        assert retrieve.source_yaml.rstrip().endswith("state: stopped")
        assert yaml.safe_load(retrieve.source_yaml)[0]["ansible.windows.win_service"]["name"] == "Spooler"
        assert retrieve.rule_yaml.startswith('- name: "5.1 | PATCH |')
        assert retrieve.source_yaml in retrieve.rule_yaml

    def test_text_keeps_upstream_quoting_and_backslashes(self, tasks_by_rule):
        (alias,) = tasks_by_rule["18.4.7"]
        assert "path: HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\Wdigest" in alias.source_yaml
        (shell_rule,) = [task for task in tasks_by_rule["17.1.1"] if task.module == "win_shell" and task.verb == "AUDIT"]
        assert "AuditPol /get" in shell_rule.source_yaml

    def test_trailing_blank_and_comment_lines_are_not_part_of_a_task(self, tasks_by_rule):
        for task in tasks_by_rule["1.2.1"]:
            assert not task.source_yaml.endswith("\n\n")
            assert not task.source_yaml.rstrip().splitlines()[-1].lstrip().startswith("#")


class TestGroupByRule:
    def test_order_of_first_appearance_is_kept(self, tasks_by_rule):
        keys = list(tasks_by_rule)
        assert keys[:3] == ["1.1.1", "1.2.2", "1.2.1"]

    def test_the_duplicate_rule_id_merges_into_one_rule(self, tasks_by_rule, role_tasks):
        merged = tasks_by_rule["1.2.1"]
        assert sum(task.rule_id == "1.2.1" for task in role_tasks) == len(merged)
        patch_steps = [task.step for task in merged if task.verb == "PATCH"]
        assert patch_steps == ["Lower the reset counter so the duration can be applied", "Set Variable"]
        assert {task.file for task in merged} == {Path("tasks/section_1/section_1.2.x.yml")}

    def test_merged_tasks_keep_upstream_order(self, tasks_by_rule):
        steps = [task.step for task in tasks_by_rule["1.2.1"]]
        assert steps.index("Read the lockout policy as 1.2.2 left it") < steps.index("Set Variable")


class TestOdvs:
    def test_every_value_variable_is_an_odv_but_toggles_are_not(self, odvs):
        assert list(odvs) == [
            "ngws",
            "max_passwords_saved",
            "account_lockout_duration",
            "bad_login_lockout_count",
            "account_lockout_counter_reset",
            "legal_notice_caption",
            "cached_logons_count",
            "idle_rdp_session_disconnect_time",
            "domain_firewall_log_size",
        ]

    def test_description_rule_and_default(self, odvs):
        odv = odvs["max_passwords_saved"]
        assert odv.rule_id == "1.1.1"
        assert odv.default == 24
        assert odv.datatype == "number"
        assert odv.description.startswith("win22cis_max_passwords_saved is the variable used to dictate")
        assert "Default:" not in odv.description
        assert odv.description.endswith("for that reason.")

    def test_a_variable_with_no_rule_line_still_has_prose(self, odvs):
        odv = odvs["ngws"]
        assert odv.rule_id is None
        assert odv.default is False and odv.datatype == "boolean"
        assert odv.description.startswith("Next Generation Windows Security (NGWS) is an optional CIS profile")

    def test_string_default(self, odvs):
        assert odvs["legal_notice_caption"].default == "DoD Notice and Consent Banner"
        assert odvs["legal_notice_caption"].datatype == "string"

    def test_range_from_the_rules_range_checks(self, odvs):
        rdp = odvs["idle_rdp_session_disconnect_time"]
        assert (rdp.min, rdp.max) == (1, 900000)
        cached = odvs["cached_logons_count"]
        assert (cached.min, cached.max) == (None, 4)
        assert (odvs["account_lockout_duration"].min, odvs["account_lockout_duration"].max) == (15, None)

    def test_an_exact_value_check_is_a_degenerate_range(self, odvs):
        assert (odvs["max_passwords_saved"].min, odvs["max_passwords_saved"].max) == (24, 24)

    def test_a_variable_no_task_checks_has_no_range(self, odvs):
        firewall = odvs["domain_firewall_log_size"]
        assert (firewall.min, firewall.max) == (None, None)

    def test_audit_warning_conditions_do_not_set_the_range(self, odvs):
        lockout = odvs["bad_login_lockout_count"]
        assert (lockout.min, lockout.max) == (1, 5)

    def test_number_bounds_for_registry_data_are_clamped_to_the_type(self, odvs):
        assert registry_number_bounds(odvs["idle_rdp_session_disconnect_time"], "REG_DWORD") == (1, 900000)
        assert registry_number_bounds(odvs["domain_firewall_log_size"], "REG_DWORD") == (0, 2**32 - 1)
        assert registry_number_bounds(odvs["domain_firewall_log_size"], "REG_QWORD") == (0, 2**64 - 1)
        unbounded_above = odvs["account_lockout_duration"]
        assert registry_number_bounds(unbounded_above, "REG_DWORD") == (15, 2**32 - 1)

    def test_a_role_without_defaults_fails_loudly(self, tmp_path):
        with pytest.raises(RoleParseError, match="defaults"):
            load_role_odvs(tmp_path, PREFIX)


class TestRegistryTypes:
    def test_dword_literal_from_a_real_task(self, tasks_by_rule, odvs):
        assert translate_registry(tasks_by_rule["18.4.2"], odvs, PREFIX) == [
            {
                "hive": "HKLM",
                "path": "SYSTEM\\CurrentControlSet\\Services\\mrxsmb10",
                "value_name": "Start",
                "type": "REG_DWORD",
                "data": 4,
                "state": "present",
            }
        ]

    def test_value_and_datatype_are_aliases_of_name_and_type(self, tasks_by_rule, odvs):
        (setting,) = translate_registry(tasks_by_rule["18.4.7"], odvs, PREFIX)
        assert (setting["value_name"], setting["type"], setting["data"]) == ("UseLogonCredential", "REG_DWORD", 0)

    def test_string_type_with_quoted_number_data_stays_text(self, tasks_by_rule, odvs):
        (setting,) = translate_registry(tasks_by_rule["18.10.26.1.1"], odvs, PREFIX)
        assert (setting["type"], setting["data"]) == ("REG_SZ", "0")

    def test_multistring_list(self, tasks_by_rule, odvs):
        domain_controller_only = frozenset({"prelim_win22cis_is_domain_controller"})
        (setting,) = translate_registry(tasks_by_rule["2.3.10.6"], odvs, PREFIX, domain_controller_only)
        assert setting["type"] == "REG_MULTI_SZ"
        assert setting["data"] == ["LSARPC", "NETLOGON", "SAMR"]

    def test_qword_expandstring_and_binary_hand_built(self, odvs):
        qword = translate_one(hand_built_registry_task({"data": 5000000000, "type": "qword"}), odvs)
        assert (qword[0]["type"], qword[0]["data"]) == ("REG_QWORD", 5000000000)
        expandable = translate_one(
            hand_built_registry_task({"data": "%SystemRoot%\\System32", "type": "expandstring"}), odvs
        )
        assert (expandable[0]["type"], expandable[0]["data"]) == ("REG_EXPAND_SZ", "%SystemRoot%\\System32")
        binary = translate_one(hand_built_registry_task({"data": [1, 255, 16], "type": "binary"}), odvs)
        assert (binary[0]["type"], binary[0]["data"]) == ("REG_BINARY", "01ff10")

    def test_missing_type_defaults_to_string_as_the_module_does(self, odvs):
        (setting,) = translate_one(hand_built_registry_task({"data": "text"}), odvs)
        assert setting["type"] == "REG_SZ"

    def test_numeric_string_data_for_a_dword_becomes_a_number(self, odvs):
        (setting,) = translate_one(hand_built_registry_task({"data": "2", "type": "dword"}), odvs)
        assert setting["data"] == 2

    def test_dword_data_out_of_range_is_not_translatable(self, odvs):
        assert translate_one(hand_built_registry_task({"data": -1, "type": "dword"}), odvs) is None
        assert translate_one(hand_built_registry_task({"data": 2**32, "type": "dword"}), odvs) is None

    def test_text_that_the_schema_cannot_hold_is_not_translatable(self, odvs):
        assert translate_one(hand_built_registry_task({"data": "line one\nline two", "type": "string"}), odvs) is None

    def test_data_missing_is_not_translatable(self, odvs):
        assert translate_one(hand_built_registry_task({"type": "dword"}), odvs) is None


class TestAbsentAndValueNames:
    def test_state_absent_with_a_value_name(self, tasks_by_rule, odvs):
        assert translate_registry(tasks_by_rule["18.9.19.7"], odvs, PREFIX) == [
            {
                "hive": "HKLM",
                "path": "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
                "value_name": "DisableBkGndGroupPolicy",
                "type": None,
                "data": None,
                "state": "absent",
            }
        ]

    def test_a_missing_or_empty_value_name_is_the_default_value(self, odvs):
        without_name = hand_built_registry_task({"data": "x", "type": "string"})
        del without_name.args["name"]
        assert translate_one(without_name, odvs)[0]["value_name"] == ""
        assert translate_one(hand_built_registry_task({"name": "", "data": "x", "type": "string"}), odvs)[0][
            "value_name"
        ] == ""

    def test_absent_without_a_name_deletes_the_key_which_is_not_a_value(self, odvs):
        key_deletion = hand_built_registry_task({"state": "absent", "delete_key": True})
        del key_deletion.args["name"]
        assert translate_one(key_deletion, odvs) is None
        default_value_only = hand_built_registry_task({"state": "absent", "delete_key": False})
        del default_value_only.args["name"]
        assert translate_one(default_value_only, odvs)[0]["value_name"] == ""

    def test_a_value_name_that_is_jinja_is_not_translatable(self, odvs):
        assert translate_one(hand_built_registry_task({"name": "{{ item }}", "data": 1, "type": "dword"}), odvs) is None


class TestHives:
    def test_per_user_hku_loop_becomes_hkcu(self, tasks_by_rule, odvs):
        assert translate_registry(tasks_by_rule["19.5.1.1"], odvs, PREFIX) == [
            {
                "hive": "HKCU",
                "path": "SOFTWARE\\Policies\\Microsoft\\Windows\\CurrentVersion\\Pushnotifications",
                "value_name": "NoToastApplicationNotificationOnLockScreen",
                "type": "REG_DWORD",
                "data": 1,
                "state": "present",
            }
        ]

    def test_other_hive_drives(self, odvs):
        for drive, hive in (("HKCU", "HKCU"), ("HKCR", "HKCR"), ("HKU", "HKU")):
            task = hand_built_registry_task({"path": f"{drive}:\\Software\\Example", "data": 1, "type": "dword"})
            assert translate_one(task, odvs)[0]["hive"] == hive

    def test_a_loop_over_a_literal_list_is_not_the_per_user_loop(self, tasks_by_rule, odvs):
        assert translate_registry(tasks_by_rule["18.10.43.6.1.2"], odvs, PREFIX) is None

    def test_a_path_with_jinja_outside_the_per_user_loop_is_not_translatable(self, odvs):
        task = hand_built_registry_task({"path": "HKU:\\{{ item }}\\Software\\Example", "data": 1, "type": "dword"})
        assert translate_one(task, odvs) is None

    def test_a_path_that_is_not_a_registry_drive_is_not_translatable(self, odvs):
        task = hand_built_registry_task({"path": "C:\\Windows", "data": 1, "type": "dword"})
        assert translate_one(task, odvs) is None


class TestOdvValues:
    def test_a_single_variable_number_value_becomes_an_odv_placeholder(self, tasks_by_rule, odvs):
        (setting,) = translate_registry(tasks_by_rule["18.10.57.3.10.1"], odvs, PREFIX)
        assert setting["type"] == "REG_DWORD"
        assert setting["data"] == "$ODV_idle_rdp_session_disconnect_time"

    def test_a_single_variable_string_value_becomes_an_odv_placeholder(self, tasks_by_rule, odvs):
        (setting,) = translate_registry(tasks_by_rule["2.3.7.5"], odvs, PREFIX)
        assert (setting["type"], setting["data"]) == ("REG_SZ", "$ODV_legal_notice_caption")

    def test_a_number_variable_written_as_text_does_not_fit_and_is_not_translatable(self, tasks_by_rule, odvs):
        member_server_only = frozenset({"prelim_win22cis_is_domain_member"})
        assert translate_registry(tasks_by_rule["2.3.7.6"], odvs, PREFIX, member_server_only) is None
        assert registry_blocker(tasks_by_rule["2.3.7.6"], odvs, PREFIX, member_server_only) == (
            "number variable cached_logons_count does not fit REG_SZ"
        )

    def test_arithmetic_jinja_is_not_a_registry_item(self, odvs):
        task = hand_built_registry_task(
            {"data": "{{ win22cis_idle_rdp_session_disconnect_time * 1000 }}", "type": "dword"}
        )
        assert translate_one(task, odvs) is None

    def test_a_filtered_value_is_not_a_registry_item(self, odvs):
        task = hand_built_registry_task({"data": "{{ win22cis_cached_logons_count | int }}", "type": "dword"})
        assert translate_one(task, odvs) is None

    def test_a_conditional_expression_is_not_a_registry_item(self, odvs):
        task = hand_built_registry_task(
            {"data": '{{ 1 if win22cis_ngws else 0 }}', "type": "dword"},
        )
        assert translate_one(task, odvs) is None

    def test_text_mixing_literal_and_jinja_is_not_a_registry_item(self, odvs):
        task = hand_built_registry_task({"data": "prefix {{ win22cis_legal_notice_caption }}", "type": "string"})
        assert translate_one(task, odvs) is None

    def test_a_single_variable_that_is_not_a_role_default_is_not_translatable(self, tasks_by_rule, odvs):
        domain_controller_only = frozenset({"prelim_win22cis_is_domain_controller"})
        assert translate_registry(tasks_by_rule["2.3.10.9"], odvs, PREFIX, domain_controller_only) is None
        assert registry_blocker(tasks_by_rule["2.3.10.9"], odvs, PREFIX, domain_controller_only).startswith(
            "data is Jinja other than one role variable"
        )

    def test_a_boolean_variable_does_not_fit_dword_data(self, odvs):
        task = hand_built_registry_task({"data": "{{ win22cis_ngws }}", "type": "dword"})
        assert translate_one(task, odvs) is None

    def test_a_variable_the_defaults_lack_raises(self, tasks_by_rule, odvs):
        with pytest.raises(UnknownRoleVariableError, match="win22cis_netbt_nodetype"):
            translate_registry(tasks_by_rule["18.4.6"], odvs, PREFIX)

    def test_an_unknown_variable_in_data_raises_even_without_a_when(self, odvs):
        task = hand_built_registry_task({"data": "{{ win22cis_missing_value }}", "type": "dword"})
        with pytest.raises(UnknownRoleVariableError, match="win22cis_missing_value"):
            translate_one(task, odvs)


class TestWhichRulesAreRegistryOnly:
    def test_a_rule_that_also_runs_win_shell_is_not_a_registry_item(self, tasks_by_rule, odvs):
        registry_task = tasks_by_rule["18.4.2"][0]
        shell_task = next(task for task in tasks_by_rule["17.1.1"] if task.module == "win_shell" and task.verb == "PATCH")
        mixed = [registry_task, replace(shell_task, rule_id=registry_task.rule_id)]
        assert translate_registry(mixed, odvs, PREFIX) is None
        assert registry_blocker(mixed, odvs, PREFIX) == "primary write is win_shell"

    def test_a_rule_that_also_changes_a_service_is_not_a_registry_item(self, tasks_by_rule, odvs):
        assert translate_registry(tasks_by_rule["5.1"], odvs, PREFIX) is None
        assert registry_blocker(tasks_by_rule["5.1"], odvs, PREFIX) == "primary write is win_service"

    def test_win_shell_only_rules_are_not_registry_items(self, tasks_by_rule, odvs):
        assert translate_registry(tasks_by_rule["17.1.1"], odvs, PREFIX) is None

    def test_other_modules_are_not_registry_items(self, tasks_by_rule, odvs):
        assert translate_registry(tasks_by_rule["1.1.1"], odvs, PREFIX) is None
        assert translate_registry(tasks_by_rule["2.2.2"], odvs, PREFIX) is None

    def test_audit_tasks_are_not_primary_writes(self, tasks_by_rule, odvs):
        audit_only = [task for task in tasks_by_rule["1.2.2"] if task.verb == "AUDIT"]
        assert registry_blocker(audit_only, odvs, PREFIX) == "no primary write"

    def test_read_only_helper_tasks_do_not_block_a_registry_rule(self, tasks_by_rule, odvs):
        registry_task = tasks_by_rule["18.4.2"][0]
        helper = replace(tasks_by_rule["5.1"][0], rule_id=registry_task.rule_id)
        assert helper.module == "win_service_info"
        assert translate_registry([helper, registry_task], odvs, PREFIX) is not None

    def test_several_registry_writes_become_several_settings_in_order(self, tasks_by_rule, odvs):
        first = tasks_by_rule["18.4.2"][0]
        second = replace(tasks_by_rule["18.4.7"][0], rule_id=first.rule_id, when=first.when)
        names = [setting["value_name"] for setting in translate_registry([first, second], odvs, PREFIX)]
        assert names == ["Start", "UseLogonCredential"]

    def test_a_condition_beyond_toggle_and_range_checks_is_not_translatable(self, tasks_by_rule, odvs):
        gated = replace(
            tasks_by_rule["18.4.2"][0],
            when=["win22cis_rule_18_4_2", "prelim_win22cis_is_domain_controller"],
        )
        assert translate_registry([gated], odvs, PREFIX) is None
        assert registry_blocker([gated], odvs, PREFIX) == "when: prelim_win22cis_is_domain_controller"

    def test_a_listed_condition_can_be_tolerated(self, tasks_by_rule, odvs):
        gated = replace(
            tasks_by_rule["18.4.2"][0],
            when=["win22cis_rule_18_4_2", "prelim_win22cis_is_domain_controller"],
        )
        tolerated = frozenset({"prelim_win22cis_is_domain_controller"})
        assert translate_registry([gated], odvs, PREFIX, tolerated_conditions=tolerated) is not None

    def test_range_checks_on_odvs_are_allowed_in_any_arrangement(self, odvs):
        for condition in (
            "win22cis_cached_logons_count <= 4",
            "win22cis_cached_logons_count == 1 or win22cis_cached_logons_count == 2",
            "win22cis_cached_logons_count in [1, 2, 4, 8]",
            "win22cis_cached_logons_count | int >= 1",
            "(win22cis_cached_logons_count > 0 and win22cis_cached_logons_count <= 4)",
        ):
            task = hand_built_registry_task(
                {"data": 1, "type": "dword"}, when=["win22cis_rule_9_9_9", condition]
            )
            assert translate_one(task, odvs) is not None, condition

    def test_a_comparison_on_something_that_is_not_a_role_variable_is_not_a_range_check(self, odvs):
        for condition in ("discovered_value > 3", "win22cis_cached_logons_count > discovered_value"):
            task = hand_built_registry_task({"data": 1, "type": "dword"}, when=["win22cis_rule_9_9_9", condition])
            assert translate_one(task, odvs) is None, condition

    def test_a_flag_variable_is_not_a_range_check(self, odvs):
        task = hand_built_registry_task({"data": 1, "type": "dword"}, when=["win22cis_rule_9_9_9", "win22cis_ngws"])
        assert translate_one(task, odvs) is None

    def test_a_unknown_variable_in_a_condition_raises(self, odvs):
        task = hand_built_registry_task(
            {"data": 1, "type": "dword"}, when=["win22cis_rule_9_9_9", "win22cis_missing_value > 3"]
        )
        with pytest.raises(UnknownRoleVariableError, match="win22cis_missing_value"):
            translate_one(task, odvs)

    def test_the_toggle_of_a_different_rule_is_not_this_rules_toggle(self, odvs):
        task = hand_built_registry_task({"data": 1, "type": "dword"}, when=["win22cis_rule_1_1_1"])
        assert translate_one(task, odvs) is None

    def test_translatable_result_has_the_schema_field_order(self, tasks_by_rule, odvs):
        (setting,) = translate_registry(tasks_by_rule["18.4.2"], odvs, PREFIX)
        assert list(setting) == ["hive", "path", "value_name", "type", "data", "state"]
