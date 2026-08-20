"""Validate control spec JSON files against specs/_control_spec.schema.json.

A control spec is the fact-only intermediate artifact the independent-
authoring pipeline (sub-project 2) produces: mechanism facts, a fixed
rationale vocabulary, and the spec author's own independently-written
statement of intent. It holds no source framework's own copyrightable
expression by construction - see docs/plans/2026-08-20-multi-framework-
rule-library-foundation-plan.md.
"""

import json
import sys
from pathlib import Path

import jsonschema

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "specs" / "_control_spec.schema.json"


def load_schema():
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def find_spec_files(root_dir):
    root_dir = Path(root_dir)
    if root_dir.is_file():
        return [] if root_dir.name.startswith("_") else [root_dir]
    return sorted(
        path for path in root_dir.rglob("*.json")
        if not path.name.startswith("_")
    )


def schema_errors(spec, validator):
    return [f"{error.json_path}: {error.message}" for error in validator.iter_errors(spec)]


def validate_spec_file(spec_path, validator):
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    return schema_errors(spec, validator)


def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "specs"
    validator = jsonschema.Draft202012Validator(load_schema())

    spec_files = find_spec_files(root_dir)
    if not spec_files:
        print(f"No spec files found under {root_dir}")
        return 0

    failed = False
    for spec_path in spec_files:
        errors = validate_spec_file(spec_path, validator)
        if errors:
            failed = True
            print(f"FAIL {spec_path}")
            for error in errors:
                print(f"  - {error}")

    if not failed:
        print(f"OK - {len(spec_files)} spec file(s) valid under {root_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
