"""Convert NIST's SP 800-171 Rev. 3 OSCAL catalog into the project's v5 rule JSON shape."""

import re

from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData
from tools.nist_oscal import (
    PARAGRAPH_SEPARATOR,
    OscalCatalog,
    check_keys,
    entry_id,
    properties,
    render_guidance,
    render_statement,
    single_property_value,
)
from tools.source_lock import SourceLock

SOURCE_NAME = "nist_800_171"
REPOSITORY_URL = "https://github.com/usnistgov/oscal-content"
LICENSE_FILE_PATH = "LICENSE.md"
CATALOG_PATH = "nist.gov/SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json"

LICENSE = {
    "name": "CC0 1.0 (public domain)",
    "url": "https://creativecommons.org/publicdomain/zero/1.0/",
    "rights_holder": "National Institute of Standards and Technology",
    "modified": True,
}

OSCAL_ID_PREFIX = "SP_800_171_"
FAMILY_NUMBER_PATTERN = re.compile(r"^03\.[0-9]{2}(?![\s\S])")
REQUIREMENT_NUMBER_PATTERN = re.compile(r"^03\.[0-9]{2}\.[0-9]{2}(?![\s\S])")
FRAMEWORK_VERSION_PATTERN = re.compile(r"^SP_800_171_([0-9]+)_([0-9]+)_([0-9]+)(?![\s\S])")
SOURCE_CONTROL_TITLE_PATTERN = re.compile(r"^[A-Z]{2}-[0-9]{2}(?:\([0-9]{2}\))?(?![\s\S])")
SP_800_53_CPRT_URL_PREFIX = "https://csrc.nist.gov/projects/cprt/catalog#/cprt/framework/version/SP_800_53_"
# Guidance cross-references are an empty CPRT anchor followed, with or without one space, by the plain
# requirement number: "in [](#/cprt/framework/version/SP_800_171_3_0_0/home?element=03.01.02)03.01.02".
EMPTY_REQUIREMENT_ANCHOR_PATTERN = re.compile(
    r"\[\]\(#/cprt/framework/version/SP_800_171_[0-9]+_[0-9]+_[0-9]+/home\?element=(03\.[0-9]{2}\.[0-9]{2})\) ?(?=\1)"
)
CPRT_NAMESPACE = "https://csrc.nist.gov/ns/cprt"
FRAMEWORK_VERSION_PROPERTY = "framework-version-identifier"

FAMILY_CLASS = "family"
REQUIREMENT_CLASS = "requirement"
STATEMENT_CLASS = "security_requirement"
WITHDRAWN_STATUS = "withdrawn"
SELECT_LABEL = "SELECTED PARAMETER VALUES"

KNOWN_GROUP_KEYS = {"id", "class", "title", "props", "controls"}
KNOWN_GROUP_PROPERTIES = {"sort-id", "label"}
KNOWN_REQUIREMENT_KEYS = {"id", "class", "title", "props", "links", "parts", "params"}
KNOWN_REQUIREMENT_PROPERTIES = {"sort-id", "label", "status"}
CARRIED_LINK_RELATION = "reference"
KNOWN_LINK_RELATIONS = {CARRIED_LINK_RELATION, "incorporated_into", "addressed_by"}
KNOWN_LINK_KEYS = {"href", "rel"}
STATEMENT_PART_NAME = "statement"
GUIDANCE_PART_NAME = "guidance"
IGNORED_PART_NAMES = {"assessment-objective", "assessment-method"}
KNOWN_PART_NAMES = {STATEMENT_PART_NAME, GUIDANCE_PART_NAME, *IGNORED_PART_NAMES}
KNOWN_STATEMENT_KEYS = {"id", "name", "class", "prose", "parts"}
KNOWN_PARAM_KEYS = {"id", "props", "label", "usage", "guidelines", "select"}


def framework_version(catalog_document: dict) -> str:
    """The SP 800-171 version ("3.0.0") from NIST's CPRT property; metadata.version only versions the OSCAL file."""
    catalog = catalog_document.get("catalog") if isinstance(catalog_document, dict) else None
    metadata = catalog.get("metadata") if isinstance(catalog, dict) else None
    metadata_properties = metadata.get("props") if isinstance(metadata, dict) else None
    if not isinstance(metadata_properties, list):
        raise UnsupportedUpstreamData("catalog metadata has no props list")
    values = [
        prop.get("value")
        for prop in metadata_properties
        if isinstance(prop, dict)
        and prop.get("name") == FRAMEWORK_VERSION_PROPERTY
        and prop.get("ns") == CPRT_NAMESPACE
    ]
    if len(values) != 1 or not isinstance(values[0], str):
        raise UnsupportedUpstreamData(f"catalog metadata needs exactly one {FRAMEWORK_VERSION_PROPERTY!r} property")
    match = FRAMEWORK_VERSION_PATTERN.match(values[0])
    if match is None:
        raise UnsupportedUpstreamData(f"unsupported {FRAMEWORK_VERSION_PROPERTY} {values[0]!r}")
    return ".".join(str(int(part)) for part in match.groups())


