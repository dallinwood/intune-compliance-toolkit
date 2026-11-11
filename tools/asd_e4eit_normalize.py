"""Convert ASD's Essentials for enterprise IT (E4EIT) OSCAL files into the project's v5 rule JSON shape."""

import re

from tools.asd_oscal import ASD_LICENSE, resource_hrefs, rewrite_resource_links
from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData
from tools.source_lock import SourceLock

SOURCE_NAME = "asd_e4eit"
ISM_SOURCE_NAME = "asd_ism"
REPOSITORY_URL = "https://github.com/AustralianCyberSecurityCentre/e4eit-oscal"
CATALOG_FILE_NAME = "E4EIT_catalog.json"
MAPPING_COLLECTION_FILE_NAME = "E4EIT_mapping-collection.json"
PROFILE_FILE_PATTERN = re.compile(r"^E4EIT_[a-z0-9-]+-domain_profile\.json$")
MAPPING_FILE_ID = "asd-e4eit-to-asd-ism"
MAPPING_SCHEMA_VERSION = 1

LICENSE = ASD_LICENSE

ESSENTIALS_NAMESPACE = "https://www.cyber.gov.au/ns/essentials/oscal/1.0"
EXPECTED_GROUP_DEPTH = 2
SAFE_CONTROL_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(?![\s\S])")
PARAGRAPH_SEPARATOR = "\n\n"

PRINCIPLE_CLASS = "essentials-principle"
OVERVIEW_PART_NAME = "overview"
OVERVIEW_HEADING_LABEL_PROPERTY = "label"
STATEMENT_PART_NAME = "statement"
ACTION_PART_CLASS = "essentials-action"
INDICATORS_PART_CLASS = "indicators-of-good-practice"
INDICATOR_GROUP_CLASS = "indicator-group"
INDICATOR_GROUP_TITLES = ("Not effective", "Partially effective", "Fully effective")

KNOWN_CONTROL_KEYS = {"id", "title", "props", "links", "parts"}
SORT_ID_PROPERTY = "sort-id"
DOMAIN_PROPERTY = "domain"
KNOWN_CONTROL_PROPERTIES = {SORT_ID_PROPERTY, DOMAIN_PROPERTY}

PROFILE_DOMAIN_PROPERTY = "domain"
PROFILE_PHASE_PROPERTY = "domain-priority-phase"

MITIGATED_TECHNIQUE_RELATION = "mitigated-technique"
TECHNIQUE_HREF_PATTERN = re.compile(
    r"^https://attack\.mitre\.org/versions/v(\d+)/techniques/(T\d+(?:\.\d+)?)/?(?![\s\S])"
)

BENCHMARK_BY_PHASE = {
    "phase-1": "e4eit_phase_1",
    "phase-2": "e4eit_phase_2",
    "phase-3": "e4eit_phase_3",
}
BENCHMARK_BY_DOMAIN = {
    "boundary-services": "e4eit_boundary_services",
    "identity-services": "e4eit_identity_services",
    "critical-processes-and-services": "e4eit_critical_processes_and_services",
    "privileged-environments": "e4eit_privileged_environments",
    "business-systems": "e4eit_business_systems",
    "governance-and-culture": "e4eit_governance_and_culture",
    "user-devices": "e4eit_user_devices",
    "visibility-and-response": "e4eit_visibility_and_response",
}

ISM_MAPPING_DESCRIPTION = "E4EIT to ISM (excl. E8)"
ESSENTIAL_EIGHT_MAPPING_DESCRIPTION = "E4EIT to E8"
ISM_MAPPING_NOTE_BY_DESCRIPTION = {
    ISM_MAPPING_DESCRIPTION: (
        "ASD lists these ISM controls as potential evidence sources for this action "
        "(E4EIT to ISM, excluding Essential Eight)."
    ),
    ESSENTIAL_EIGHT_MAPPING_DESCRIPTION: (
        "ASD lists these ISM controls as potential evidence sources for this action "
        "(E4EIT to Essential Eight)."
    ),
}
REFERENCE_KEYS_BY_MAPPING_DESCRIPTION = {
    "E4EIT to CSF": ("nist", "csf_2.0"),
    "E4EIT to 800-171r3": ("nist", "800-171r3"),
    "E4EIT to AESCSF": ("aemo", "aescsf_v2"),
}
KNOWN_MAPPING_DESCRIPTIONS = {
    *ISM_MAPPING_NOTE_BY_DESCRIPTION,
    *REFERENCE_KEYS_BY_MAPPING_DESCRIPTION,
}
MAPPING_RELATIONSHIP = "intersects-with"
MAPPING_ENDPOINT_TYPE = "control"
ISM_CATALOG_HREF_PATTERN = re.compile(
    r"^https://www\.cyber\.gov\.au/ism/oscal/(v\d{4}\.\d{2}\.\d+)/artifacts/ISM_catalog\.xml(?![\s\S])"
)


