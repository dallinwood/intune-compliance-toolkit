"""Acceptance test for the deterministic parser: for every rule file this
repo already has, locate its section in the source markdown and diff the
fields tools/rule_extraction.py can derive against what's actually
committed. This is the go/no-go gate for trusting the parser as an input to
any future AI-assisted authoring step (Phase 2) - see the plan doc under
docs/plans/ for the full pipeline design.

Not a pytest suite: some mismatches here are expected and informative rather
than parser bugs. Two known, non-bug sources of mismatch, found by running
this against every rule file that existed when this tool was built:

- A hand-authored file occasionally makes an interpretive choice beyond the
  two normalizations this repo's fidelity rule allows - e.g. rendering an
  italicized aside as quoted text ('Backup log automatically when full')
  instead of stripping the markup to plain text.
- Whether a blank line in the source becomes a "\\n\\n" paragraph break or
  gets collapsed to a single space is **not consistently derivable from the
  source alone** - the existing hand-authored corpus itself disagrees rule
  to rule (e.g. cis_intune_win11_4.11.15.3.1.json keeps "\\n\\n" before "The
  recommended state..." while cis_intune_win11_106.1.1.json collapses the
  same blank line to a space, for what appears to be the same source
  pattern). This parser always preserves the blank line as "\\n\\n"; expect
  mismatches against any hand-authored file that collapsed it instead.

Read the diffs, don't just count PASS/FAIL - a mismatch here doesn't
necessarily mean the parser is wrong.
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools.benchmark_markdown import read_lines  # noqa: E402
from tools.rule_extraction import extract_all_rules  # noqa: E402

BASELINES_DIR = REPO_ROOT / "baselines"
SOURCE_DOCUMENTS_DIR = REPO_ROOT / "baseline-references" / "cis-benchmarks"

# Maps a (family, product, version) rule folder to its source markdown file.
# Extend this as more benchmark versions gain rule files under baselines/.
SOURCE_DOCUMENTS = {
    ("cis", "windows_11", "v5.0.0"): "CIS_Microsoft_Intune_for_Windows_11_Benchmark_v5.0.0.md",
    ("cis", "macos_26_tahoe", "v1.1.0"): "CIS_Apple_macOS_26_Tahoe_Benchmark_v1.1.0.md",
}

FIELDS_TO_COMPARE = [
    "profile_applicability",
    "description",
    "rationale",
    "impact",
    "default_value",
    "references",
    "minimum_os_csp",
]


def find_rule_files(folder):
    return sorted(p for p in folder.glob("*.json") if not p.name.startswith("_"))


def committed_extended_cis(rule):
    return (rule.get("extended_attributes") or {}).get("cis") or {}


def diff_rule(rule_path, extracted_by_id):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))
    rule_id = rule["id"]

    extracted = extracted_by_id.get(rule_id)
    if extracted is None:
        return [f"no matching heading found in source markdown for rule id {rule_id!r}"]

    _, title, source_status, fields = extracted
    mismatches = []

    if title != rule["title"]:
        mismatches.append(f"title: extracted {title!r} != committed {rule['title']!r}")
    if source_status is not None and source_status != rule["assessment_status"]:
        mismatches.append(
            f"assessment_status: source heading tag {source_status!r} != committed {rule['assessment_status']!r}"
        )

    for field in FIELDS_TO_COMPARE:
        extracted_value = fields[field]
        committed_value = rule.get(field)
        if extracted_value != committed_value:
            mismatches.append(f"{field}: extracted {extracted_value!r} != committed {committed_value!r}")

    extended_cis = committed_extended_cis(rule)
    if "grid_id" in extended_cis and fields["grid_id"] != extended_cis.get("grid_id"):
        mismatches.append(
            f"extended_attributes.cis.grid_id: extracted {fields['grid_id']!r} != "
            f"committed {extended_cis.get('grid_id')!r}"
        )
    if "cis_controls" in extended_cis and fields["cis_controls"] != extended_cis.get("cis_controls"):
        mismatches.append(
            f"extended_attributes.cis.cis_controls: extracted {fields['cis_controls']!r} != "
            f"committed {extended_cis.get('cis_controls')!r}"
        )

    return mismatches


def main():
    total_rules = 0
    total_mismatched_fields = 0
    any_mismatch = False

    for (family, product, version), markdown_filename in sorted(SOURCE_DOCUMENTS.items()):
        folder = BASELINES_DIR / family / product / version
        markdown_path = SOURCE_DOCUMENTS_DIR / markdown_filename
        if not folder.is_dir() or not markdown_path.is_file():
            continue

        lines = read_lines(markdown_path)
        extracted_by_id = {
            rule_id: (rule_id, title, status, fields) for rule_id, title, status, fields in extract_all_rules(lines)
        }

        for rule_path in find_rule_files(folder):
            total_rules += 1
            mismatches = diff_rule(rule_path, extracted_by_id)
            if mismatches:
                any_mismatch = True
                total_mismatched_fields += len(mismatches)
                print(f"MISMATCH {rule_path.relative_to(REPO_ROOT)}")
                for mismatch in mismatches:
                    print(f"  - {mismatch}")
            else:
                print(f"OK       {rule_path.relative_to(REPO_ROOT)}")

    print()
    print(f"{total_rules} rule file(s) checked, {total_mismatched_fields} field mismatch(es)")
    return 1 if any_mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
