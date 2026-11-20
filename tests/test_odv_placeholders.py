import json
from pathlib import Path

import pytest

from tools.odv_placeholders import PLACEHOLDER_PATTERN, display_gate_problem, malformed_placeholders, placeholder_errors

GRAMMAR_CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "odv_placeholders" / "grammar_cases.json").read_text(encoding="utf-8")
)["grammar_cases"]


def build_odv(name: str = "v", quoting: str = "unquoted", recommended="5", by_benchmark=None) -> dict:
    return {
        "name": name,
        "datatype": "string",
        "description": "d",
        "validation": None,
        "recommended": recommended,
        "by_benchmark": by_benchmark or {},
        "quoting": quoting,
    }


def build_rule(shell: str | None, odvs: list[dict]) -> dict:
    return {
        "id": "rule_1",
        "odvs": odvs,
        "check": {
            "macos": [
                {
                    "name": None,
                    "language": "bash",
                    "default": {"shell": shell},
                    "by_version": {},
                }
            ]
        },
        "remediation": None,
    }


def test_prefix_names_do_not_collide():
    names = [match.group(1) for match in PLACEHOLDER_PATTERN.finditer("$ODV_a $ODV_a_b")]
    assert names == ["a", "a_b"]


@pytest.mark.parametrize("grammar_case", GRAMMAR_CASES, ids=[grammar_case["name"] for grammar_case in GRAMMAR_CASES])
def test_shared_grammar_cases(grammar_case):
    text = grammar_case["text"]
    names = [match.group(1) for match in PLACEHOLDER_PATTERN.finditer(text)]
    assert list(dict.fromkeys(names)) == grammar_case["names"]
    assert malformed_placeholders(text) == grammar_case["malformed"]
    assert PLACEHOLDER_PATTERN.sub("[value]", text) == grammar_case["display"]


def test_bare_placeholder_reported():
    errors = placeholder_errors(build_rule("echo $ODV", [build_odv()]))
    assert any(error.startswith("rule_1") and "malformed" in error and "$ODV" in error for error in errors)


@pytest.mark.parametrize("malformed_text", ["$ODVX", "$ODV_Upper", "$ODV_", "$ODV_vX"])
def test_malformed_placeholder_reported(malformed_text):
    errors = placeholder_errors(build_rule(f"echo $ODV_v; echo {malformed_text}", [build_odv()]))
    assert any("malformed" in error and malformed_text in error for error in errors)


def test_name_followed_by_uppercase_is_neither_used_nor_quote_checked_silently():
    rule = build_rule("echo '$ODV_v'; echo $ODV_vX", [build_odv(quoting="single")])
    assert any("malformed" in error and "$ODV_vX" in error for error in placeholder_errors(rule))


def test_unknown_and_unused_names_reported():
    errors = placeholder_errors(build_rule("echo $ODV_other", [build_odv("v")]))
    assert any("$ODV_other" in error and "no declared" in error for error in errors)
    assert any("'v'" in error and "never used" in error for error in errors)


def test_single_quoted_occurrence_ok():
    rule = build_rule("x='$ODV_v'", [build_odv(quoting="single")])
    assert placeholder_errors(rule) == []


def test_single_declared_but_unquoted_reported():
    rule = build_rule("echo $ODV_v", [build_odv(quoting="single")])
    assert any("single" in error for error in placeholder_errors(rule))


def test_double_quoted_occurrence_ok():
    rule = build_rule("""$(echo "$ODV_v" | sed 's/a/b/')""", [build_odv(quoting="double")])
    assert placeholder_errors(rule) == []


def test_double_declared_inside_single_quotes_reported():
    rule = build_rule("x='$ODV_v'", [build_odv(quoting="double")])
    assert any("double" in error for error in placeholder_errors(rule))


def test_recommended_failing_gate_reported():
    rule = build_rule("x='$ODV_v'", [build_odv(quoting="single", recommended="it's")])
    assert any("recommended" in error for error in placeholder_errors(rule))


