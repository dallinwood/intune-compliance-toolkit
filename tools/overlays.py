"""Validate maintainer-written overlays under baselines/_overlays/rules/ against the committed library.

An overlay adds to or replaces fields on imported rules without touching
baselines/. The web UI applies overlays as it displays rules
(webui/src/logic/overlays.ts); this module carries its own copy of the
merge rules for CI. Both copies are pinned by
tests/fixtures/overlays/cases.json so they cannot drift.
"""

import copy
import json
import re
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.file_references import file_reference_errors
from tools.library_output import SCHEMA_VERSION
from tools.validate_library import load_schema

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OVERLAYS_DIR = REPOSITORY_ROOT / "baselines" / "_overlays" / "rules"
DEFAULT_BASELINES_DIR = REPOSITORY_ROOT / "baselines"

OVERLAY_SCHEMA_VERSION = 1
MANIFEST_FILE_NAME = "_manifest.json"
OVERLAY_ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]*")
REQUIRED_OVERLAY_KEYS = frozenset({"schema_version", "id", "targets", "fields"})
ALLOWED_OVERLAY_KEYS = REQUIRED_OVERLAY_KEYS | {"description"}
TARGET_KEYS = frozenset({"rule", "release"})

PROTECTED_FIELDS = frozenset({"id", "source", "file", "schema_version"})
REPLACE_WRAPPER = "$replace"
APPEND_WRAPPER = "$append"
MERGE_WRAPPER = "$merge"
WRAPPER_KEYS = frozenset({REPLACE_WRAPPER, APPEND_WRAPPER, MERGE_WRAPPER})
# A JavaScript object with these keys would reach its prototype, so the web
# UI's copy of the merge rejects them; this copy matches it.
RESERVED_KEYS = frozenset({"__proto__", "constructor", "prototype"})

# Index entries are copies of these rule fields; every other overlay field
# only exists on the full rule and is ignored at index level.
ODV_REQUIRED_KEYS = frozenset({"datatype", "description", "validation", "recommended", "by_benchmark"})
INDEX_OVERLAY_FIELDS = frozenset({"title", "section_path", "assessment", "architecture", "applicability", "tags"})


class InvalidOverlay(ValueError):
    """An overlay that cannot be applied: bad shape, protected field, or type mismatch."""


class OverlayWarning(UserWarning):
    """A problem worth a maintainer's look that does not make an overlay invalid."""


class _Absent:
    def __repr__(self) -> str:
        return "<absent>"


ABSENT = _Absent()


def _kind_of(value: object) -> str:
    if value is ABSENT:
        return "absent"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "list"
    return "object"


def _wrapper_of(value: dict, path: str) -> tuple[str, object] | None:
    dollar_keys = [key for key in value if key.startswith("$")]
    if not dollar_keys:
        return None
    if len(value) != 1:
        raise InvalidOverlay(f"{path}: a wrapper object must have exactly one key, got {sorted(value)}")
    wrapper_key = dollar_keys[0]
    if wrapper_key not in WRAPPER_KEYS:
        raise InvalidOverlay(f"{path}: unknown wrapper {wrapper_key!r} (expected one of {sorted(WRAPPER_KEYS)})")
    return wrapper_key, value[wrapper_key]


def _reserved_key_error(value: object, path: str) -> str | None:
    if isinstance(value, list):
        for position, item in enumerate(value):
            problem = _reserved_key_error(item, f"{path}[{position}]")
            if problem:
                return problem
    elif isinstance(value, dict):
        for key, child in value.items():
            if key in RESERVED_KEYS:
                return f"{path}: key {key!r} is not allowed"
            problem = _reserved_key_error(child, f"{path}.{key}")
            if problem:
                return problem
    return None


# Upstream null merges and appends as if the field were absent, so a partial
# object can fill in a field upstream left empty (such as check: null).
def _append(upstream: object, entries: list, path: str) -> list:
    if upstream is ABSENT or upstream is None:
        return copy.deepcopy(entries)
    if not isinstance(upstream, list):
        raise InvalidOverlay(f"{path}: cannot append a list to a {_kind_of(upstream)} value")
    return copy.deepcopy(upstream) + copy.deepcopy(entries)