def _prose(value, where: str) -> str:
    if not isinstance(value, str) or not value:
        raise UnsupportedUpstreamData(f"{where}: needs non-empty prose")
    if "\r" in value:
        raise UnsupportedUpstreamData(f"{where}: prose contains a carriage return")
    return value


def _single_part(parts: list, predicate, description: str, where: str) -> dict:
    matching = [part for part in parts if isinstance(part, dict) and predicate(part)]
    if len(matching) != 1:
        raise UnsupportedUpstreamData(f"{where}: needs exactly one {description}")
    return matching[0]


def _property_values(properties: list, name: str) -> list[str]:
    values = [
        prop.get("value")
        for prop in properties
        if isinstance(prop, dict) and prop.get("name") == name
    ]
    return values if all(isinstance(value, str) for value in values) else []


def _property_value(properties: list, name: str) -> str | None:
    values = [
        prop.get("value")
        for prop in properties
        if isinstance(prop, dict) and prop.get("name") == name
    ]
    return values[0] if len(values) == 1 and isinstance(values[0], str) else None


def _principle_overview_text(principle_group: dict, resource_hrefs_by_uuid: dict, where: str) -> str:
    overview = _single_part(
        principle_group.get("parts", []),
        lambda part: part.get("name") == OVERVIEW_PART_NAME,
        "overview part",
        where,
    )
    heading = _property_value(overview.get("props", []), OVERVIEW_HEADING_LABEL_PROPERTY)
    if heading is None:
        raise UnsupportedUpstreamData(f"{where}: overview part needs one label property")
    prose = _prose(overview.get("prose"), f"{where} overview")
    return heading, rewrite_resource_links(prose, resource_hrefs_by_uuid, where)


def _walk_groups(groups: list, titles_so_far: list[str]):
    """Yield (control entry, group titles outermost first, innermost group) for every control."""
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("title"), str):
            raise UnsupportedUpstreamData(f"group under {titles_so_far} has no title")
        titles = [*titles_so_far, group["title"]]
        if len(titles) > EXPECTED_GROUP_DEPTH:
            raise UnsupportedUpstreamData(
                f"{titles}: groups must be exactly two levels above a control"
            )
        if len(titles) == EXPECTED_GROUP_DEPTH and group.get("class") != PRINCIPLE_CLASS:
            raise UnsupportedUpstreamData(
                f"{group['title']!r}: principle group class must be {PRINCIPLE_CLASS!r}, "
                f"found {group.get('class')!r}"
            )
        for entry in group.get("controls", []):
            yield entry, titles, group
        yield from _walk_groups(group.get("groups", []), titles)


def _entry_id(entry) -> str:
    entry_id = entry.get("id") if isinstance(entry, dict) else None
    if not isinstance(entry_id, str):
        raise UnsupportedUpstreamData("catalog entry without a string id")
    return entry_id


