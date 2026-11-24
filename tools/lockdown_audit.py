"""Read an ansible-lockdown Windows CIS Audit repo (goss tests for one benchmark).

An Audit repo (for example Windows-2022-CIS-Audit) holds one `cis_<ID>.yml` per control and a
`coverage.json` listing every rule with its clean title and gate (design
2026-11-20-windows-cis-lockdown-design.md, section 4). The control files are Go-template YAML
(`{{ if .Vars.x }}` lines at column 0), so they are not parsed as YAML: the text is kept
verbatim, and only the `meta:` block is read, on its own.

The files are untrusted input and are only ever read, never run or rendered.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

COVERAGE_FILE = "coverage.json"
META_LINE_PATTERN = re.compile(r"^(?P<indent>[ \t]*)meta:[ \t]*$")
TEMPLATE_DIRECTIVE_PATTERN = re.compile(r"^\s*\{\{.*\}\}\s*$")


class AuditParseError(ValueError):
    """The Audit repo's coverage.json or a control file could not be read."""


@dataclass(frozen=True)
class AuditControl:
    """One rule of the Audit repo. `goss_text` is the control file verbatim, None when the repo has no test for it.

    `gate` is the template variable that turns the test on (for example `win22cis_level_1`), also None
    without a test. `meta` is the first `meta:` mapping of the file (profile levels, `CIS_ID`, NIST
    references), empty when there is none.
    """

    rule_id: str
    title: str
    gate: str | None
    goss_text: str | None
    meta: dict
    file: str | None = None


def indentation_width(line: str) -> int:
    return len(line) - len(line.lstrip(" \t"))


def meta_block_of(goss_text: str) -> dict:
    """The mapping under the first `meta:` line, read from its indented lines alone.

    A line that is only a template directive (`{{ end }}`) is dropped; both branches of an `if` stay.
    """
    lines = goss_text.splitlines()
    for position, line in enumerate(lines):
        matched = META_LINE_PATTERN.match(line)
        if matched is None:
            continue
        meta_indent = len(matched["indent"])
        block = []
        for following in lines[position + 1 :]:
            if following.strip() and indentation_width(following) <= meta_indent:
                break
            if not TEMPLATE_DIRECTIVE_PATTERN.match(following):
                block.append(following)
        try:
            meta = yaml.safe_load("\n".join(block))
        except yaml.YAMLError as error:
            raise AuditParseError(f"meta block is not YAML: {error}") from error
        return meta if isinstance(meta, dict) else {}
    return {}


def read_text(file_path: Path) -> str:
    try:
        return file_path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise AuditParseError(f"{file_path}: {error}") from error


def load_audit(audit_dir: Path) -> dict[str, AuditControl]:
    """Every rule of the Audit repo's coverage.json, keyed by rule id, in coverage order."""
    coverage_path = audit_dir / COVERAGE_FILE
    try:
        coverage = json.loads(read_text(coverage_path))
    except json.JSONDecodeError as error:
        raise AuditParseError(f"{coverage_path}: {error}") from error
    if not isinstance(coverage, list):
        raise AuditParseError(f"{coverage_path}: expected a list of rules")
    controls: dict[str, AuditControl] = {}
    for entry in coverage:
        try:
            rule_id, title = str(entry["rule_id"]), entry["title"]
        except (KeyError, TypeError) as error:
            raise AuditParseError(f"{coverage_path}: a rule has no rule_id or title") from error
        if rule_id in controls:
            raise AuditParseError(f"{coverage_path}: rule {rule_id} is listed twice")
        goss_text, gate = None, None
        if entry.get("emitted") and entry.get("file"):
            control_path = (audit_dir / entry["file"]).resolve()
            if not control_path.is_relative_to(audit_dir.resolve()):
                raise AuditParseError(f"{coverage_path}: rule {rule_id} names a file outside the repo")
            goss_text = read_text(control_path)
            gate = entry.get("gate")
        controls[rule_id] = AuditControl(
            rule_id=rule_id,
            title=title,
            gate=gate,
            goss_text=goss_text,
            meta=meta_block_of(goss_text) if goss_text is not None else {},
            file=entry["file"] if goss_text is not None else None,
        )
    return controls
