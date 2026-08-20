"""Generate a per-folder _index.json manifest for rule JSON files.

Point this at baselines/ and it walks the tree, groups rule files by their
containing folder, and writes one _index.json into every folder that
directly holds rule files - not a single root-level index. New
benchmark/platform/version folders are picked up automatically; nothing
about the folder layout is hardcoded here.

Only pass a root that's baselines/ itself (or a folder under it) - a rule
file is duck-typed (JSON object with id/title/benchmark keys) to keep the
usual case safe, but a broad enough root can still contain other JSON that
happens to match that shape and pick up an unwanted _index.json alongside it.

Each _index.json holds only the scalar metadata a consumer needs to filter
and browse rules (id, title, assessment_status, benchmark, profile
applicability, recommended_state) plus every variable a rule's check_command
steps assign, so a rule-selection tool can flag cross-rule variable
collisions without re-parsing every full rule file. It deliberately omits a
generated-at timestamp - re-running this script over an unchanged ruleset
should produce a byte-identical file, so the index diffs cleanly in git and
only changes when a rule actually changes.

The indexed assessment_status is computed, not copied from the rule file:
it's "Automated" if the rule has at least one scripted audit method with a
real output_check attached, and "Manual" otherwise - regardless of what the
benchmark itself calls the assessment method. This is what a rule-selection
tool should filter/gate script generation on, since a benchmark's own label
(e.g. CIS marking something "Manual") doesn't always match whether this repo
has actually engineered a working check_command for it. The untouched
original label is still available under source_assessment_status.
"""

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools.validate_rules import assigned_variables  # noqa: E402

INDEX_FILENAME = "_index.json"

# A leading underscore marks a generated/meta artifact, never a rule to
# index - _index.json itself, baselines/_rule.schema.json, anything else
# added under this convention later.
GENERATED_ARTIFACT_PREFIX = "_"

# Never worth recursing into if this script is pointed at a broad root (e.g.
# the repo root instead of baselines/) - dotfolders (.venv, .git, ...) and a
# couple of common non-dot build/cache folders have no rule files but are
# large enough that walking them is pure waste.
SKIPPED_DIR_NAMES = {"node_modules", "__pycache__"}


def is_skipped_dir(dirname):
    return dirname.startswith(".") or dirname in SKIPPED_DIR_NAMES


REQUIRED_RULE_KEYS = {"id", "title", "framework_mappings"}


def looks_like_rule_file(path):
    """Duck-type a rule file instead of trusting "any .json in this folder" -
    a directory search rooted above baselines/ (by mistake, or because a
    future ruleset lives somewhere new) will otherwise pick up unrelated
    JSON - skill example fixtures, anything else - and write a bogus
    _index.json next to it.
    """
    try:
        rule = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    return isinstance(rule, dict) and REQUIRED_RULE_KEYS.issubset(rule.keys())


def find_rule_folders(root_dir):
    """Map each folder that directly contains rule files to its list of rule files."""
    folders = {}
    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [d for d in dirnames if not is_skipped_dir(d)]
        rule_files = [
            path
            for filename in filenames
            if filename.endswith(".json") and not filename.startswith(GENERATED_ARTIFACT_PREFIX)
            for path in [Path(dirpath) / filename]
            if looks_like_rule_file(path)
        ]
        if rule_files:
            folders[Path(dirpath)] = rule_files
    return folders


def rule_variables(rule):
    variables = set()
    for method in rule.get("audit", {}).get("methods", []):
        for step in method.get("steps", []):
            variables |= assigned_variables(step.get("check_command") or "")
    return sorted(variables)


def is_automated(rule):
    """True if at least one scripted audit method has a real compliance
    check attached - i.e. this repo can generate a script for it,
    regardless of what the benchmark itself calls the assessment method.
    CIS's own assessment_status label reflects the benchmark's general
    judgment, not whether this repo has actually engineered a working
    check_command for it, and real data already diverges on that point.
    """
    return any(
        method.get("type") == "scripted" and any(step.get("output_check") for step in method.get("steps", []))
        for method in rule.get("audit", {}).get("methods", [])
    )


def requires_organization_defined_value(rule):
    """True if selecting this rule leaves at least one output_check whose
    pass/fail target has to come from whoever configures the policy, not
    from the benchmark - so a rule-selection tool knows to prompt for a
    value rather than generating a fully self-contained check.
    """
    for method in rule.get("audit", {}).get("methods", []):
        for step in method.get("steps", []):
            for output_check in step.get("output_check", []):
                if output_check.get("value_source") == "organization_defined":
                    return True
    return False


def rule_summary(rule_path):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))
    return {
        "file": rule_path.name,
        "id": rule.get("id"),
        "title": rule.get("title"),
        "assessment_status": "Automated" if is_automated(rule) else "Manual",
        "source_assessment_status": rule.get("assessment_status"),
        "framework_mappings": rule.get("framework_mappings"),
        "policy_classification": rule.get("policy_classification"),
        "recommended_state": rule.get("recommended_state"),
        "requires_organization_defined_value": requires_organization_defined_value(rule),
        "variables": rule_variables(rule),
    }


def build_index(rule_files):
    rules = sorted(
        (rule_summary(rule_path) for rule_path in rule_files),
        key=lambda summary: (summary["id"] or "", summary["file"]),
    )
    return {"rules": rules}


def write_index(folder, rule_files):
    index = build_index(rule_files)
    index_path = folder / INDEX_FILENAME
    index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return index_path


def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "baselines"
    folders = find_rule_folders(root_dir)

    if not folders:
        print(f"No rule files found under {root_dir}")
        return 1

    for folder in sorted(folders):
        index_path = write_index(folder, folders[folder])
        print(f"{index_path} <- {len(folders[folder])} rule(s)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