def _read_domains(control: dict, control_id: str) -> list[str]:
    domains: list[str] = []
    for prop in control.get("props", []):
        name = prop.get("name") if isinstance(prop, dict) else None
        if name not in KNOWN_CONTROL_PROPERTIES:
            raise UnsupportedUpstreamData(f"{control_id}: unsupported property {name!r}")
        if name != DOMAIN_PROPERTY:
            continue
        if prop.get("ns") != ESSENTIALS_NAMESPACE:
            raise UnsupportedUpstreamData(
                f"{control_id}: domain property is in namespace {prop.get('ns')!r}, "
                f"expected {ESSENTIALS_NAMESPACE!r}"
            )
        domain = prop.get("value")
        if domain not in BENCHMARK_BY_DOMAIN:
            raise UnsupportedUpstreamData(f"{control_id}: unknown domain {domain!r}")
        if domain in domains:
            raise UnsupportedUpstreamData(f"{control_id}: domain {domain!r} appears more than once")
        domains.append(domain)
    if not domains:
        raise UnsupportedUpstreamData(f"{control_id}: has no domain property")
    return domains


def _read_action_and_indicators(
    control: dict, control_id: str, resource_hrefs_by_uuid: dict
) -> tuple[str, list[tuple[str, list[str]]]]:
    parts = control.get("parts", [])
    if not isinstance(parts, list) or len(parts) != 2:
        raise UnsupportedUpstreamData(f"{control_id}: needs exactly two parts (action and indicators)")
    for part in parts:
        if not isinstance(part, dict) or part.get("name") != STATEMENT_PART_NAME:
            raise UnsupportedUpstreamData(f"{control_id}: unsupported part {part!r}")
    action_part = _single_part(
        parts, lambda part: part.get("class") == ACTION_PART_CLASS, "action part", control_id
    )
    indicators_part = _single_part(
        parts, lambda part: part.get("class") == INDICATORS_PART_CLASS, "indicators part", control_id
    )

    action = _prose(action_part.get("prose"), f"{control_id} action")
    if PARAGRAPH_SEPARATOR in action:
        raise UnsupportedUpstreamData(f"{control_id}: the action must be a single paragraph")
    action = rewrite_resource_links(action, resource_hrefs_by_uuid, control_id)

    groups = indicators_part.get("parts", [])
    group_titles = [group.get("title") for group in groups if isinstance(group, dict)]
    if (
        len(groups) != len(INDICATOR_GROUP_TITLES)
        or sorted(group_titles, key=str) != sorted(INDICATOR_GROUP_TITLES)
        or any(group.get("class") != INDICATOR_GROUP_CLASS for group in groups)
    ):
        raise UnsupportedUpstreamData(
            f"{control_id}: needs exactly the indicator groups {list(INDICATOR_GROUP_TITLES)}, "
            f"found {group_titles}"
        )
    indicator_groups = []
    for group in groups:
        indicators = group.get("parts", [])
        if not isinstance(indicators, list) or not indicators:
            raise UnsupportedUpstreamData(
                f"{control_id}: indicator group {group['title']!r} needs at least one indicator"
            )
        indicator_texts = []
        for indicator in indicators:
            text = _prose(
                indicator.get("prose") if isinstance(indicator, dict) else None,
                f"{control_id} indicator in {group['title']!r}",
            )
            if "\n" in text:
                raise UnsupportedUpstreamData(
                    f"{control_id}: indicator in {group['title']!r} contains a line break"
                )
            indicator_texts.append(rewrite_resource_links(text, resource_hrefs_by_uuid, control_id))
        indicator_groups.append((group["title"], indicator_texts))
    return action, indicator_groups


def _technique_references(control: dict, control_id: str, resource_hrefs_by_uuid: dict) -> dict:
    techniques_by_version_key: dict[str, set[str]] = {}
    for link in control.get("links", []):
        relation = link.get("rel") if isinstance(link, dict) else None
        if relation != MITIGATED_TECHNIQUE_RELATION:
            raise UnsupportedUpstreamData(f"{control_id}: unsupported link rel {relation!r}")
        href = link.get("href")
        if not isinstance(href, str) or not href.startswith("#"):
            raise UnsupportedUpstreamData(f"{control_id}: technique link must point at a back-matter resource")
        resource_href = resource_hrefs_by_uuid.get(href[1:])
        if resource_href is None:
            raise UnsupportedUpstreamData(
                f"{control_id}: link to unknown back-matter resource {href[1:]!r}"
            )
        match = TECHNIQUE_HREF_PATTERN.match(resource_href)
        if match is None:
            raise UnsupportedUpstreamData(
                f"{control_id}: {resource_href!r} is not a MITRE ATT&CK technique page"
            )
        version, technique_id = match.groups()
        techniques_by_version_key.setdefault(f"attack_v{version}", set()).add(technique_id)
    return {key: sorted(ids) for key, ids in techniques_by_version_key.items()}


