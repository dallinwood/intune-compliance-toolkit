"""Validate rule JSON files against the schema in baselines/_rule.schema.json.

Covers everything the schema itself can express (required fields, enums,
value/value_source coupling, lookup-step output_check emptiness) plus two
cross-field checks a JSON Schema can't express on its own: every variable a
check_command assigns must be prefixed with the rule's own file-slug, and
every output_check variable must actually appear in that step's
check_command. See the skill's SKILL.md/schema.md for why these rules exist.
"""

import json
import re
import sys
from pathlib import Path

import jsonschema

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "baselines" / "_rule.schema.json"

POWERSHELL_ASSIGNMENT = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)\s*=")
BASH_ASSIGNMENT = re.compile(r"(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)=")


def load_schema():
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def find_rule_files(root_dir):
    """A leading underscore marks a generated/meta artifact (_index.json,
    _rule.schema.json), never a rule to validate - same convention the
    index generator uses.
    """
    root_dir = Path(root_dir)
    if root_dir.is_file():
        return [] if root_dir.name.startswith("_") else [root_dir]
    return sorted(
        path for path in root_dir.rglob("*.json")
        if not path.name.startswith("_")
    )


def assigned_variables(check_command):
    return set(POWERSHELL_ASSIGNMENT.findall(check_command)) | set(BASH_ASSIGNMENT.findall(check_command))


def file_slug(rule_path):
    return rule_path.stem.lower().replace(".", "_")


def schema_errors(rule, validator):
    return [f"{error.json_path}: {error.message}" for error in validator.iter_errors(rule)]


def convention_errors(rule, slug):
    """Cross-field checks a JSON Schema can't express: variable prefixing and
    output_check/check_command consistency. `slug` is filename-derived, so
    this only makes sense for real rule files (see references/schema.md's
    file-naming convention) - not the bundled skill examples, which use
    descriptive filenames on purpose.
    """
    errors = []
    for method in rule.get("audit", {}).get("methods", []):
        for step in method.get("steps", []):
            check_command = step.get("check_command") or ""
            for variable in assigned_variables(check_command):
                if not variable.startswith(slug):
                    errors.append(
                        f"variable '{variable}' is not prefixed with file slug '{slug}'"
                    )
            for output_check in step.get("output_check", []):
                variable = output_check.get("variable", "")
                if variable not in check_command:
                    errors.append(
                        f"output_check variable '{variable}' does not appear in its step's check_command"
                    )
    return errors


def validate_rule_file(rule_path, validator):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))
    errors = schema_errors(rule, validator)
    errors.extend(convention_errors(rule, file_slug(rule_path)))
    return errors


def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "baselines"
    validator = jsonschema.Draft202012Validator(load_schema())

    rule_files = find_rule_files(root_dir)
    if not rule_files:
        print(f"No rule files found under {root_dir}")
        return 0

    failed = False
    for rule_path in rule_files:
        errors = validate_rule_file(rule_path, validator)
        if errors:
            failed = True
            print(f"FAIL {rule_path}")
            for error in errors:
                print(f"  - {error}")

    if not failed:
        print(f"OK - {len(rule_files)} rule file(s) valid under {root_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