def test_by_benchmark_failing_gate_reported():
    odv = build_odv(quoting="double", by_benchmark={"cis": "a$b"})
    rule = build_rule('x="$ODV_v"', [odv])
    assert any("by_benchmark" in error for error in placeholder_errors(rule))


def test_unquoted_has_no_gate():
    assert display_gate_problem("unquoted", "it's $x \"y\"") is None
    rule = build_rule("echo $ODV_v", [build_odv(recommended="it's")])
    assert placeholder_errors(rule) == []


@pytest.mark.parametrize("typographic_quote", ["\u2018", "\u2019", "\u201a", "\u201b"])
def test_single_gate_rejects_powershell_typographic_single_quotes(typographic_quote):
    assert display_gate_problem("single", f"x{typographic_quote}; Write-Output INJECTED") is not None


@pytest.mark.parametrize("typographic_quote", ["\u201c", "\u201d", "\u201e"])
def test_double_gate_rejects_powershell_typographic_double_quotes(typographic_quote):
    assert display_gate_problem("double", f"x{typographic_quote}; Write-Output INJECTED") is not None


def test_display_gate_forbidden_characters():
    assert display_gate_problem("single", "a'b") is not None
    assert display_gate_problem("single", "a$b`c\"d") is None
    assert display_gate_problem("double", "a\\b") is not None
    assert display_gate_problem("double", "a\nb") is not None
    assert display_gate_problem("double", 5) is None


def test_duplicate_and_invalid_names_reported():
    odvs = [build_odv("v"), build_odv("v"), build_odv("Bad-Name")]
    errors = placeholder_errors(build_rule("echo $ODV_v", odvs))
    assert any("duplicate" in error for error in errors)
    assert any("invalid" in error for error in errors)


def test_unknown_quoting_reported():
    rule = build_rule("echo $ODV_v", [build_odv(quoting="weird")])
    assert any("quoting" in error for error in placeholder_errors(rule))


def test_null_check_and_null_shell_are_tolerated():
    rule = build_rule(None, [])
    rule["check"]["macos"][0]["default"] = None
    assert placeholder_errors(rule) == []
    rule["check"] = None
    assert placeholder_errors(rule) == []


def build_rule_with_script_file(script_path: str, odvs: list[dict]) -> dict:
    rule = build_rule(None, odvs)
    rule["check"]["macos"][0]["default"] = {"shell_file": script_path}
    return rule


def build_reader(script_text_by_path: dict[str, str]):
    return lambda script_path: script_text_by_path[script_path]


def test_script_file_placeholder_counts_as_used():
    rule = build_rule_with_script_file("scripts/check.sh", [build_odv()])
    assert placeholder_errors(rule, build_reader({"scripts/check.sh": "echo $ODV_v"})) == []


def test_script_file_single_quoted_ok():
    rule = build_rule_with_script_file("scripts/fix.ps1", [build_odv(quoting="single")])
    assert placeholder_errors(rule, build_reader({"scripts/fix.ps1": "$Value = '$ODV_v'"})) == []


def test_script_file_unquoted_reported():
    rule = build_rule_with_script_file("scripts/check.sh", [build_odv(quoting="single")])
    errors = placeholder_errors(rule, build_reader({"scripts/check.sh": "echo $ODV_v"}))
    assert any("scripts/check.sh" in error and "single" in error for error in errors)


def test_powershell_backtick_escape_inside_double_quotes():
    rule = build_rule_with_script_file("scripts/fix.ps1", [build_odv(quoting="double")])
    script_text = 'Write-Host "a`"b $ODV_v"'
    assert placeholder_errors(rule, build_reader({"scripts/fix.ps1": script_text})) == []


def test_unknown_script_extension_reported():
    rule = build_rule_with_script_file("scripts/check.rb", [build_odv()])
    errors = placeholder_errors(rule, build_reader({"scripts/check.rb": "puts $ODV_v"}))
    assert any("scripts/check.rb" in error and "extension" in error for error in errors)