def _merge_object(upstream: object, overlay_object: dict, path: str) -> dict:
    if upstream is ABSENT or upstream is None:
        merged: dict = {}
    elif isinstance(upstream, dict):
        merged = copy.deepcopy(upstream)
    else:
        raise InvalidOverlay(f"{path}: cannot merge an object into a {_kind_of(upstream)} value")
    for key, value in overlay_object.items():
        if key.startswith("$"):
            raise InvalidOverlay(f"{path}: key {key!r} starts with $, which is reserved for wrappers")
        merged[key] = _merge_value(merged.get(key, ABSENT), value, f"{path}.{key}")
    return merged


def _merge_value(upstream: object, value: object, path: str) -> object:
    if isinstance(value, list):
        return _append(upstream, value, path)
    if not isinstance(value, dict):
        return copy.deepcopy(value)
    wrapper = _wrapper_of(value, path)
    if wrapper is None:
        return _merge_object(upstream, value, path)
    wrapper_key, wrapped = wrapper
    if wrapper_key == REPLACE_WRAPPER:
        return copy.deepcopy(wrapped)
    if wrapper_key == APPEND_WRAPPER:
        if not isinstance(wrapped, list):
            raise InvalidOverlay(f"{path}: $append takes a list, got a {_kind_of(wrapped)}")
        return _append(upstream, wrapped, path)
    if not isinstance(wrapped, dict):
        raise InvalidOverlay(f"{path}: $merge takes an object, got a {_kind_of(wrapped)}")
    return _merge_object(upstream, wrapped, path)


def apply_overlay_fields(rule: dict, fields: dict, known_fields: set[str] | None = None) -> dict:
    """Return a new rule with `fields` merged in; neither input is changed.

    With `known_fields`, top-level fields outside it are skipped. Protected
    fields are rejected either way, since setting one is always a mistake.
    """
    protected = sorted(PROTECTED_FIELDS & fields.keys())
    if protected:
        raise InvalidOverlay(f"protected field(s) cannot be overlaid: {', '.join(protected)}")
    for field_name, value in fields.items():
        problem = _reserved_key_error({field_name: value}, "fields")
        if problem:
            raise InvalidOverlay(problem)
    merged = copy.deepcopy(rule)
    for field_name, value in fields.items():
        if known_fields is not None and field_name not in known_fields:
            continue
        merged[field_name] = _merge_value(rule.get(field_name, ABSENT), value, field_name)
    return merged


def apply_overlay_to_index_entry(entry: dict, fields: dict) -> dict:
    """Apply an overlay to an index entry, then recompute the derived fields.

    An index entry has no odv, only has_odv, so it is stood in for by an
    empty object or null. An odv the rule did not have must arrive complete,
    or has_odv would promise a value the rule cannot supply.
    """
    seeded = copy.deepcopy(entry)
    seeded["odv"] = {} if entry["has_odv"] else None
    merged = apply_overlay_fields(seeded, fields, INDEX_OVERLAY_FIELDS | {"odv"})
    odv = merged.pop("odv")
    if not entry["has_odv"] and odv is not None:
        missing = sorted(ODV_REQUIRED_KEYS - odv.keys()) if isinstance(odv, dict) else sorted(ODV_REQUIRED_KEYS)
        if missing:
            raise InvalidOverlay(f"odv: a rule without an odv needs a complete one, missing {', '.join(missing)}")
    merged["has_odv"] = odv is not None
    section_path = merged.get("section_path")
    if isinstance(section_path, list) and section_path:
        merged["section"] = section_path[0]
    return merged


def overlay_file_names(directory: Path) -> list[str]:
    """The published overlay files, in the order they apply (the manifest's order)."""
    if not directory.is_dir():
        return []
    return sorted(
        path.name
        for path in directory.iterdir()
        if path.is_file()
        and path.suffix == ".json"
        and not path.name.startswith(".")
        and path.name != MANIFEST_FILE_NAME
    )


