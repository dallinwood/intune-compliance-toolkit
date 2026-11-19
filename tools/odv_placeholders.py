"""Shared rules for named organization-defined value (ODV) placeholders.

A rule declares ODVs by name and refers to each one in its text as `$ODV_<name>`.
The web UI repeats the grammar in webui/src/logic/odv.ts, and both sides are
pinned by tests/fixtures/odv_placeholders/grammar_cases.json.
"""

import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import PurePosixPath

NAME_PATTERN = re.compile(r"[a-z][a-z0-9_]*")
# A placeholder must not run on into another name character, so $ODV_vX is
# malformed rather than $ODV_v followed by X.
PLACEHOLDER_PATTERN = re.compile(r"\$ODV_([a-z][a-z0-9_]*)(?![A-Za-z0-9_])")
# Every $ODV occurrence, well formed or not, with the name characters after it.
ODV_OCCURRENCE_PATTERN = re.compile(r"\$ODV[A-Za-z0-9_]*")
QUOTINGS = ("unquoted", "single", "double")

# PowerShell also opens and closes strings with these typographic quotes.
TYPOGRAPHIC_SINGLE_QUOTES = "\u2018\u2019\u201a\u201b"
TYPOGRAPHIC_DOUBLE_QUOTES = "\u201c\u201d\u201e"
CONTROL_CHARACTERS = "\n\r\0"
FORBIDDEN_DISPLAY_CHARACTERS = {
    "single": "'" + TYPOGRAPHIC_SINGLE_QUOTES + CONTROL_CHARACTERS,
    "double": '"' + TYPOGRAPHIC_DOUBLE_QUOTES + "`$\\" + CONTROL_CHARACTERS,
}


@dataclass(frozen=True)
class QuoteDialect:
    single_quotes: str
    double_quotes: str
    escape: str
    has_ansi_c_quotes: bool


BASH = QuoteDialect(single_quotes="'", double_quotes='"', escape="\\", has_ansi_c_quotes=True)
POWERSHELL = QuoteDialect(
    single_quotes="'" + TYPOGRAPHIC_SINGLE_QUOTES,
    double_quotes='"' + TYPOGRAPHIC_DOUBLE_QUOTES,
    escape="`",
    has_ansi_c_quotes=False,
)
# Quoted ODVs are supported only where the quoting scan matches the
# interpreter. Python is left out: its strings process backslash escapes and
# f-string braces, which the single and double gates do not keep out.
QUOTE_DIALECT_BY_SCRIPT_EXTENSION = {".sh": BASH, ".ps1": POWERSHELL}
QUOTE_DIALECT_BY_INLINE_LANGUAGE = {"bash": BASH, "zsh": BASH}
SCRIPT_EXTENSIONS = (".sh", ".ps1", ".py")

ANSI_C_QUOTE = "ansi-c"


def placeholder(name: str) -> str:
    return "$ODV_" + name


def malformed_placeholders(text: str) -> list[str]:
    """Every $ODV occurrence that is not exactly $ODV_<name>, in order."""
    return [
        occurrence.group(0)
        for occurrence in ODV_OCCURRENCE_PATTERN.finditer(text)
        if not PLACEHOLDER_PATTERN.fullmatch(occurrence.group(0))
    ]


def display_gate_problem(quoting: str, value: str | int) -> str | None:
    forbidden_characters = FORBIDDEN_DISPLAY_CHARACTERS.get(quoting)
    if forbidden_characters is None:
        return None
    text = str(value)
    for character in forbidden_characters:
        if character in text:
            return f"value {text!r} contains {character!r}, which cannot be shown in {quoting} quotes"
    return None


@dataclass(frozen=True)
class QuoteScan:
    # The quote open just before each character: "single", "double", ANSI_C_QUOTE or None.
    quote_before: list[str | None]
    # Where the quote still open at the end of the text was opened, or None when every quote closes.
    unclosed_quote_start: int | None


def scan_quotes(text: str, dialect: QuoteDialect) -> QuoteScan:
    """Track quoting across the whole text, as the shell does, so a quote may span lines."""
    quote_before: list[str | None] = []
    open_quote: str | None = None
    open_quote_start = 0
    index = 0
    while index < len(text):
        character = text[index]
        quote_before.append(open_quote)
        skips_next_character = False
        if open_quote == "single":
            if character in dialect.single_quotes:
                open_quote = None
        elif open_quote == ANSI_C_QUOTE:
            if character == "\\":
                skips_next_character = True
            elif character == "'":
                open_quote = None
        elif character == dialect.escape:
            skips_next_character = True
        elif open_quote == "double":
            if character in dialect.double_quotes:
                open_quote = None
        elif dialect.has_ansi_c_quotes and character == "$" and text.startswith("'", index + 1):
            open_quote, open_quote_start = ANSI_C_QUOTE, index
            skips_next_character = True
        elif character in dialect.single_quotes:
            open_quote, open_quote_start = "single", index
        elif character in dialect.double_quotes:
            open_quote, open_quote_start = "double", index
        if skips_next_character and index + 1 < len(text):
            index += 1
            quote_before.append(open_quote)
        index += 1
    return QuoteScan(quote_before, open_quote_start if open_quote is not None else None)


def line_at(text: str, position: int) -> str:
    line_start = text.rfind("\n", 0, position) + 1
    line_end = text.find("\n", position)
    return text[line_start:] if line_end == -1 else text[line_start:line_end]


def iter_strings(value) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_strings(child)


