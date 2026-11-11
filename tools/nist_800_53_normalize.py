"""Convert NIST's SP 800-53 Rev. 5 OSCAL catalog and baseline profiles into the project's v5 rule JSON shape."""

import re

from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData
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
LINK_PATTERN = re.compile(r"\[([^\]]*)\]\(#([^)\s]+)\)")
INSERT_PATTERN = re.compile(r"\{\{\s*insert:\s*param,\s*([^\s}]+)\s*\}\}")

BASE_CONTROL_CLASS = "SP800-53"
ENHANCEMENT_CLASS = "SP800-53-enhancement"
FAMILY_CLASS = "family"
WITHDRAWN_STATUS = "withdrawn"
ZERO_PADDED_LABEL_CLASS = "zero-padded"
MAXIMUM_ITEM_DEPTH = 3
PARAGRAPH_SEPARATOR = "\n\n"
LIST_INDENT = "  "
ORGANIZATION_DEFINED_PREFIX = "organization-defined"

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
KNOWN_PROPERTY_KEYS = {"name", "value", "class", "ns"}
CARRIED_LINK_RELATIONS = {"related", "reference"}
KNOWN_LINK_RELATIONS = {*CARRIED_LINK_RELATIONS, "required", "incorporated-into", "moved-to"}
KNOWN_LINK_KEYS = {"href", "rel"}
STATEMENT_PART_NAME = "statement"
GUIDANCE_PART_NAME = "guidance"
ITEM_PART_NAME = "item"
IGNORED_PART_NAMES = {"assessment-objective", "assessment-method"}
KNOWN_PART_NAMES = {STATEMENT_PART_NAME, GUIDANCE_PART_NAME, ITEM_PART_NAME, *IGNORED_PART_NAMES}
KNOWN_STATEMENT_KEYS = {"id", "name", "prose", "parts"}
KNOWN_ITEM_KEYS = {"id", "name", "prose", "props", "parts"}
KNOWN_GUIDANCE_KEYS = {"id", "name", "prose"}
KNOWN_PARAM_KEYS = {"id", "props", "label", "guidelines", "select"}
KNOWN_SELECT_KEYS = {"how-many", "choice"}
ONE_OR_MORE = "one-or-more"
KNOWN_PROFILE_IMPORT_KEYS = {"href", "include-controls"}


def label_for_control_id(control_id: str) -> str:
    match = CONTROL_ID_PATTERN.match(control_id)
    if match is None:
        raise UnsupportedUpstreamData(f"{control_id!r}: not a control id")
    family, number, enhancement_number = match.groups()
    label = f"{family.upper()}-{number}"
    return label if enhancement_number is None else f"{label}({enhancement_number})"


def control_id_for_label(label: str) -> str | None:
    match = CONTROL_LABEL_PATTERN.match(label)
    if match is None:
        return None
    family, number, enhancement_number = match.groups()
    control_id = f"{family.lower()}-{number}"
    return control_id if enhancement_number is None else f"{control_id}.{enhancement_number}"


def _entry_id(entry) -> str:
    entry_id = entry.get("id") if isinstance(entry, dict) else None
    if not isinstance(entry_id, str):
        raise UnsupportedUpstreamData("catalog entry without a string id")
    return entry_id


def _properties(owner: dict, where: str, known_names: set[str]) -> list[dict]:
    properties = owner.get("props", [])
    if not isinstance(properties, list):
        raise UnsupportedUpstreamData(f"{where}: props must be a list")
    for prop in properties:
        if not isinstance(prop, dict) or not isinstance(prop.get("name"), str):
            raise UnsupportedUpstreamData(f"{where}: property without a name")
        unknown_keys = sorted(set(prop) - KNOWN_PROPERTY_KEYS)
        if unknown_keys:
            raise UnsupportedUpstreamData(f"{where}: unsupported property key {unknown_keys[0]!r}")
        if prop["name"] not in known_names:
            raise UnsupportedUpstreamData(f"{where}: unsupported property {prop['name']!r}")
        if not isinstance(prop.get("value"), str):
            raise UnsupportedUpstreamData(f"{where}: property {prop['name']!r} needs a string value")
    return properties


