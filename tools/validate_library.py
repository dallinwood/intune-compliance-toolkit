"""Validate the normalized rule library under baselines/ against the v3 schemas,
plus the hand-edited display-name vocabulary when one is present."""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASELINES_DIR = REPOSITORY_ROOT / "baselines"
VOCABULARY_FILE_NAME = "_vocabulary.json"


def load_schema(name: str) -> dict:
    schema_path = REPOSITORY_ROOT / "baselines" / f"_{name}.schema.json"
    return json.loads(schema_path.read_text(encoding="utf-8"))


def schema_errors(instance: dict, schema_name: str = "rule") -> list[str]:
    validator = Draft202012Validator(load_schema(schema_name))
    errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.absolute_path))
    return [f"{error.json_path}: {error.message}" for error in errors]


def _validate_document(path: Path, schema_name: str, errors: list[str]) -> dict | None:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"{path}: file not found")
        return None
    except (OSError, ValueError) as problem:
        errors.append(f"{path}: cannot read JSON ({problem})")
        return None

    schema_problems = schema_errors(document, schema_name)
    errors.extend(f"{path}: {problem}" for problem in schema_problems)
    return None if schema_problems else document


def _validate_source(baselines_dir: Path, source: dict, errors: list[str]) -> None:
    index_path = baselines_dir / source["index_path"]
    index = _validate_document(index_path, "index", errors)
    if index is None:
        return

    if len(index["rules"]) != source["rule_count"]:
        errors.append(
            f"{index_path}: manifest rule_count {source['rule_count']} "
            f"does not match {len(index['rules'])} index entries"
        )

    for entry in index["rules"]:
        rule_path = index_path.parent / entry["file"]
        rule = _validate_document(rule_path, "rule", errors)
        if rule is not None and rule["id"] != entry["id"]:
            errors.append(
                f"{rule_path}: rule id {rule['id']} does not match index id {entry['id']}"
            )


def duplicate_term_errors(vocabulary_file: dict) -> list[str]:
    errors: list[str] = []
    for vocabulary_name, entries in vocabulary_file["vocabularies"].items():
        label_by_term: dict[str, str] = {}
        for entry in entries:
            for term in entry["terms"]:
                if term in label_by_term:
                    errors.append(
                        f"{vocabulary_name}: term {term!r} is listed under both "
                        f"{label_by_term[term]!r} and {entry['label']!r}"
                    )
                else:
                    label_by_term[term] = entry["label"]
    return errors


def _validate_vocabulary(baselines_dir: Path, errors: list[str]) -> None:
    vocabulary_path = baselines_dir / VOCABULARY_FILE_NAME
    if not vocabulary_path.exists():
        return
    vocabulary_file = _validate_document(vocabulary_path, "vocabulary", errors)
    if vocabulary_file is not None:
        errors.extend(f"{vocabulary_path}: {problem}" for problem in duplicate_term_errors(vocabulary_file))


def validate_library(baselines_dir: Path) -> list[str]:
    errors: list[str] = []
    _validate_vocabulary(baselines_dir, errors)
    manifest = _validate_document(baselines_dir / "_manifest.json", "manifest", errors)
    if manifest is None:
        return errors
    for source in manifest["sources"]:
        _validate_source(baselines_dir, source, errors)
    return errors


def main(arguments: list[str]) -> int:
    baselines_dir = Path(arguments[0]) if arguments else DEFAULT_BASELINES_DIR
    errors = validate_library(baselines_dir)
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
