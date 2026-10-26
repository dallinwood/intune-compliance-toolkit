"""Convert ASD's ISM OSCAL catalog into the project's v5 rule JSON shape."""

import re

from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData
from tools.source_lock import SourceLock

SOURCE_NAME = "asd_ism"
REPOSITORY_URL = "https://github.com/AustralianCyberSecurityCentre/ism-oscal"
CATALOG_FILE_NAME = "ISM_catalog.json"

LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "rights_holder": "Commonwealth of Australia (Australian Signals Directorate)",
    "modified": True,
}

CONTROL_CLASS = "ISM-control"
PRINCIPLE_CLASS = "ISM-principle"
EXPECTED_GROUP_DEPTH = 3
SAFE_CONTROL_ID_PATTERN = re.compile(r"^[a-z0-9_-]+(?![\s\S])")
RESOURCE_LINK_PATTERN = re.compile(r"\]\(#([^)\s]+)\)")
PARAGRAPH_SEPARATOR = "\n\n"

KNOWN_CONTROL_KEYS = {"id", "class", "title", "props", "parts"}
STATEMENT_PART_NAME = "statement"
KNOWN_STATEMENT_PART_KEYS = {"id", "name", "prose"}

CLASSIFICATION_PROPERTY = "applicability"
ESSENTIAL_EIGHT_PROPERTY = "essential-eight-applicability"
SINGLE_VALUE_PROPERTIES = ("revision", "updated")
IGNORED_PROPERTIES = ("sort-id",)
KNOWN_PROPERTIES = {
    CLASSIFICATION_PROPERTY,
    ESSENTIAL_EIGHT_PROPERTY,
    *SINGLE_VALUE_PROPERTIES,
    *IGNORED_PROPERTIES,
}

BENCHMARK_BY_CLASSIFICATION = {
    "NC": "ism_non_classified",
    "OS": "ism_official_sensitive",
    "P": "ism_protected",
    "S": "ism_secret",
    "TS": "ism_top_secret",
}
BENCHMARK_BY_ESSENTIAL_EIGHT_LEVEL = {
    "ML1": "e8_ml1",
    "ML2": "e8_ml2",
    "ML3": "e8_ml3",
}
BENCHMARK_ORDER = (
    *BENCHMARK_BY_CLASSIFICATION.values(),
    *BENCHMARK_BY_ESSENTIAL_EIGHT_LEVEL.values(),
)


def split_statement(statement: str) -> tuple[str, bool]:
    first_paragraph, separator, _ = statement.partition(PARAGRAPH_SEPARATOR)
    return first_paragraph, bool(separator)


def rewrite_resource_links(prose: str, resource_hrefs: dict[str, str], where: str) -> str:
    def resolve(match: re.Match) -> str:
        uuid = match.group(1)
        if uuid not in resource_hrefs:
            raise UnsupportedUpstreamData(f"{where}: link to unknown back-matter resource {uuid!r}")
        return f"]({resource_hrefs[uuid]})"

    return RESOURCE_LINK_PATTERN.sub(resolve, prose)


def _resource_hrefs(catalog: dict) -> dict[str, str]:
    back_matter = catalog.get("back-matter")
    if not isinstance(back_matter, dict) or not isinstance(back_matter.get("resources"), list):
        raise UnsupportedUpstreamData("catalog has no back-matter resources list")
    hrefs = {}
    for resource in back_matter["resources"]:
        uuid = resource.get("uuid") if isinstance(resource, dict) else None
        if not isinstance(uuid, str):
            raise UnsupportedUpstreamData("back-matter resource without a uuid")
        rlinks = resource.get("rlinks")
        first_link = rlinks[0] if isinstance(rlinks, list) and rlinks else None
        first_href = first_link.get("href") if isinstance(first_link, dict) else None
        if not isinstance(first_href, str) or not first_href:
            raise UnsupportedUpstreamData(f"back-matter resource {uuid!r} has no rlinks href")
        hrefs[uuid] = first_href
    return hrefs


