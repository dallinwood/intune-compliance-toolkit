"""Shared markdown-parsing helpers for CIS-style benchmark documents.

These helpers are deterministic and source-only: they read structural facts
(headings, front-page title/version/date) directly out of a benchmark
markdown file with no AI involvement and no synthesized text. Everything
returned is either verbatim from the source or a straightforward, reversible
transform of it (heading-line rejoining, date-component reordering).

Two structural facts, verified directly against
baseline-references/cis-benchmarks/CIS_Microsoft_Intune_for_Windows_11_Benchmark_v5.0.0.md
(and cross-checked against the macOS Tahoe benchmark), drove the design here
and are not obvious from a casual read of the markdown:

- Most rule headings wrap across two or more physical lines, and the
  (Automated)/(Manual) tag frequently ends up as its own italic fragment,
  separated from the title by a blank line (e.g. "_1.1 ... 'Block'_" then,
  after a blank line, "_(Automated)_"). A heading is only complete once a
  run of consecutive marker-prefixed lines ends - checking only the first
  line misses the tag, or the back half of the title, on the majority of
  rules.
- Bold headings ("## **1 Above Lock**") mark section/grouping headings;
  italic headings ("### _1.1 Ensure ..._") mark individual rules. The
  numeric ID's segment count - not the heading's "#" depth - is what
  actually distinguishes a section from a rule; "#" depth is a secondary,
  not fully reliable signal.

A document's printed table of contents is not a source of false positives
here: its entries have no leading "#", so the heading-start regexes below
never match them.
"""

import re
from pathlib import Path

SECTION_BOILERPLATE_RE = re.compile(r"^This section contains recommendations for .+\.$")
FRONT_PAGE_VERSION_DATE_RE = re.compile(
    r"^v(?P<version>\d+(?:\.\d+)*)\s*-\s*(?P<month>\d{2})-(?P<day>\d{2})-(?P<year>\d{4})\s*$"
)
CHANGE_HISTORY_DATE_RE = re.compile(
    r"^\*\*Date:\s*(?P<month>\d{2})/(?P<day>\d{2})/(?P<year>\d{4})\s+Version:\s*(?P<version>\d+(?:\.\d+)*)\*\*$"
)
ASSESSMENT_TAG_RE = re.compile(r"\s*\((?P<tag>Automated|Manual)\)\s*$")
NUMERIC_ID_RE = re.compile(r"^(?P<id>\d+(?:\.\d+)*)\s+(?P<rest>.+)$")
LABEL_LINE_RE = re.compile(r"^\*\*[^*]{1,60}:\*\*$")

BOLD_HEADING_START_RE = re.compile(r"^#{1,6}\s+\*\*(?P<rest>.*)$")
ITALIC_HEADING_START_RE = re.compile(r"^#{1,6}\s+_(?P<rest>.*)$")

MAX_HEADING_CONTINUATION_LINES = 6


def read_lines(markdown_path):
    return Path(markdown_path).read_text(encoding="utf-8").splitlines()


def _strip_marker(text, marker):
    """Strip one leading and/or one trailing occurrence of `marker`.

    The opening line's fragment never legitimately starts with `marker` (the
    heading-start regex already consumed that occurrence), but a wrapped
    continuation line is a fresh markdown span of its own - e.g. a
    "_(Automated)_" fragment on its own line - and carries both its opening
    and closing marker, so both need stripping here.
    """
    text = text.strip()
    if text.startswith(marker):
        text = text[len(marker):]
    if text.endswith(marker):
        text = text[: -len(marker)]
    return text.strip()


def _collect_heading_text(lines, start_index, marker):
    """Merge a (possibly wrapped) heading starting at lines[start_index].

    `marker` is "**" for a bold section heading or "_" for an italic rule
    heading. Returns (merged_text, next_index), where next_index is the
    line index to resume scanning from.
    """
    start_match = (BOLD_HEADING_START_RE if marker == "**" else ITALIC_HEADING_START_RE).match(lines[start_index])
    fragments = [_strip_marker(start_match.group("rest"), marker)]

    index = start_index + 1
    consumed = 0
    while consumed < MAX_HEADING_CONTINUATION_LINES and index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if not stripped:
            index += 1
            continue
        if stripped.startswith("#") or not stripped.startswith(marker) or LABEL_LINE_RE.match(stripped):
            break
        fragments.append(_strip_marker(stripped, marker))
        index += 1
        consumed += 1

    merged = " ".join(fragment for fragment in fragments if fragment)
    return merged, index