def _discussion(heading: str, overview: str, indicator_heading: str, indicator_groups: list) -> str:
    blocks = [f"# {heading}", overview, f"# {indicator_heading}"]
    for group_title, indicators in indicator_groups:
        bullet_lines = "\n".join(f"- {indicator}" for indicator in indicators)
        blocks.append(f"{group_title}:\n{bullet_lines}")
    return PARAGRAPH_SEPARATOR.join(blocks)


def _profile_metadata_properties(profile_document: dict) -> list:
    profile = profile_document.get("profile") if isinstance(profile_document, dict) else None
    metadata = profile.get("metadata") if isinstance(profile, dict) else None
    properties = metadata.get("props") if isinstance(metadata, dict) else None
    if not isinstance(properties, list):
        raise UnsupportedUpstreamData("profile has no metadata props list")
    return properties


def _profile_domain(profile_document: dict) -> str:
    properties = _profile_metadata_properties(profile_document)
    domain = _property_value(properties, PROFILE_DOMAIN_PROPERTY)
    if domain is None:
        raise UnsupportedUpstreamData("profile needs exactly one domain property")
    if domain not in BENCHMARK_BY_DOMAIN:
        raise UnsupportedUpstreamData(f"profile for unknown domain {domain!r}")
    return domain


def phases_by_domain(profiles: list[dict]) -> dict[str, list[str]]:
    """Each domain's priority phases, sorted. Some upstream domains span several phases."""
    phases_by_domain_name: dict[str, list[str]] = {}
    for profile_document in profiles:
        domain = _profile_domain(profile_document)
        if domain in phases_by_domain_name:
            raise UnsupportedUpstreamData(f"more than one profile for domain {domain!r}")
        phases = _property_values(
            _profile_metadata_properties(profile_document), PROFILE_PHASE_PROPERTY
        )
        if not phases:
            raise UnsupportedUpstreamData(
                f"profile for {domain!r} needs at least one {PROFILE_PHASE_PROPERTY} property"
            )
        for phase in phases:
            if phase not in BENCHMARK_BY_PHASE:
                raise UnsupportedUpstreamData(f"profile for {domain!r} has unknown phase {phase!r}")
        phases_by_domain_name[domain] = sorted(set(phases))
    return phases_by_domain_name


def _profile_control_ids(profile_document: dict, domain: str) -> set[str]:
    imports = profile_document["profile"].get("imports")
    if not isinstance(imports, list) or len(imports) != 1:
        raise UnsupportedUpstreamData(f"profile for {domain!r} needs exactly one imports entry")
    include_controls = imports[0].get("include-controls") if isinstance(imports[0], dict) else None
    if not isinstance(include_controls, list) or len(include_controls) != 1:
        raise UnsupportedUpstreamData(
            f"profile for {domain!r} needs exactly one include-controls entry"
        )
    control_ids = include_controls[0].get("with-ids") if isinstance(include_controls[0], dict) else None
    if not isinstance(control_ids, list) or not all(isinstance(item, str) for item in control_ids):
        raise UnsupportedUpstreamData(f"profile for {domain!r} needs a with-ids list of strings")
    return set(control_ids)


def _check_profiles_agree_with_catalog(
    profiles: list[dict], domains_by_action: dict[str, list[str]]
) -> None:
    actions_by_domain: dict[str, set[str]] = {}
    for action_id, domains in domains_by_action.items():
        for domain in domains:
            actions_by_domain.setdefault(domain, set()).add(action_id)
    profile_by_domain = {_profile_domain(profile): profile for profile in profiles}
    for domain in sorted(set(actions_by_domain) - set(profile_by_domain)):
        raise UnsupportedUpstreamData(f"no profile for catalog domain {domain!r}")
    for domain, profile_document in sorted(profile_by_domain.items()):
        profile_ids = _profile_control_ids(profile_document, domain)
        catalog_ids = actions_by_domain.get(domain, set())
        if profile_ids != catalog_ids:
            differences = sorted(profile_ids ^ catalog_ids)
            raise UnsupportedUpstreamData(
                f"profile for {domain!r} and the catalog disagree on controls {differences}"
            )