def test_without_reader_script_files_are_ignored():
    rule = build_rule_with_script_file("scripts/check.sh", [build_odv(quoting="single")])
    errors = placeholder_errors(rule)
    assert errors == ["rule_1: ODV 'v' is declared but never used"]


def test_powershell_typographic_quote_ends_a_single_quoted_string():
    rule = build_rule_with_script_file("scripts/fix.ps1", [build_odv(quoting="single")])
    script_text = "$Setting = 'a\u2019; $ODV_v; \u2019'"
    errors = placeholder_errors(rule, build_reader({"scripts/fix.ps1": script_text}))
    assert any("outside single quotes" in error for error in errors)


def test_powershell_typographic_quotes_open_a_string():
    rule = build_rule_with_script_file("scripts/fix.ps1", [build_odv(quoting="double")])
    script_text = "Write-Host \u201ca $ODV_v\u201d"
    assert placeholder_errors(rule, build_reader({"scripts/fix.ps1": script_text})) == []


@pytest.mark.parametrize("quoting, script_text", [("single", "x = '$ODV_v'"), ("double", 'x = "$ODV_v"')])
def test_quoted_placeholder_in_python_script_reported(quoting, script_text):
    rule = build_rule_with_script_file("scripts/fix.py", [build_odv(quoting=quoting)])
    errors = placeholder_errors(rule, build_reader({"scripts/fix.py": script_text}))
    assert any("scripts/fix.py" in error and quoting in error for error in errors)


def test_unquoted_placeholder_in_python_script_ok():
    rule = build_rule_with_script_file("scripts/fix.py", [build_odv()])
    assert placeholder_errors(rule, build_reader({"scripts/fix.py": "x = $ODV_v"})) == []


def test_quoted_placeholder_in_unknown_script_extension_reported():
    rule = build_rule_with_script_file("scripts/fix.rb", [build_odv(quoting="single")])
    errors = placeholder_errors(rule, build_reader({"scripts/fix.rb": "x = '$ODV_v'"}))
    assert any("scripts/fix.rb" in error and "single" in error and "extension" not in error for error in errors)


def test_quoted_placeholder_in_inline_powershell_reported():
    rule = build_rule("$x = '$ODV_v'", [build_odv(quoting="single")])
    rule["check"]["macos"][0]["language"] = "powershell"
    assert any("single" in error for error in placeholder_errors(rule))


def test_quoted_placeholder_in_inline_zsh_ok():
    rule = build_rule("x='$ODV_v'", [build_odv(quoting="single")])
    rule["check"]["macos"][0]["language"] = "zsh"
    assert placeholder_errors(rule) == []


def test_quote_state_carries_across_lines():
    rule = build_rule("x='a\nb' ; y=$ODV_v '", [build_odv(quoting="single")])
    assert any("$ODV_v" in error for error in placeholder_errors(rule))


def test_multi_line_single_quoted_string_ok():
    rule = build_rule("x='first line\n$ODV_v\nlast line'", [build_odv(quoting="single")])
    assert placeholder_errors(rule) == []


def test_unterminated_quote_before_placeholder_reported():
    rule = build_rule("echo ok\nx='$ODV_v", [build_odv(quoting="single")])
    errors = placeholder_errors(rule)
    assert any("$ODV_v" in error and "never closed" in error for error in errors)


def test_ansi_c_quoted_placeholder_reported():
    rule = build_rule("x=$'$ODV_v'", [build_odv(quoting="single")])
    assert any("$ODV_v" in error for error in placeholder_errors(rule))


def build_script_rule(script_path: str, quoting: str) -> dict:
    rule = build_rule(None, [build_odv(quoting=quoting)])
    rule["check"]["macos"][0]["default"] = {"shell_file": script_path}
    return rule


def test_apostrophe_in_comment_does_not_open_a_quote():
    rule = build_rule("# don't\necho $ODV_v", [build_odv(quoting="single")])
    assert any("$ODV_v" in error for error in placeholder_errors(rule))


