"""Assemble library rules from a ComplianceAsCode CIS control file and its datastream."""

from pathlib import Path

import yaml

from tools.cac_benchmarks import LEVELS, LICENSE, REPOSITORY_URL, BenchmarkSpec
from tools.cac_controls import (
    Control,
    assessment,
    benchmark_name,
    levels_with_inheritance,
    read_controls,
    section_path,
)
from tools.cac_datastream import Datastream, DatastreamRule
from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData
from tools.odv_placeholders import display_gate_problem, placeholder, placeholder_errors
from tools.source_lock import SourceLock

PARAGRAPH_SEPARATOR = "\n\n"
NO_RULES_DISCUSSION = "ComplianceAsCode links no rule to this recommendation."
NO_AUDIT_TEXT = "No audit procedure in ComplianceAsCode."
AUDIT_BLOCK_FENCE = "----"


def normalize_benchmark(upstream_dir: Path, spec: BenchmarkSpec, lock: SourceLock) -> tuple[str, list[dict]]:
    controls_text = (upstream_dir / spec.controls_path).read_text(encoding="utf-8")
    benchmark_version, controls = read_controls(yaml.safe_load(controls_text), spec)
    datastream = Datastream((upstream_dir / "release" / f"ssg-{spec.product}-ds.xml").read_bytes())
    rules = [_assemble_rule(control, benchmark_version, datastream, spec, lock) for control in controls]
    return benchmark_version, rules


def _assemble_rule(
    control: Control, benchmark_version: str, datastream: Datastream, spec: BenchmarkSpec, lock: SourceLock
) -> dict:
    where = f"{spec.source_name} control {control.cis_id}"
    try:
        return _assemble_rule_unchecked(control, benchmark_version, datastream, spec, lock, where)
    except UnsupportedUpstreamData as error:
        if where in str(error):
            raise
        raise UnsupportedUpstreamData(f"{where}: {error}") from error


def _assemble_rule_unchecked(
    control: Control,
    benchmark_version: str,
    datastream: Datastream,
    spec: BenchmarkSpec,
    lock: SourceLock,
    where: str,
) -> dict:
    linked_rules = [datastream.rule(rule_id) for rule_id in control.rule_ids]
    for linked_rule in linked_rules:
        if control.cis_id not in linked_rule.cis_references:
            raise UnsupportedUpstreamData(
                f"{where}: rule {linked_rule.rule_id} cites CIS {list(linked_rule.cis_references)}, "
                f"not {control.cis_id}"
            )
    rule = {
        "schema_version": SCHEMA_VERSION,
        "id": f"{spec.source_name}.{control.cis_id}",
        "title": control.title,
        "discussion": _discussion(control, linked_rules),
        "discussion_format": "markdown",
        "section_path": section_path(control.cis_id),
        "source": {
            "name": spec.source_name,
            "release_tag": lock.tag,
            "commit_sha": lock.commit_sha,
            "upstream_rule_id": control.cis_id,
            "upstream_path": spec.controls_path,
            "upstream_revision": None,
            "upstream_updated": None,
            "upstream_url": f"{REPOSITORY_URL}/blob/{lock.commit_sha}/{spec.controls_path}",
            "license": dict(LICENSE),
        },
        "assessment": assessment(control.status, where, links_rules=bool(control.rule_ids)),
        "architecture": None,
        "applicability": [
            {
                "target": spec.target,
                "version": spec.version,
                "benchmarks": [
                    {"name": benchmark_name(level), "severity": None}
                    for level in levels_with_inheritance(control.levels)
                ],
            }
        ],
        "tags": [],
        "references": _references(control, benchmark_version, linked_rules),
        "check": _check(spec, linked_rules, where),
        "odvs": _odvs(control, linked_rules, datastream, spec, where),
        "remediation": _remediation(spec, linked_rules),
    }
    problems = placeholder_errors(rule)
    if problems:
        raise UnsupportedUpstreamData(f"{where}: {'; '.join(problems)}")
    return rule


def _discussion(control: Control, linked_rules: list[DatastreamRule]) -> str:
    if not linked_rules:
        return control.notes or NO_RULES_DISCUSSION
    sections = []
    for linked_rule in linked_rules:
        parts = [f"## {linked_rule.title}", linked_rule.description_markdown]
        if linked_rule.rationale_markdown:
            parts.append(f"**Rationale:**{PARAGRAPH_SEPARATOR}{linked_rule.rationale_markdown}")
        sections.append(PARAGRAPH_SEPARATOR.join(parts))
    if control.notes:
        sections.append(f"**Notes:**{PARAGRAPH_SEPARATOR}{control.notes}")
    return PARAGRAPH_SEPARATOR.join(sections)