@dataclass(frozen=True)
class ShellText:
    text: str
    description: str
    # None where quoted placeholders are not supported.
    quote_dialect: QuoteDialect | None


def iter_inline_shell_texts(rule: dict) -> Iterator[ShellText]:
    for target_check in (rule.get("check") or {}).values():
        quote_dialect = QUOTE_DIALECT_BY_INLINE_LANGUAGE.get(target_check.get("language"))
        default_check = target_check.get("default")
        if default_check and default_check.get("shell"):
            yield ShellText(default_check["shell"], "", quote_dialect)
        for version_check in (target_check.get("by_version") or {}).values():
            if version_check.get("shell"):
                yield ShellText(version_check["shell"], "", quote_dialect)
    for target_remediation in (rule.get("remediation") or {}).values():
        for step in target_remediation.get("steps") or []:
            if step.get("shell"):
                yield ShellText(step["shell"], "", QUOTE_DIALECT_BY_INLINE_LANGUAGE.get(step.get("language")))


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


def iter_payload_paths(rule: dict) -> Iterator[str]:
    for target_remediation in (rule.get("remediation") or {}).values():
        for payload in target_remediation.get("payloads") or []:
            if payload.get("data_file"):
                yield payload["data_file"]


def read_script_texts(rule: dict, read_script: Callable[[str], str]) -> tuple[list[ShellText], list[str]]:
    script_texts = []
    errors = []
    for script_path in dict.fromkeys(iter_script_paths(rule)):
        extension = PurePosixPath(script_path).suffix.lower()
        if extension not in SCRIPT_EXTENSIONS:
            errors.append(f"{rule['id']}: script {script_path} has unsupported extension {extension!r}")
        quote_dialect = QUOTE_DIALECT_BY_SCRIPT_EXTENSION.get(extension)
        script_texts.append(ShellText(read_script(script_path), f"script {script_path}", quote_dialect))
    return script_texts, errors


def read_payload_texts(rule: dict, read_script: Callable[[str], str]) -> list[str]:
    """Payload text counts towards the placeholder checks, but is never quote-checked: the web UI shows it with the strict gate."""
    return [read_script(payload_path) for payload_path in dict.fromkeys(iter_payload_paths(rule))]


def declared_name_errors(rule_id: str, odvs: list[dict]) -> list[str]:
    errors = []
    seen_names: set[str] = set()
    for odv in odvs:
        name = odv.get("name")
        if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
            errors.append(f"{rule_id}: invalid ODV name {name!r}")
        elif name in seen_names:
            errors.append(f"{rule_id}: duplicate ODV name {name!r}")
        seen_names.add(name)
        if odv.get("quoting") not in QUOTINGS:
            errors.append(f"{rule_id}: ODV {name!r} has unknown quoting {odv.get('quoting')!r}")
    return errors


def usage_errors(rule: dict, declared_names: set[str], file_texts: list[str]) -> list[str]:
    rule_id = rule["id"]
    rule_without_declarations = {key: value for key, value in rule.items() if key != "odvs"}
    errors = []
    used_names: set[str] = set()
    for text in [*iter_strings(rule_without_declarations), *file_texts]:
        for occurrence in ODV_OCCURRENCE_PATTERN.finditer(text):
            well_formed = PLACEHOLDER_PATTERN.fullmatch(occurrence.group(0))
            if well_formed is None:
                errors.append(
                    f"{rule_id}: malformed placeholder {occurrence.group(0)}; use $ODV_<name>, where the name is "
                    "lowercase letters, digits and _ and is not followed by another letter or digit"
                )
                continue
            name = well_formed.group(1)
            if name in declared_names:
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
    for shell_text in [*iter_inline_shell_texts(rule), *script_texts]:
        location = f" ({shell_text.description})" if shell_text.description else ""
        quoted_matches = [
            match for match in PLACEHOLDER_PATTERN.finditer(shell_text.text) if match.group(1) in quoting_by_name
        ]
        if not quoted_matches:
            continue
        if shell_text.quote_dialect is None:
            for match in quoted_matches:
                errors.append(
                    f"{rule_id}: {placeholder(match.group(1))} is declared {quoting_by_name[match.group(1)]}, "
                    f"which only inline bash or zsh and .sh or .ps1 scripts support{location}"
                )
            continue
        scan = scan_quotes(shell_text.text, shell_text.quote_dialect)
        for match in quoted_matches:
            name = match.group(1)
            required_quoting = quoting_by_name[name]
            line = line_at(shell_text.text, match.start()).strip()
            if scan.unclosed_quote_start is not None and match.start() > scan.unclosed_quote_start:
                errors.append(
                    f"{rule_id}: {placeholder(name)} is declared {required_quoting} "
                    f"but sits in a quote that is never closed{location} in: {line}"
                )
            elif scan.quote_before[match.start()] != required_quoting:
                errors.append(
                    f"{rule_id}: {placeholder(name)} is declared {required_quoting} "
                    f"but appears outside {required_quoting} quotes{location} in: {line}"
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
    payload_texts = read_payload_texts(rule, read_script) if read_script else []
    file_texts = [*(script.text for script in script_texts), *payload_texts]
    return (
        declared_name_errors(rule["id"], odvs)
        + script_errors
        + usage_errors(rule, declared_names, file_texts)
        + quoting_errors({**rule, "odvs": odvs}, script_texts)
        + display_value_errors({**rule, "odvs": odvs})
    )