def test_placeholder_in_comment_is_error():
    rule = build_rule("echo ok # '$ODV_v'", [build_odv(quoting="single")])
    assert any("comment" in error for error in placeholder_errors(rule))


def test_hash_inside_a_word_is_not_a_bash_comment():
    rule = build_rule("echo a#b '$ODV_v'", [build_odv(quoting="single")])
    assert placeholder_errors(rule) == []


def test_hash_inside_quotes_is_not_a_comment():
    rule = build_rule("echo '# $ODV_v'", [build_odv(quoting="single")])
    assert placeholder_errors(rule) == []


def test_powershell_hash_mid_word_starts_a_comment():
    rule = build_script_rule("check.ps1", "single")
    assert placeholder_errors(rule, lambda path: "$x = 1#it's\n$y = '$ODV_v'") == []


def test_powershell_block_comment():
    rule = build_script_rule("check.ps1", "single")
    assert any("$ODV_v" in error for error in placeholder_errors(rule, lambda path: "<# it's #>\n$x = $ODV_v"))
    assert placeholder_errors(rule, lambda path: "<# it's #>\n$x = '$ODV_v'") == []


def test_heredoc_body_placeholder_is_error():
    rule = build_rule("cat <<EOF\n'$ODV_v'\nEOF", [build_odv(quoting="single")])
    assert any("heredoc" in error for error in placeholder_errors(rule))


@pytest.mark.parametrize(
    "heredoc",
    ["cat <<EOF\n'$ODV_v'\nEOF", "cat <<-EOF\n'$ODV_v'\n\tEOF", "cat <<'EOF'\n'$ODV_v'\nEOF", 'cat <<"EOF"\n\'$ODV_v\'\nEOF'],
)
def test_heredoc_forms_are_skipped_and_the_text_after_is_checked(heredoc):
    errors = placeholder_errors(build_rule(heredoc + "\nx='$ODV_v'", [build_odv(quoting="single")]))
    assert len(errors) == 1
    assert "heredoc" in errors[0]


def test_here_string_is_not_a_heredoc():
    rule = build_rule("done <<< \"$matching\"\nx='$ODV_v'", [build_odv(quoting="single")])
    assert placeholder_errors(rule) == []


def test_lone_quote_in_heredoc_does_not_open_a_quote():
    rule = build_rule("cat <<EOF\nit's\nEOF\necho $ODV_v", [build_odv(quoting="single")])
    assert any("outside single quotes" in error for error in placeholder_errors(rule))


def test_placeholder_in_command_substitution_inside_double_quotes_is_error():
    rule = build_rule("x=\"$(printf '%s' \"$ODV_v\")\"", [build_odv(quoting="double")])
    assert any("command substitution" in error for error in placeholder_errors(rule))


def test_placeholder_in_backtick_substitution_inside_double_quotes_is_error():
    rule = build_rule("x=\"`printf '%s' \"$ODV_v\"`\"", [build_odv(quoting="double")])
    assert any("command substitution" in error for error in placeholder_errors(rule))


def test_placeholder_after_substitution_inside_double_quotes_is_still_in_quotes():
    rule = build_rule('x="$(date) $ODV_v"', [build_odv(quoting="double")])
    assert placeholder_errors(rule) == []


def test_substitution_outside_double_quotes_keeps_quoted_placeholder_valid():
    rule = build_rule("login_banner_text=$(echo \"$ODV_v\" | sed 's/a/b/')", [build_odv(quoting="double")])
    assert placeholder_errors(rule) == []


def build_rule_with_payload_file(payload_path: str, odvs: list[dict]) -> dict:
    rule = build_rule(None, odvs)
    rule["remediation"] = {"windows": {"steps": [], "payloads": [{"data_file": payload_path}]}}
    return rule


def test_payload_file_placeholder_counts_as_used():
    rule = build_rule_with_payload_file("baselines/x/payload.json", [build_odv(quoting="single")])
    reader = build_reader({"baselines/x/payload.json": '{"path": $ODV_v}'})
    assert placeholder_errors(rule, reader) == []


