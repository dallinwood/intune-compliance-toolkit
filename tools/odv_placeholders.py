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


COMMENT = "comment"
HEREDOC_BODY = "heredoc body"
COMMAND_SUBSTITUTION = "command substitution in double quotes"
CASE_STATEMENT = "case statement"
HERE_STRING = "PowerShell here-string"
# Text the scan does not model, so a quoted placeholder there is always an error.
UNMODELLED_STATES = (COMMENT, HEREDOC_BODY, COMMAND_SUBSTITUTION, CASE_STATEMENT, HERE_STRING)
WORD_BOUNDARY_CHARACTERS = " \t\r\n;&|()"
# `case` and `esac` as whole shell words. The patterns of a case statement end in an unmatched `)`.
CASE_KEYWORD_PATTERN = re.compile(r"(?<![^ \t\r\n;&|()])(case|esac)(?![^ \t\r\n;&|()])")
HEREDOC_WORD_END_CHARACTERS = " \t\r\n;&|()<>"


@dataclass(frozen=True)
class QuoteScan:
    # The state just before each character: "single", "double", ANSI_C_QUOTE,
    # one of UNMODELLED_STATES, or None outside quotes.
    quote_before: list[str | None]
    # Where the quote still open at the end of the text was opened, or None when every quote closes.
    unclosed_quote_start: int | None


def find_substitution_end(text: str, index: int) -> int:
    """Index of the `)` closing a `$(` whose contents start at index, or len(text) when it never closes.

    Also len(text) when the contents hold a comment, heredoc or case statement, whose
    text or patterns can carry a `)` that this count cannot attribute.
    """
    depth = 1
    contents_start = index
    while index < len(text):
        character = text[index]
        starts_word = index == contents_start or text[index - 1] in WORD_BOUNDARY_CHARACTERS
        if character == "\\":
            index += 1
        elif (character == "#" and starts_word) or CASE_KEYWORD_PATTERN.match(text, index):
            return len(text)
        elif text.startswith("<<<", index):
            index += 2
        elif text.startswith("<<", index):
            return len(text)
        elif character in "'`":
            closing = text.find(character, index + 1)
            index = len(text) if closing == -1 else closing
        elif character == '"':
            index = find_double_quote_end(text, index + 1)
        elif character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return len(text)


def find_double_quote_end(text: str, index: int) -> int:
    """Index of the `"` closing a double-quoted string whose contents start at index, or len(text)."""
    while index < len(text):
        character = text[index]
        if character == "\\":
            index += 1
        elif character == '"':
            return index
        elif text.startswith("$(", index):
            index = find_substitution_end(text, index + 2)
        index += 1
    return len(text)


def find_case_statement_end(text: str, index: int) -> int:
    """Index just past the `esac` closing the `case` at index, or len(text) when it never closes."""
    depth = 0
    for keyword in CASE_KEYWORD_PATTERN.finditer(text, index):
        depth += 1 if keyword.group(1) == "case" else -1
        if depth == 0:
            return keyword.end()
    return len(text)


def find_here_string_end(text: str, index: int, closing_quotes: str) -> int:
    """Index just past the closing quote and `@` of a PowerShell here-string whose body starts at index, or len(text).

    Only a closing quote and `@` at the very start of a line count, so the body is never cut short.
    """
    line_start = text.find("\n", index) + 1
    while 0 < line_start < len(text):
        if text[line_start] in closing_quotes and text.startswith("@", line_start + 1):
            return line_start + 2
        line_start = text.find("\n", line_start) + 1
    return len(text)


def read_heredoc_delimiter(text: str, index: int) -> tuple[str, bool, int] | None:
    """Parse what follows `<<`: the delimiter word, whether `<<-` strips tabs, and where the word ends."""
    strips_tabs = text.startswith("-", index)
    if strips_tabs:
        index += 1
    while index < len(text) and text[index] in " \t":
        index += 1
    if index >= len(text):
        return None
    if text[index] in "'\"":
        closing = text.find(text[index], index + 1)
        if closing == -1:
            return None
        return text[index + 1 : closing], strips_tabs, closing + 1
    if text[index] == "\\":
        index += 1
    word_start = index
    while index < len(text) and text[index] not in HEREDOC_WORD_END_CHARACTERS:
        index += 1
    if index == word_start:
        return None
    return text[word_start:index], strips_tabs, index


def find_heredoc_body_end(text: str, body_start: int, delimiter: str, strips_tabs: bool) -> int:
    """Index of the newline ending the delimiter line of a heredoc body, or len(text) when it never ends."""
    line_start = body_start
    while line_start < len(text):
        line_end = text.find("\n", line_start)
        line_end = len(text) if line_end == -1 else line_end
        line = text[line_start:line_end].rstrip("\r")
        if (line.lstrip("\t") if strips_tabs else line) == delimiter:
            return line_end
        line_start = line_end + 1
    return len(text)