def _check(spec: BenchmarkSpec, linked_rules: list[DatastreamRule], where: str) -> dict | None:
    if not any(linked_rule.ocil_text for linked_rule in linked_rules):
        return None
    return {
        spec.target: {
            "language": "instructions",
            "default": {
                "shell": None,
                "result": None,
                "additional_info": PARAGRAPH_SEPARATOR.join(
                    _audit_text(linked_rule, where) for linked_rule in linked_rules
                ),
            },
            "by_version": {},
        }
    }


def _audit_text(linked_rule: DatastreamRule, where: str) -> str:
    lines = [f"== {linked_rule.title}"]
    if linked_rule.ocil_text:
        if any(line.strip() == AUDIT_BLOCK_FENCE for line in linked_rule.ocil_text.splitlines()):
            raise UnsupportedUpstreamData(
                f"{where}: audit text of rule {linked_rule.rule_id} has a {AUDIT_BLOCK_FENCE} line, "
                "which would end the block it is shown in"
            )
        lines += [AUDIT_BLOCK_FENCE, linked_rule.ocil_text, AUDIT_BLOCK_FENCE]
    else:
        lines.append(NO_AUDIT_TEXT)
    if linked_rule.variables:
        expected_values = ", ".join(
            f"{variable.name} = {placeholder(variable.name)}" for variable in linked_rule.variables
        )
        lines.append(f"Expected values: {expected_values}")
    return "\n".join(lines)


def _remediation(spec: BenchmarkSpec, linked_rules: list[DatastreamRule]) -> dict | None:
    if not linked_rules:
        return None
    steps = [
        {
            "name": linked_rule.title,
            "language": "bash" if linked_rule.fix_shell else "instructions",
            "shell": linked_rule.fix_shell,
            "additional_info": (
                f"ComplianceAsCode rule `{linked_rule.rule_id}`"
                if linked_rule.fix_shell
                else f"No fix in ComplianceAsCode (rule `{linked_rule.rule_id}`)."
            ),
            "versions": None,
        }
        for linked_rule in linked_rules
    ]
    return {spec.target: {"steps": steps, "payloads": []}}


def _references(control: Control, benchmark_version: str, linked_rules: list[DatastreamRule]) -> dict:
    complianceascode: dict = {"status": control.status}
    if control.rule_ids:
        complianceascode["rules"] = list(control.rule_ids)
    if control.related_rule_ids:
        complianceascode["related_rules"] = list(control.related_rule_ids)
    cce_by_rule = {linked_rule.rule_id: linked_rule.cce for linked_rule in linked_rules if linked_rule.cce}
    if cce_by_rule:
        complianceascode["cce"] = cce_by_rule
    return {
        "cis": {"benchmark_version": benchmark_version, "id": control.cis_id, "levels": list(control.levels)},
        "complianceascode": complianceascode,
    }


def _merged_quoting(linked_rules: list[DatastreamRule], where: str) -> dict[str, str]:
    quoting_by_name: dict[str, str] = {}
    for linked_rule in linked_rules:
        for variable in linked_rule.variables:
            previous_quoting = quoting_by_name.get(variable.name, "unquoted")
            if "unquoted" not in (previous_quoting, variable.quoting) and previous_quoting != variable.quoting:
                raise UnsupportedUpstreamData(
                    f"{where}: variable {variable.name} is {previous_quoting} quoted in one linked rule "
                    f"and {variable.quoting} quoted in another"
                )
            quoting_by_name[variable.name] = previous_quoting if previous_quoting != "unquoted" else variable.quoting
    return quoting_by_name


def _odvs(
    control: Control, linked_rules: list[DatastreamRule], datastream: Datastream, spec: BenchmarkSpec, where: str
) -> list[dict]:
    lowest_listed_level = min(control.levels, key=LEVELS.index)
    expanded_levels = levels_with_inheritance(control.levels)
    odvs = []
    for name, quoting in _merged_quoting(linked_rules, where).items():
        definition = datastream.value_definition(name)

        def value_for_level(level: str, name=name, datatype=definition.datatype):
            raw_value = datastream.value_for_profile(name, spec.level_profiles[level])
            return _typed_value(datatype, name, raw_value, where)

        recommended = value_for_level(lowest_listed_level)
        by_benchmark = {benchmark_name(level): value_for_level(level) for level in expanded_levels}
        for shown_value in (recommended, *by_benchmark.values()):
            problem = display_gate_problem(quoting, shown_value)
            if problem:
                raise UnsupportedUpstreamData(f"{where}: variable {name}: {problem}")
        odvs.append(
            {
                "name": name,
                "datatype": definition.datatype,
                "description": definition.title,
                "validation": None,
                "recommended": recommended,
                "by_benchmark": by_benchmark,
                "quoting": quoting,
            }
        )
    return odvs


def _typed_value(datatype: str, name: str, raw_value: str, where: str) -> str | int:
    if datatype != "number":
        return raw_value
    try:
        return int(raw_value)
    except ValueError:
        raise UnsupportedUpstreamData(f"{where}: number variable {name} has non-integer value {raw_value!r}") from None
