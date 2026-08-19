"""Validate _metadata.json file(s) against baselines/_metadata.schema.json.

Schema validation only - unlike validate_rules.py there are no cross-field
checks to run here, since _metadata.json has no cross-referencing fields
like check_command/output_check to keep consistent with each other.
"""

import json
import sys
from pathlib import Path

import jsonschema

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "baselines" / "_metadata.schema.json"
METADATA_FILENAME = "_metadata.json"


def load_schema():
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def find_metadata_files(root_dir):
    root_dir = Path(root_dir)
    if root_dir.is_file():
        return [root_dir] if root_dir.name == METADATA_FILENAME else []
    return sorted(root_dir.rglob(METADATA_FILENAME))


def schema_errors(metadata, validator):
    return [f"{error.json_path}: {error.message}" for error in validator.iter_errors(metadata)]


def validate_metadata_file(metadata_path, validator):
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    return schema_errors(metadata, validator)


def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "baselines"
    validator = jsonschema.Draft202012Validator(load_schema())

    metadata_files = find_metadata_files(root_dir)
    if not metadata_files:
        print(f"No {METADATA_FILENAME} files found under {root_dir}")
        return 0

    failed = False
    for metadata_path in metadata_files:
        errors = validate_metadata_file(metadata_path, validator)
        if errors:
            failed = True
            print(f"FAIL {metadata_path}")
            for error in errors:
                print(f"  - {error}")

    if not failed:
        print(f"OK - {len(metadata_files)} metadata file(s) valid under {root_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
