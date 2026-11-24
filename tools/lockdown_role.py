"""Read an ansible-lockdown Windows CIS role and translate its registry tasks.

A role (for example Windows-2022-CIS) keeps one or more tasks per CIS rule under
`tasks/section*`, and its configurable values in `defaults/main/main.yml`. This module
turns those files into `RoleTask` and `RoleOdv` records and, where every write of a
rule is a plain `win_regedit`, into the toolkit's native `registry` settings (design
2026-11-20-windows-cis-lockdown-design.md, sections 1 and 4).

The role files are untrusted input: they are only ever parsed with `yaml.safe_load`
machinery, never executed, and the Jinja in their strings is never rendered.
"""

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

from tools.lockdown_powershell import (
    security_policy_check_powershell,
    security_policy_fix_powershell,
    services_check_powershell,
    services_fix_powershell,
    user_rights_check_powershell,
    user_rights_fix_powershell,
)

RULE_NAME_PATTERN = re.compile(r"^(?P<rule_id>\d+(?:\.\d+)*)\s*\|\s*(?P<verb>[A-Za-z]+)\s*(?:\|\s*)?(?P<rest>.*)$")
APPLICABILITY_BY_SUFFIX = {"MS only": "Member Server", "DC only": "Domain Controller"}
APPLICABILITY_SUFFIX_PATTERN = re.compile(r"\s+(MS only|DC only)$")
APPLICABILITY_WORDS = ("Member Server", "Domain Controller")

TASK_KEYWORDS = frozenset(
    {
        "name", "when", "tags", "vars", "register", "changed_when", "failed_when", "check_mode", "notify",
        "loop", "with_items", "loop_control", "block", "rescue", "always", "no_log", "ignore_errors",
        "ignore_unreachable", "become", "become_user", "become_method", "environment", "delegate_to", "args",
        "retries", "until", "delay", "async", "poll", "any_errors_fatal", "diff", "listen", "run_once",
        "throttle", "connection", "collections", "module_defaults", "timeout", "debugger", "remote_user",
        "port", "local_action", "no_proxy", "delegate_facts", "max_fail_percentage",
    }
)
NESTED_TASK_KEYS = ("block", "rescue", "always")
IMPORT_MODULES = ("import_tasks", "include_tasks")
RAW_PARAMETERS_KEY = "_raw_params"
NON_WRITING_MODULES = frozenset(
    {"debug", "set_fact", "import_tasks", "include_tasks", "win_service_info", "win_feature_info", "win_reg_stat"}
)

HIVE_PATH_PATTERN = re.compile(r"^(?P<hive>HKLM|HKCU|HKU|HKCR):\\(?P<key_path>.+)$", re.IGNORECASE)
PER_USER_PATH_PATTERN = re.compile(r"^HKU:\\\{\{\s*item\s*\}\}\\(?P<key_path>.+)$", re.IGNORECASE)
PER_USER_LOOP_PATTERN = re.compile(r"^\{\{\s*\w*hku\w*list\s*\}\}$", re.IGNORECASE)
JINJA_MARKERS = ("{{", "{%", "{#")
SINGLE_VARIABLE_PATTERN = re.compile(r"^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$")
HEX_BYTES_PATTERN = re.compile(r"^(?:[0-9A-Fa-f]{2})*$")
UNREPRESENTABLE_TEXT_PATTERN = re.compile(r"[\r\n\x00]")

REGISTRY_TYPE_BY_MODULE_TYPE = {
    "dword": "REG_DWORD",
    "qword": "REG_QWORD",
    "string": "REG_SZ",
    "expandstring": "REG_EXPAND_SZ",
    "multistring": "REG_MULTI_SZ",
    "binary": "REG_BINARY",
}
DEFAULT_MODULE_TYPE = "string"
NUMBER_RANGE_BY_REGISTRY_TYPE = {"REG_DWORD": (0, 2**32 - 1), "REG_QWORD": (0, 2**64 - 1)}
TEXT_REGISTRY_TYPES = ("REG_SZ", "REG_EXPAND_SZ")

COMPARISON_PATTERN = re.compile(
    r"^(?P<left>-?\w+)(?:\s*\|\s*int)?\s*(?P<operator>>=|<=|==|!=|>|<)\s*(?P<right>-?\w+)(?:\s*\|\s*int)?$"
)
MEMBERSHIP_PATTERN = re.compile(r"^(?P<variable>\w+)(?:\s*\|\s*int)?\s+in\s+\[(?P<members>[^\]]*)\]$")
NOT_MEMBERSHIP_PATTERN = re.compile(r"^(?P<variable>\w+)(?:\s*\|\s*int)?\s+not\s+in\s+\[(?P<members>[^\]]*)\]$")
INTEGER_PATTERN = re.compile(r"^-?\d+$")
SECTION_TOGGLE_PATTERN = r"^{prefix}_section\d+$"
DEFAULT_COMMENT_PATTERN = re.compile(r"^Default:")
RULE_ID_COMMENT_PATTERN = re.compile(r"^\d+(?:\.\d+)*$")


class RoleParseError(ValueError):
    """A role file could not be read, or its task text could not be located."""


class UnknownRoleVariableError(LookupError):
    """A task refers to a role variable that the defaults do not define."""


@dataclass(frozen=True)
class RoleTask:
    """One leaf task of a role (a task that runs a module), with what its enclosing blocks add.

    `source_yaml` is the verbatim text of this task; `rule_yaml` the verbatim text of the
    top-level task that contains it (the same text when the task is not inside a block).
    `step` is the sub-task description of a name such as "ID | PATCH | title | step".
    """

    rule_id: str
    verb: str
    title: str
    step: str | None
    applicability: str | None
    name: str
    module: str
    args: dict
    when: list[str]
    loop: object
    tags: list[str]
    source_yaml: str
    rule_yaml: str
    file: Path


@dataclass(frozen=True)
class RoleOdv:
    """A configurable role variable. `min` and `max` come from range checks in the role's `when`."""

    name: str
    description: str
    default: object
    datatype: str
    rule_id: str | None
    min: int | None
    max: int | None


