"""Generate mSCP to NIST framework mappings from the citations mSCP itself makes in references.nist.

Reads only the normalized library. Every link records mSCP's claim and is not reviewed by this project.
Each framework is a CitationTarget; generate_mscp_nist_800_53_mapping.py and
generate_mscp_nist_800_171_mapping.py are the command-line entry points.
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
class CitationTarget:
    source_name: str
    framework_name: str
    """How the framework is named in the description, note and messages ("NIST SP 800-53")."""
    item_noun: str
    """What one cited thing is called in the link note ("800-53 control")."""
    item_plural: str
    """What the cited things are called in the mapping description ("controls")."""
    citation_key: str
    """The key under mSCP's references.nist that lists the citations ("800-53r5")."""
    upstream_id_for_citation: Callable[[str], str | None]
    """Turns one citation into the target rule's upstream id, or None when the citation has another shape."""
    mapping_id: str
    generator_command: str
    report_release_key: str

    @property
    def mapping_file_name(self) -> str:
        return f"{self.mapping_id}.json"

    @property
    def report_file_name(self) -> str:
        return f"{self.mapping_id}-unresolved.json"

    @property
    def link_note(self) -> str:
        return (
            f"Generated from mSCP's own references: mSCP lists this {self.item_noun} for this rule. "
            "Not reviewed by this project."
        )


@dataclass(frozen=True)
class GenerationResult:
    link_count: int
    pair_count: int
    mscp_release_tag: str
    nist_release_tag: str
    unresolved: list[dict]


def report_path_for(target: CitationTarget, baselines_dir: Path) -> Path:
    return baselines_dir.parent / "docs" / "mappings" / target.report_file_name


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
    target: CitationTarget, rule_id: str, citations: list, target_rule_ids: set[str], unresolved: list[dict]
) -> list[str]:
    resolved_rule_ids: list[str] = []
    seen_citations: set[str] = set()
    for citation in citations:
        if citation in seen_citations:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": DUPLICATE_CITATION})
            continue
        seen_citations.add(citation)
        upstream_id = target.upstream_id_for_citation(citation) if isinstance(citation, str) else None
        if upstream_id is None:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": UNRECOGNISED_FORMAT})
        elif f"{target.source_name}.{upstream_id}" not in target_rule_ids:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": NOT_IN_RELEASE})
        else:
            resolved_rule_ids.append(f"{target.source_name}.{upstream_id}")
    return resolved_rule_ids


def _endpoint(rule_id: str, release_tag: str) -> dict:
    return {"kind": "rule", "id": rule_id, "release": release_tag}


def generate(target: CitationTarget, baselines_dir: Path, report_path: Path) -> GenerationResult | None:
    manifest = read_json_rejecting_duplicates(baselines_dir / MANIFEST_FILE_NAME, "manifest")
    mscp_release = _current_release(manifest, MSCP_SOURCE_NAME)
    target_release = _current_release(manifest, target.source_name)
    if mscp_release is None or target_release is None:
        return None
    target_rule_ids = {rule_id for rule_id, _ in _read_rule_ids_and_files(baselines_dir, target_release)}
    mscp_tag, target_tag = mscp_release["tag"], target_release["tag"]

    links = []
    pair_count = 0
    unresolved: list[dict] = []
    for rule_id, rule_path in sorted(_read_rule_ids_and_files(baselines_dir, mscp_release)):
        rule = read_json_rejecting_duplicates(rule_path, "rule file")
        citations = rule.get("references", {}).get("nist", {}).get(target.citation_key, [])
        cited_rule_ids = _resolve_citations(target, rule_id, citations, target_rule_ids, unresolved)
        if not cited_rule_ids:
            continue
        pair_count += len(cited_rule_ids)
        links.append(
            {
                "relation": "supports",
                "from": [_endpoint(rule_id, mscp_tag)],
                "to": [_endpoint(cited_id, target_tag) for cited_id in cited_rule_ids],
                "note": target.link_note,
            }
        )

    unresolved.sort(key=lambda item: (item["rule"], str(item["citation"])))
    mapping_path = baselines_dir / "_mappings" / "rules" / target.mapping_file_name
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        mapping_path,
        {
            "schema_version": SCHEMA_VERSION,
            "id": target.mapping_id,
            "generated_by": target.generator_command,
            "description": (
                f"mSCP rules linked to the {target.framework_name} {target.item_plural} mSCP itself "
                f"cites for them. Generated by `{target.generator_command}` from mSCP {mscp_tag} and "
                f"{target.framework_name} {target_tag}; do not edit by hand."
            ),
            "links": links,
        },
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        report_path,
        {
            "schema_version": SCHEMA_VERSION,
            "mscp_release": mscp_tag,
            target.report_release_key: target_tag,
            "unresolved": unresolved,
        },
    )
    return GenerationResult(len(links), pair_count, mscp_tag, target_tag, unresolved)


def describe_result(target: CitationTarget, result: GenerationResult) -> str:
    return (
        f"Wrote {result.link_count} links ({result.pair_count} pairs) from mSCP "
        f"{result.mscp_release_tag} to {target.framework_name} {result.nist_release_tag}; "
        f"{len(result.unresolved)} citations unresolved"
    )


def print_unresolved_warnings(result: GenerationResult) -> None:
    for item in result.unresolved:
        print(
            f"warning: {item['rule']}: citation {item['citation']!r} not linked ({item['reason']})",
            file=sys.stderr,
        )


def generate_and_report(target: CitationTarget, baselines_dir: Path, report_path: Path) -> bool:
    """Run the generator and print its outcome; False when a source is missing."""
    result = generate(target, baselines_dir, report_path)
    if result is None:
        print(
            f"Skipped the mSCP to {target.framework_name} mapping: needs both '{MSCP_SOURCE_NAME}' and "
            f"'{target.source_name}' in {baselines_dir / MANIFEST_FILE_NAME}",
            file=sys.stderr,
        )
        return False
    print_unresolved_warnings(result)
    print(describe_result(target, result))
    return True


def regenerate(target: CitationTarget, baselines_dir: Path) -> None:
    generate_and_report(target, baselines_dir, report_path_for(target, baselines_dir))


def main(target: CitationTarget, description: str, argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--baselines-dir", type=Path, default=REPOSITORY_ROOT / "baselines")
    arguments = parser.parse_args(argv)
    try:
        generated = generate_and_report(
            target, arguments.baselines_dir, report_path_for(target, arguments.baselines_dir)
        )
    except (ValueError, OSError, KeyError) as problem:
        print(f"Generation failed: {problem!r}", file=sys.stderr)
        return 1
    return 0 if generated else 1
