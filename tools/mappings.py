"""Validate maintainer-written rule mappings under baselines/_mappings/rules/ against the committed library.

A mapping file links rules of any sources with a typed relation
(docs/plans/2026-10-27-rule-mappings-design.md). Each link entry lists
`from` and `to` endpoints and expands to every (from, to) pair. The publish
step builds a by-rule index from these files (webui/src/logic/mappingIndex.ts)
that only checks their structure; this module is the CI gate.
"""

import json
import re
import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.file_references import PATH_SEGMENT_PATTERN

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MAPPINGS_DIR = REPOSITORY_ROOT / "baselines" / "_mappings" / "rules"
DEFAULT_BASELINES_DIR = REPOSITORY_ROOT / "baselines"

MAPPING_SCHEMA_VERSION = 1
MAPPING_ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9-]*")
REQUIRED_MAPPING_KEYS = frozenset({"schema_version", "id", "links"})
ALLOWED_MAPPING_KEYS = REQUIRED_MAPPING_KEYS | {"description"}
REQUIRED_LINK_KEYS = frozenset({"relation", "from", "to"})
ALLOWED_LINK_KEYS = REQUIRED_LINK_KEYS | {"note"}
ENDPOINT_KEYS = frozenset({"kind", "id", "release"})
RELATIONS = ("implements", "partially_implements", "related")
DIRECTED_RELATIONS = frozenset({"implements", "partially_implements"})
ENDPOINT_KINDS = frozenset({"rule"})


class MappingWarning(UserWarning):
    """A problem worth a maintainer's look that does not make a mapping invalid."""


def mapping_file_names(directory: Path) -> list[str]:
    """The mapping files to read, in file name order; hidden files are skipped like the publish copy skips them."""
    if not directory.is_dir():
        return []
    return sorted(
        path.name
        for path in directory.iterdir()
        if path.is_file() and path.suffix == ".json" and not path.name.startswith(".")
    )


def load_mappings(directory: Path) -> list[dict]:
    """Read every mapping file in file name order.

    Each entry is {"file_name", "mapping"} for readable LF, UTF-8 JSON (not
    yet validated) or {"file_name", "error"} for a file that cannot be used.
    """
    loaded: list[dict] = []
    for file_name in mapping_file_names(directory):
        if not PATH_SEGMENT_PATTERN.fullmatch(file_name):
            loaded.append({"file_name": file_name, "error": "the file name must use only letters, digits, '.', '_' and '-'"})
            continue
        try:
            content = (directory / file_name).read_bytes()
        except OSError as problem:
            loaded.append({"file_name": file_name, "error": f"cannot read the file ({problem})"})
            continue
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            loaded.append({"file_name": file_name, "error": "the file is not UTF-8"})
            continue
        if "\r" in text:
            loaded.append({"file_name": file_name, "error": "the file must use LF line endings, not CRLF"})
            continue
        try:
            mapping = json.loads(text)
        except ValueError as problem:
            loaded.append({"file_name": file_name, "error": f"cannot read JSON ({problem})"})
            continue
        loaded.append({"file_name": file_name, "mapping": mapping})
    return loaded


def _is_text(value: object) -> bool:
    return isinstance(value, str) and value != ""


def _endpoint_errors(endpoint: object, path: str) -> list[str]:
    if not isinstance(endpoint, dict):
        return [f"{path} must be an object with kind, id and release"]
    errors: list[str] = []
    missing = sorted(ENDPOINT_KEYS - endpoint.keys())
    if missing:
        errors.append(f"{path}: missing key(s): {', '.join(missing)}")
    unexpected = sorted(endpoint.keys() - ENDPOINT_KEYS)
    if unexpected:
        errors.append(f"{path}: unexpected key(s): {', '.join(unexpected)}")
    # A kind that is not a string (such as a list) cannot be looked up in a set.
    if "kind" in endpoint and not (isinstance(endpoint["kind"], str) and endpoint["kind"] in ENDPOINT_KINDS):
        errors.append(f"{path}: unknown kind {endpoint['kind']!r} (expected one of {sorted(ENDPOINT_KINDS)})")
    if "id" in endpoint and not _is_text(endpoint["id"]):
        errors.append(f"{path}: id must be a non-empty string")
    if "release" in endpoint and not _is_text(endpoint["release"]):
        errors.append(f"{path}: release must be a non-empty string")
    return errors