@dataclass(frozen=True)
class ParsedTaskName:
    rule_id: str
    verb: str
    title: str
    step: str | None
    applicability: str | None


def parse_task_name(name: str) -> ParsedTaskName | None:
    """Split "<ID> | PATCH | <title> [| <step>]", dropping the "MS only | Member Server" style suffix."""
    matched = RULE_NAME_PATTERN.match(name.strip())
    if matched is None:
        return None
    segments = [segment.strip() for segment in matched["rest"].split("|") if segment.strip()]
    title = segments[0] if segments else ""
    step_segments = segments[1:]
    applicability = None
    if step_segments and step_segments[-1] in APPLICABILITY_WORDS:
        applicability = step_segments.pop()
    suffix = APPLICABILITY_SUFFIX_PATTERN.search(title)
    if suffix:
        title = title[: suffix.start()]
        applicability = APPLICABILITY_BY_SUFFIX[suffix[1]]
    return ParsedTaskName(
        rule_id=matched["rule_id"],
        verb=matched["verb"],
        title=title,
        step=" | ".join(step_segments) or None,
        applicability=applicability,
    )


def module_key_of(task: dict) -> str | None:
    return next((key for key in task if key not in TASK_KEYWORDS), None)


def module_arguments(raw_arguments) -> dict:
    if isinstance(raw_arguments, dict):
        return dict(raw_arguments)
    if raw_arguments is None:
        return {}
    return {RAW_PARAMETERS_KEY: raw_arguments}


def as_text_list(value) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    return [str(item) for item in items]


def append_unique(existing: list[str], additions: list[str]) -> list[str]:
    return existing + [item for item in additions if item not in existing]


def import_target(task: dict) -> str | None:
    for key, value in task.items():
        if key.split(".")[-1] in IMPORT_MODULES:
            return value.get("file") if isinstance(value, dict) else value
    return None


def natural_sort_key(path: Path) -> list:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", path.as_posix())]


def read_yaml_document(file_path: Path) -> list:
    try:
        data = yaml.safe_load(file_path.read_bytes().decode("utf-8"))
    except (yaml.YAMLError, UnicodeDecodeError) as error:
        raise RoleParseError(f"{file_path}: {error}") from error
    return data or []


def section_files_in_upstream_order(tasks_dir: Path) -> list[Path]:
    """Section files in the order the role runs them: main.yml's imports, depth first.

    Upstream order matters (the role runs 1.2.2 before 1.2.1 on purpose). Any section file
    that no import reaches follows, in natural file name order.
    """
    ordered: list[Path] = []

    def visit(file_path: Path) -> None:
        for task in read_yaml_document(file_path):
            target = import_target(task) if isinstance(task, dict) else None
            if not isinstance(target, str):
                continue
            for candidate in (file_path.parent / target, tasks_dir / target):
                if candidate.is_file():
                    relative_parts = candidate.relative_to(tasks_dir).parts
                    if relative_parts[0].startswith("section") and candidate not in ordered:
                        ordered.append(candidate)
                        visit(candidate)
                    break

    entry_point = tasks_dir / "main.yml"
    if entry_point.is_file():
        visit(entry_point)
    unreached = sorted(
        (path for path in tasks_dir.glob("section*/**/*.yml") if path not in ordered), key=natural_sort_key
    )
    return ordered + unreached


@dataclass(frozen=True)
class InheritedContext:
    when: list[str]
    tags: list[str]
    identity: ParsedTaskName | None
    rule_yaml: str


def load_role_tasks(role_dir: Path) -> list[RoleTask]:
    """Every leaf task of the role's section files that belongs to a numbered rule, in upstream order."""
    tasks_dir = role_dir / "tasks"
    tasks: list[RoleTask] = []
    for task_file in section_files_in_upstream_order(tasks_dir):
        tasks.extend(tasks_of_file(task_file, role_dir))
    return tasks


def tasks_of_file(task_file: Path, role_dir: Path) -> list[RoleTask]:
    text = task_file.read_bytes().decode("utf-8")
    lines = re.split(r"(?<=\n)", text)
    loader = yaml.SafeLoader(text)
    try:
        root_node = loader.get_single_node()
        data = loader.construct_document(root_node) if root_node is not None else None
    except yaml.YAMLError as error:
        raise RoleParseError(f"{task_file}: {error}") from error
    finally:
        loader.dispose()
    if not data:
        return []
    relative_file = task_file.relative_to(role_dir)
    collected: list[RoleTask] = []
    walk_task_list(
        root_node, data, len(lines), lines, relative_file, InheritedContext([], [], None, ""), collected
    )
    return collected


def trimmed_text(lines: list[str], start_line: int, end_line: int) -> str:
    """The lines from start_line up to end_line, without the blank and comment lines that trail a task."""
    last = end_line
    while last > start_line and (not lines[last - 1].strip() or lines[last - 1].lstrip().startswith("#")):
        last -= 1
    return "".join(lines[start_line:last])


def walk_task_list(
    list_node, task_list, end_line, lines, relative_file, inherited: InheritedContext, collected: list
) -> None:
    item_nodes = list_node.value
    for position, (item_node, task) in enumerate(zip(item_nodes, task_list)):
        if not isinstance(task, dict):
            continue
        item_start = item_node.start_mark.line
        item_end = item_nodes[position + 1].start_mark.line if position + 1 < len(item_nodes) else end_line
        source_yaml = trimmed_text(lines, item_start, item_end)
        verify_text_matches(source_yaml, task, relative_file)
        rule_yaml = source_yaml if not inherited.rule_yaml else inherited.rule_yaml
        own_name = task.get("name")
        identity = (parse_task_name(own_name) if isinstance(own_name, str) else None) or inherited.identity
        context = InheritedContext(
            when=inherited.when + as_text_list(task.get("when")),
            tags=append_unique(inherited.tags, as_text_list(task.get("tags"))),
            identity=identity,
            rule_yaml=rule_yaml,
        )
        for key, nested_node in zip(item_node_keys(item_node), item_node_values(item_node)):
            if key in NESTED_TASK_KEYS and isinstance(task.get(key), list):
                walk_task_list(nested_node, task[key], item_end, lines, relative_file, context, collected)
        module_key = module_key_of(task)
        if module_key is None or identity is None:
            continue
        collected.append(
            RoleTask(
                rule_id=identity.rule_id,
                verb=identity.verb,
                title=identity.title,
                step=identity.step,
                applicability=identity.applicability,
                name=own_name if isinstance(own_name, str) else "",
                module=module_key.split(".")[-1],
                args=module_arguments(task[module_key]),
                when=context.when,
                loop=task.get("loop", task.get("with_items")),
                tags=context.tags,
                source_yaml=source_yaml,
                rule_yaml=rule_yaml,
                file=relative_file,
            )
        )


