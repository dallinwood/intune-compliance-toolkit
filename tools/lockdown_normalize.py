"""Join an ansible-lockdown Windows CIS role and its Audit repo into library rules, one per CIS recommendation.

The role supplies the fixes (translated to registry settings and PowerShell where that is safe, the
original Ansible tasks always), the Audit repo supplies the clean title and the goss test. None of CIS's
own prose exists upstream, so the discussion only says where the rule came from. Design:
docs/plans/2026-11-20-windows-cis-lockdown-design.md, section 4.
"""

from pathlib import Path

from tools.cac_controls import section_path
from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData
from tools.lockdown_audit import AuditControl, load_audit
from tools.lockdown_role import (
    RoleOdv,
    RoleTask,
    UnknownRoleVariableError,
    group_by_rule,
    load_role_odvs,
    load_role_tasks,
    powershell_blocker,
    profiles_for,
    registry_blocker,
    registry_number_bounds,
    translate_powershell,
    translate_registry,
)
from tools.lockdown_sources import LockdownSpec
from tools.odv_placeholders import PLACEHOLDER_PATTERN, display_gate_problem, placeholder_errors
from tools.registry_powershell import registry_check_powershell, registry_fix_powershell
from tools.source_lock import SourceLock

GOSS_CHECK_NAME = "Original goss test"
ANSIBLE_STEP_NAME = "Original Ansible tasks"
# The schema has no "ansible_only" reason for manual rules; a rule nothing machine-checkable was
# translated for is the nearest existing one, and the discussion says why.
ANSIBLE_ONLY_REASON = "no_check"
NO_CHECK_TRANSLATED = "the role applies it, but no check could be translated"
REGISTRY_ONLY_BLOCKER = "registry settings have their own translation"
TASK_YAML_SEPARATOR = "\n\n"
PARAGRAPH_SEPARATOR = "\n\n"
ODV_QUOTING_BY_DATATYPE = {"number": "unquoted", "string": "single"}


def normalize_rules(spec: LockdownSpec, role_dir: Path, audit_dir: Path, lock: SourceLock) -> list[dict]:
    """Every recommendation of the role, in upstream order, then those only the Audit repo knows."""
    tasks_by_rule = group_by_rule(load_role_tasks(role_dir))
    # Handed to the translators untouched: it also carries the role's discovered facts.
    role_odvs = load_role_odvs(role_dir, spec.variable_prefix)
    controls = load_audit(audit_dir)
    rules = [
        _role_rule(spec, lock, rule_id, tasks, role_odvs, controls.get(rule_id))
        for rule_id, tasks in tasks_by_rule.items()
    ]
    rules += [
        _audit_only_rule(spec, lock, control) for rule_id, control in controls.items() if rule_id not in tasks_by_rule
    ]
    return rules


def _role_rule(
    spec: LockdownSpec,
    lock: SourceLock,
    rule_id: str,
    tasks: list[RoleTask],
    role_odvs: dict[str, RoleOdv],
    control: AuditControl | None,
) -> dict:
    where = f"{spec.source_name} rule {rule_id}"
    try:
        return _role_rule_unchecked(spec, lock, rule_id, tasks, role_odvs, control, where)
    except UnknownRoleVariableError as error:
        raise UnsupportedUpstreamData(f"{where}: {error}") from error