def _single_property_value(properties: list[dict], name: str, property_class: str | None, where: str) -> str:
    values = [
        prop["value"]
        for prop in properties
        if prop["name"] == name and prop.get("class") == property_class
    ]
    if len(values) != 1:
        raise UnsupportedUpstreamData(
            f"{where}: needs exactly one {name!r} property of class {property_class!r}, found {len(values)}"
        )
    return values[0]


def _check_keys(owner: dict, known_keys: set[str], where: str, what: str) -> None:
    unknown_keys = sorted(set(owner) - known_keys)
    if unknown_keys:
        raise UnsupportedUpstreamData(f"{where}: unsupported {what} key {unknown_keys[0]!r}")


class _Catalog:
    """Everything the entries need to look each other up, collected before any entry is rendered."""

    def __init__(self, catalog: dict):
        self.params: dict[str, dict] = {}
        self.link_target_ids: set[str] = set()
        self.control_ids: set[str] = set()
        self.resources: dict[str, tuple[str, str]] = {}
        self._collect_back_matter(catalog)
        for group in catalog["groups"]:
            self._collect_group(group)

    def _collect_back_matter(self, catalog: dict) -> None:
        back_matter = catalog.get("back-matter")
        if not isinstance(back_matter, dict) or not isinstance(back_matter.get("resources"), list):
            raise UnsupportedUpstreamData("catalog has no back-matter resources list")
        for resource in back_matter["resources"]:
            uuid = resource.get("uuid") if isinstance(resource, dict) else None
            if not isinstance(uuid, str):
                raise UnsupportedUpstreamData("back-matter resource without a uuid")
            title = resource.get("title")
            if not isinstance(title, str) or not title:
                raise UnsupportedUpstreamData(f"back-matter resource {uuid!r} has no title")
            rlinks = resource.get("rlinks")
            first_link = rlinks[0] if isinstance(rlinks, list) and rlinks else None
            first_href = first_link.get("href") if isinstance(first_link, dict) else None
            if not isinstance(first_href, str) or not first_href:
                raise UnsupportedUpstreamData(f"back-matter resource {uuid!r} has no rlinks href")
            self.resources[uuid] = (title, first_href)

    def _collect_group(self, group) -> None:
        if not isinstance(group, dict):
            raise UnsupportedUpstreamData("catalog group is not an object")
        group_id = _entry_id(group)
        self.link_target_ids.add(group_id)
        for part in group.get("parts", []):
            self._collect_part_ids(part)
        for control in group.get("controls", []):
            self._collect_control(control)

    def _collect_control(self, control) -> None:
        control_id = _entry_id(control)
        if control_id in self.control_ids:
            raise UnsupportedUpstreamData(f"{control_id}: duplicate id")
        self.control_ids.add(control_id)
        self.link_target_ids.add(control_id)
        for part in control.get("parts", []):
            self._collect_part_ids(part)
        for param in control.get("params", []):
            param_id = _entry_id(param)
            if param_id in self.params or param_id in self.link_target_ids:
                raise UnsupportedUpstreamData(f"{param_id}: duplicate id")
            self.params[param_id] = param
            self.link_target_ids.add(param_id)
        for enhancement in control.get("controls", []):
            self._collect_control(enhancement)

    def _collect_part_ids(self, part) -> None:
        if isinstance(part, dict):
            if isinstance(part.get("id"), str):
                self.link_target_ids.add(part["id"])
            for child in part.get("parts", []):
                self._collect_part_ids(child)

    def render_inserts(self, text: str, where: str) -> str:
        return self._render_inserts(text, where, ())

    def _render_inserts(self, text: str, where: str, parameter_ids_being_rendered: tuple[str, ...]) -> str:
        def render(match: re.Match) -> str:
            return self._render_param(match.group(1), where, parameter_ids_being_rendered)

        rendered = INSERT_PATTERN.sub(render, text)
        if "{{" in rendered:
            raise UnsupportedUpstreamData(f"{where}: unsupported {{{{ ... }}}} expression")
        return rendered

    def _render_param(self, param_id: str, where: str, parameter_ids_being_rendered: tuple[str, ...]) -> str:
        if param_id in parameter_ids_being_rendered:
            raise UnsupportedUpstreamData(f"{where}: parameter {param_id!r} inserts itself")
        param = self.params.get(param_id)
        if param is None:
            raise UnsupportedUpstreamData(f"{where}: insert of unknown parameter {param_id!r}")
        _check_keys(param, KNOWN_PARAM_KEYS, param_id, "parameter")
        has_label = "label" in param
        has_select = "select" in param
        if has_label == has_select:
            raise UnsupportedUpstreamData(f"{param_id}: parameter needs exactly one of label and select")
        if has_label:
            label = param["label"]
            if not isinstance(label, str):
                raise UnsupportedUpstreamData(f"{param_id}: parameter label must be a string")
            if label.startswith(ORGANIZATION_DEFINED_PREFIX):
                return f"[Assignment: {label}]"
            return f"[Assignment: {ORGANIZATION_DEFINED_PREFIX} {label}]"
        select = param["select"]
        if not isinstance(select, dict) or not isinstance(select.get("choice"), list) or not select["choice"]:
            raise UnsupportedUpstreamData(f"{param_id}: select needs a non-empty choice list")
        _check_keys(select, KNOWN_SELECT_KEYS, param_id, "select")
        how_many = select.get("how-many")
        if how_many not in (None, ONE_OR_MORE):
            raise UnsupportedUpstreamData(f"{param_id}: unsupported how-many {how_many!r}")
        stack = (*parameter_ids_being_rendered, param_id)
        choices = []
        for choice in select["choice"]:
            if not isinstance(choice, str):
                raise UnsupportedUpstreamData(f"{param_id}: select choice must be a string")
            choices.append(self._render_inserts(choice.strip(), where, stack))
        heading = "Selection (one or more)" if how_many == ONE_OR_MORE else "Selection"
        return f"[{heading}: {'; '.join(choices)}]"

    def rewrite_links(self, text: str, where: str) -> str:
        def rewrite(match: re.Match) -> str:
            text, target = match.groups()
            if target in self.resources:
                return f"[{text}]({self.resources[target][1]})"
            if target in self.link_target_ids:
                return text
            raise UnsupportedUpstreamData(f"{where}: link to unknown target {target!r}")

        rewritten = LINK_PATTERN.sub(rewrite, text)
        if "](#" in rewritten:
            raise UnsupportedUpstreamData(f"{where}: a link could not be rewritten")
        return rewritten