def _mapping_collection_body(mapping_collection: dict) -> dict:
    body = mapping_collection.get("mapping-collection") if isinstance(mapping_collection, dict) else None
    if not isinstance(body, dict) or not isinstance(body.get("mappings"), list):
        raise UnsupportedUpstreamData("document has no mapping-collection.mappings list")
    return body


def _read_mapping_endpoint(endpoint_list, side: str, where: str) -> str:
    if not isinstance(endpoint_list, list) or len(endpoint_list) != 1:
        raise UnsupportedUpstreamData(f"{where}: a map needs exactly one source and one target")
    endpoint = endpoint_list[0]
    if not isinstance(endpoint, dict) or endpoint.get("type") != MAPPING_ENDPOINT_TYPE:
        raise UnsupportedUpstreamData(
            f"{where}: {side} endpoint type must be {MAPPING_ENDPOINT_TYPE!r}, "
            f"found {endpoint.get('type') if isinstance(endpoint, dict) else endpoint!r}"
        )
    identifier = endpoint.get("id-ref")
    if not isinstance(identifier, str) or not identifier:
        raise UnsupportedUpstreamData(f"{where}: {side} endpoint without an id-ref")
    return identifier


def _read_mapping_targets(
    mapping_collection: dict, action_ids: set[str]
) -> dict[str, dict[str, list[str]]]:
    """Return {mapping description: {action id: sorted target ids}}, validating every map."""
    targets_by_description: dict[str, dict[str, set[str]]] = {}
    for mapping in _mapping_collection_body(mapping_collection)["mappings"]:
        description = mapping.get("mapping-description") if isinstance(mapping, dict) else None
        if description not in KNOWN_MAPPING_DESCRIPTIONS:
            raise UnsupportedUpstreamData(f"unknown mapping-description {description!r}")
        targets_by_action = targets_by_description.setdefault(description, {})
        for mapped in mapping.get("maps", []):
            where = f"mapping {description!r}"
            relationship = mapped.get("relationship") if isinstance(mapped, dict) else None
            if relationship != MAPPING_RELATIONSHIP:
                raise UnsupportedUpstreamData(
                    f"{where}: relationship must be {MAPPING_RELATIONSHIP!r}, found {relationship!r}"
                )
            source_id = _read_mapping_endpoint(mapped.get("sources"), "source", where)
            target_id = _read_mapping_endpoint(mapped.get("targets"), "target", where)
            if source_id not in action_ids:
                raise UnsupportedUpstreamData(f"{where}: source {source_id!r} is not an action")
            targets = targets_by_action.setdefault(source_id, set())
            if target_id in targets:
                raise UnsupportedUpstreamData(
                    f"{where}: duplicate pair {source_id!r} to {target_id!r}"
                )
            targets.add(target_id)
    return {
        description: {action_id: sorted(targets) for action_id, targets in by_action.items()}
        for description, by_action in targets_by_description.items()
    }


def _ism_release_tag(mapping_collection: dict) -> str:
    body = _mapping_collection_body(mapping_collection)
    hrefs_by_uuid = resource_hrefs(body)
    release_tags = set()
    for mapping in body["mappings"]:
        if mapping["mapping-description"] not in ISM_MAPPING_NOTE_BY_DESCRIPTION:
            continue
        target_href = mapping.get("target-resource", {}).get("href", "")
        resource_href = hrefs_by_uuid.get(target_href.removeprefix("#"))
        match = ISM_CATALOG_HREF_PATTERN.match(resource_href) if resource_href else None
        if match is None:
            raise UnsupportedUpstreamData(
                f"{mapping['mapping-description']!r}: target resource {resource_href!r} "
                "is not an ISM catalog link of the expected shape"
            )
        release_tags.add(match.group(1))
    if not release_tags:
        raise UnsupportedUpstreamData("mapping collection has no ISM mappings to name a release")
    if len(release_tags) != 1:
        raise UnsupportedUpstreamData(
            f"ISM mappings name different releases: {sorted(release_tags)}"
        )
    return release_tags.pop()