def item_node_keys(item_node) -> list[str]:
    return [key_node.value for key_node, _ in item_node.value]


def item_node_values(item_node) -> list:
    return [value_node for _, value_node in item_node.value]


def verify_text_matches(source_yaml: str, task: dict, relative_file: Path) -> None:
    """Fail loudly if the sliced text is not the task it claims to be (for example an odd line break)."""
    try:
        reparsed = yaml.safe_load(source_yaml)
    except yaml.YAMLError as error:
        raise RoleParseError(f"{relative_file}: could not isolate a task's text: {error}") from error
    if reparsed != [task]:
        raise RoleParseError(f"{relative_file}: the text found for task {task.get('name')!r} does not match it")


def group_by_rule(tasks: list[RoleTask]) -> dict[str, list[RoleTask]]:
    """Tasks per rule id, rules in order of first appearance, merging tasks that share an id."""
    grouped: dict[str, list[RoleTask]] = {}
    for task in tasks:
        grouped.setdefault(task.rule_id, []).append(task)
    return grouped


def datatype_of(default) -> str:
    if isinstance(default, bool):
        return "boolean"
    if isinstance(default, int):
        return "number"
    if isinstance(default, str):
        return "string"
    if isinstance(default, list):
        return "list"
    return "other"


def comment_block_above(lines: list[str], variable_line: int) -> list[str]:
    block: list[str] = []
    position = variable_line - 1
    while position >= 0 and lines[position].startswith("#"):
        block.insert(0, re.sub(r"^#\s?", "", lines[position]).rstrip())
        position -= 1
    return block


def describe_comment_block(block: list[str]) -> tuple[str | None, str]:
    """The rule id (a lone `# 1.1.4` first line) and the prose, without the `# Default:` line."""
    rule_id = None
    if block and RULE_ID_COMMENT_PATTERN.match(block[0].strip()):
        rule_id = block[0].strip()
        block = block[1:]
    prose = [line.strip() for line in block if line.strip() and not DEFAULT_COMMENT_PATTERN.match(line.strip())]
    return rule_id, " ".join(prose)


def defaults_file_of(role_dir: Path) -> Path:
    for candidate in (role_dir / "defaults" / "main" / "main.yml", role_dir / "defaults" / "main.yml"):
        if candidate.is_file():
            return candidate
    raise RoleParseError(f"{role_dir}: no defaults/main/main.yml or defaults/main.yml")


def odv_key_for(variable: str, prefix: str) -> str:
    """The ODV name of a role variable: the name without the prefix, `value_` first when it starts with a digit.

    The schema wants names that start with a letter, and a few real variables do not
    (for example win11cis_48_digit_recovery_password_setting).
    """
    name = variable[len(prefix) + 1 :]
    return f"value_{name}" if name[:1].isdigit() else name


def is_odv_name(variable: str, prefix: str) -> bool:
    return (
        variable.startswith(f"{prefix}_")
        and not variable.startswith(f"{prefix}_rule_")
        and not re.match(SECTION_TOGGLE_PATTERN.format(prefix=re.escape(prefix)), variable)
    )


Interval = tuple[int | None, int | None]


def integer_literal(token: str) -> int | None:
    return int(token) if INTEGER_PATTERN.match(token) else None


def atom_intervals(atom: str, prefix: str) -> dict[str, Interval] | None:
    """The interval one comparison puts on a role variable, or None when it is not a comparison."""
    atom = atom.strip()
    membership = MEMBERSHIP_PATTERN.match(atom)
    if membership:
        if not membership["variable"].startswith(f"{prefix}_"):
            return None
        members = [integer_literal(member.strip()) for member in membership["members"].split(",")]
        if members and None not in members:
            return {membership["variable"]: (min(members), max(members))}
        return {membership["variable"]: (None, None)}
    comparison = COMPARISON_PATTERN.match(atom)
    if comparison is None:
        return None
    left, operator, right = comparison["left"], comparison["operator"], comparison["right"]
    left_number, right_number = integer_literal(left), integer_literal(right)
    if left_number is not None and right_number is not None:
        return None
    if left_number is None and right_number is None:
        both_are_role_variables = left.startswith(f"{prefix}_") and right.startswith(f"{prefix}_")
        return {left: (None, None), right: (None, None)} if both_are_role_variables else None
    variable, number = (left, right_number) if left_number is None else (right, left_number)
    if not variable.startswith(f"{prefix}_"):
        return None
    if left_number is not None:
        operator = {">": "<", "<": ">", ">=": "<=", "<=": ">="}.get(operator, operator)
    interval = {
        ">": (number + 1, None),
        ">=": (number, None),
        "<": (None, number - 1),
        "<=": (None, number),
        "==": (number, number),
        "!=": (None, None),
    }[operator]
    return {variable: interval}


def strip_outer_parentheses(expression: str) -> str:
    expression = expression.strip()
    while expression.startswith("(") and expression.endswith(")"):
        depth = 0
        for position, character in enumerate(expression):
            depth += (character == "(") - (character == ")")
            if depth == 0 and position < len(expression) - 1:
                return expression
        expression = expression[1:-1].strip()
    return expression


def split_top_level(expression: str, word: str) -> list[str]:
    parts, depth, start, position = [], 0, 0, 0
    separator = f" {word} "
    while position < len(expression):
        character = expression[position]
        depth += (character == "(") - (character == ")")
        if depth == 0 and expression.startswith(separator, position):
            parts.append(expression[start:position])
            position += len(separator)
            start = position
            continue
        position += 1
    parts.append(expression[start:])
    return parts


