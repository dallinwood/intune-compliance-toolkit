"""Convert NIST's SP 800-53 Rev. 5 OSCAL catalog and baseline profiles into the project's v5 rule JSON shape."""

import re

from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData
from tools.nist_oscal import (
    ITEM_PART_NAME,
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

SOURCE_NAME = "nist_800_53"
REPOSITORY_URL = "https://github.com/usnistgov/oscal-content"
LICENSE_FILE_PATH = "LICENSE.md"
README_FILE_PATH = "nist.gov/SP800-53/README.md"
CATALOG_PATH = "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json"
PROFILE_PATHS = {
    "nist_800_53_low": "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_LOW-baseline_profile.json",
    "nist_800_53_moderate": "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_MODERATE-baseline_profile.json",
    "nist_800_53_high": "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_HIGH-baseline_profile.json",
    "nist_800_53_privacy": "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_PRIVACY-baseline_profile.json",
}

LICENSE = {
    "name": "CC0 1.0 (public domain)",
    "url": "https://creativecommons.org/publicdomain/zero/1.0/",
    "rights_holder": "National Institute of Standards and Technology",
    "modified": True,
}

CONTROL_ID_PATTERN = re.compile(r"^([a-z]{2})-([0-9]+)(?:\.([0-9]+))?(?![\s\S])")
CONTROL_LABEL_PATTERN = re.compile(r"^([A-Z]{2})-([0-9]+)(?:\(([0-9]+)\))?(?![\s\S])")

BASE_CONTROL_CLASS = "SP800-53"
ENHANCEMENT_CLASS = "SP800-53-enhancement"
FAMILY_CLASS = "family"
WITHDRAWN_STATUS = "withdrawn"
ZERO_PADDED_LABEL_CLASS = "zero-padded"

KNOWN_GROUP_KEYS = {"id", "class", "title", "props", "controls", "parts"}
KNOWN_GROUP_PART_NAMES = {"overview"}
KNOWN_CONTROL_KEYS = {"id", "class", "title", "props", "links", "parts", "params", "controls"}
KNOWN_CONTROL_PROPERTIES = {
    "label",
    "sort-id",
    "implementation-level",
    "contributes-to-assurance",
    "status",
}
CARRIED_LINK_RELATIONS = {"related", "reference"}
KNOWN_LINK_RELATIONS = {*CARRIED_LINK_RELATIONS, "required", "incorporated-into", "moved-to"}
KNOWN_LINK_KEYS = {"href", "rel"}
STATEMENT_PART_NAME = "statement"
GUIDANCE_PART_NAME = "guidance"
IGNORED_PART_NAMES = {"assessment-objective", "assessment-method"}
KNOWN_PART_NAMES = {STATEMENT_PART_NAME, GUIDANCE_PART_NAME, ITEM_PART_NAME, *IGNORED_PART_NAMES}
KNOWN_STATEMENT_KEYS = {"id", "name", "prose", "parts"}
# depends-on and remarks appear only in oscal-content v1.0.0; neither changes how a parameter is rendered.
KNOWN_PARAM_KEYS = {"id", "props", "label", "guidelines", "select", "depends-on", "remarks"}
KNOWN_PROFILE_IMPORT_KEYS = {"href", "include-controls"}


def label_for_control_id(control_id: str) -> str:
    match = CONTROL_ID_PATTERN.match(control_id)
    if match is None:
        raise UnsupportedUpstreamData(f"{control_id!r}: not a control id")
    family, number, enhancement_number = match.groups()
    label = f"{family.upper()}-{number}"
    return label if enhancement_number is None else f"{label}({enhancement_number})"


def zero_padded_label_for_control_id(control_id: str) -> str:
    match = CONTROL_ID_PATTERN.match(control_id)
    if match is None:
        raise UnsupportedUpstreamData(f"{control_id!r}: not a control id")
    family, number, enhancement_number = match.groups()
    label = f"{family.upper()}-{number.zfill(2)}"
    return label if enhancement_number is None else f"{label}({enhancement_number.zfill(2)})"


def control_id_for_label(label: str) -> str | None:
    match = CONTROL_LABEL_PATTERN.match(label)
    if match is None:
        return None
    family, number, enhancement_number = match.groups()
    control_id = f"{family.lower()}-{number}"
    return control_id if enhancement_number is None else f"{control_id}.{enhancement_number}"


def control_id_for_zero_padded_label(label: str) -> str | None:
    """"AC-02(03)" -> "ac-2.3"; None unless the label is exactly the zero-padded form NIST derives from the id."""
    match = CONTROL_LABEL_PATTERN.match(label)
    if match is None:
        return None
    family, number, enhancement_number = match.groups()
    control_id = f"{family.lower()}-{int(number)}"
    if enhancement_number is not None:
        control_id = f"{control_id}.{int(enhancement_number)}"
    return control_id if zero_padded_label_for_control_id(control_id) == label else None


def _item_label(label: str, depth: int, where: str) -> str:
    return label


def _statement_and_guidance(control: dict, where: str) -> tuple[dict, dict]:
    parts = control.get("parts", [])
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
    return statements[0], guidances[0]


def _link_targets(control: dict, where: str) -> dict[str, list[str]]:
    targets_by_relation: dict[str, list[str]] = {relation: [] for relation in CARRIED_LINK_RELATIONS}
    links = control.get("links", [])
    if not isinstance(links, list):
        raise UnsupportedUpstreamData(f"{where}: links must be a list")
    for link in links:
        if not isinstance(link, dict) or not isinstance(link.get("rel"), str):
            raise UnsupportedUpstreamData(f"{where}: link without a rel")
        check_keys(link, KNOWN_LINK_KEYS, where, "link")
        relation = link["rel"]
        if relation not in KNOWN_LINK_RELATIONS:
            raise UnsupportedUpstreamData(f"{where}: unsupported link rel {relation!r}")
        if relation in CARRIED_LINK_RELATIONS:
            href = link.get("href")
            if not isinstance(href, str) or not href.startswith("#"):
                raise UnsupportedUpstreamData(f"{where}: {relation} link needs a #target href")
            targets_by_relation[relation].append(href[1:])
    return targets_by_relation


def _references(control: dict, catalog: OscalCatalog, where: str) -> dict:
    targets = _link_targets(control, where)
    related_controls = []
    for target in targets["related"]:
        if target not in catalog.control_ids:
            raise UnsupportedUpstreamData(f"{where}: related link to unknown control {target!r}")
        related_controls.append(label_for_control_id(target))
    publications = []
    for target in targets["reference"]:
        if target not in catalog.resources:
            raise UnsupportedUpstreamData(f"{where}: reference link to unknown back-matter resource {target!r}")
        publications.append(catalog.resources[target][0])
    references = {}
    if related_controls:
        references["related_controls"] = related_controls
    if publications:
        references["publications"] = publications
    return references


def _profile_control_ids(profile_document: dict, benchmark_name: str) -> list[str]:
    profile = profile_document.get("profile") if isinstance(profile_document, dict) else None
    if not isinstance(profile, dict):
        raise UnsupportedUpstreamData(f"{benchmark_name}: document has no profile")
    imports = profile.get("imports")
    if not isinstance(imports, list) or len(imports) != 1 or not isinstance(imports[0], dict):
        raise UnsupportedUpstreamData(f"{benchmark_name}: profile needs exactly one import")
    check_keys(imports[0], KNOWN_PROFILE_IMPORT_KEYS, benchmark_name, "profile import")
    if profile.get("merge") != {"as-is": True}:
        raise UnsupportedUpstreamData(f"{benchmark_name}: profile merge must be as-is")
    include_controls = imports[0].get("include-controls")
    if not isinstance(include_controls, list) or not include_controls:
        raise UnsupportedUpstreamData(f"{benchmark_name}: profile import needs include-controls")
    control_ids: list[str] = []
    for selection in include_controls:
        if not isinstance(selection, dict) or set(selection) != {"with-ids"} or not isinstance(selection["with-ids"], list):
            raise UnsupportedUpstreamData(f"{benchmark_name}: include-controls may only use with-ids")
        control_ids.extend(selection["with-ids"])
    return control_ids


def _benchmark_membership(
    profile_documents: dict[str, dict], current_control_ids: set[str]
) -> dict[str, set[str]]:
    missing_profiles = [name for name in PROFILE_PATHS if name not in profile_documents]
    if missing_profiles:
        raise UnsupportedUpstreamData(f"missing baseline profile {missing_profiles[0]!r}")
    membership = {}
    for benchmark_name in PROFILE_PATHS:
        control_ids = _profile_control_ids(profile_documents[benchmark_name], benchmark_name)
        for control_id in control_ids:
            if control_id not in current_control_ids:
                raise UnsupportedUpstreamData(
                    f"{benchmark_name}: lists {control_id!r}, which is withdrawn or not in the catalog"
                )
        if len(set(control_ids)) != len(control_ids):
            raise UnsupportedUpstreamData(f"{benchmark_name}: lists a control more than once")
        membership[benchmark_name] = set(control_ids)
    return membership


def _read_entry(entry: dict, expected_class: str) -> tuple[str, bool, str, str | None]:
    """Check an entry's shape and return (id, is withdrawn, sort id, zero-padded label or None if withdrawn)."""
    control_id = entry_id(entry)
    check_keys(entry, KNOWN_CONTROL_KEYS, control_id, "control")
    if entry.get("class") != expected_class:
        raise UnsupportedUpstreamData(f"{control_id}: unsupported class {entry.get('class')!r}")
    if not CONTROL_ID_PATTERN.match(control_id):
        raise UnsupportedUpstreamData(f"{control_id!r}: control id is not safe to use in a rule id")
    control_properties = properties(entry, control_id, KNOWN_CONTROL_PROPERTIES)
    statuses = [prop["value"] for prop in control_properties if prop["name"] == "status"]
    if any(status != WITHDRAWN_STATUS for status in statuses) or len(statuses) > 1:
        raise UnsupportedUpstreamData(f"{control_id}: unsupported status {statuses!r}")
    sort_id = single_property_value(control_properties, "sort-id", None, control_id)
    _link_targets(entry, control_id)
    if statuses:
        # Withdrawn entries never become rules, and oscal-content v1.3.0 has one (si-3.9) without a plain label.
        return control_id, True, sort_id, None
    label = single_property_value(control_properties, "label", None, control_id)
    if label != label_for_control_id(control_id):
        raise UnsupportedUpstreamData(
            f"{control_id}: label {label!r} differs from the label derived from its id"
        )
    derived_zero_padded_label = zero_padded_label_for_control_id(control_id)
    zero_padded_labels = [
        prop["value"]
        for prop in control_properties
        if prop["name"] == "label" and prop.get("class") == ZERO_PADDED_LABEL_CLASS
    ]
    if len(zero_padded_labels) > 1:
        raise UnsupportedUpstreamData(f"{control_id}: more than one zero-padded label")
    # oscal-content v1.0.0 has no zero-padded labels; later releases' labels must match the derivation, which proves it.
    if zero_padded_labels and zero_padded_labels[0] != derived_zero_padded_label:
        raise UnsupportedUpstreamData(
            f"{control_id}: zero-padded label {zero_padded_labels[0]!r} differs from {derived_zero_padded_label!r}"
        )
    return control_id, False, sort_id, derived_zero_padded_label


def _walk_entries(catalog_document: dict):
    """Yield (entry, base control entry or None, family title) for every control and enhancement."""
    for group in catalog_document["groups"]:
        check_keys(group, KNOWN_GROUP_KEYS, entry_id(group), "group")
        if group.get("class") != FAMILY_CLASS:
            raise UnsupportedUpstreamData(f"{entry_id(group)}: unsupported group class {group.get('class')!r}")
        # oscal-content v1.0.0 and v1.3.0 give groups no label; it is not used, so its absence is accepted.
        group_properties = properties(group, entry_id(group), {"label"})
        if len(group_properties) > 1:
            raise UnsupportedUpstreamData(f"{entry_id(group)}: group has more than one label property")
        if not isinstance(group.get("title"), str):
            raise UnsupportedUpstreamData(f"{entry_id(group)}: group has no title")
        for part in group.get("parts", []):
            if not isinstance(part, dict) or part.get("name") not in KNOWN_GROUP_PART_NAMES:
                raise UnsupportedUpstreamData(f"{entry_id(group)}: unsupported group part")
        for control in group.get("controls", []):
            yield control, None, group["title"]
            for enhancement in control.get("controls", []):
                yield enhancement, control, group["title"]


def normalize_catalog(
    catalog_document: dict, profile_documents: dict[str, dict], lock: SourceLock
) -> list[dict]:
    catalog = catalog_document.get("catalog") if isinstance(catalog_document, dict) else None
    if not isinstance(catalog, dict) or not isinstance(catalog.get("groups"), list):
        raise UnsupportedUpstreamData("document has no catalog.groups list")
    lookup = OscalCatalog(catalog, KNOWN_PARAM_KEYS)

    entries = list(_walk_entries(catalog))
    facts_by_id = {}
    for entry, base_control, _ in entries:
        expected_class = ENHANCEMENT_CLASS if base_control is not None else BASE_CONTROL_CLASS
        control_id, withdrawn, sort_id, zero_padded_label = _read_entry(entry, expected_class)
        facts_by_id[control_id] = (withdrawn, sort_id, zero_padded_label)
        if base_control is not None and "controls" in entry:
            raise UnsupportedUpstreamData(f"{control_id}: enhancements nested deeper than one level")

    current_control_ids = {control_id for control_id, facts in facts_by_id.items() if not facts[0]}
    membership = _benchmark_membership(profile_documents, current_control_ids)

    rules = []
    for entry, base_control, family_title in entries:
        control_id = entry["id"]
        withdrawn, sort_id, _ = facts_by_id[control_id]
        if withdrawn:
            continue
        statement, guidance = _statement_and_guidance(entry, control_id)
        base_entry = base_control if base_control is not None else entry
        base_zero_padded_label = facts_by_id[base_entry["id"]][2]
        title = entry["title"] if base_control is None else f"{base_control['title']} | {entry['title']}"
        discussion = (
            f"## Control{PARAGRAPH_SEPARATOR}{render_statement(statement, lookup, control_id, KNOWN_STATEMENT_KEYS, _item_label)}"
            f"{PARAGRAPH_SEPARATOR}## Discussion{PARAGRAPH_SEPARATOR}{render_guidance(guidance, lookup, control_id)}"
        )
        rule = {
            "schema_version": SCHEMA_VERSION,
            "id": f"{SOURCE_NAME}.{control_id}",
            "title": title,
            "discussion": discussion,
            "discussion_format": "markdown",
            "section_path": [family_title, f"{base_zero_padded_label} {base_entry['title']}"],
            "source": {
                "name": SOURCE_NAME,
                "release_tag": lock.tag,
                "commit_sha": lock.commit_sha,
                "upstream_rule_id": control_id,
                "upstream_path": CATALOG_PATH,
                "upstream_revision": None,
                "upstream_updated": None,
                "upstream_url": f"{lock.repository_url.rstrip('/')}/blob/{lock.commit_sha}/{CATALOG_PATH}",
                "license": dict(LICENSE),
            },
            "assessment": {"status": "manual", "manual_reason": "no_check"},
            "architecture": None,
            "applicability": [
                {
                    "target": None,
                    "version": None,
                    "benchmarks": [
                        {"name": benchmark_name, "severity": None}
                        for benchmark_name in PROFILE_PATHS
                        if control_id in membership[benchmark_name]
                    ],
                }
            ],
            "tags": [],
            "references": _references(entry, lookup, control_id),
            "check": None,
            "odvs": [],
            "remediation": None,
        }
        rules.append((sort_id, rule))
    return [rule for _, rule in sorted(rules, key=lambda sorted_rule: sorted_rule[0])]