def _role_rule_unchecked(
    spec: LockdownSpec,
    lock: SourceLock,
    rule_id: str,
    tasks: list[RoleTask],
    role_odvs: dict[str, RoleOdv],
    control: AuditControl | None,
    where: str,
) -> dict:
    prefix = spec.variable_prefix
    registry = translate_registry(tasks, role_odvs, prefix)
    powershell = translate_powershell(tasks, role_odvs, prefix)
    translated = registry is not None or powershell is not None
    blocker = None if translated else _blocker(tasks, role_odvs, prefix)
    has_runnable_check = registry is not None or (powershell is not None and powershell[0] is not None)
    if translated and not has_runnable_check:
        blocker = NO_CHECK_TRANSLATED

    check_powershell = registry_check_powershell(registry) if registry is not None else None
    fix_powershell = registry_fix_powershell(registry) if registry is not None else None
    if powershell is not None:
        check_powershell, fix_powershell = powershell

    check_items = []
    if registry is not None:
        check_items.append(_check_item(None, "registry", registry=registry))
    if check_powershell is not None:
        check_items.append(_check_item(None, "powershell", shell=check_powershell))
    if control is not None and control.goss_text is not None:
        check_items.append(_check_item(GOSS_CHECK_NAME, "goss", shell=control.goss_text))

    fix_steps = []
    if registry is not None:
        fix_steps.append(_fix_step(None, "registry", registry=registry))
    if fix_powershell is not None:
        fix_steps.append(_fix_step(None, "powershell", shell=fix_powershell))
    fix_steps.append(_fix_step(ANSIBLE_STEP_NAME, "ansible", shell=_ansible_text(tasks)))

    rule_text = {"check": check_items, "fix": fix_steps}
    odvs = _odvs_used(rule_text, role_odvs, registry, where)
    first_task = tasks[0]
    patch_task = next((task for task in tasks if task.verb == "PATCH"), first_task)
    role_path = first_task.file.as_posix()
    rule = _rule_envelope(
        spec,
        lock,
        rule_id,
        title=control.title if control is not None else patch_task.title,
        discussion=_discussion(spec, role_path, control, _applicability_notes(tasks), blocker),
        source_path=role_path,
        assessment=(
            {"status": "automated", "manual_reason": None}
            if has_runnable_check
            else {"status": "manual", "manual_reason": ANSIBLE_ONLY_REASON}
        ),
        benchmarks=profiles_for(tasks),
        check_items=check_items,
        odvs=odvs,
        fix_steps=fix_steps,
    )
    return _checked(rule, where)


def _audit_only_rule(spec: LockdownSpec, lock: SourceLock, control: AuditControl) -> dict:
    where = f"{spec.source_name} rule {control.rule_id}"
    check_items = []
    if control.goss_text is not None:
        check_items.append(_check_item(GOSS_CHECK_NAME, "goss", shell=control.goss_text))
    rule = _rule_envelope(
        spec,
        lock,
        control.rule_id,
        title=control.title,
        discussion=_discussion(spec, None, control, [], None),
        source_path=control.file or "coverage.json",
        assessment={"status": "manual", "manual_reason": ANSIBLE_ONLY_REASON},
        benchmarks=[],
        check_items=check_items,
        odvs=[],
        fix_steps=[],
        from_audit=True,
    )
    return _checked(rule, where)


def _rule_envelope(
    spec: LockdownSpec,
    lock: SourceLock,
    rule_id: str,
    *,
    title: str,
    discussion: str,
    source_path: str,
    assessment: dict,
    benchmarks: list[str],
    check_items: list[dict],
    odvs: list[dict],
    fix_steps: list[dict],
    from_audit: bool = False,
) -> dict:
    repository_url = spec.audit_url if from_audit else spec.role_url
    commit_sha = lock.details.get("audit_commit", lock.commit_sha) if from_audit else lock.commit_sha
    return {
        "schema_version": SCHEMA_VERSION,
        "id": f"{spec.source_name}.{rule_id}",
        "title": title,
        "discussion": discussion,
        "discussion_format": "markdown",
        "section_path": section_path(rule_id),
        "source": {
            "name": spec.source_name,
            "release_tag": lock.tag,
            "commit_sha": commit_sha,
            "upstream_rule_id": rule_id,
            "upstream_path": source_path,
            "upstream_revision": None,
            "upstream_updated": None,
            "upstream_url": f"{repository_url}/blob/{commit_sha}/{source_path}",
            "license": dict(spec.license),
        },
        "assessment": assessment,
        "architecture": None,
        "applicability": [
            {
                "target": spec.target,
                "version": spec.version,
                "benchmarks": [{"name": name, "severity": None} for name in benchmarks],
            }
        ],
        "tags": [],
        "references": {
            "cis": {"benchmark_version": spec.benchmark_version.removeprefix("v"), "id": rule_id},
        },
        "check": {spec.target: check_items} if check_items else None,
        "odvs": odvs,
        "remediation": {spec.target: {"steps": fix_steps, "payloads": []}} if fix_steps else None,
    }


def _checked(rule: dict, where: str) -> dict:
    problems = placeholder_errors(rule)
    if problems:
        raise UnsupportedUpstreamData(f"{where}: {'; '.join(problems)}")
    return rule


def _check_item(name: str | None, language: str, *, shell: str | None = None, registry: list[dict] | None = None) -> dict:
    entry: dict = {"registry": registry} if registry is not None else {"shell": shell}
    entry.update({"result": None, "additional_info": None})
    return {"name": name, "language": language, "default": entry, "by_version": {}}


