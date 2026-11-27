"""Generate the mSCP to NIST SP 800-53 mapping from the 800-53 controls mSCP itself cites.

Reads only the normalized library. Every link records mSCP's claim and is not reviewed by this project.
"""

import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import citation_mappings
from tools.citation_mappings import GenerationResult, mscp_nist_mapping
from tools.nist_800_53_normalize import SOURCE_NAME as NIST_SOURCE_NAME
from tools.nist_800_53_normalize import control_id_for_label

TARGET = mscp_nist_mapping(
    to_source_name=NIST_SOURCE_NAME,
    to_name="NIST SP 800-53",
    item_noun="800-53 control",
    item_plural="controls",
    citation_key="800-53r5",
    upstream_id_for_citation=control_id_for_label,
    mapping_id="mscp-to-nist-800-53",
    generator_command="python tools/generate_mscp_nist_800_53_mapping.py",
    report_to_key="nist_800_53_release",
)
MAPPING_FILE_NAME = TARGET.mapping_file_name
REPORT_FILE_NAME = TARGET.report_file_name
LINK_NOTE = TARGET.link_note


def report_path_for(baselines_dir: Path) -> Path:
    return citation_mappings.report_path_for(TARGET, baselines_dir)


def generate(baselines_dir: Path, report_path: Path) -> GenerationResult | None:
    return citation_mappings.generate(TARGET, baselines_dir, report_path)


def describe_result(result: GenerationResult) -> str:
    return citation_mappings.describe_result(TARGET, result)


def regenerate_after_import(sources_dir: Path, baselines_dir: Path) -> None:
    """The NIST SP 800-53 importer's after_import hook: keeps the generated mapping current."""
    citation_mappings.regenerate(TARGET, baselines_dir)


def main(argv: list[str] | None = None) -> int:
    return citation_mappings.main(TARGET, __doc__, argv)


if __name__ == "__main__":
    sys.exit(main())
