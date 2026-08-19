"""Deterministic, source-only extraction of a rule's body fields.

Covers the labeled fields a CIS-style rule section always has - Profile
Applicability, Description, Rationale, Impact, Default Value, References,
CIS Controls - which don't require technical judgment to lift out verbatim.
Audit/remediation method structure and check_command engineering are
deliberately out of scope here: splitting a rule's Audit section into
methods, deriving steps, and writing a check_command are real engineering
judgment calls (see the compliance-benchmark-json skill), not mechanical
extraction, and stay a human/AI job.

Only two normalizations are ever applied to source text: joining lines a PDF
conversion wrapped, and stripping the backtick/emphasis-marker rendering
artifacts pymupdf4llm leaves behind (e.g. "is: `Block` ." -> "is: Block.").
Everything else is transcribed as-is, typos included.
"""

import re

from tools.benchmark_markdown import iter_heading_start_indices, iter_rule_headings

TOP_LEVEL_LABELS = [
    "Profile Applicability",
    "Description",
    "Rationale",
    "Impact",
    "Audit",
    "Remediation",
    "Default Value",
    "References",
    "CIS Controls",
    "Additional Information",
]

LABEL_START_RE = {label: re.compile(r"^\*\*" + re.escape(label) + r":\*\*$") for label in TOP_LEVEL_LABELS}

BULLET_RE = re.compile(r"^-\s+(?P<text>.+)$")
INLINE_LABEL_RE = re.compile(r"^\*\*[^*]{1,40}:\*\*\s+\S")
REFERENCE_ITEM_RE = re.compile(r"^(?P<num>\d+)\.\s*(?P<rest>.*)$")
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\((?P<href>[^)]+)\)")
GRID_RE = re.compile(r"^GRID:\s*(?P<value>.+)$")
MIN_OS_CSP_RE = re.compile(r"^Minimum OS CSP:\s*(?P<value>.+)$", re.IGNORECASE)
CIS_TABLE_ROW_RE = re.compile(
    r"^\|(?P<version>v\d+)\|(?P<id_and_title>[^|]+)\|(?P<ig1>[^|]*)\|(?P<ig2>[^|]*)\|(?P<ig3>[^|]*)\|$"
)
CONTROL_ID_TITLE_RE = re.compile(r"^(?P<control_id>\d+(?:\.\d+)*)(?P<control_title>.+)$")


def strip_markdown_artifacts(text):
    """Strip the PDF-conversion rendering markup this repo normalizes away:
    inline code-span backticks (and the stray space they leave before
    adjacent punctuation) and italic/bold emphasis markers. All of it is
    markdown syntax pymupdf4llm introduced during conversion, not characters
    present in the source PDF text.
    """
    # An inline hyperlink over a run of prose (as opposed to a References-list
    # entry, handled separately) renders as "text: url".
    text = re.sub(r"\[([^\]]*)\]\((?P<href>[^)]+)\)", r"\1: \g<href>", text)
    text = re.sub(r"`([^`\n]*)`\s+([.,;:!?)])", r"\1\2", text)
    text = re.sub(r"`([^`\n]*)`", r"\1", text)
    text = re.sub(r"\*\*([^*\n]*)\*\*", r"\1", text)
    text = re.sub(r"_([^_\n]*)_", r"\1", text)
    return text


def find_rule_body(lines, rule_body_start_index, heading_starts=None):
    """Return the raw line slice for one rule's body: from just after its
    (possibly wrapped) heading to the start of the next heading of either
    kind, or end of file. `heading_starts` may be precomputed once per
    document via list(iter_heading_start_indices(lines)) for callers
    processing many rules from the same document.
    """
    if heading_starts is None:
        heading_starts = list(iter_heading_start_indices(lines))
    for start in heading_starts:
        if start >= rule_body_start_index:
            return lines[rule_body_start_index:start]
    return lines[rule_body_start_index:]