def catalog_action_ids(catalog: dict) -> set[str]:
    """Return the upstream OSCAL id (such as IT.PRO-13.1) of every action in the catalog."""
    catalog_body = catalog.get("catalog") if isinstance(catalog, dict) else None
    if not isinstance(catalog_body, dict) or not isinstance(catalog_body.get("groups"), list):
        raise UnsupportedUpstreamData("document has no catalog.groups list")
    return {_entry_id(entry) for entry, _titles, _group in _walk_groups(catalog_body["groups"], [])}


def ism_mapping(
    mapping_collection: dict, action_ids: set[str], e4eit_tag: str
) -> tuple[dict, str]:
    """Build the rule mapping file content from ASD's ISM and Essential Eight maps.

    action_ids are the upstream OSCAL ids (such as IT.PRO-13.1). Returns the
    file content and the ISM release tag the maps name.
    """
    targets_by_description = _read_mapping_targets(mapping_collection, action_ids)
    ism_tag = _ism_release_tag(mapping_collection)
    entries = []
    for order, (description, note) in enumerate(ISM_MAPPING_NOTE_BY_DESCRIPTION.items()):
        for action_id, target_ids in targets_by_description.get(description, {}).items():
            entries.append(
                (
                    action_id,
                    order,
                    {
                        "relation": "related",
                        "from": [
                            {
                                "kind": "rule",
                                "id": f"{SOURCE_NAME}.{action_id.lower()}",
                                "release": e4eit_tag,
                            }
                        ],
                        "to": [
                            {
                                "kind": "rule",
                                "id": f"{ISM_SOURCE_NAME}.{target_id}",
                                "release": ism_tag,
                            }
                            for target_id in target_ids
                        ],
                        "note": note,
                    },
                )
            )
    entries.sort(key=lambda entry: (entry[0], entry[1]))
    content = {
        "schema_version": MAPPING_SCHEMA_VERSION,
        "id": MAPPING_FILE_ID,
        "description": (
            "Generated by tools/import_asd_e4eit.py from ASD's E4EIT mapping collection "
            f"{e4eit_tag} (Potential Evidence Sources). Do not edit by hand."
        ),
        "links": [entry[2] for entry in entries],
    }
    return content, ism_tag


def _framework_references(
    action_id: str, technique_references: dict, targets_by_description: dict
) -> dict:
    ids_by_key: dict[tuple[str, str], list[str]] = {}
    for description, (organisation, framework) in REFERENCE_KEYS_BY_MAPPING_DESCRIPTION.items():
        target_ids = targets_by_description.get(description, {}).get(action_id)
        if target_ids:
            ids_by_key[(organisation, framework)] = target_ids
    for version_key, technique_ids in technique_references.items():
        ids_by_key[("mitre", version_key)] = technique_ids
    references: dict[str, dict[str, list[str]]] = {}
    for (organisation, framework), ids in sorted(ids_by_key.items()):
        references.setdefault(organisation, {})[framework] = sorted(set(ids))
    return references


def _benchmark_names(domains: list[str], phases_by_domain_name: dict[str, list[str]]) -> list[str]:
    phases = {phase for domain in domains for phase in phases_by_domain_name[domain]}
    return [
        *(name for phase, name in BENCHMARK_BY_PHASE.items() if phase in phases),
        *(name for domain, name in BENCHMARK_BY_DOMAIN.items() if domain in domains),
    ]


def _check_control_shape(control: dict, control_id: str) -> None:
    unknown_keys = sorted(set(control) - KNOWN_CONTROL_KEYS)
    if unknown_keys:
        raise UnsupportedUpstreamData(f"{control_id}: unsupported control key {unknown_keys[0]!r}")