def _topic_overview(topic: dict, control_id: str) -> str:
    overviews = [
        part
        for part in topic.get("parts", [])
        if isinstance(part, dict) and part.get("name") == "overview"
    ]
    if len(overviews) != 1 or not isinstance(overviews[0].get("prose"), str):
        raise UnsupportedUpstreamData(
            f"{control_id}: topic group {topic.get('title')!r} needs exactly one overview part with prose"
        )
    return overviews[0]["prose"]


def _check_control_shape(control: dict, control_id: str) -> None:
    unknown_keys = sorted(set(control) - KNOWN_CONTROL_KEYS)
    if unknown_keys:
        raise UnsupportedUpstreamData(f"{control_id}: unsupported control key {unknown_keys[0]!r}")
    parts = control.get("parts", [])
    if not isinstance(parts, list):
        raise UnsupportedUpstreamData(f"{control_id}: parts must be a list")
    for part in parts:
        if not isinstance(part, dict) or part.get("name") != STATEMENT_PART_NAME:
            part_name = part.get("name") if isinstance(part, dict) else part
            raise UnsupportedUpstreamData(f"{control_id}: unsupported part {part_name!r}")
        unknown_part_keys = sorted(set(part) - KNOWN_STATEMENT_PART_KEYS)
        if unknown_part_keys:
            raise UnsupportedUpstreamData(
                f"{control_id}: unsupported statement part key {unknown_part_keys[0]!r}"
            )


def _statement(control: dict, control_id: str) -> str:
    statements = control.get("parts", [])
    if len(statements) != 1 or not isinstance(statements[0].get("prose"), str) or not statements[0]["prose"]:
        raise UnsupportedUpstreamData(f"{control_id}: needs exactly one statement part with prose")
    return statements[0]["prose"]


def _read_properties(control: dict, control_id: str) -> tuple[dict, list[str], list[str]]:
    single_values: dict[str, str] = {}
    classifications: list[str] = []
    essential_eight_levels: list[str] = []
    for prop in control.get("props", []):
        if not isinstance(prop, dict) or not isinstance(prop.get("name"), str):
            raise UnsupportedUpstreamData(f"{control_id}: property without a name")
        name = prop["name"]
        if name not in KNOWN_PROPERTIES:
            raise UnsupportedUpstreamData(f"{control_id}: unsupported property {name!r}")
        value = prop.get("value")
        if not isinstance(value, str):
            raise UnsupportedUpstreamData(f"{control_id}: property {name!r} needs a string value")
        if name in SINGLE_VALUE_PROPERTIES:
            if name in single_values:
                raise UnsupportedUpstreamData(f"{control_id}: property {name!r} appears more than once")
            single_values[name] = value
        elif name == CLASSIFICATION_PROPERTY:
            classifications.append(value)
        elif name == ESSENTIAL_EIGHT_PROPERTY:
            essential_eight_levels.append(value)
    for name in SINGLE_VALUE_PROPERTIES:
        if name not in single_values:
            raise UnsupportedUpstreamData(f"{control_id}: missing {name!r} property")
    return single_values, classifications, essential_eight_levels


def _benchmark_names(
    classifications: list[str], essential_eight_levels: list[str], control_id: str
) -> list[str]:
    present = set()
    for value in classifications:
        if value not in BENCHMARK_BY_CLASSIFICATION:
            raise UnsupportedUpstreamData(
                f"{control_id}: unsupported {CLASSIFICATION_PROPERTY} value {value!r}"
            )
        present.add(BENCHMARK_BY_CLASSIFICATION[value])
    for value in essential_eight_levels:
        if value not in BENCHMARK_BY_ESSENTIAL_EIGHT_LEVEL:
            raise UnsupportedUpstreamData(
                f"{control_id}: unsupported {ESSENTIAL_EIGHT_PROPERTY} value {value!r}"
            )
        present.add(BENCHMARK_BY_ESSENTIAL_EIGHT_LEVEL[value])
    return [name for name in BENCHMARK_ORDER if name in present]


