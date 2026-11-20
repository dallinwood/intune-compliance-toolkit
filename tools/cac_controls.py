"""Read a ComplianceAsCode CIS control file into normalized controls."""

import re
from dataclasses import dataclass

from tools.cac_benchmarks import LEVEL_INHERITANCE, LEVELS, BenchmarkSpec
from tools.library_output import UnsupportedUpstreamData

CIS_ID_PATTERN = re.compile(r"^[0-9]+(?:\.[0-9]+)*(?![\s\S])")
KNOWN_CONTROL_KEYS = {"id", "title", "levels", "status", "rules", "related_rules", "notes"}
VARIABLE_SETTING_MARKER = "="
OPENSCAP_ASSESSMENT = {"status": "manual", "manual_reason": "openscap"}
ASSESSMENT_BY_STATUS = {
    "automated": OPENSCAP_ASSESSMENT,
    "partial": OPENSCAP_ASSESSMENT,
    "supported": OPENSCAP_ASSESSMENT,
    "manual": {"status": "manual", "manual_reason": "manual"},
    "pending": {"status": "manual", "manual_reason": "no_check"},
    "not applicable": {"status": "manual", "manual_reason": "n_a"},
    "inherently met": {"status": "manual", "manual_reason": "inherent"},
}


@dataclass(frozen=True)
class Control:
    cis_id: str
    title: str
    levels: tuple[str, ...]
    status: str
    rule_ids: tuple[str, ...]
    related_rule_ids: tuple[str, ...]
    notes: str | None


def read_controls(document: dict, spec: BenchmarkSpec) -> tuple[str, list[Control]]:
    if not isinstance(document, dict):
        raise UnsupportedUpstreamData(f"{spec.source_name}: control file is not a mapping")
    version = document.get("version")
    if not isinstance(version, str) or not version:
        raise UnsupportedUpstreamData(f"{spec.source_name}: control file version {version!r} is not a string")
    declared_levels = [level.get("id") if isinstance(level, dict) else level for level in document.get("levels") or []]
    if sorted(declared_levels, key=str) != sorted(LEVELS):
        raise UnsupportedUpstreamData(f"{spec.source_name}: unexpected levels {declared_levels!r}")
    raw_controls = document.get("controls")
    if not isinstance(raw_controls, list):
        raise UnsupportedUpstreamData(f"{spec.source_name}: control file has no controls list")

    controls = []
    seen_ids = set()
    for raw_control in raw_controls:
        if not isinstance(raw_control, dict):
            raise UnsupportedUpstreamData(f"{spec.source_name}: control entry {raw_control!r} is not a mapping")
        control_id = raw_control.get("id")
        if not isinstance(control_id, str):
            raise UnsupportedUpstreamData(f"{spec.source_name}: control id {control_id!r} is not a string")
        if control_id in seen_ids:
            raise UnsupportedUpstreamData(f"{spec.source_name}: duplicate control {control_id}")
        seen_ids.add(control_id)
        if control_id in spec.helper_control_ids:
            continue
        if not CIS_ID_PATTERN.match(control_id):
            raise UnsupportedUpstreamData(
                f"{spec.source_name}: control {control_id} is neither a CIS number nor a listed helper"
            )
        controls.append(_read_control(raw_control, control_id, spec))
    return version, controls


def _read_control(raw_control: dict, control_id: str, spec: BenchmarkSpec) -> Control:
    where = f"{spec.source_name} control {control_id}"
    unknown_keys = set(raw_control) - KNOWN_CONTROL_KEYS
    if unknown_keys:
        raise UnsupportedUpstreamData(f"{where}: unknown keys {sorted(unknown_keys)}")
    title = raw_control.get("title")
    if not isinstance(title, str) or not title:
        raise UnsupportedUpstreamData(f"{where}: missing title")
    levels = _string_list(raw_control.get("levels"), "levels", where)
    if not levels or any(level not in LEVELS for level in levels):
        raise UnsupportedUpstreamData(f"{where}: unsupported levels {levels!r}")
    status = raw_control.get("status")
    assessment(status, where)
    rule_ids = tuple(
        rule_id
        for rule_id in _string_list(raw_control.get("rules"), "rules", where)
        if VARIABLE_SETTING_MARKER not in rule_id
    )
    related_rule_ids = tuple(_string_list(raw_control.get("related_rules"), "related_rules", where))
    notes = raw_control.get("notes")
    if notes is not None and not isinstance(notes, str):
        raise UnsupportedUpstreamData(f"{where}: notes are not a string")
    return Control(control_id, title, tuple(levels), status, rule_ids, related_rule_ids, notes)


def _string_list(value, key: str, where: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise UnsupportedUpstreamData(f"{where}: {key} is not a list of strings")
    return value


def section_path(cis_id: str) -> list[str]:
    """The sections containing a recommendation: its id's prefixes, not the id itself."""
    parts = cis_id.split(".")
    if len(parts) < 2:
        raise UnsupportedUpstreamData(f"CIS id {cis_id!r} has no parent section")
    return [".".join(parts[: length + 1]) for length in range(len(parts) - 1)]


def levels_with_inheritance(levels: tuple[str, ...]) -> list[str]:
    expanded = set(levels)
    for higher_level, lower_level in LEVEL_INHERITANCE.items():
        if lower_level in levels:
            expanded.add(higher_level)
    return [level for level in LEVELS if level in expanded]


def benchmark_name(level: str) -> str:
    return f"cis_{level}"


def assessment(status: str, where: str) -> dict:
    if not isinstance(status, str) or status not in ASSESSMENT_BY_STATUS:
        raise UnsupportedUpstreamData(f"{where}: unsupported status {status!r}")
    return dict(ASSESSMENT_BY_STATUS[status])