def normalize_release(
    catalog: dict, profiles: list[dict], mapping_collection: dict, lock: SourceLock
) -> list[dict]:
    catalog_body = catalog.get("catalog") if isinstance(catalog, dict) else None
    if not isinstance(catalog_body, dict) or not isinstance(catalog_body.get("groups"), list):
        raise UnsupportedUpstreamData("document has no catalog.groups list")
    resource_hrefs_by_uuid = resource_hrefs(catalog_body)

    parsed_controls: dict[str, dict] = {}
    original_id_by_lowercase_id: dict[str, str] = {}
    overview_by_principle_title: dict[str, tuple[str, str]] = {}
    for entry, titles, principle_group in _walk_groups(catalog_body["groups"], []):
        control_id = _entry_id(entry)
        if len(titles) != EXPECTED_GROUP_DEPTH:
            raise UnsupportedUpstreamData(
                f"{control_id}: must be exactly two groups deep, found {len(titles)} ({titles})"
            )
        if not SAFE_CONTROL_ID_PATTERN.match(control_id):
            raise UnsupportedUpstreamData(f"{control_id!r}: control id is not safe to use in a rule id")
        lowercase_id = control_id.lower()
        if lowercase_id in original_id_by_lowercase_id:
            raise UnsupportedUpstreamData(
                f"{control_id}: id collides with {original_id_by_lowercase_id[lowercase_id]!r} "
                "once lowercased"
            )
        original_id_by_lowercase_id[lowercase_id] = control_id
        _check_control_shape(entry, control_id)
        principle_title = titles[-1]
        if principle_title not in overview_by_principle_title:
            overview_by_principle_title[principle_title] = _principle_overview_text(
                principle_group, resource_hrefs_by_uuid, principle_title
            )
        action, indicator_groups = _read_action_and_indicators(
            entry, control_id, resource_hrefs_by_uuid
        )
        parsed_controls[control_id] = {
            "titles": titles,
            "domains": _read_domains(entry, control_id),
            "action": action,
            "indicator_groups": indicator_groups,
            "indicators_heading": _indicators_heading(entry),
            "techniques": _technique_references(entry, control_id, resource_hrefs_by_uuid),
        }

    _check_profiles_agree_with_catalog(
        profiles, {control_id: parsed["domains"] for control_id, parsed in parsed_controls.items()}
    )
    phases_by_domain_name = phases_by_domain(profiles)
    targets_by_description = _read_mapping_targets(mapping_collection, set(parsed_controls))

    rules = []
    for control_id, parsed in parsed_controls.items():
        principle_heading, principle_overview = overview_by_principle_title[parsed["titles"][-1]]
        benchmark_names = _benchmark_names(parsed["domains"], phases_by_domain_name)
        rules.append(
            {
                "schema_version": SCHEMA_VERSION,
                "id": f"{SOURCE_NAME}.{control_id.lower()}",
                "title": parsed["action"],
                "discussion": _discussion(
                    principle_heading,
                    principle_overview,
                    parsed["indicators_heading"],
                    parsed["indicator_groups"],
                ),
                "discussion_format": "markdown",
                "section_path": parsed["titles"],
                "source": {
                    "name": SOURCE_NAME,
                    "release_tag": lock.tag,
                    "commit_sha": lock.commit_sha,
                    "upstream_rule_id": control_id,
                    "upstream_path": CATALOG_FILE_NAME,
                    "upstream_revision": None,
                    "upstream_updated": None,
                    "upstream_url": (
                        f"{lock.repository_url.rstrip('/')}/blob/{lock.commit_sha}/{CATALOG_FILE_NAME}"
                    ),
                    "license": dict(LICENSE),
                },
                "assessment": {"status": "manual", "manual_reason": "no_check"},
                "architecture": None,
                "applicability": [
                    {
                        "target": None,
                        "version": None,
                        "benchmarks": [{"name": name, "severity": None} for name in benchmark_names],
                    }
                ],
                "tags": [],
                "references": _framework_references(
                    control_id, parsed["techniques"], targets_by_description
                ),
                "check": None,
                "odv": None,
                "remediation": None,
            }
        )
    return sorted(rules, key=lambda rule: rule["id"])


def _indicators_heading(control: dict) -> str:
    indicators_part = next(
        part for part in control["parts"] if part.get("class") == INDICATORS_PART_CLASS
    )
    return _prose(indicators_part.get("title"), f"{control['id']} indicators title")
