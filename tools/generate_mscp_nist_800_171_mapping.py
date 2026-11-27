"""Generate the mSCP to NIST SP 800-171 mapping from the 800-171 requirements mSCP itself cites.

Reads only the normalized library. Every link records mSCP's claim and is not reviewed by this project.
"""

import re
import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import mscp_citation_mappings
from tools.mscp_citation_mappings import CitationTarget, GenerationResult
from tools.nist_800_171_normalize import REQUIREMENT_NUMBER_PATTERN
from tools.nist_800_171_normalize import SOURCE_NAME as NIST_SOURCE_NAME


def requirement_number_for_citation(citation: str) -> str | None:
    """mSCP cites Rev. 3 requirements by number ("03.03.08"), which is the rule's upstream id part."""
    return citation if REQUIREMENT_NUMBER_PATTERN.match(citation) else None


TARGET = CitationTarget(
    source_name=NIST_SOURCE_NAME,
    framework_name="NIST SP 800-171",
    item_noun="800-171 requirement",
    item_plural="requirements",
    citation_key="800-171r3",
    upstream_id_for_citation=requirement_number_for_citation,
    mapping_id="mscp-to-nist-800-171",
    generator_command="python tools/generate_mscp_nist_800_171_mapping.py",
    report_release_key="nist_800_171_release",
)
MAPPING_FILE_NAME = TARGET.mapping_file_name
REPORT_FILE_NAME = TARGET.report_file_name
LINK_NOTE = TARGET.link_note


def report_path_for(baselines_dir: Path) -> Path:
    return mscp_citation_mappings.report_path_for(TARGET, baselines_dir)


def generate(baselines_dir: Path, report_path: Path) -> GenerationResult | None:
    return mscp_citation_mappings.generate(TARGET, baselines_dir, report_path)


def regenerate_after_import(sources_dir: Path, baselines_dir: Path) -> None:
    """The NIST SP 800-171 importer's after_import hook: keeps the generated mapping current."""
    mscp_citation_mappings.regenerate(TARGET, baselines_dir)


def main(argv: list[str] | None = None) -> int:
    return mscp_citation_mappings.main(TARGET, __doc__, argv)


if __name__ == "__main__":
    sys.exit(main())