def load_overlays(directory: Path) -> list[dict]:
    """Read every overlay file in apply order.

    Each entry is {"file_name", "overlay"} for readable JSON (not yet
    validated) or {"file_name", "error"} for a file that cannot be read.
    """
    loaded: list[dict] = []
    for file_name in overlay_file_names(directory):
        try:
            overlay = json.loads((directory / file_name).read_text(encoding="utf-8"))
        except (OSError, ValueError) as problem:
            loaded.append({"file_name": file_name, "error": f"cannot read JSON ({problem})"})
            continue
        loaded.append({"file_name": file_name, "overlay": overlay})
    return loaded


def _is_text(value: object) -> bool:
    return isinstance(value, str) and value != ""


def structure_errors(overlay: object) -> list[str]:
    if not isinstance(overlay, dict):
        return ["an overlay must be a JSON object"]
    errors: list[str] = []
    missing = sorted(REQUIRED_OVERLAY_KEYS - overlay.keys())
    if missing:
        errors.append(f"missing key(s): {', '.join(missing)}")
    unexpected = sorted(overlay.keys() - ALLOWED_OVERLAY_KEYS)
    if unexpected:
        errors.append(f"unexpected key(s): {', '.join(unexpected)}")

    schema_version = overlay.get("schema_version")
    # bool is an int in Python, and True == 1.
    if "schema_version" in overlay and not (type(schema_version) is int and schema_version == OVERLAY_SCHEMA_VERSION):
        errors.append(f"schema_version must be {OVERLAY_SCHEMA_VERSION}, got {schema_version!r}")
    overlay_id = overlay.get("id")
    if "id" in overlay and not (isinstance(overlay_id, str) and OVERLAY_ID_PATTERN.fullmatch(overlay_id)):
        errors.append(f"id must match ^[a-z0-9][a-z0-9-]*$, got {overlay_id!r}")
    if "description" in overlay and not isinstance(overlay["description"], str):
        errors.append("description must be a string")

    targets = overlay.get("targets")
    if "targets" in overlay:
        if not isinstance(targets, list) or not targets:
            errors.append("targets must be a non-empty list")
        else:
            for position, target in enumerate(targets):
                if not (
                    isinstance(target, dict)
                    and target.keys() == TARGET_KEYS
                    and _is_text(target["rule"])
                    and _is_text(target["release"])
                ):
                    errors.append(f"targets[{position}] must be an object with exactly a rule and a release string")

    if "fields" in overlay:
        fields = overlay["fields"]
        if not isinstance(fields, dict):
            errors.append("fields must be an object")
        else:
            protected = sorted(PROTECTED_FIELDS & fields.keys())
            if protected:
                errors.append(f"protected field(s) cannot be overlaid: {', '.join(protected)}")
            reserved = _reserved_key_error(fields, "fields")
            if reserved:
                errors.append(reserved)
    return errors


def _resolve(schema: dict, root_schema: dict) -> dict:
    while "$ref" in schema:
        definition_name = schema["$ref"].removeprefix("#/$defs/")
        schema = root_schema["$defs"][definition_name]
    return schema


def _object_schema(schema: dict, root_schema: dict) -> dict | None:
    candidates = [schema, *schema.get("oneOf", []), *schema.get("anyOf", [])]
    for candidate in candidates:
        candidate = _resolve(candidate, root_schema)
        if "properties" in candidate or isinstance(candidate.get("additionalProperties"), (bool, dict)):
            return candidate
    return None


def drop_unknown_keys(instance: object, schema: dict, root_schema: dict, path: str = "") -> tuple[object, list[str]]:
    """Remove keys the schema does not allow where it closes an object.

    Returns the cleaned copy and the dotted paths of the keys removed. Open
    objects (such as references) keep every key.
    """
    unknown_paths: list[str] = []

    def clean(value: object, value_schema: dict, value_path: str) -> object:
        value_schema = _resolve(value_schema, root_schema)
        if isinstance(value, dict):
            object_schema = _object_schema(value_schema, root_schema)
            if object_schema is None:
                return copy.deepcopy(value)
            properties = object_schema.get("properties", {})
            additional = object_schema.get("additionalProperties", True)
            cleaned: dict = {}
            for key, child in value.items():
                child_path = f"{value_path}.{key}" if value_path else key
                if key in properties:
                    cleaned[key] = clean(child, properties[key], child_path)
                elif additional is False:
                    unknown_paths.append(child_path)
                elif isinstance(additional, dict):
                    cleaned[key] = clean(child, additional, child_path)
                else:
                    cleaned[key] = copy.deepcopy(child)
            return cleaned
        if isinstance(value, list) and isinstance(value_schema.get("items"), dict):
            return [clean(item, value_schema["items"], f"{value_path}[{position}]") for position, item in enumerate(value)]
        return copy.deepcopy(value)

    return clean(instance, schema, path), unknown_paths


