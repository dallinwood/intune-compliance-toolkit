"""Shared rules for named organization-defined value (ODV) placeholders.

A rule declares ODVs by name and refers to each one in its text as `$ODV_<name>`.
"""

import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import PurePosixPath

NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
PLACEHOLDER_PATTERN = re.compile(r"\$ODV(?:_([a-z][a-z0-9_]*))?(?![A-Za-z0-9_])")
QUOTINGS = ("unquoted", "single", "double")

CONTROL_CHARACTERS = "\n\r\0"
FORBIDDEN_DISPLAY_CHARACTERS = {
    "single": "'" + CONTROL_CHARACTERS,
    "double": '"`$\\' + CONTROL_CHARACTERS,
}
DOUBLE_QUOTE_ESCAPE_BY_EXTENSION = {".sh": "\\", ".py": "\\", ".ps1": "`"}


def placeholder(name: str) -> str:
    return "$ODV_" + name


def display_gate_problem(quoting: str, value: str | int) -> str | None:
    forbidden_characters = FORBIDDEN_DISPLAY_CHARACTERS.get(quoting)
    if forbidden_characters is None:
        return None
    text = str(value)
    for character in forbidden_characters:
        if character in text:
            return f"value {text!r} contains {character!r}, which cannot be shown in {quoting} quotes"
    return None


def enclosing_quote_kind(line: str, position: int, double_quote_escape: str = "\\") -> str | None:
    """Return "single", "double" or None for the quotes around `position`, scanning from the line start."""
    open_quote: str | None = None
    index = 0
    while index < position:
        character = line[index]
        if open_quote == "single":
            if character == "'":
                open_quote = None
        elif character == double_quote_escape:
            index += 1
        elif open_quote == "double":
            if character == '"':
                open_quote = None
        elif character == "'":
            open_quote = "single"
        elif character == '"':
            open_quote = "double"
        index += 1
    return open_quote


def iter_strings(value) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_strings(child)


def iter_shell_texts(rule: dict) -> Iterator[str]:
    for target_check in (rule.get("check") or {}).values():
        default_check = target_check.get("default")
        if default_check and default_check.get("shell"):
            yield default_check["shell"]
        for version_check in (target_check.get("by_version") or {}).values():
            if version_check.get("shell"):
                yield version_check["shell"]
    for target_remediation in (rule.get("remediation") or {}).values():
        for step in target_remediation.get("steps") or []:
            if step.get("shell"):
                yield step["shell"]


@dataclass(frozen=True)
class ShellText:
    text: str
    description: str
    double_quote_escape: str = "\\"


def iter_script_paths(rule: dict) -> Iterator[str]:
    for target_check in (rule.get("check") or {}).values():
        default_check = target_check.get("default")
        if default_check and default_check.get("shell_file"):
            yield default_check["shell_file"]
        for version_check in (target_check.get("by_version") or {}).values():
            if version_check.get("shell_file"):
                yield version_check["shell_file"]
    for target_remediation in (rule.get("remediation") or {}).values():
        for step in target_remediation.get("steps") or []:
            if step.get("shell_file"):
                yield step["shell_file"]


def read_script_texts(rule: dict, read_script: Callable[[str], str]) -> tuple[list[ShellText], list[str]]:
    script_texts = []
    errors = []
    for script_path in dict.fromkeys(iter_script_paths(rule)):
        extension = PurePosixPath(script_path).suffix.lower()
        double_quote_escape = DOUBLE_QUOTE_ESCAPE_BY_EXTENSION.get(extension)
        if double_quote_escape is None:
            errors.append(f"{rule['id']}: script {script_path} has unsupported extension {extension!r}")
            double_quote_escape = "\\"
        script_texts.append(ShellText(read_script(script_path), f"script {script_path}", double_quote_escape))
    return script_texts, errors


def declared_name_errors(rule_id: str, odvs: list[dict]) -> list[str]:
    errors = []
    seen_names: set[str] = set()
    for odv in odvs:
        name = odv.get("name")
        if not isinstance(name, str) or not NAME_PATTERN.match(name):
            errors.append(f"{rule_id}: invalid ODV name {name!r}")
        elif name in seen_names:
            errors.append(f"{rule_id}: duplicate ODV name {name!r}")
        seen_names.add(name)
        if odv.get("quoting") not in QUOTINGS:
            errors.append(f"{rule_id}: ODV {name!r} has unknown quoting {odv.get('quoting')!r}")
    return errors


def usage_errors(rule: dict, declared_names: set[str], script_texts: list[ShellText]) -> list[str]:
    rule_id = rule["id"]
    rule_without_declarations = {key: value for key, value in rule.items() if key != "odvs"}
    errors = []
    used_names: set[str] = set()
    for text in [*iter_strings(rule_without_declarations), *(script.text for script in script_texts)]:
        for match in PLACEHOLDER_PATTERN.finditer(text):
            name = match.group(1)
            if name is None:
                errors.append(f"{rule_id}: bare $ODV placeholder; use $ODV_<name>")
            elif name in declared_names:
                used_names.add(name)
            else:
                errors.append(f"{rule_id}: {placeholder(name)} names no declared ODV")
    for name in sorted(declared_names - used_names):
        errors.append(f"{rule_id}: ODV {name!r} is declared but never used")
    return errors


def quoting_errors(rule: dict, script_texts: list[ShellText]) -> list[str]:
    rule_id = rule["id"]
    quoting_by_name = {
        odv["name"]: odv["quoting"] for odv in rule["odvs"] if odv.get("quoting") in FORBIDDEN_DISPLAY_CHARACTERS
    }
    errors = []
    inline_texts = [ShellText(shell, "") for shell in iter_shell_texts(rule)]
    for shell_text in [*inline_texts, *script_texts]:
        location = f" ({shell_text.description})" if shell_text.description else ""
        for line in shell_text.text.splitlines():
            for match in PLACEHOLDER_PATTERN.finditer(line):
                name = match.group(1)
                required_quoting = quoting_by_name.get(name)
                if required_quoting is None:
                    continue
                if enclosing_quote_kind(line, match.start(), shell_text.double_quote_escape) != required_quoting:
                    errors.append(
                        f"{rule_id}: {placeholder(name)} is declared {required_quoting} "
                        f"but appears outside {required_quoting} quotes{location} in: {line.strip()}"
                    )
    return errors


def display_value_errors(rule: dict) -> list[str]:
    rule_id = rule["id"]
    errors = []
    for odv in rule["odvs"]:
        quoting = odv.get("quoting")
        if quoting not in FORBIDDEN_DISPLAY_CHARACTERS:
            continue
        values = {"recommended": odv.get("recommended")}
        for benchmark, value in (odv.get("by_benchmark") or {}).items():
            values[f"by_benchmark[{benchmark}]"] = value
        for source, value in values.items():
            if value is None:
                continue
            problem = display_gate_problem(quoting, value)
            if problem:
                errors.append(f"{rule_id}: ODV {odv.get('name')!r} {source}: {problem}")
    return errors


def placeholder_errors(rule: dict, read_script: Callable[[str], str] | None = None) -> list[str]:
    odvs = rule.get("odvs") or []
    declared_names = {odv["name"] for odv in odvs if isinstance(odv.get("name"), str)}
    script_texts, script_errors = read_script_texts(rule, read_script) if read_script else ([], [])
    return (
        declared_name_errors(rule["id"], odvs)
        + script_errors
        + usage_errors(rule, declared_names, script_texts)
        + quoting_errors({**rule, "odvs": odvs}, script_texts)
        + display_value_errors({**rule, "odvs": odvs})
    )