def split_into_labeled_sections(body_lines):
    """Split a rule's body into {label: [raw_lines]}, keyed by the fixed set
    of top-level CIS labels. A label's segment runs from the line after its
    "**Label:**" marker to the line before the next top-level label marker -
    nested labels inside Audit/Remediation content (e.g.
    "**Graphical Method:**") are deliberately absent from TOP_LEVEL_LABELS,
    so they stay part of that section's raw lines instead of ending it early.
    """
    label_positions = []
    for index, line in enumerate(body_lines):
        stripped = line.strip()
        for label, pattern in LABEL_START_RE.items():
            if pattern.match(stripped):
                label_positions.append((index, label))
                break

    sections = {}
    for position, (start_index, label) in enumerate(label_positions):
        content_start = start_index + 1
        content_end = label_positions[position + 1][0] if position + 1 < len(label_positions) else len(body_lines)
        sections[label] = body_lines[content_start:content_end]
    return sections


def _join_body_lines(section_lines):
    """Join a labeled section's raw lines the way this repo's rule files
    render prose: blank-line-separated blocks join with "\\n\\n"; a run of
    "- "-prefixed bullets (each possibly wrapped across lines) renders as
    one "\\n"-separated "- item" per bullet; and a line that opens with an
    inline bold label followed by more text on the same line (e.g.
    "**Note:** Old events...") starts a new block even without a blank line
    before it in the source, matching how this repo's existing rule files
    always break such asides onto their own paragraph.
    """
    blocks = []
    current_paragraph = []

    def flush_paragraph():
        if current_paragraph:
            blocks.append(("paragraph", " ".join(current_paragraph)))
            current_paragraph.clear()

    lines = [line.rstrip() for line in section_lines]
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if not stripped:
            flush_paragraph()
            index += 1
            continue
        bullet_match = BULLET_RE.match(stripped)
        if bullet_match:
            flush_paragraph()
            bullets = []
            while index < len(lines):
                stripped = lines[index].strip()
                if not stripped:
                    index += 1
                    continue
                bullet_match = BULLET_RE.match(stripped)
                if bullet_match:
                    fragment = [bullet_match.group("text")]
                    index += 1
                    while index < len(lines) and lines[index].strip() and not BULLET_RE.match(lines[index].strip()):
                        fragment.append(lines[index].strip())
                        index += 1
                    bullets.append(" ".join(fragment))
                    continue
                break
            blocks.append(("bullets", bullets))
            continue
        if INLINE_LABEL_RE.match(stripped) and current_paragraph:
            flush_paragraph()
        current_paragraph.append(stripped)
        index += 1
    flush_paragraph()

    return "\n\n".join(
        value if kind == "paragraph" else "\n".join(f"- {item}" for item in value) for kind, value in blocks
    )


def extract_profile_applicability(sections):
    items = []
    for line in sections.get("Profile Applicability", []):
        match = BULLET_RE.match(line.strip())
        if match:
            items.append(strip_markdown_artifacts(match.group("text")).strip())
    return items


def extract_prose_field(sections, label):
    section_lines = sections.get(label)
    if section_lines is None:
        return None
    joined = _join_body_lines(section_lines)
    return strip_markdown_artifacts(joined) if joined else None


def _merge_numbered_items(lines):
    items = []
    current = []
    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped:
            continue
        match = REFERENCE_ITEM_RE.match(stripped)
        if match:
            if current:
                items.append(" ".join(current))
            current = [match.group("rest")]
        else:
            current.append(stripped)
    if current:
        items.append(" ".join(current))
    return items


