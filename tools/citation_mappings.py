"""Generate a mapping from the citations one source's rules make to another source's rules.

Reads only the normalized library. Every link records the citing source's claim and is not reviewed by
this project. Each mapping is a CitationMapping; the generate_*_mapping.py scripts are the entry points.
"""

import argparse
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from tools.json_output import read_json_rejecting_duplicates, write_json
from tools.library_output import MANIFEST_FILE_NAME
from tools.validate_library import REPOSITORY_ROOT

MSCP_SOURCE_NAME = "mscp"
SCHEMA_VERSION = 1

UNRECOGNISED_FORMAT = "unrecognised_format"
NOT_IN_RELEASE = "not_in_release"
DUPLICATE_CITATION = "duplicate_citation"


@dataclass(frozen=True)
class CitationMapping:
    from_source_name: str
    from_name: str
    """How the citing source is named in the description and messages ("mSCP")."""
    to_source_name: str
    to_name: str
    """How the cited source is named in the description and messages ("NIST SP 800-53")."""
    citations_of: Callable[[dict], list]
    """The citations one citing rule makes, as listed in its rule file."""
    upstream_id_for_citation: Callable[[str], str | None]
    """Turns one citation into the cited rule's upstream id, or None when the citation has another shape."""
    relation: str
    link_note: str
    description_subject: str
    """The first sentence of the mapping description, without its full stop."""
    mapping_id: str
    generator_command: str
    report_from_key: str
    report_to_key: str

    @property
    def mapping_file_name(self) -> str:
        return f"{self.mapping_id}.json"

    @property
    def report_file_name(self) -> str:
        return f"{self.mapping_id}-unresolved.json"


def mscp_nist_mapping(
    to_source_name: str,
    to_name: str,
    item_noun: str,
    item_plural: str,
    citation_key: str,
    upstream_id_for_citation: Callable[[str], str | None],
    mapping_id: str,
    generator_command: str,
    report_to_key: str,
) -> CitationMapping:
    """An mSCP to NIST mapping: mSCP's own references.nist[citation_key] citations as supports links."""
    return CitationMapping(
        from_source_name=MSCP_SOURCE_NAME,
        from_name="mSCP",
        to_source_name=to_source_name,
        to_name=to_name,
        citations_of=lambda rule: rule.get("references", {}).get("nist", {}).get(citation_key, []),
        upstream_id_for_citation=upstream_id_for_citation,
        relation="supports",
        link_note=(
            f"Generated from mSCP's own references: mSCP lists this {item_noun} for this rule. "
            "Not reviewed by this project."
        ),
        description_subject=f"mSCP rules linked to the {to_name} {item_plural} mSCP itself cites for them",
        mapping_id=mapping_id,
        generator_command=generator_command,
        report_from_key="mscp_release",
        report_to_key=report_to_key,
    )


@dataclass(frozen=True)
class GenerationResult:
    link_count: int
    pair_count: int
    from_release_tag: str
    to_release_tag: str
    unresolved: list[dict]


def report_path_for(mapping: CitationMapping, baselines_dir: Path) -> Path:
    return baselines_dir.parent / "docs" / "mappings" / mapping.report_file_name


def _current_release(manifest: dict, source_name: str) -> dict | None:
    source = next((source for source in manifest["sources"] if source["name"] == source_name), None)
    if source is None:
        return None
    return next(release for release in source["releases"] if release["tag"] == source["release_tag"])


def _read_rule_ids_and_files(baselines_dir: Path, release: dict) -> list[tuple[str, Path]]:
    index_path = baselines_dir / release["index_path"]
    index = read_json_rejecting_duplicates(index_path, "release index")
    return [(entry["id"], index_path.parent / entry["file"]) for entry in index["rules"]]


def _resolve_citations(
    mapping: CitationMapping, rule_id: str, citations: list, cited_rule_ids: set[str], unresolved: list[dict]
) -> list[str]:
    resolved_rule_ids: list[str] = []
    seen_citations: set[str] = set()
    for citation in citations:
        if citation in seen_citations:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": DUPLICATE_CITATION})
            continue
        seen_citations.add(citation)
        upstream_id = mapping.upstream_id_for_citation(citation) if isinstance(citation, str) else None
        if upstream_id is None:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": UNRECOGNISED_FORMAT})
        elif f"{mapping.to_source_name}.{upstream_id}" not in cited_rule_ids:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": NOT_IN_RELEASE})
        else:
            resolved_rule_ids.append(f"{mapping.to_source_name}.{upstream_id}")
    return resolved_rule_ids