def intersect_intervals(first: Interval, second: Interval) -> Interval:
    lows = [bound for bound in (first[0], second[0]) if bound is not None]
    highs = [bound for bound in (first[1], second[1]) if bound is not None]
    return (max(lows) if lows else None, min(highs) if highs else None)


def hull_of_intervals(first: Interval, second: Interval) -> Interval:
    low = None if first[0] is None or second[0] is None else min(first[0], second[0])
    high = None if first[1] is None or second[1] is None else max(first[1], second[1])
    return (low, high)


def expression_intervals(expression: str, prefix: str) -> dict[str, Interval] | None:
    """Per-variable intervals for a range check made of comparisons joined by `and` / `or`.

    Returns None when any part is not a comparison, so the caller can tell a range check
    from a condition on host facts or flags.
    """
    expression = strip_outer_parentheses(expression)
    alternatives = split_top_level(expression, "or")
    if len(alternatives) > 1:
        results = [expression_intervals(alternative, prefix) for alternative in alternatives]
        if any(result is None for result in results):
            return None
        shared = set.intersection(*(set(result) for result in results))
        merged = {}
        for variable in shared:
            interval = results[0][variable]
            for result in results[1:]:
                interval = hull_of_intervals(interval, result[variable])
            merged[variable] = interval
        every_variable = set.union(*(set(result) for result in results))
        return {**{variable: (None, None) for variable in every_variable}, **merged}
    conjuncts = split_top_level(expression, "and")
    if len(conjuncts) > 1:
        results = [expression_intervals(conjunct, prefix) for conjunct in conjuncts]
        if any(result is None for result in results):
            return None
        merged: dict[str, Interval] = {}
        for result in results:
            for variable, interval in result.items():
                merged[variable] = intersect_intervals(merged.get(variable, (None, None)), interval)
        return merged
    return atom_intervals(expression, prefix)


def is_writing_task(task: RoleTask) -> bool:
    return task.verb.upper() != "AUDIT" and task.module not in NON_WRITING_MODULES


def is_range(interval: Interval) -> bool:
    """A real range has a bound and is not a single value: `x == 24` alone says nothing about the range."""
    return interval != (None, None) and interval[0] != interval[1]


def role_variable_ranges(tasks: list[RoleTask], prefix: str) -> dict[str, Interval]:
    """Range of each variable implied by the range checks on the role's writing tasks (the valid values)."""
    ranges: dict[str, Interval] = {}
    for task in tasks:
        if not is_writing_task(task):
            continue
        task_ranges: dict[str, Interval] = {}
        for condition in task.when:
            intervals = expression_intervals(condition, prefix)
            for variable, interval in (intervals or {}).items():
                task_ranges[variable] = intersect_intervals(task_ranges.get(variable, (None, None)), interval)
        for variable, interval in task_ranges.items():
            if is_range(interval):
                ranges[variable] = hull_of_intervals(ranges[variable], interval) if variable in ranges else interval
    return ranges


def valid_interval_of_atom(atom: str, prefix: str) -> dict[str, Interval]:
    """The values a warning's single comparison leaves valid, for one role variable (empty when unknown)."""
    atom = atom.strip()
    not_member = NOT_MEMBERSHIP_PATTERN.match(atom)
    if not_member:
        members = [integer_literal(member.strip()) for member in not_member["members"].split(",")]
        if not_member["variable"].startswith(f"{prefix}_") and members and None not in members:
            return {not_member["variable"]: (min(members), max(members))}
        return {}
    comparison = COMPARISON_PATTERN.match(atom)
    if comparison is None:
        return {}
    left, operator, right = comparison["left"], comparison["operator"], comparison["right"]
    left_number, right_number = integer_literal(left), integer_literal(right)
    if (left_number is None) == (right_number is None):
        return {}
    variable, number = (left, right_number) if left_number is None else (right, left_number)
    if not variable.startswith(f"{prefix}_"):
        return {}
    if left_number is not None:
        operator = {">": "<", "<": ">", ">=": "<=", "<=": ">="}.get(operator, operator)
    valid = {
        ">": (None, number),
        ">=": (None, number - 1),
        "<": (number, None),
        "<=": (number + 1, None),
        "!=": (number, number),
    }.get(operator)
    return {variable: valid} if valid is not None else {}


def warning_valid_intervals(expression: str, prefix: str) -> dict[str, Interval]:
    """What a warning condition (true when a value is out of range) leaves valid, per variable.

    Handles the shape the roles use, comparisons joined by `or`. An alternative it cannot read
    is skipped, which only makes the result looser.
    """
    expression = strip_outer_parentheses(expression)
    valid: dict[str, Interval] = {}
    for alternative in split_top_level(expression, "or"):
        alternative = strip_outer_parentheses(alternative)
        if len(split_top_level(alternative, "and")) > 1:
            continue
        for variable, interval in valid_interval_of_atom(alternative, prefix).items():
            valid[variable] = intersect_intervals(valid.get(variable, (None, None)), interval)
    return valid


def warning_variable_ranges(tasks: list[RoleTask], prefix: str) -> dict[str, Interval]:
    """Range of each variable implied by the role's AUDIT warning conditions (the inverse of what they warn about)."""
    ranges: dict[str, Interval] = {}
    for task in tasks:
        if task.verb.upper() != "AUDIT":
            continue
        warnings = [intervals for intervals in (warning_valid_intervals(when, prefix) for when in task.when) if intervals]
        if len(warnings) != 1:
            continue
        for variable, interval in warnings[0].items():
            if is_range(interval):
                ranges[variable] = hull_of_intervals(ranges[variable], interval) if variable in ranges else interval
    return ranges


