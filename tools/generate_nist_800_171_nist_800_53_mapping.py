"""Generate the NIST SP 800-171 to NIST SP 800-53 mapping from the source controls NIST lists for each requirement.

Reads only the normalized library. Every link records NIST's own statement and is not reviewed by this project.
"""

import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import citation_mappings
from tools.citation_mappings import CitationMapping, GenerationResult
from tools.nist_800_53_normalize import SOURCE_NAME as NIST_800_53_SOURCE_NAME
from tools.nist_800_53_normalize import control_id_for_zero_padded_label
from tools.nist_800_171_normalize import SOURCE_NAME as NIST_800_171_SOURCE_NAME

GENERATOR_COMMAND = "python tools/generate_nist_800_171_nist_800_53_mapping.py"

# NIST derived 800-171 Rev. 3 from 800-53 Rev. 5.1.1; the links point at the current 800-53 release because the
# control ids carry over, and the note says which version NIST's statement was made against.
MAPPING = CitationMapping(
    from_source_name=NIST_800_171_SOURCE_NAME,
    from_name="NIST SP 800-171",
    to_source_name=NIST_800_53_SOURCE_NAME,
    to_name="NIST SP 800-53",
    citations_of=lambda rule: rule.get("references", {}).get("source_controls", []),
    upstream_id_for_citation=control_id_for_zero_padded_label,
    relation="related",
    link_note=(
        "Generated from NIST's catalog: NIST lists these SP 800-53 controls (as published in 800-53 5.1.1) "
        "as the source controls of this requirement. Not reviewed by this project."
    ),
    description_subject="NIST SP 800-171 requirements linked to the NIST SP 800-53 controls NIST lists as their source controls",
    mapping_id="nist-800-171-to-nist-800-53",
    generator_command=GENERATOR_COMMAND,
    report_from_key="nist_800_171_release",
    report_to_key="nist_800_53_release",
)
MAPPING_FILE_NAME = MAPPING.mapping_file_name
REPORT_FILE_NAME = MAPPING.report_file_name
LINK_NOTE = MAPPING.link_note


def report_path_for(baselines_dir: Path) -> Path:
    return citation_mappings.report_path_for(MAPPING, baselines_dir)


def generate(baselines_dir: Path, report_path: Path) -> GenerationResult | None:
    return citation_mappings.generate(MAPPING, baselines_dir, report_path)


def regenerate_after_import(sources_dir: Path, baselines_dir: Path) -> None:
    """A NIST importer's after_import hook: keeps this mapping current when either NIST source is imported."""
    citation_mappings.regenerate(MAPPING, baselines_dir)


def main(argv: list[str] | None = None) -> int:
    return citation_mappings.main(MAPPING, __doc__, argv)


if __name__ == "__main__":
    sys.exit(main())
