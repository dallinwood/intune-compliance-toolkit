"""Generate a per-version _metadata.json from a benchmark markdown file.

Captures the two things that don't belong on any individual rule file: the
benchmark's own name/version/release date, and the section/heading
hierarchy (numeric ID -> title/description) a browsing UI needs to label a
group of rules with something better than "Section 4.11.49". Deterministic
and source-only - see tools/benchmark_markdown.py for the parsing rules this
relies on.

Usage:
    python tools/generate_metadata.py <markdown-path> <output-version-folder> \
        [--name NAME] [--version VERSION]

--name/--version only need to be passed for a source that doesn't follow the
CIS "vX.Y.Z - MM-DD-YYYY" front-page template this auto-detects from; every
benchmark under baseline-references/cis-benchmarks/ today does.

Like _index.json, this is a generated artifact (leading underscore) - never
hand-author or hand-edit it, regenerate it after the source markdown changes.
"""

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools.benchmark_markdown import (  # noqa: E402
    find_change_history_date,
    iter_section_headings,
    parse_front_page,
    read_lines,
)

METADATA_FILENAME = "_metadata.json"


def build_metadata(lines, name_override=None, version_override=None):
    detected_name, detected_version, detected_date = parse_front_page(lines)
    name = name_override or detected_name
    version = version_override or detected_version
    if not name or not version:
        raise ValueError(
            "could not detect benchmark name/version from the document's front page - "
            "pass --name and --version explicitly for sources that don't follow the "
            "CIS 'vX.Y.Z - MM-DD-YYYY' front-page template"
        )

    if version == detected_version:
        release_date = detected_date
        cross_check_date = find_change_history_date(lines, version)
        if cross_check_date and release_date and cross_check_date != release_date:
            print(
                f"WARNING: front-page release date {release_date!r} disagrees with "
                f"the change-history entry {cross_check_date!r} for version {version!r}",
                file=sys.stderr,
            )
    else:
        # An overridden version isn't necessarily the document's own current
        # version, so the front page's date doesn't apply to it - fall back
        # to a change-history row for that specific version, if any.
        release_date = find_change_history_date(lines, version)

    sections = [
        {"id": section_id, "title": title, "description": description}
        for section_id, title, description in iter_section_headings(lines)
    ]

    return {
        "schemaVersion": 1,
        "benchmark": {"name": name, "version": version, "release_date": release_date},
        "sections": sections,
    }


def write_metadata(markdown_path, output_dir, name_override=None, version_override=None):
    lines = read_lines(markdown_path)
    metadata = build_metadata(lines, name_override=name_override, version_override=version_override)
    output_path = Path(output_dir) / METADATA_FILENAME
    output_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return output_path


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("markdown_path", type=Path)
    parser.add_argument(
        "output_dir",
        type=Path,
        help="Version folder under baselines/ to write _metadata.json into (e.g. baselines/cis/windows_11/v5.0.0)",
    )
    parser.add_argument("--name", default=None, help="Override the auto-detected benchmark name")
    parser.add_argument("--version", default=None, help="Override the auto-detected benchmark version")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    if not args.markdown_path.is_file():
        print(f"Markdown file does not exist: {args.markdown_path}", file=sys.stderr)
        return 1
    if not args.output_dir.is_dir():
        print(f"Output directory does not exist: {args.output_dir}", file=sys.stderr)
        return 1

    try:
        output_path = write_metadata(
            args.markdown_path, args.output_dir, name_override=args.name, version_override=args.version
        )
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"{args.markdown_path} -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