def _link_errors(link: object, path: str) -> list[str]:
    if not isinstance(link, dict):
        return [f"{path} must be an object"]
    errors: list[str] = []
    missing = sorted(REQUIRED_LINK_KEYS - link.keys())
    if missing:
        errors.append(f"{path}: missing key(s): {', '.join(missing)}")
    unexpected = sorted(link.keys() - ALLOWED_LINK_KEYS)
    if unexpected:
        errors.append(f"{path}: unexpected key(s): {', '.join(unexpected)}")
    if "relation" in link and not (isinstance(link["relation"], str) and link["relation"] in RELATIONS):
        errors.append(f"{path}: unknown relation {link['relation']!r} (expected one of {list(RELATIONS)})")
    for side in ("from", "to"):
        if side not in link:
            continue
        endpoints = link[side]
        if not isinstance(endpoints, list) or not endpoints:
            errors.append(f"{path}.{side} must be a non-empty list")
            continue
        for position, endpoint in enumerate(endpoints):
            errors.extend(_endpoint_errors(endpoint, f"{path}.{side}[{position}]"))
    if "note" in link and link["note"] is not None and not isinstance(link["note"], str):
        errors.append(f"{path}.note must be a string or null")
    return errors


def structure_errors(mapping: object) -> list[str]:
    """Problems with a mapping file's shape alone, without the library."""
    if not isinstance(mapping, dict):
        return ["a mapping file must be a JSON object"]
    errors: list[str] = []
    missing = sorted(REQUIRED_MAPPING_KEYS - mapping.keys())
    if missing:
        errors.append(f"missing key(s): {', '.join(missing)}")
    unexpected = sorted(mapping.keys() - ALLOWED_MAPPING_KEYS)
    if unexpected:
        errors.append(f"unexpected key(s): {', '.join(unexpected)}")
    schema_version = mapping.get("schema_version")
    # bool is an int in Python, and True == 1.
    if "schema_version" in mapping and not (type(schema_version) is int and schema_version == MAPPING_SCHEMA_VERSION):
        errors.append(f"schema_version must be {MAPPING_SCHEMA_VERSION}, got {schema_version!r}")
    mapping_id = mapping.get("id")
    if "id" in mapping and not (isinstance(mapping_id, str) and MAPPING_ID_PATTERN.fullmatch(mapping_id)):
        errors.append(f"id must match ^[a-z0-9][a-z0-9-]*$, got {mapping_id!r}")
    if "description" in mapping and not isinstance(mapping["description"], str):
        errors.append("description must be a string")
    if "links" in mapping:
        links = mapping["links"]
        if not isinstance(links, list) or not links:
            errors.append("links must be a non-empty list")
        else:
            for position, link in enumerate(links):
                errors.extend(_link_errors(link, f"links[{position}]"))
    return errors


def expanded_pairs(mapping: dict) -> list[dict]:
    """Every (from, to) pair of a structurally valid mapping, in file order."""
    pairs: list[dict] = []
    for position, link in enumerate(mapping["links"]):
        for from_endpoint in link["from"]:
            for to_endpoint in link["to"]:
                pairs.append(
                    {
                        "link_position": position,
                        "relation": link["relation"],
                        "from": from_endpoint,
                        "to": to_endpoint,
                        "note": link.get("note"),
                    }
                )
    return pairs


def _load_library(baselines_dir: Path) -> dict[str, dict]:
    """Every committed rule id -> its source name and that source's current release tag."""
    manifest = json.loads((baselines_dir / "_manifest.json").read_text(encoding="utf-8"))
    library: dict[str, dict] = {}
    for source in manifest["sources"]:
        index = json.loads((baselines_dir / source["index_path"]).read_text(encoding="utf-8"))
        for entry in index["rules"]:
            library[entry["id"]] = {"source_name": source["name"], "release_tag": source["release_tag"]}
    return library