def single_value_paths(fields: dict) -> list[str]:
    """Paths an overlay sets to one value (replace), as opposed to appending."""
    paths: list[str] = []

    def walk(value: object, path: str) -> None:
        if isinstance(value, list):
            return
        if not isinstance(value, dict):
            paths.append(path)
            return
        wrapper_keys = [key for key in value if key in WRAPPER_KEYS]
        if len(value) == 1 and wrapper_keys:
            wrapper_key = wrapper_keys[0]
            if wrapper_key == REPLACE_WRAPPER:
                paths.append(path)
            elif wrapper_key == MERGE_WRAPPER and isinstance(value[wrapper_key], dict):
                for key, child in value[wrapper_key].items():
                    walk(child, f"{path}.{key}")
            return
        for key, child in value.items():
            walk(child, f"{path}.{key}")

    for field_name, value in fields.items():
        walk(value, field_name)
    return paths


def _load_library(baselines_dir: Path) -> dict[str, dict]:
    """Every committed rule id -> its source name, index entry and rule file path."""
    manifest = json.loads((baselines_dir / "_manifest.json").read_text(encoding="utf-8"))
    library: dict[str, dict] = {}
    for source in manifest["sources"]:
        index_path = baselines_dir / source["index_path"]
        index = json.loads(index_path.read_text(encoding="utf-8"))
        for entry in index["rules"]:
            library[entry["id"]] = {
                "source_name": source["name"],
                "entry": entry,
                "rule_path": index_path.parent / entry["file"],
            }
    return library


def _structurally_valid_overlays(directory: Path, errors: list[str]) -> list[tuple[str, dict]]:
    valid: list[tuple[str, dict]] = []
    file_name_by_id: dict[str, str] = {}
    for loaded in load_overlays(directory):
        file_name = loaded["file_name"]
        if "error" in loaded:
            errors.append(f"{file_name}: {loaded['error']}")
            continue
        overlay = loaded["overlay"]
        problems = structure_errors(overlay)
        if problems:
            errors.extend(f"{file_name}: {problem}" for problem in problems)
            continue
        if overlay["id"] in file_name_by_id:
            errors.append(f"{file_name}: id {overlay['id']!r} is already used by {file_name_by_id[overlay['id']]}")
            continue
        file_name_by_id[overlay["id"]] = file_name
        valid.append((file_name, overlay))
    return valid


def _overlays_by_rule(
    valid_overlays: list[tuple[str, dict]], library: dict[str, dict], errors: list[str]
) -> dict[str, list[tuple[str, dict]]]:
    by_rule: dict[str, list[tuple[str, dict]]] = {}
    for file_name, overlay in valid_overlays:
        targeted: set[str] = set()
        for target in overlay["targets"]:
            rule_id = target["rule"]
            if rule_id not in library:
                errors.append(f"{file_name}: target rule {rule_id} does not exist in the committed library")
                continue
            if rule_id not in targeted:
                targeted.add(rule_id)
                by_rule.setdefault(rule_id, []).append((file_name, overlay))
    return by_rule