def _number_from_id(oscal_id: str, pattern: re.Pattern, what: str) -> str:
    number = oscal_id.removeprefix(OSCAL_ID_PREFIX)
    if number == oscal_id or not pattern.match(number):
        raise UnsupportedUpstreamData(f"{oscal_id!r}: not a {what} id")
    return number


def _item_label_renderer(requirement_number: str):
    """Print item labels as the publication does: SR-03.01.01.c becomes "c.", SR-03.01.01.c.01 becomes "1."."""
    top_level_pattern = re.compile(rf"^SR-{re.escape(requirement_number)}\.([a-z])(?![\s\S])")
    nested_pattern = re.compile(rf"^SR-{re.escape(requirement_number)}\.[a-z]\.([0-9]{{2}})(?![\s\S])")

    def render(label: str, depth: int, where: str) -> str:
        pattern = top_level_pattern if depth == 1 else nested_pattern
        match = pattern.match(label) if depth <= 2 else None
        if match is None:
            raise UnsupportedUpstreamData(f"{where}: unsupported item label {label!r} at depth {depth}")
        return f"{match.group(1)}." if depth == 1 else f"{int(match.group(1))}."

    return render


def _read_group(group) -> tuple[str, str]:
    """Check a family's shape and return (number, title)."""
    group_id = entry_id(group)
    check_keys(group, KNOWN_GROUP_KEYS, group_id, "group")
    if group.get("class") != FAMILY_CLASS:
        raise UnsupportedUpstreamData(f"{group_id}: unsupported group class {group.get('class')!r}")
    number = _number_from_id(group_id, FAMILY_NUMBER_PATTERN, "family")
    title = group.get("title")
    if not isinstance(title, str) or not title:
        raise UnsupportedUpstreamData(f"{group_id}: group has no title")
    group_properties = properties(group, group_id, KNOWN_GROUP_PROPERTIES)
    if single_property_value(group_properties, "sort-id", None, group_id) != number:
        raise UnsupportedUpstreamData(f"{group_id}: sort-id differs from the number in its id")
    if single_property_value(group_properties, "label", None, group_id) != f"{title} ({number})":
        raise UnsupportedUpstreamData(f"{group_id}: label differs from '<title> (<number>)'")
    if not isinstance(group.get("controls"), list):
        raise UnsupportedUpstreamData(f"{group_id}: group has no controls list")
    return number, title


def _reference_targets(requirement: dict, where: str) -> list[str]:
    links = requirement.get("links", [])
    if not isinstance(links, list):
        raise UnsupportedUpstreamData(f"{where}: links must be a list")
    targets = []
    for link in links:
        if not isinstance(link, dict) or not isinstance(link.get("rel"), str):
            raise UnsupportedUpstreamData(f"{where}: link without a rel")
        check_keys(link, KNOWN_LINK_KEYS, where, "link")
        if link["rel"] not in KNOWN_LINK_RELATIONS:
            raise UnsupportedUpstreamData(f"{where}: unsupported link rel {link['rel']!r}")
        if link["rel"] == CARRIED_LINK_RELATION:
            href = link.get("href")
            if not isinstance(href, str) or not href.startswith("#"):
                raise UnsupportedUpstreamData(f"{where}: reference link needs a #target href")
            targets.append(href[1:])
    return targets


def _references(requirement: dict, catalog: OscalCatalog, where: str) -> dict:
    source_controls = []
    publications = []
    for target in _reference_targets(requirement, where):
        if target not in catalog.resources:
            raise UnsupportedUpstreamData(f"{where}: reference link to unknown back-matter resource {target!r}")
        title, href = catalog.resources[target]
        if SOURCE_CONTROL_TITLE_PATTERN.match(title):
            if href is None or not href.startswith(SP_800_53_CPRT_URL_PREFIX):
                raise UnsupportedUpstreamData(f"{where}: {title!r} looks like an SP 800-53 control but does not link to one")
            source_controls.append(title)
        else:
            publications.append(title)
    references = {}
    if source_controls:
        references["source_controls"] = source_controls
    if publications:
        references["publications"] = publications
    return references


def _read_requirement(requirement) -> tuple[str, bool, str]:
    """Check a requirement's shape and return (number, is withdrawn, sort id)."""
    requirement_id = entry_id(requirement)
    check_keys(requirement, KNOWN_REQUIREMENT_KEYS, requirement_id, "requirement")
    if requirement.get("class") != REQUIREMENT_CLASS:
        raise UnsupportedUpstreamData(f"{requirement_id}: unsupported class {requirement.get('class')!r}")
    number = _number_from_id(requirement_id, REQUIREMENT_NUMBER_PATTERN, "requirement")
    requirement_properties = properties(requirement, requirement_id, KNOWN_REQUIREMENT_PROPERTIES)
    sort_id = single_property_value(requirement_properties, "sort-id", None, requirement_id)
    if sort_id != number:
        raise UnsupportedUpstreamData(f"{requirement_id}: sort-id differs from the number in its id")
    statuses = [prop["value"] for prop in requirement_properties if prop["name"] == "status"]
    if any(status != WITHDRAWN_STATUS for status in statuses) or len(statuses) > 1:
        raise UnsupportedUpstreamData(f"{requirement_id}: unsupported status {statuses!r}")
    _reference_targets(requirement, requirement_id)
    if statuses:
        return number, True, sort_id
    title = requirement.get("title")
    if not isinstance(title, str) or not title:
        raise UnsupportedUpstreamData(f"{requirement_id}: requirement has no title")
    if single_property_value(requirement_properties, "label", None, requirement_id) != f"{title} ({number})":
        raise UnsupportedUpstreamData(f"{requirement_id}: label differs from '<title> (<number>)'")
    return number, False, sort_id