def _item_lines(item: dict, depth: int, catalog: _Catalog, where: str) -> list[str]:
    if depth > MAXIMUM_ITEM_DEPTH:
        raise UnsupportedUpstreamData(f"{where}: statement items nested deeper than {MAXIMUM_ITEM_DEPTH} levels")
    if not isinstance(item, dict) or item.get("name") != ITEM_PART_NAME:
        part_name = item.get("name") if isinstance(item, dict) else item
        raise UnsupportedUpstreamData(f"{where}: unsupported statement part {part_name!r}")
    _check_keys(item, KNOWN_ITEM_KEYS, where, "item")
    label = _single_property_value(_properties(item, where, {"label"}), "label", None, where)
    prose = item.get("prose")
    if not isinstance(prose, str):
        raise UnsupportedUpstreamData(f"{where}: item {label!r} has no prose")
    indentation = LIST_INDENT * (depth - 1)
    lines = [f"{indentation}- {label} {catalog.render_inserts(prose, where)}"]
    for child in item.get("parts", []):
        lines.extend(_item_lines(child, depth + 1, catalog, where))
    return lines


def _render_statement(statement: dict, catalog: _Catalog, where: str) -> str:
    _check_keys(statement, KNOWN_STATEMENT_KEYS, where, "statement part")
    blocks = []
    prose = statement.get("prose")
    if prose is not None:
        if not isinstance(prose, str):
            raise UnsupportedUpstreamData(f"{where}: statement prose must be a string")
        blocks.append(catalog.render_inserts(prose, where))
    item_lines = []
    for item in statement.get("parts", []):
        item_lines.extend(_item_lines(item, 1, catalog, where))
    if item_lines:
        blocks.append("\n".join(item_lines))
    if not blocks:
        raise UnsupportedUpstreamData(f"{where}: statement has neither prose nor items")
    return catalog.rewrite_links(PARAGRAPH_SEPARATOR.join(blocks), where).strip()