def _check_rule(
    rule_id: str,
    library_rule: dict,
    rule_overlays: list[tuple[str, dict]],
    errors: list[str],
    overlay_warnings: list[str],
    repository_root: Path,
) -> dict:
    rule_schema = load_schema("rule")
    index_schema = load_schema("index")
    entry_schema = index_schema["properties"]["rules"]["items"]
    rule = json.loads(library_rule["rule_path"].read_text(encoding="utf-8"))
    entry = library_rule["entry"]

    merged_rule = rule
    merged_entry = entry
    applied_files: list[str] = []
    setter_by_path: dict[str, str] = {}
    reported_unknown_paths: set[str] = set()
    for file_name, overlay in rule_overlays:
        fields = overlay["fields"]
        try:
            next_rule = apply_overlay_fields(merged_rule, fields)
            next_entry = apply_overlay_to_index_entry(merged_entry, fields)
        except InvalidOverlay as problem:
            errors.append(f"{file_name}: {rule_id}: {problem}")
            continue
        _, unknown_paths = drop_unknown_keys(next_rule, rule_schema, rule_schema)
        new_unknown_paths = [path for path in unknown_paths if path not in reported_unknown_paths]
        reported_unknown_paths.update(new_unknown_paths)
        overlay_warnings.extend(f"{file_name}: {rule_id}: unknown key {path} is ignored" for path in new_unknown_paths)
        merged_rule, merged_entry = next_rule, next_entry
        applied_files.append(file_name)

        for path in single_value_paths(fields):
            if path in setter_by_path:
                overlay_warnings.append(
                    f"{rule_id}: {path} is set by both {setter_by_path[path]} and {file_name}; {file_name} wins"
                )
            setter_by_path[path] = file_name

    if not applied_files:
        return merged_rule
    overlay_names = ", ".join(applied_files)
    cleaned_rule, _ = drop_unknown_keys(merged_rule, rule_schema, rule_schema)
    rule_validator = Draft202012Validator(rule_schema)
    for problem in sorted(rule_validator.iter_errors(cleaned_rule), key=lambda error: list(error.absolute_path)):
        errors.append(f"{overlay_names}: {rule_id}: merged rule {problem.json_path}: {problem.message}")
    for problem in file_reference_errors(cleaned_rule, repository_root):
        errors.append(f"{overlay_names}: {rule_id}: merged rule {problem}")

    cleaned_entry, _ = drop_unknown_keys(merged_entry, entry_schema, index_schema)
    index_document = {"schema_version": SCHEMA_VERSION, "source": library_rule["source_name"], "rules": [cleaned_entry]}
    index_validator = Draft202012Validator(index_schema)
    for problem in sorted(index_validator.iter_errors(index_document), key=lambda error: list(error.absolute_path)):
        entry_path = problem.json_path.replace("$.rules[0]", "$", 1)
        errors.append(f"{overlay_names}: {rule_id}: merged index entry {entry_path}: {problem.message}")
    return cleaned_rule


def _validate(directory: Path, baselines_dir: Path) -> tuple[list[str], list[str], dict[str, dict]]:
    errors: list[str] = []
    overlay_warnings: list[str] = []
    merged_by_rule: dict[str, dict] = {}
    valid_overlays = _structurally_valid_overlays(directory, errors)
    if not valid_overlays:
        return errors, overlay_warnings, merged_by_rule
    library = _load_library(baselines_dir)
    for rule_id, rule_overlays in _overlays_by_rule(valid_overlays, library, errors).items():
        merged_by_rule[rule_id] = _check_rule(
            rule_id, library[rule_id], rule_overlays, errors, overlay_warnings, baselines_dir.resolve().parent
        )
    unique_warnings = list(dict.fromkeys(overlay_warnings))
    return errors, unique_warnings, merged_by_rule


def validate_overlays(directory: Path, baselines_dir: Path) -> tuple[list[str], list[str]]:
    """Check every overlay file; returns (errors, warnings), each a list of messages naming the file."""
    errors, overlay_warnings, _ = _validate(directory, baselines_dir)
    return errors, overlay_warnings


def merged_rules(directory: Path, baselines_dir: Path) -> dict[str, dict]:
    """The overlaid rules, keyed by rule id, as the UI would show them."""
    _, _, merged_by_rule = _validate(directory, baselines_dir)
    return merged_by_rule


def main(arguments: list[str]) -> int:
    overlays_dir = Path(arguments[0]) if arguments else DEFAULT_OVERLAYS_DIR
    baselines_dir = Path(arguments[1]) if len(arguments) > 1 else DEFAULT_BASELINES_DIR
    errors, overlay_warnings = validate_overlays(overlays_dir, baselines_dir)
    for warning in overlay_warnings:
        print(f"warning: {warning}", file=sys.stderr)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