def _endpoint(rule_id: str, release_tag: str) -> dict:
    return {"kind": "rule", "id": rule_id, "release": release_tag}


def generate(mapping: CitationMapping, baselines_dir: Path, report_path: Path) -> GenerationResult | None:
    manifest = read_json_rejecting_duplicates(baselines_dir / MANIFEST_FILE_NAME, "manifest")
    from_release = _current_release(manifest, mapping.from_source_name)
    to_release = _current_release(manifest, mapping.to_source_name)
    if from_release is None or to_release is None:
        return None
    cited_rule_ids = {rule_id for rule_id, _ in _read_rule_ids_and_files(baselines_dir, to_release)}
    from_tag, to_tag = from_release["tag"], to_release["tag"]

    links = []
    pair_count = 0
    unresolved: list[dict] = []
    for rule_id, rule_path in sorted(_read_rule_ids_and_files(baselines_dir, from_release)):
        rule = read_json_rejecting_duplicates(rule_path, "rule file")
        resolved_rule_ids = _resolve_citations(mapping, rule_id, mapping.citations_of(rule), cited_rule_ids, unresolved)
        if not resolved_rule_ids:
            continue
        pair_count += len(resolved_rule_ids)
        links.append(
            {
                "relation": mapping.relation,
                "from": [_endpoint(rule_id, from_tag)],
                "to": [_endpoint(cited_id, to_tag) for cited_id in resolved_rule_ids],
                "note": mapping.link_note,
            }
        )

    unresolved.sort(key=lambda item: (item["rule"], str(item["citation"])))
    mapping_path = baselines_dir / "_mappings" / "rules" / mapping.mapping_file_name
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        mapping_path,
        {
            "schema_version": SCHEMA_VERSION,
            "id": mapping.mapping_id,
            "generated_by": mapping.generator_command,
            "description": (
                f"{mapping.description_subject}. Generated by `{mapping.generator_command}` from "
                f"{mapping.from_name} {from_tag} and {mapping.to_name} {to_tag}; do not edit by hand."
            ),
            "links": links,
        },
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        report_path,
        {
            "schema_version": SCHEMA_VERSION,
            mapping.report_from_key: from_tag,
            mapping.report_to_key: to_tag,
            "unresolved": unresolved,
        },
    )
    return GenerationResult(len(links), pair_count, from_tag, to_tag, unresolved)


def describe_result(mapping: CitationMapping, result: GenerationResult) -> str:
    return (
        f"Wrote {result.link_count} links ({result.pair_count} pairs) from {mapping.from_name} "
        f"{result.from_release_tag} to {mapping.to_name} {result.to_release_tag}; "
        f"{len(result.unresolved)} citations unresolved"
    )


def print_unresolved_warnings(result: GenerationResult) -> None:
    for item in result.unresolved:
        print(
            f"warning: {item['rule']}: citation {item['citation']!r} not linked ({item['reason']})",
            file=sys.stderr,
        )


def generate_and_report(mapping: CitationMapping, baselines_dir: Path, report_path: Path) -> bool:
    """Run the generator and print its outcome; False when a source is missing."""
    result = generate(mapping, baselines_dir, report_path)
    if result is None:
        print(
            f"Skipped the {mapping.from_name} to {mapping.to_name} mapping: needs both "
            f"'{mapping.from_source_name}' and '{mapping.to_source_name}' in {baselines_dir / MANIFEST_FILE_NAME}",
            file=sys.stderr,
        )
        return False
    print_unresolved_warnings(result)
    print(describe_result(mapping, result))
    return True


def regenerate(mapping: CitationMapping, baselines_dir: Path) -> None:
    generate_and_report(mapping, baselines_dir, report_path_for(mapping, baselines_dir))


def main(mapping: CitationMapping, description: str, argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--baselines-dir", type=Path, default=REPOSITORY_ROOT / "baselines")
    arguments = parser.parse_args(argv)
    try:
        generated = generate_and_report(
            mapping, arguments.baselines_dir, report_path_for(mapping, arguments.baselines_dir)
        )
    except (ValueError, OSError, KeyError) as problem:
        print(f"Generation failed: {problem!r}", file=sys.stderr)
        return 1
    return 0 if generated else 1