def _render_guidance(guidance: dict, catalog: _Catalog, where: str) -> str:
    _check_keys(guidance, KNOWN_GUIDANCE_KEYS, where, "guidance part")
    prose = guidance.get("prose")
    if not isinstance(prose, str):
        raise UnsupportedUpstreamData(f"{where}: guidance has no prose")
    return catalog.rewrite_links(catalog.render_inserts(prose, where), where).strip()


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
        _check_keys(link, KNOWN_LINK_KEYS, where, "link")
        relation = link["rel"]
        if relation not in KNOWN_LINK_RELATIONS:
            raise UnsupportedUpstreamData(f"{where}: unsupported link rel {relation!r}")
        if relation in CARRIED_LINK_RELATIONS:
            href = link.get("href")
            if not isinstance(href, str) or not href.startswith("#"):
                raise UnsupportedUpstreamData(f"{where}: {relation} link needs a #target href")
            targets_by_relation[relation].append(href[1:])
    return targets_by_relation


def _references(control: dict, catalog: _Catalog, where: str) -> dict:
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
    _check_keys(imports[0], KNOWN_PROFILE_IMPORT_KEYS, benchmark_name, "profile import")
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


def _read_entry(entry: dict, expected_class: str) -> tuple[str, bool, str, str]:
    """Check an entry's shape and return (id, is withdrawn, sort id, zero-padded label)."""
    control_id = _entry_id(entry)
    _check_keys(entry, KNOWN_CONTROL_KEYS, control_id, "control")
    if entry.get("class") != expected_class:
        raise UnsupportedUpstreamData(f"{control_id}: unsupported class {entry.get('class')!r}")
    if not CONTROL_ID_PATTERN.match(control_id):
        raise UnsupportedUpstreamData(f"{control_id!r}: control id is not safe to use in a rule id")
    properties = _properties(entry, control_id, KNOWN_CONTROL_PROPERTIES)
    label = _single_property_value(properties, "label", None, control_id)
    if label != label_for_control_id(control_id):
        raise UnsupportedUpstreamData(
            f"{control_id}: label {label!r} differs from the label derived from its id"
        )
    sort_id = _single_property_value(properties, "sort-id", None, control_id)
    zero_padded_label = _single_property_value(properties, "label", ZERO_PADDED_LABEL_CLASS, control_id)
    statuses = [prop["value"] for prop in properties if prop["name"] == "status"]
    if any(status != WITHDRAWN_STATUS for status in statuses) or len(statuses) > 1:
        raise UnsupportedUpstreamData(f"{control_id}: unsupported status {statuses!r}")
    _link_targets(entry, control_id)
    return control_id, bool(statuses), sort_id, zero_padded_label


def _walk_entries(catalog_document: dict):
    """Yield (entry, base control entry or None, family title) for every control and enhancement."""
    for group in catalog_document["groups"]:
        _check_keys(group, KNOWN_GROUP_KEYS, _entry_id(group), "group")
        if group.get("class") != FAMILY_CLASS:
            raise UnsupportedUpstreamData(f"{_entry_id(group)}: unsupported group class {group.get('class')!r}")
        group_properties = _properties(group, _entry_id(group), {"label"})
        if len(group_properties) != 1:
            raise UnsupportedUpstreamData(f"{_entry_id(group)}: group needs exactly one label property")
        if not isinstance(group.get("title"), str):
            raise UnsupportedUpstreamData(f"{_entry_id(group)}: group has no title")
        for part in group.get("parts", []):
            if not isinstance(part, dict) or part.get("name") not in KNOWN_GROUP_PART_NAMES:
                raise UnsupportedUpstreamData(f"{_entry_id(group)}: unsupported group part")
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
    lookup = _Catalog(catalog)

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
            f"## Control{PARAGRAPH_SEPARATOR}{_render_statement(statement, lookup, control_id)}"
            f"{PARAGRAPH_SEPARATOR}## Discussion{PARAGRAPH_SEPARATOR}{_render_guidance(guidance, lookup, control_id)}"
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
            "odv": None,
            "remediation": None,
        }
        rules.append((sort_id, rule))
    return [rule for _, rule in sorted(rules, key=lambda sorted_rule: sorted_rule[0])]