def _fix_step(name: str | None, language: str, *, shell: str | None = None, registry: list[dict] | None = None) -> dict:
    step: dict = {"name": name, "language": language}
    step.update({"registry": registry} if registry is not None else {"shell": shell})
    step.update({"additional_info": None, "versions": None})
    return step


def _unique(items) -> list:
    unique_items: list = []
    for item in items:
        if item not in unique_items:
            unique_items.append(item)
    return unique_items


def _ansible_text(tasks: list[RoleTask]) -> str:
    """The role text of the rule: each enclosing top-level task once, verbatim, in upstream order."""
    return TASK_YAML_SEPARATOR.join(_unique(task.rule_yaml.rstrip("\r\n") for task in tasks)) + "\n"


def _applicability_notes(tasks: list[RoleTask]) -> list[str]:
    return _unique(task.applicability for task in tasks if task.applicability)


def _blocker(tasks: list[RoleTask], role_odvs: dict[str, RoleOdv], prefix: str) -> str:
    reason = powershell_blocker(tasks, role_odvs, prefix)
    if reason == REGISTRY_ONLY_BLOCKER:
        reason = registry_blocker(tasks, role_odvs, prefix)
    return reason or "no translation applies"


def _discussion(
    spec: LockdownSpec, role_path: str | None, control: AuditControl | None, notes: list[str], blocker: str | None
) -> str:
    """Where the rule came from. The schema has no applicability notes field, so those go here too."""
    sources = []
    if role_path is not None:
        sources.append(f"role task file `{role_path}` of `{spec.role_repository}`")
    if control is not None and control.file is not None:
        sources.append(f"Audit control `{control.file}` of `{spec.audit_repository}`")
    paragraphs = [
        "Imported from " + (" and ".join(sources) or f"`{spec.audit_repository}`") + ". "
        "The CIS Benchmark text is not part of this source."
    ]
    if notes:
        paragraphs.append(f"Applies to: {', '.join(notes)} only (from the upstream task name).")
    if blocker is not None:
        paragraphs.append(
            f"No runnable check ({blocker}); the original Ansible tasks are the fix."
        )
    return PARAGRAPH_SEPARATOR.join(paragraphs)


def _strings_of(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from _strings_of(value)
    elif isinstance(node, list):
        for value in node:
            yield from _strings_of(value)


def _odvs_used(rule_text: dict, role_odvs: dict[str, RoleOdv], registry: list[dict] | None, where: str) -> list[dict]:
    """The role variables the translated check and fix texts refer to, in order of first use."""
    names: list[str] = []
    for text in _strings_of({"check": rule_text["check"], "fix": rule_text["fix"]}):
        for match in PLACEHOLDER_PATTERN.finditer(text):
            if match[1] not in names:
                names.append(match[1])
    registry_type_by_odv = {
        setting["data"][len("$ODV_") :]: setting["type"]
        for setting in registry or []
        if isinstance(setting["data"], str) and PLACEHOLDER_PATTERN.fullmatch(setting["data"])
    }
    odvs = []
    for name in names:
        role_odv = role_odvs.get(name)
        if role_odv is None:
            raise UnsupportedUpstreamData(f"{where}: $ODV_{name} is not a variable of the role defaults")
        if role_odv.datatype not in ODV_QUOTING_BY_DATATYPE:
            raise UnsupportedUpstreamData(f"{where}: ODV {name} has datatype {role_odv.datatype!r}")
        quoting = ODV_QUOTING_BY_DATATYPE[role_odv.datatype]
        problem = display_gate_problem(quoting, role_odv.default)
        if problem:
            raise UnsupportedUpstreamData(f"{where}: ODV {name}: {problem}")
        odvs.append(
            {
                "name": name,
                "datatype": role_odv.datatype,
                "description": role_odv.description,
                "validation": _validation(role_odv, registry_type_by_odv.get(name)),
                "recommended": role_odv.default,
                "by_benchmark": {},
                "quoting": quoting,
            }
        )
    return odvs


def _validation(role_odv: RoleOdv, registry_type: str | None) -> dict | None:
    if role_odv.datatype != "number":
        return None
    if registry_type is not None:
        minimum, maximum = registry_number_bounds(role_odv, registry_type)
        return {"min": minimum, "max": maximum}
    bounds = {"min": role_odv.min, "max": role_odv.max}
    present = {key: value for key, value in bounds.items() if value is not None}
    return present or None