def scan_quotes(text: str, dialect: QuoteDialect) -> QuoteScan:
    """Track quoting across the whole text, as the shell does, so a quote may span lines.

    Comments, heredoc bodies and command substitutions opened inside double quotes
    are not modelled; they are marked so that a placeholder there is an error.
    """
    quote_before: list[str | None] = [None] * len(text)
    open_quote: str | None = None
    open_quote_start = 0
    pending_heredocs: list[tuple[str, bool]] = []
    is_bash = dialect.has_ansi_c_quotes

    def mark(start: int, end: int, state: str) -> None:
        for position in range(start, min(end, len(text))):
            quote_before[position] = state

    index = 0
    while index < len(text):
        character = text[index]
        quote_before[index] = open_quote
        next_index = index + 1
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
            elif text.startswith("$(", index):
                next_index = find_substitution_end(text, index + 2) + 1
                mark(index, next_index, COMMAND_SUBSTITUTION)
            elif is_bash and character == "`":
                closing = text.find("`", index + 1)
                next_index = len(text) if closing == -1 else closing + 1
                mark(index, next_index, COMMAND_SUBSTITUTION)
        elif is_bash and character == "$" and text.startswith("'", index + 1):
            open_quote, open_quote_start = ANSI_C_QUOTE, index
            skips_next_character = True
        elif character == "#" and (not is_bash or index == 0 or text[index - 1] in WORD_BOUNDARY_CHARACTERS):
            comment_end = text.find("\n", index)
            next_index = len(text) if comment_end == -1 else comment_end
            mark(index, next_index, COMMENT)
        elif is_bash and CASE_KEYWORD_PATTERN.match(text, index):
            next_index = find_case_statement_end(text, index)
            mark(index, next_index, CASE_STATEMENT)
        elif not is_bash and character == "@" and text[index + 1 : index + 2] in tuple(dialect.double_quotes):
            next_index = find_here_string_end(text, index + 2, dialect.double_quotes)
            mark(index, next_index, HERE_STRING)
        elif not is_bash and character == "@" and text[index + 1 : index + 2] in tuple(dialect.single_quotes):
            next_index = find_here_string_end(text, index + 2, dialect.single_quotes)
            mark(index, next_index, HERE_STRING)
        elif not is_bash and text.startswith("<#", index):
            comment_end = text.find("#>", index + 2)
            next_index = len(text) if comment_end == -1 else comment_end + 2
            mark(index, next_index, COMMENT)
        elif is_bash and text.startswith("<<<", index):
            next_index = index + 3
        elif is_bash and text.startswith("<<", index):
            heredoc = read_heredoc_delimiter(text, index + 2)
            if heredoc is not None:
                delimiter, strips_tabs, next_index = heredoc
                pending_heredocs.append((delimiter, strips_tabs))
        elif character == "\n" and pending_heredocs:
            body_start = index + 1
            body_end = body_start
            for delimiter, strips_tabs in pending_heredocs:
                body_end = min(find_heredoc_body_end(text, body_end, delimiter, strips_tabs) + 1, len(text))
            pending_heredocs.clear()
            mark(body_start, body_end, HEREDOC_BODY)
            next_index = body_end
        elif character in dialect.single_quotes:
            open_quote, open_quote_start = "single", index
        elif character in dialect.double_quotes:
            open_quote, open_quote_start = "double", index
        if skips_next_character and next_index < len(text):
            quote_before[next_index] = open_quote
            next_index += 1
        index = next_index
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


def iter_check_items(rule: dict) -> Iterator[dict]:
    for check_items in (rule.get("check") or {}).values():
        yield from check_items


def iter_inline_shell_texts(rule: dict) -> Iterator[ShellText]:
    for check_item in iter_check_items(rule):
        quote_dialect = QUOTE_DIALECT_BY_INLINE_LANGUAGE.get(check_item.get("language"))
        default_check = check_item.get("default")
        if default_check and default_check.get("shell"):
            yield ShellText(default_check["shell"], "", quote_dialect)
        for version_check in (check_item.get("by_version") or {}).values():
            if version_check.get("shell"):
                yield ShellText(version_check["shell"], "", quote_dialect)
    for target_remediation in (rule.get("remediation") or {}).values():
        for step in target_remediation.get("steps") or []:
            if step.get("shell"):
                yield ShellText(step["shell"], "", QUOTE_DIALECT_BY_INLINE_LANGUAGE.get(step.get("language")))


def iter_script_paths(rule: dict) -> Iterator[str]:
    for check_item in iter_check_items(rule):
        default_check = check_item.get("default")
        if default_check and default_check.get("shell_file"):
            yield default_check["shell_file"]
        for version_check in (check_item.get("by_version") or {}).values():
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
            elif scan.quote_before[match.start()] in UNMODELLED_STATES:
                errors.append(
                    f"{rule_id}: {placeholder(name)} is declared {required_quoting} "
                    f"but sits in a {scan.quote_before[match.start()]}, which is not checked{location} in: {line}"
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