def _structurally_valid_mappings(directory: Path, errors: list[str]) -> list[tuple[str, dict]]:
    valid: list[tuple[str, dict]] = []
    file_name_by_id: dict[str, str] = {}
    for loaded in load_mappings(directory):
        file_name = loaded["file_name"]
        if "error" in loaded:
            errors.append(f"{file_name}: {loaded['error']}")
            continue
        mapping = loaded["mapping"]
        problems = structure_errors(mapping)
        if problems:
            errors.extend(f"{file_name}: {problem}" for problem in problems)
            continue
        if mapping["id"] in file_name_by_id:
            errors.append(f"{file_name}: id {mapping['id']!r} is already used by {file_name_by_id[mapping['id']]}")
            continue
        file_name_by_id[mapping["id"]] = file_name
        valid.append((file_name, mapping))
    return valid


def _endpoints(mapping: dict):
    for link_position, link in enumerate(mapping["links"]):
        for side in ("from", "to"):
            for endpoint_position, endpoint in enumerate(link[side]):
                yield side, (link_position, endpoint_position), endpoint


def _pair_conflict(earlier: dict, pair: dict) -> str:
    if earlier["relation"] != pair["relation"]:
        return f"is already linked as {earlier['relation']} by {earlier['where']}; a pair can have only one relation"
    same_direction = earlier["from"]["id"] == pair["from"]["id"]
    if pair["relation"] in DIRECTED_RELATIONS and not same_direction:
        return f"is already linked in the other direction by {earlier['where']}; a {pair['relation']} pair can go one way only"
    return f"is already defined by {earlier['where']}"


def _check_pairs(
    valid_mappings: list[tuple[str, dict]], library: dict[str, dict], errors: list[str], mapping_warnings: list[str]
) -> None:
    pair_by_rules: dict[frozenset[str], dict] = {}
    for file_name, mapping in valid_mappings:
        for endpoint_side, endpoint_position, endpoint in _endpoints(mapping):
            rule_id = endpoint["id"]
            where = f"links[{endpoint_position[0]}].{endpoint_side}[{endpoint_position[1]}]"
            library_rule = library.get(rule_id)
            if library_rule is None:
                errors.append(f"{file_name}: {where}: rule {rule_id} does not exist in the committed library")
                continue
            if endpoint["release"] != library_rule["release_tag"]:
                mapping_warnings.append(
                    f"{file_name}: {where}: rule {rule_id} was mapped against {library_rule['source_name']} "
                    f"{endpoint['release']}, but the library is at {library_rule['release_tag']}; review the link for accuracy"
                )

        for pair in expanded_pairs(mapping):
            from_id, to_id = pair["from"]["id"], pair["to"]["id"]
            where = f"{file_name} links[{pair['link_position']}]"
            if from_id == to_id:
                errors.append(f"{where}: rule {from_id} is linked to itself")
                continue
            if from_id not in library or to_id not in library:
                continue
            rules_key = frozenset((from_id, to_id))
            earlier = pair_by_rules.get(rules_key)
            if earlier is not None:
                errors.append(f"{where}: the pair {from_id} -> {to_id} {_pair_conflict(earlier, pair)}")
                continue
            pair_by_rules[rules_key] = {**pair, "where": where}


def validate_mappings(directory: Path, baselines_dir: Path) -> tuple[list[str], list[str]]:
    """Check every mapping file; returns (errors, warnings), each a list of messages naming the file."""
    errors: list[str] = []
    mapping_warnings: list[str] = []
    valid_mappings = _structurally_valid_mappings(directory, errors)
    if valid_mappings:
        _check_pairs(valid_mappings, _load_library(baselines_dir), errors, mapping_warnings)
    return errors, list(dict.fromkeys(mapping_warnings))


def main(arguments: list[str]) -> int:
    mappings_dir = Path(arguments[0]) if arguments else DEFAULT_MAPPINGS_DIR
    baselines_dir = Path(arguments[1]) if len(arguments) > 1 else DEFAULT_BASELINES_DIR
    errors, mapping_warnings = validate_mappings(mappings_dir, baselines_dir)
    for warning in mapping_warnings:
        print(f"warning: {warning}", file=sys.stderr)
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