def extract_references_and_extras(sections):
    """Returns (references, grid_id, minimum_os_csp). The References section
    mixes plain URL references with "GRID: ..." and "Minimum OS CSP: ..."
    entries that belong on the rule's extended_attributes.cis.grid_id and
    top-level minimum_os_csp fields instead, per the compliance-benchmark-
    json skill.
    """
    items = _merge_numbered_items(sections.get("References", []))

    references = []
    grid_id = None
    minimum_os_csp = None
    for item_text in items:
        grid_match = GRID_RE.match(item_text)
        min_os_match = MIN_OS_CSP_RE.match(item_text)
        if grid_match:
            grid_id = grid_match.group("value").strip()
            continue
        if min_os_match:
            minimum_os_csp = min_os_match.group("value").strip()
            continue
        link_match = MARKDOWN_LINK_RE.search(item_text)
        if link_match:
            references.append(link_match.group("href"))
        elif item_text.strip():
            # A bare URL wrapped in pymupdf4llm's underline tags, not a
            # markdown link - strip only the <u> tags. strip_markdown_artifacts
            # isn't right here: its underscore stripping would mangle a
            # legitimate underscore inside the URL itself.
            references.append(re.sub(r"</?u>", "", item_text).strip())
    return references, grid_id, minimum_os_csp


def extract_cis_controls(sections):
    controls = []
    for raw_line in sections.get("CIS Controls", []):
        match = CIS_TABLE_ROW_RE.match(raw_line.strip())
        if not match:
            continue
        # The title itself can wrap mid-word across a single "<br>"
        # (e.g. "Patch<br>Management"); only a doubled "<br> <br>" marks the
        # actual title/description boundary in this table's cell format.
        id_and_title = match.group("id_and_title").split("<br> <br>")[0]
        # A wrapped title rejoins with a space ("Patch<br>Management" ->
        # "Patch Management"), except where the break falls right after a
        # slash ("Features/<br>Deploy" -> "Features/Deploy") - the PDF wrapped
        # a compound term, not two separate words.
        id_and_title = re.sub(r"(?<=/)\s*<br>\s*", "", id_and_title)
        id_and_title = re.sub(r"\s*<br>\s*", " ", id_and_title).strip()
        control_match = CONTROL_ID_TITLE_RE.match(id_and_title)
        if not control_match:
            continue
        implementation_groups = [
            group_name
            for group_name, cell in (("IG1", match.group("ig1")), ("IG2", match.group("ig2")), ("IG3", match.group("ig3")))
            if "●" in cell
        ]
        controls.append(
            {
                "version": match.group("version"),
                "control_id": control_match.group("control_id"),
                "control_title": strip_markdown_artifacts(control_match.group("control_title")).strip(),
                "implementation_groups": implementation_groups,
            }
        )
    return controls


def extract_rule_fields(lines, rule_body_start_index, heading_starts=None):
    """Extract every source-verbatim field this module covers for one rule,
    as a dict shaped like the corresponding slice of the rule JSON schema.
    """
    body_lines = find_rule_body(lines, rule_body_start_index, heading_starts=heading_starts)
    sections = split_into_labeled_sections(body_lines)
    references, grid_id, minimum_os_csp = extract_references_and_extras(sections)

    return {
        "profile_applicability": extract_profile_applicability(sections),
        "description": extract_prose_field(sections, "Description"),
        "rationale": extract_prose_field(sections, "Rationale"),
        "impact": extract_prose_field(sections, "Impact"),
        "default_value": extract_prose_field(sections, "Default Value"),
        "additional_information": extract_prose_field(sections, "Additional Information"),
        "references": references,
        "minimum_os_csp": minimum_os_csp,
        "cis_controls": extract_cis_controls(sections),
        "grid_id": grid_id,
    }


def extract_all_rules(lines):
    """Yield (rule_id, title, source_assessment_status, fields) for every
    rule heading found in `lines`.
    """
    heading_starts = list(iter_heading_start_indices(lines))
    for rule_id, title, source_assessment_status, body_start_index in iter_rule_headings(lines):
        fields = extract_rule_fields(lines, body_start_index, heading_starts=heading_starts)
        yield rule_id, title, source_assessment_status, fields
