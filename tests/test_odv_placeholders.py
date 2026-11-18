from tools.odv_placeholders import PLACEHOLDER_PATTERN, display_gate_problem, placeholder_errors


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
            "macos": {
                "language": "shell",
                "default": {"shell": shell},
                "by_version": {},
            }
        },
        "remediation": None,
    }


def test_prefix_names_do_not_collide():
    names = [match.group(1) for match in PLACEHOLDER_PATTERN.finditer("$ODV_a $ODV_a_b")]
    assert names == ["a", "a_b"]


def test_bare_placeholder_reported():
    errors = placeholder_errors(build_rule("echo $ODV", [build_odv()]))
    assert any(error.startswith("rule_1") and "bare" in error for error in errors)


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
    rule["check"]["macos"]["default"] = None
    assert placeholder_errors(rule) == []
    rule["check"] = None
    assert placeholder_errors(rule) == []