def iter_section_headings(lines):
    """Yield (id, title, description) for each bold section/grouping heading.

    `description` is the verbatim boilerplate sentence immediately following
    the heading ("This section contains recommendations for X.") when
    present, else None - some sections may genuinely lack it, and that
    absence is not papered over by synthesizing the sentence from the title.
    """
    index = 0
    while index < len(lines):
        if BOLD_HEADING_START_RE.match(lines[index]) is None:
            index += 1
            continue
        heading_text, next_index = _collect_heading_text(lines, index, "**")
        id_match = NUMERIC_ID_RE.match(heading_text)
        index = next_index
        if id_match is None:
            continue

        description = None
        for lookahead in range(index, min(index + 5, len(lines))):
            candidate = lines[lookahead].strip()
            if not candidate:
                continue
            if SECTION_BOILERPLATE_RE.match(candidate):
                description = candidate
            break

        yield id_match.group("id"), id_match.group("rest").strip(), description


def iter_rule_headings(lines):
    """Yield (id, title, source_assessment_status, next_line_index) for each
    italic rule heading. `next_line_index` is where the rule's body starts,
    so callers that also need the rule's body text don't have to re-search
    for the heading's end.
    """
    index = 0
    while index < len(lines):
        if ITALIC_HEADING_START_RE.match(lines[index]) is None:
            index += 1
            continue
        heading_text, next_index = _collect_heading_text(lines, index, "_")
        id_match = NUMERIC_ID_RE.match(heading_text)
        index = next_index
        if id_match is None:
            continue

        rest = id_match.group("rest")
        tag_match = ASSESSMENT_TAG_RE.search(rest)
        if tag_match:
            title = rest[: tag_match.start()].strip()
            source_assessment_status = tag_match.group("tag")
        else:
            title = rest.strip()
            source_assessment_status = None

        yield id_match.group("id"), title, source_assessment_status, index


def parse_front_page(lines, max_lines=20):
    """Extract (name, version, release_date) from a CIS-style front page:
    one or more plain title lines, then a "vX.Y.Z - MM-DD-YYYY" line.
    `release_date` is returned as DD-MM-YYYY.

    Returns (None, None, None) if that version/date line isn't found in the
    first `max_lines` non-blank lines - callers should fall back to explicit
    name/version arguments rather than guessing for sources that don't
    follow this exact template.
    """
    title_fragments = []
    for line in lines[:max_lines]:
        stripped = line.strip()
        if not stripped:
            continue
        match = FRONT_PAGE_VERSION_DATE_RE.match(stripped)
        if match:
            name = " ".join(title_fragments)
            release_date = f"{match.group('day')}-{match.group('month')}-{match.group('year')}"
            return name, match.group("version"), release_date
        title_fragments.append(stripped)
    return None, None, None


def find_change_history_date(lines, version):
    """Cross-check helper: find the release date for `version` in the
    document's "Appendix: Change History" table
    ("**Date: MM/DD/YYYY Version: X.Y.Z**"), returned as DD-MM-YYYY, or None
    if no matching row is found. Used only to sanity-check the front-page
    date against a second, independent occurrence in the same document -
    not the primary source, since not every benchmark family is guaranteed
    to have this appendix.
    """
    for line in lines:
        match = CHANGE_HISTORY_DATE_RE.match(line.strip())
        if match and match.group("version") == version:
            return f"{match.group('day')}-{match.group('month')}-{match.group('year')}"
    return None


def iter_heading_start_indices(lines):
    """Yield the line index of every bold or italic heading start, in order.

    Used by callers that need to know where a rule's body ends: that's the
    start of the next heading of either kind (or end of file), not
    necessarily the next rule - the last rule under a subsection is followed
    directly by the next section's heading.
    """
    for index, line in enumerate(lines):
        if BOLD_HEADING_START_RE.match(line) or ITALIC_HEADING_START_RE.match(line):
            yield index
