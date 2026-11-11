"""Generate the mSCP to NIST SP 800-53 mapping from the 800-53 controls mSCP itself cites.

Reads only the normalized library. Every link records mSCP's claim and is not reviewed by this project.
"""

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.json_output import read_json_rejecting_duplicates, write_json
from tools.library_output import MANIFEST_FILE_NAME
from tools.nist_800_53_normalize import SOURCE_NAME as NIST_SOURCE_NAME
from tools.nist_800_53_normalize import control_id_for_label
from tools.validate_library import REPOSITORY_ROOT

MSCP_SOURCE_NAME = "mscp"
MAPPING_ID = "mscp-to-nist-800-53"
MAPPING_FILE_NAME = f"{MAPPING_ID}.json"
REPORT_FILE_NAME = f"{MAPPING_ID}-unresolved.json"
CITATION_KEY = "800-53r5"
SCHEMA_VERSION = 1
LINK_NOTE = (
    "Generated from mSCP's own references: mSCP lists this 800-53 control for this rule. "
    "Not reviewed by this project."
)
GENERATOR_COMMAND = "python tools/generate_mscp_nist_800_53_mapping.py"

UNRECOGNISED_FORMAT = "unrecognised_format"
NOT_IN_RELEASE = "not_in_release"
DUPLICATE_CITATION = "duplicate_citation"


@dataclass(frozen=True)
class GenerationResult:
    link_count: int
    pair_count: int
    mscp_release_tag: str
    nist_release_tag: str
    unresolved: list[dict]


def report_path_for(baselines_dir: Path) -> Path:
    return baselines_dir.parent / "docs" / "mappings" / REPORT_FILE_NAME


def _current_release(manifest: dict, source_name: str) -> dict | None:
    source = next((source for source in manifest["sources"] if source["name"] == source_name), None)
    if source is None:
        return None
    return next(release for release in source["releases"] if release["tag"] == source["release_tag"])


def _read_rule_ids_and_files(baselines_dir: Path, release: dict) -> list[tuple[str, Path]]:
    index_path = baselines_dir / release["index_path"]
    index = read_json_rejecting_duplicates(index_path, "release index")
    return [(entry["id"], index_path.parent / entry["file"]) for entry in index["rules"]]


def _citations_of(rule: dict) -> list:
    return rule.get("references", {}).get("nist", {}).get(CITATION_KEY, [])


def _resolve_citations(
    rule_id: str, citations: list, nist_rule_ids: set[str], unresolved: list[dict]
) -> list[str]:
    resolved_control_ids: list[str] = []
    seen_citations: set[str] = set()
    for citation in citations:
        if citation in seen_citations:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": DUPLICATE_CITATION})
            continue
        seen_citations.add(citation)
        control_id = control_id_for_label(citation) if isinstance(citation, str) else None
        if control_id is None:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": UNRECOGNISED_FORMAT})
        elif f"{NIST_SOURCE_NAME}.{control_id}" not in nist_rule_ids:
            unresolved.append({"rule": rule_id, "citation": citation, "reason": NOT_IN_RELEASE})
        else:
            resolved_control_ids.append(f"{NIST_SOURCE_NAME}.{control_id}")
    return resolved_control_ids


def _endpoint(rule_id: str, release_tag: str) -> dict:
    return {"kind": "rule", "id": rule_id, "release": release_tag}


def generate(baselines_dir: Path, report_path: Path) -> GenerationResult | None:
    manifest = read_json_rejecting_duplicates(baselines_dir / MANIFEST_FILE_NAME, "manifest")
    mscp_release = _current_release(manifest, MSCP_SOURCE_NAME)
    nist_release = _current_release(manifest, NIST_SOURCE_NAME)
    if mscp_release is None or nist_release is None:
        return None
    nist_rule_ids = {
        rule_id for rule_id, _ in _read_rule_ids_and_files(baselines_dir, nist_release)
    }
    mscp_tag, nist_tag = mscp_release["tag"], nist_release["tag"]

    links = []
    pair_count = 0
    unresolved: list[dict] = []
    for rule_id, rule_path in sorted(_read_rule_ids_and_files(baselines_dir, mscp_release)):
        rule = read_json_rejecting_duplicates(rule_path, "rule file")
        nist_rule_ids_cited = _resolve_citations(rule_id, _citations_of(rule), nist_rule_ids, unresolved)
        if not nist_rule_ids_cited:
            continue
        pair_count += len(nist_rule_ids_cited)
        links.append(
            {
                "relation": "supports",
                "from": [_endpoint(rule_id, mscp_tag)],
                "to": [_endpoint(cited_id, nist_tag) for cited_id in nist_rule_ids_cited],
                "note": LINK_NOTE,
            }
        )

    unresolved.sort(key=lambda item: (item["rule"], str(item["citation"])))
    mapping_path = baselines_dir / "_mappings" / "rules" / MAPPING_FILE_NAME
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        mapping_path,
        {
            "schema_version": SCHEMA_VERSION,
            "id": MAPPING_ID,
            "description": (
                f"mSCP rules linked to the NIST SP 800-53 controls mSCP itself cites for them. "
                f"Generated by `{GENERATOR_COMMAND}` from mSCP {mscp_tag} and NIST SP 800-53 "
                f"{nist_tag}; do not edit by hand."
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
            "nist_800_53_release": nist_tag,
            "unresolved": unresolved,
        },
    )
    return GenerationResult(len(links), pair_count, mscp_tag, nist_tag, unresolved)


def describe_result(result: GenerationResult) -> str:
    return (
        f"Wrote {result.link_count} links ({result.pair_count} pairs) from mSCP "
        f"{result.mscp_release_tag} to NIST SP 800-53 {result.nist_release_tag}; "
        f"{len(result.unresolved)} citations unresolved"
    )


def print_unresolved_warnings(result: GenerationResult) -> None:
    for item in result.unresolved:
        print(
            f"warning: {item['rule']}: citation {item['citation']!r} not linked ({item['reason']})",
            file=sys.stderr,
        )


def generate_and_report(baselines_dir: Path, report_path: Path) -> bool:
    """Run the generator and print its outcome; False when a source is missing."""
    result = generate(baselines_dir, report_path)
    if result is None:
        print(
            f"Skipped the mSCP to NIST SP 800-53 mapping: needs both '{MSCP_SOURCE_NAME}' and "
            f"'{NIST_SOURCE_NAME}' in {baselines_dir / MANIFEST_FILE_NAME}",
            file=sys.stderr,
        )
        return False
    print_unresolved_warnings(result)
    print(describe_result(result))
    return True


def regenerate_after_import(baselines_dir: Path) -> None:
    """The after_import hook: keeps the generated mapping current after any import."""
    generate_and_report(baselines_dir, report_path_for(baselines_dir))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baselines-dir", type=Path, default=REPOSITORY_ROOT / "baselines")
    arguments = parser.parse_args(argv)
    try:
        generated = generate_and_report(arguments.baselines_dir, report_path_for(arguments.baselines_dir))
    except (ValueError, OSError, KeyError) as problem:
        print(f"Generation failed: {problem!r}", file=sys.stderr)
        return 1
    return 0 if generated else 1


if __name__ == "__main__":
    sys.exit(main())