def _normalize_control(
    control: dict,
    control_id: str,
    section_path: list[str],
    overview: str,
    resource_hrefs: dict[str, str],
    lock: SourceLock,
) -> dict:
    _check_control_shape(control, control_id)
    single_values, classifications, essential_eight_levels = _read_properties(control, control_id)
    benchmark_names = _benchmark_names(classifications, essential_eight_levels, control_id)
    statement = rewrite_resource_links(_statement(control, control_id), resource_hrefs, control_id)
    title, has_more_paragraphs = split_statement(statement)
    overview = rewrite_resource_links(overview, resource_hrefs, control_id)
    discussion = f"{statement}{PARAGRAPH_SEPARATOR}{overview}" if has_more_paragraphs else overview
    return {
        "schema_version": SCHEMA_VERSION,
        "id": f"{SOURCE_NAME}.{control_id}",
        "title": title,
        "discussion": discussion,
        "discussion_format": "markdown",
        "section_path": section_path,
        "source": {
            "name": SOURCE_NAME,
            "release_tag": lock.tag,
            "commit_sha": lock.commit_sha,
            "upstream_rule_id": control_id,
            "upstream_path": CATALOG_FILE_NAME,
            "upstream_revision": single_values["revision"],
            "upstream_updated": single_values["updated"],
            "upstream_url": f"{lock.repository_url.rstrip('/')}/blob/{lock.commit_sha}/{CATALOG_FILE_NAME}",
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
        "references": {},
        "check": None,
        "odv": None,
        "remediation": None,
    }


def _entry_id(entry) -> str:
    entry_id = entry.get("id") if isinstance(entry, dict) else None
    if not isinstance(entry_id, str):
        raise UnsupportedUpstreamData("catalog entry without a string id")
    return entry_id


def _walk_groups(groups: list, titles_so_far: list[str]):
    """Yield (control entry, group titles outermost first, topic group) for every control-bearing group."""
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("title"), str):
            raise UnsupportedUpstreamData(f"group under {titles_so_far} has no title")
        titles = [*titles_so_far, group["title"]]
        for entry in group.get("controls", []):
            yield entry, titles, group
        yield from _walk_groups(group.get("groups", []), titles)


def normalize_catalog(document: dict, lock: SourceLock) -> list[dict]:
    catalog = document.get("catalog") if isinstance(document, dict) else None
    if not isinstance(catalog, dict) or not isinstance(catalog.get("groups"), list):
        raise UnsupportedUpstreamData("document has no catalog.groups list")
    resource_hrefs = _resource_hrefs(catalog)

    rules_by_id: dict[str, dict] = {}
    for entry, titles, topic in _walk_groups(catalog["groups"], []):
        control_id = _entry_id(entry)
        entry_class = entry.get("class")
        if entry_class == PRINCIPLE_CLASS:
            continue
        if entry_class != CONTROL_CLASS:
            raise UnsupportedUpstreamData(f"{control_id}: unsupported class {entry_class!r}")
        if not SAFE_CONTROL_ID_PATTERN.match(control_id):
            raise UnsupportedUpstreamData(f"{control_id!r}: control id is not safe to use in a rule id")
        if len(titles) != EXPECTED_GROUP_DEPTH:
            raise UnsupportedUpstreamData(
                f"{control_id}: must be exactly three groups deep, found {len(titles)} ({titles})"
            )
        if control_id in rules_by_id:
            raise UnsupportedUpstreamData(f"{control_id}: duplicate control id")
        rule = _normalize_control(
            entry,
            control_id,
            titles,
            _topic_overview(topic, control_id),
            resource_hrefs,
            lock,
        )
        rules_by_id[control_id] = rule
    return sorted(rules_by_id.values(), key=lambda rule: rule["id"])