def odv_range_disagreements(role_dir: Path, prefix: str) -> dict[str, tuple[Interval, Interval]]:
    """Variables whose PATCH range and AUDIT warning range give different bounds on a side that both bound.

    Name to (patch range, warning range). A bound only one of them states is not a disagreement.
    """
    tasks = load_role_tasks(role_dir)
    patch_ranges = role_variable_ranges(tasks, prefix)
    warning_ranges = warning_variable_ranges(tasks, prefix)
    disagreements = {}
    for variable, patch_range in patch_ranges.items():
        warning_range = warning_ranges.get(variable)
        if warning_range is None:
            continue
        differs_on_a_side = any(
            patch_bound is not None and warning_bound is not None and patch_bound != warning_bound
            for patch_bound, warning_bound in zip(patch_range, warning_range)
        )
        if differs_on_a_side:
            disagreements[odv_key_for(variable, prefix)] = (patch_range, warning_range)
    return disagreements


class RoleOdvTable(dict):
    """The role's ODVs by name, plus the role's discovered facts.

    A discovered fact is a prefixed variable that a task sets with `set_fact` (for example
    win25cis_hyperv_installed, found out in prelim.yml): it is not configurable, so it is no ODV,
    but a condition on it is not a typo either. A prefixed variable that is neither is an error.
    """

    discovered_facts: frozenset[str] = frozenset()


def set_fact_names_in(node) -> set[str]:
    names: set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(key, str) and key.split(".")[-1] == "set_fact" and isinstance(value, dict):
                names.update(name for name in value if isinstance(name, str))
            else:
                names.update(set_fact_names_in(value))
    elif isinstance(node, list):
        for item in node:
            names.update(set_fact_names_in(item))
    return names


def load_role_facts(role_dir: Path, prefix: str) -> frozenset[str]:
    """Prefixed variables that any task file of the role sets with `set_fact`."""
    names: set[str] = set()
    for task_file in sorted((role_dir / "tasks").glob("**/*.yml")):
        names.update(set_fact_names_in(read_yaml_document(task_file)))
    return frozenset(name for name in names if name.startswith(f"{prefix}_"))


def discovered_facts_of(odvs: dict[str, RoleOdv]) -> frozenset[str]:
    return getattr(odvs, "discovered_facts", frozenset())


def load_role_odvs(role_dir: Path, prefix: str) -> dict[str, RoleOdv]:
    """The role's configurable variables, keyed by name without the prefix, in file order.

    The result also lists the role's discovered facts (see RoleOdvTable) so that a condition
    on one is not mistaken for a variable the defaults forgot.
    """
    defaults_file = defaults_file_of(role_dir)
    text = defaults_file.read_bytes().decode("utf-8")
    try:
        values = yaml.safe_load(text) or {}
    except yaml.YAMLError as error:
        raise RoleParseError(f"{defaults_file}: {error}") from error
    lines = text.split("\n")
    line_of_variable = {
        match[1]: number for number, line in enumerate(lines) if (match := re.match(r"^(\w+):", line))
    }
    role_tasks = load_role_tasks(role_dir)
    patch_ranges = role_variable_ranges(role_tasks, prefix)
    warning_ranges = warning_variable_ranges(role_tasks, prefix)
    odvs = RoleOdvTable()
    odvs.discovered_facts = load_role_facts(role_dir, prefix)
    for variable, default in values.items():
        if not is_odv_name(variable, prefix):
            continue
        rule_id, description = describe_comment_block(comment_block_above(lines, line_of_variable[variable]))
        datatype = datatype_of(default)
        low, high = (None, None)
        if datatype == "number":
            low, high = intersect_intervals(
                patch_ranges.get(variable, (None, None)), warning_ranges.get(variable, (None, None))
            )
        name = odv_key_for(variable, prefix)
        odvs[name] = RoleOdv(name, description, default, datatype, rule_id, low, high)
    return odvs


def registry_number_bounds(odv: RoleOdv, registry_type: str) -> tuple[int, int]:
    """Validation min and max for a number ODV written as DWORD or QWORD data: the role's range, clamped to the type."""
    type_minimum, type_maximum = NUMBER_RANGE_BY_REGISTRY_TYPE[registry_type]
    minimum = type_minimum if odv.min is None else max(odv.min, type_minimum)
    maximum = type_maximum if odv.max is None else min(odv.max, type_maximum)
    return minimum, maximum


class TranslationBlocker(Exception):
    """Why a rule's tasks cannot become native registry settings (a short, stable reason)."""


def has_jinja(value) -> bool:
    return isinstance(value, str) and any(marker in value for marker in JINJA_MARKERS)


def odv_reference(text: str, prefix: str, odvs: dict[str, RoleOdv]) -> RoleOdv | None:
    """The ODV a `{{ <prefix>_<name> }}` text names; raises if the defaults lack it, None for other text."""
    single = SINGLE_VARIABLE_PATTERN.match(text.strip())
    if single is None or not single[1].startswith(f"{prefix}_"):
        return None
    name = odv_key_for(single[1], prefix)
    if name not in odvs:
        if single[1] in discovered_facts_of(odvs):
            return None
        raise UnknownRoleVariableError(f"{single[1]} is used by a task but not defined in the role defaults")
    return odvs[name]


def check_condition_variables(condition: str, prefix: str, odvs: dict[str, RoleOdv]) -> None:
    for variable in set(re.findall(rf"\b{re.escape(prefix)}_\w+", condition)):
        if variable.startswith(f"{prefix}_rule_"):
            continue
        if odv_key_for(variable, prefix) not in odvs and variable not in discovered_facts_of(odvs):
            raise UnknownRoleVariableError(f"{variable} is used by a task but not defined in the role defaults")


@lru_cache(maxsize=None)
def profile_gate_patterns(prefix: str) -> tuple[re.Pattern, ...]:
    """The `when` conditions that only select a profile or a test run, and so do not change what a rule sets.

    Domain controller and member server gates, the NGWS and BitLocker switches, the
    domain-scoped account policy and standalone gates, and `win_skip_for_test`, each optionally negated. The profile tags already carry them.
    """
    escaped = re.escape(prefix)
    return tuple(
        re.compile(pattern)
        for pattern in (
            rf"(?:not\s+)?prelim_{escaped}_is_domain_(?:controller|member)",
            rf"(?:not\s+)?{escaped}_ngws",
            rf"(?:not\s+)?{escaped}_bitlocker",
            rf"(?:not\s+)?(?:prelim_{escaped}|discovered)_account_policy_is_domain_scoped",
            rf"(?:not\s+)?prelim_{escaped}_is_standalone",
            r"(?:not\s+)?\(?\s*win_skip_for_test(?:\s*\|\s*bool)?\s*\)?",
        )
    )