def _statement_and_guidance(requirement: dict, where: str) -> tuple[dict, dict]:
    parts = requirement.get("parts", [])
    if not isinstance(parts, list):
        raise UnsupportedUpstreamData(f"{where}: parts must be a list")
    for part in parts:
        part_name = part.get("name") if isinstance(part, dict) else part
        if part_name not in KNOWN_PART_NAMES:
            raise UnsupportedUpstreamData(f"{where}: unsupported part {part_name!r}")
    statements = [part for part in parts if part["name"] == STATEMENT_PART_NAME]
    guidances = [part for part in parts if part["name"] == GUIDANCE_PART_NAME]
    if len(statements) != 1 or len(guidances) != 1:
        raise UnsupportedUpstreamData(f"{where}: needs exactly one statement part and one guidance part")
    if statements[0].get("class") != STATEMENT_CLASS:
        raise UnsupportedUpstreamData(f"{where}: unsupported statement class {statements[0].get('class')!r}")
    return statements[0], guidances[0]


def _without_requirement_anchors(guidance: dict, requirement_numbers: set[str], where: str) -> dict:
    prose = guidance.get("prose")
    if not isinstance(prose, str):
        return guidance

    def drop_anchor(match: re.Match) -> str:
        if match.group(1) not in requirement_numbers:
            raise UnsupportedUpstreamData(f"{where}: cross-reference to unknown requirement {match.group(1)!r}")
        return ""

    return {**guidance, "prose": EMPTY_REQUIREMENT_ANCHOR_PATTERN.sub(drop_anchor, prose)}


def normalize_catalog(catalog_document: dict, lock: SourceLock) -> list[dict]:
    catalog = catalog_document.get("catalog") if isinstance(catalog_document, dict) else None
    if not isinstance(catalog, dict) or not isinstance(catalog.get("groups"), list):
        raise UnsupportedUpstreamData("document has no catalog.groups list")
    for group in catalog["groups"]:
        _read_group(group)
        for requirement in group["controls"]:
            if "controls" in requirement:
                raise UnsupportedUpstreamData(f"{entry_id(requirement)}: requirements cannot nest")
    lookup = OscalCatalog(catalog, KNOWN_PARAM_KEYS, select_label=SELECT_LABEL)
    requirement_numbers = {
        _number_from_id(entry_id(requirement), REQUIREMENT_NUMBER_PATTERN, "requirement")
        for group in catalog["groups"]
        for requirement in group["controls"]
    }

    rules = []
    for group in catalog["groups"]:
        family_number, family_title = _read_group(group)
        for requirement in group["controls"]:
            number, withdrawn, sort_id = _read_requirement(requirement)
            if withdrawn:
                continue
            requirement_id = requirement["id"]
            statement, guidance = _statement_and_guidance(requirement, requirement_id)
            statement_text = render_statement(
                statement, lookup, requirement_id, KNOWN_STATEMENT_KEYS, _item_label_renderer(number)
            )
            discussion = (
                f"## Requirement{PARAGRAPH_SEPARATOR}{statement_text}"
                f"{PARAGRAPH_SEPARATOR}## Discussion{PARAGRAPH_SEPARATOR}"
                f"{render_guidance(_without_requirement_anchors(guidance, requirement_numbers, requirement_id), lookup, requirement_id)}"
            )
            rule = {
                "schema_version": SCHEMA_VERSION,
                "id": f"{SOURCE_NAME}.{number}",
                "title": requirement["title"],
                "discussion": discussion,
                "discussion_format": "markdown",
                "section_path": [f"{family_number} {family_title}"],
                "source": {
                    "name": SOURCE_NAME,
                    "release_tag": lock.tag,
                    "commit_sha": lock.commit_sha,
                    "upstream_rule_id": requirement_id,
                    "upstream_path": CATALOG_PATH,
                    "upstream_revision": None,
                    "upstream_updated": None,
                    "upstream_url": f"{lock.repository_url.rstrip('/')}/blob/{lock.commit_sha}/{CATALOG_PATH}",
                    "license": dict(LICENSE),
                },
                "assessment": {"status": "manual", "manual_reason": "no_check"},
                "architecture": None,
                "applicability": [{"target": None, "version": None, "benchmarks": []}],
                "tags": [],
                "references": _references(requirement, lookup, requirement_id),
                "check": None,
                "odvs": [],
                "remediation": None,
            }
            rules.append((sort_id, rule))
    return [rule for _, rule in sorted(rules, key=lambda sorted_rule: sorted_rule[0])]