def test_payload_file_unknown_and_malformed_placeholders_reported():
    rule = build_rule_with_payload_file("baselines/x/payload.xml", [build_odv()])
    reader = build_reader({"baselines/x/payload.xml": "<a>$ODV_v $ODV_other $ODVX</a>"})
    errors = placeholder_errors(rule, reader)
    assert any("$ODV_other" in error and "no declared" in error for error in errors)
    assert any("malformed" in error and "$ODVX" in error for error in errors)


def test_placeholder_in_case_statement_inside_double_quoted_substitution_is_error():
    rule = build_rule("x=\"$(case a in a) echo '$ODV_v';; esac)\"", [build_odv(quoting="double")])
    assert any("$ODV_v" in error for error in placeholder_errors(rule))


def test_placeholder_in_case_statement_is_error():
    rule = build_rule("case \"$x\" in\n  a) y='$ODV_v' ;;\nesac", [build_odv(quoting="single")])
    assert any("case statement" in error for error in placeholder_errors(rule))


def test_text_after_case_statement_is_checked():
    rule = build_rule("case \"$x\" in\n  a) y=1 ;;\nesac\ny='$ODV_v'", [build_odv(quoting="single")])
    assert placeholder_errors(rule) == []


def test_case_inside_a_word_is_not_a_case_statement():
    rule = build_rule("echo showcase; y='$ODV_v'", [build_odv(quoting="single")])
    assert placeholder_errors(rule) == []


def test_placeholder_after_comment_inside_double_quoted_substitution_is_error():
    rule = build_rule("x=\"$(echo a # )\n echo '$ODV_v')\"", [build_odv(quoting="double")])
    assert any("$ODV_v" in error for error in placeholder_errors(rule))


def test_placeholder_in_powershell_expandable_here_string_is_error():
    rule = build_script_rule("check.ps1", "single")
    errors = placeholder_errors(rule, lambda path: "$x = @\"\n\" '$ODV_v' \"\n\"@")
    assert any("here-string" in error for error in errors)


def test_placeholder_in_powershell_literal_here_string_is_error():
    rule = build_script_rule("check.ps1", "single")
    errors = placeholder_errors(rule, lambda path: "$x = @'\n'$ODV_v'\n'@")
    assert any("here-string" in error for error in errors)


def test_text_after_powershell_here_string_is_checked():
    rule = build_script_rule("check.ps1", "single")
    assert placeholder_errors(rule, lambda path: "$x = @\"\nit's\n\"@\n$y = '$ODV_v'") == []
    errors = placeholder_errors(rule, lambda path: "$x = @\"\nit's\n\"@\n$y = $ODV_v")
    assert any("outside single quotes" in error for error in errors)


def test_every_check_item_is_scanned_for_placeholders_and_quoting():
    rule = build_rule("echo $ODV_v", [build_odv(quoting="single")])
    second_item = {"name": "Second", "language": "bash", "default": {"shell": "echo $ODV_v"}, "by_version": {}}
    rule["check"]["macos"].append(second_item)
    errors = placeholder_errors(rule)
    assert len([error for error in errors if "single" in error]) == 2


def test_a_placeholder_used_only_in_a_second_check_item_counts_as_used():
    rule = build_rule("echo nothing", [build_odv()])
    rule["check"]["macos"].append({"name": "Second", "language": "bash", "default": {"shell": "echo $ODV_v"}, "by_version": {}})
    assert placeholder_errors(rule) == []


def test_a_script_file_in_a_second_check_item_is_read():
    rule = build_rule("echo nothing", [build_odv()])
    rule["check"]["macos"].append({"name": "Second", "language": "bash", "default": {"shell_file": "scripts/second.sh"}, "by_version": {}})
    assert placeholder_errors(rule, build_reader({"scripts/second.sh": "echo $ODV_v"})) == []