def is_tolerated_condition(condition: str, prefix: str, tolerated: frozenset[str] | None) -> bool:
    """`tolerated` None means the profile gates; a set means exactly those conditions (empty: none)."""
    if tolerated is not None:
        return condition in tolerated
    return any(pattern.fullmatch(condition) for pattern in profile_gate_patterns(prefix))


def registered_name(task: RoleTask) -> str | None:
    try:
        parsed = yaml.safe_load(task.source_yaml)
    except yaml.YAMLError:
        return None
    if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
        register = parsed[0].get("register")
        return register if isinstance(register, str) else None
    return None


def guard_patterns(tasks: list[RoleTask]) -> tuple[re.Pattern, ...]:
    """Conditions that only test what the rule's own read-only tasks found (`x.exists`, `'Success' not in x.stdout`).

    A generated script already tolerates a missing service and runs idempotent commands
    unconditionally, so these guards do not change what it does. Used for PowerShell only.
    """
    patterns = []
    for task in tasks:
        register = registered_name(task) if not is_writing_task(task) else None
        if register:
            escaped = re.escape(register)
            patterns.append(re.compile(rf"{escaped}\.exists|'[^']*'\s+(?:not\s+)?in\s+{escaped}\.stdout"))
    return tuple(patterns)


def check_conditions(
    task: RoleTask,
    prefix: str,
    odvs: dict[str, RoleOdv],
    tolerated: frozenset[str] | None,
    guards: tuple[re.Pattern, ...] = (),
) -> None:
    rule_toggle = f"{prefix}_rule_{task.rule_id.replace('.', '_')}"
    for condition in task.when:
        stripped = condition.strip()
        if stripped == rule_toggle or is_tolerated_condition(stripped, prefix, tolerated):
            continue
        if any(guard.fullmatch(stripped) for guard in guards):
            continue
        check_condition_variables(stripped, prefix, odvs)
        if expression_intervals(stripped, prefix) is None:
            raise TranslationBlocker(f"when: {stripped}")


def registry_hive_and_path(task: RoleTask) -> tuple[str, str]:
    path = task.args.get("path")
    if not isinstance(path, str):
        raise TranslationBlocker("path is not text")
    if task.loop is not None:
        looped = PER_USER_PATH_PATTERN.match(path)
        if looped is None or not isinstance(task.loop, str) or not PER_USER_LOOP_PATTERN.match(task.loop.strip()):
            raise TranslationBlocker("loop other than the per-user HKU loop")
        return "HKCU", looped["key_path"].rstrip("\\")
    if has_jinja(path):
        raise TranslationBlocker("path has Jinja")
    matched = HIVE_PATH_PATTERN.match(path)
    if matched is None:
        raise TranslationBlocker(f"path is not a PowerShell registry path: {path}")
    return matched["hive"].upper(), matched["key_path"].rstrip("\\")


def registry_value_name(task: RoleTask) -> str:
    value_name = next((task.args[key] for key in ("name", "value", "entry") if key in task.args), None)
    if value_name is None:
        return ""
    if not isinstance(value_name, str) or has_jinja(value_name):
        raise TranslationBlocker("value name is not a literal")
    return value_name


def number_data(raw, registry_type: str):
    low, high = NUMBER_RANGE_BY_REGISTRY_TYPE[registry_type]
    if isinstance(raw, str) and INTEGER_PATTERN.match(raw.strip()):
        raw = int(raw)
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise TranslationBlocker(f"{registry_type} data is not a number: {raw!r}")
    if not low <= raw <= high:
        raise TranslationBlocker(f"{registry_type} data out of range: {raw}")
    return raw


def text_data(raw) -> str:
    if isinstance(raw, bool) or not isinstance(raw, (str, int)):
        raise TranslationBlocker(f"text data is not a string: {raw!r}")
    text = str(raw)
    if UNREPRESENTABLE_TEXT_PATTERN.search(text):
        raise TranslationBlocker("text data has a line break or null character")
    return text


def multi_text_data(raw) -> list[str]:
    items = raw if isinstance(raw, list) else [raw]
    if any(has_jinja(item) for item in items):
        raise TranslationBlocker("multistring data has Jinja")
    return [text_data(item) for item in items]


def binary_data(raw) -> str:
    if isinstance(raw, list) and all(isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= 255 for item in raw):
        return "".join(f"{item:02x}" for item in raw)
    if isinstance(raw, str) and HEX_BYTES_PATTERN.match(raw):
        return raw
    raise TranslationBlocker(f"binary data is not bytes: {raw!r}")


def registry_data(task: RoleTask, registry_type: str, prefix: str, odvs: dict[str, RoleOdv]):
    if "data" not in task.args or task.args["data"] is None:
        raise TranslationBlocker("no data")
    raw = task.args["data"]
    if has_jinja(raw):
        odv = odv_reference(raw, prefix, odvs)
        if odv is None:
            raise TranslationBlocker(f"data is Jinja other than one role variable: {raw}")
        fits_number = registry_type in NUMBER_RANGE_BY_REGISTRY_TYPE and odv.datatype == "number"
        fits_text = registry_type in TEXT_REGISTRY_TYPES and odv.datatype == "string"
        if not (fits_number or fits_text):
            raise TranslationBlocker(f"{odv.datatype} variable {odv.name} does not fit {registry_type}")
        return f"$ODV_{odv.name}"
    if registry_type in NUMBER_RANGE_BY_REGISTRY_TYPE:
        return number_data(raw, registry_type)
    if registry_type in TEXT_REGISTRY_TYPES:
        return text_data(raw)
    if registry_type == "REG_MULTI_SZ":
        return multi_text_data(raw)
    return binary_data(raw)


def registry_setting_of(task: RoleTask, prefix: str, odvs: dict[str, RoleOdv]) -> dict:
    hive, key_path = registry_hive_and_path(task)
    value_name = registry_value_name(task)
    state = task.args.get("state", "present")
    if state == "absent":
        if not value_name and task.args.get("delete_key", True):
            raise TranslationBlocker("deletes the whole key")
        return {"hive": hive, "path": key_path, "value_name": value_name, "type": None, "data": None, "state": "absent"}
    if state != "present":
        raise TranslationBlocker(f"state {state!r}")
    module_type = str(task.args.get("type", task.args.get("datatype", DEFAULT_MODULE_TYPE))).lower()
    registry_type = REGISTRY_TYPE_BY_MODULE_TYPE.get(module_type)
    if registry_type is None:
        raise TranslationBlocker(f"type {module_type}")
    data = registry_data(task, registry_type, prefix, odvs)
    return {"hive": hive, "path": key_path, "value_name": value_name, "type": registry_type, "data": data, "state": "present"}


def registry_blocker(
    tasks: list[RoleTask],
    odvs: dict[str, RoleOdv],
    prefix: str,
    tolerated_conditions: frozenset[str] | None = None,
) -> str | None:
    """The reason a rule's tasks are not native registry settings, or None when they are.

    Raises UnknownRoleVariableError when a task names a role variable the defaults lack.
    """
    try:
        translate_registry_or_raise(tasks, odvs, prefix, tolerated_conditions)
    except TranslationBlocker as blocker:
        return str(blocker)
    return None


def translate_registry_or_raise(
    tasks: list[RoleTask], odvs: dict[str, RoleOdv], prefix: str, tolerated_conditions: frozenset[str] | None
) -> list[dict]:
    primary_writes = [task for task in tasks if is_writing_task(task)]
    if not primary_writes:
        raise TranslationBlocker("no primary write")
    for task in primary_writes:
        if task.module != "win_regedit":
            raise TranslationBlocker(f"primary write is {task.module}")
    settings = []
    for task in primary_writes:
        check_conditions(task, prefix, odvs, tolerated_conditions)
        settings.append(registry_setting_of(task, prefix, odvs))
    reject_conflicting_writes(
        [((s["hive"], s["path"].lower(), s["value_name"].lower()), s) for s in settings], "registry value"
    )
    return settings


def reject_conflicting_writes(writes: list[tuple[object, object]], what: str) -> None:
    """Two writes to one target that disagree would depend on `when` conditions that were tolerated."""
    seen: dict[object, object] = {}
    for target, write in writes:
        if target in seen and seen[target] != write:
            raise TranslationBlocker(f"conflicting writes to one {what}")
        seen[target] = write


def translate_registry(
    tasks: list[RoleTask],
    odvs: dict[str, RoleOdv],
    prefix: str,
    tolerated_conditions: frozenset[str] | None = None,
) -> list[dict] | None:
    """Native registry settings for a rule's tasks, or None when any primary write is not a translatable win_regedit.

    Primary writes are the rule's non-AUDIT tasks that run a module other than a read-only helper.
    A `when` beyond the rule toggle, ODV range checks and the profile gates (domain controller,
    member server, NGWS, BitLocker, `win_skip_for_test`) makes the rule untranslatable.
    `tolerated_conditions` replaces the profile gates with exactly the conditions it lists
    (an empty set tolerates none). Raises UnknownRoleVariableError for a role variable the
    defaults do not define, so a dangling `$ODV_` never reaches the output.
    """
    try:
        return translate_registry_or_raise(tasks, odvs, prefix, tolerated_conditions)
    except TranslationBlocker:
        return None


POWERSHELL_TEXT_PATTERN = re.compile(r"[\r\n\x00\"]")
USER_RIGHT_NAME_PATTERN = re.compile(r"^Se\w+$")
POLICY_KEY_PATTERN = re.compile(r"^\w+$")
QUOTED_POLICY_KEYS = ("newadministratorname", "newguestname")
SERVICE_START_MODES = ("auto", "manual", "disabled")
SERVICE_STATES = ("started", "stopped")
SERVICE_ARGUMENTS = frozenset({"name", "start_mode", "state", "force_dependent_services"})
USER_RIGHT_ACTIONS = ("set", "add", "remove")
SECURITY_POLICY_SECTION = "System Access"
SHELL_ARGUMENTS = frozenset({RAW_PARAMETERS_KEY, "cmd"})
PROFILE_TAG_PATTERN = re.compile(r"^(?:level[12]|ngws)-")


def literal_text(raw, what: str) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise TranslationBlocker(f"{what} is not text")
    if has_jinja(raw):
        raise TranslationBlocker(f"{what} has Jinja")
    if POWERSHELL_TEXT_PATTERN.search(raw):
        raise TranslationBlocker(f"{what} has a quote, line break or null character")
    return raw


def odv_of_datatype(raw: str, datatype: str, prefix: str, odvs: dict[str, RoleOdv], what: str) -> str:
    odv = odv_reference(raw, prefix, odvs)
    if odv is None:
        raise TranslationBlocker(f"{what} is Jinja other than one role variable: {raw}")
    if odv.datatype != datatype:
        raise TranslationBlocker(f"{odv.datatype} variable {odv.name} does not fit {what}")
    return f"$ODV_{odv.name}"


def user_right_of(task: RoleTask, odvs: dict[str, RoleOdv], prefix: str) -> dict:
    name = task.args.get("name")
    if not isinstance(name, str) or not USER_RIGHT_NAME_PATTERN.match(name):
        raise TranslationBlocker(f"user right name is not a privilege constant: {name!r}")
    action = task.args.get("action", "set")
    if action not in USER_RIGHT_ACTIONS:
        raise TranslationBlocker(f"user right action {action!r}")
    users = task.args.get("users")
    if users is None:
        raise TranslationBlocker("user right has no users")
    accounts = []
    for user in users if isinstance(users, list) else [users]:
        if has_jinja(user):
            accounts.append(odv_of_datatype(user, "string", prefix, odvs, "user right account"))
        else:
            accounts.append(literal_text(user, "user right account"))
    return {"name": name, "accounts": accounts, "action": action}


def security_policy_setting_of(task: RoleTask, odvs: dict[str, RoleOdv], prefix: str) -> dict:
    section, key, value = task.args.get("section"), task.args.get("key"), task.args.get("value")
    if section != SECURITY_POLICY_SECTION:
        raise TranslationBlocker(f"security policy section {section!r}")
    if not isinstance(key, str) or not POLICY_KEY_PATTERN.match(key):
        raise TranslationBlocker(f"security policy key {key!r}")
    is_text_key = key.lower() in QUOTED_POLICY_KEYS
    if isinstance(value, str) and has_jinja(value):
        datatype = "string" if is_text_key else "number"
        data = odv_of_datatype(value, datatype, prefix, odvs, f"security policy {key}")
        return {"section": section, "key": key, "value": data, "kind": "text" if is_text_key else "number"}
    if is_text_key:
        return {"section": section, "key": key, "value": literal_text(value, f"security policy {key}"), "kind": "text"}
    if isinstance(value, str) and INTEGER_PATTERN.match(value.strip()):
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int):
        raise TranslationBlocker(f"security policy {key} value is not a number: {value!r}")
    return {"section": section, "key": key, "value": value, "kind": "number"}


def service_of(task: RoleTask) -> dict:
    extra = set(task.args) - SERVICE_ARGUMENTS
    if extra:
        raise TranslationBlocker(f"service argument {sorted(extra)[0]}")
    name = literal_text(task.args.get("name"), "service name")
    if re.search(r"[*?\[\]]", name):
        raise TranslationBlocker("service name has wildcard characters")
    start_mode, state = task.args.get("start_mode"), task.args.get("state")
    if start_mode is not None and start_mode not in SERVICE_START_MODES:
        raise TranslationBlocker(f"service start_mode {start_mode!r}")
    if state is not None and state not in SERVICE_STATES:
        raise TranslationBlocker(f"service state {state!r}")
    if start_mode is None and state is None:
        raise TranslationBlocker("service sets neither start_mode nor state")
    return {
        "name": name,
        "start_mode": start_mode,
        "state": state,
        "force_dependent_services": task.args.get("force_dependent_services") is True,
    }


def shell_body_of(task: RoleTask) -> str:
    if set(task.args) - SHELL_ARGUMENTS:
        raise TranslationBlocker("win_shell has arguments other than the command")
    command = task.args.get(RAW_PARAMETERS_KEY, task.args.get("cmd"))
    if not isinstance(command, str) or not command.strip():
        raise TranslationBlocker("win_shell has no command")
    if has_jinja(command):
        raise TranslationBlocker("win_shell command has Jinja")
    return command.rstrip("\r\n")


def translate_powershell_or_raise(
    tasks: list[RoleTask], odvs: dict[str, RoleOdv], prefix: str, tolerated_conditions: frozenset[str] | None
) -> tuple[str | None, str]:
    primary_writes = [task for task in tasks if is_writing_task(task)]
    if not primary_writes:
        raise TranslationBlocker("no primary write")
    modules = {task.module for task in primary_writes}
    if modules == {"win_regedit"}:
        raise TranslationBlocker("registry settings have their own translation")
    if len(modules) > 1:
        raise TranslationBlocker(f"primary writes mix {', '.join(sorted(modules))}")
    (module,) = modules
    if module not in ("win_user_right", "win_security_policy", "win_service", "win_shell"):
        raise TranslationBlocker(f"primary write is {module}")
    guards = guard_patterns(tasks)
    for task in primary_writes:
        check_conditions(task, prefix, odvs, tolerated_conditions, guards)
        if task.loop is not None:
            raise TranslationBlocker("loop")
    if module == "win_shell":
        return None, "\n".join(shell_body_of(task) for task in primary_writes) + "\n"
    if module == "win_user_right":
        rights = [user_right_of(task, odvs, prefix) for task in primary_writes]
        reject_conflicting_writes([(right["name"], right) for right in rights], "user right")
        return user_rights_check_powershell(rights), user_rights_fix_powershell(rights)
    if module == "win_security_policy":
        settings = [security_policy_setting_of(task, odvs, prefix) for task in primary_writes]
        reject_conflicting_writes([((s["section"].lower(), s["key"].lower()), s) for s in settings], "security policy key")
        return security_policy_check_powershell(settings), security_policy_fix_powershell(settings)
    services = [service_of(task) for task in primary_writes]
    reject_conflicting_writes([(service["name"].lower(), service) for service in services], "service")
    return services_check_powershell(services), services_fix_powershell(services)


def powershell_blocker(
    tasks: list[RoleTask],
    odvs: dict[str, RoleOdv],
    prefix: str,
    tolerated_conditions: frozenset[str] | None = None,
) -> str | None:
    """The reason a rule has no translated PowerShell, or None when it has."""
    try:
        translate_powershell_or_raise(tasks, odvs, prefix, tolerated_conditions)
    except TranslationBlocker as blocker:
        return str(blocker)
    return None


def translate_powershell(
    tasks: list[RoleTask],
    odvs: dict[str, RoleOdv],
    prefix: str,
    tolerated_conditions: frozenset[str] | None = None,
) -> tuple[str | None, str] | None:
    """PowerShell `(check, fix)` for a rule whose primary writes are all one of win_user_right, win_security_policy
    or win_service, or `(None, body)` when they are all win_shell (the commands verbatim, with no check).

    None when the rule is not translatable: registry-only rules (they have the registry translation),
    mixed modules, an unknown module, a loop, Jinja other than one ODV, or a `when` beyond the rule toggle,
    ODV range checks, the profile gates (see `translate_registry`) and the guards on the rule's own
    read-only tasks (a service that must exist, `'Success' not in <audit result>`). Raises
    UnknownRoleVariableError for a role variable the defaults do not define.
    """
    try:
        return translate_powershell_or_raise(tasks, odvs, prefix, tolerated_conditions)
    except TranslationBlocker:
        return None


def profiles_for(tasks: list[RoleTask]) -> list[str]:
    """Benchmark names for a rule's profile tags (`level1-memberserver` is `level1_memberserver`), in tag order."""
    names: list[str] = []
    for task in tasks:
        for tag in task.tags:
            name = tag.replace("-", "_")
            if PROFILE_TAG_PATTERN.match(tag) and name not in names:
                names.append(name)
    return names
