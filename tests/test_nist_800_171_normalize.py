import copy
import json
from pathlib import Path

import pytest

from tools.library_output import UnsupportedUpstreamData
from tools.nist_800_171_normalize import (
    CATALOG_PATH,
    LICENSE,
    REPOSITORY_URL,
    SOURCE_NAME,
    framework_version,
    normalize_catalog,
)
from tools.source_lock import SourceLock
from tools.validate_library import schema_errors

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "nist_800_171"
COMMIT_SHA = "f" * 40
LOCK = SourceLock(
    tag="v1.6.0",
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-11-27",
    repository_url=REPOSITORY_URL,
    published_date="2026-10-22",
    importer_format="nist-800-171-rev3-oscal-1",
)
FIXTURE_RULE_IDS = [
    "nist_800_171.03.01.01",
    "nist_800_171.03.01.02",
    "nist_800_171.03.01.08",
    "nist_800_171.03.01.10",
    "nist_800_171.03.15.01",
]
CPRT_ANCHOR = "[](#/cprt/framework/version/SP_800_171_3_0_0/home?element={number})"


def load_catalog() -> dict:
    return json.loads((FIXTURE_DIRECTORY / CATALOG_PATH).read_text(encoding="utf-8"))


def rules_by_id(catalog: dict | None = None) -> dict[str, dict]:
    return {rule["id"]: rule for rule in normalize_catalog(load_catalog() if catalog is None else catalog, LOCK)}


def find_requirement(catalog: dict, number: str) -> dict:
    for group in catalog["catalog"]["groups"]:
        for requirement in group["controls"]:
            if requirement["id"] == f"SP_800_171_{number}":
                return requirement
    raise KeyError(number)


def part_named(requirement: dict, name: str) -> dict:
    return next(part for part in requirement["parts"] if part["name"] == name)


def test_current_requirements_become_valid_rules_in_sort_order():
    rules = normalize_catalog(load_catalog(), LOCK)
    assert [rule["id"] for rule in rules] == FIXTURE_RULE_IDS
    for rule in rules:
        assert schema_errors(rule, "rule") == []


def test_withdrawn_requirement_is_not_a_rule():
    assert "nist_800_171.03.01.13" not in rules_by_id()


def test_requirement_fields():
    rule = rules_by_id()["nist_800_171.03.01.08"]
    assert rule["title"] == "Unsuccessful Logon Attempts"
    assert rule["section_path"] == ["03.01 Access Control"]
    assert rule["discussion_format"] == "markdown"
    assert rule["assessment"] == {"status": "manual", "manual_reason": "no_check"}
    assert rule["applicability"] == [{"target": None, "version": None, "benchmarks": []}]
    assert rule["source"] == {
        "name": SOURCE_NAME,
        "release_tag": "v1.6.0",
        "commit_sha": COMMIT_SHA,
        "upstream_rule_id": "SP_800_171_03.01.08",
        "upstream_path": CATALOG_PATH,
        "upstream_revision": None,
        "upstream_updated": None,
        "upstream_url": f"{REPOSITORY_URL}/blob/{COMMIT_SHA}/{CATALOG_PATH}",
        "license": LICENSE,
    }


def test_items_are_labelled_as_the_publication_prints_them():
    discussion = rules_by_id()["nist_800_171.03.01.01"]["discussion"]
    assert discussion.startswith("## Requirement\n\n- a. Define the types of system accounts allowed and prohibited.\n")
    assert "\n- c. Specify:\n  - 1. Authorized users of the system,\n  - 2. Group and role membership, and\n" in discussion
    assert "SR-03.01.01" not in discussion


def test_prose_only_statement():
    discussion = rules_by_id()["nist_800_171.03.01.02"]["discussion"]
    assert discussion.startswith(
        "## Requirement\n\nEnforce approved authorizations for logical access to CUI and system resources"
    )


def test_parameters_render_as_assignments_and_selections():
    discussion = rules_by_id()["nist_800_171.03.01.08"]["discussion"]
    assert "- a. Enforce a limit of [Assignment: organization-defined number] consecutive invalid logon attempts" in discussion
    assert (
        "- b. Automatically [Selection (one or more): lock the account or node for an "
        "[Assignment: organization-defined time period]; lock the account or node until released by an administrator;"
    ) in discussion
    assert "SELECTED PARAMETER VALUES" not in discussion


def test_guidance_follows_the_discussion_heading():
    discussion = rules_by_id()["nist_800_171.03.01.08"]["discussion"]
    assert "\n\n## Discussion\n\nDue to the potential for denial of service" in discussion


def test_empty_cross_reference_anchors_are_dropped_with_or_without_a_following_space():
    discussions = {rule_id: rule["discussion"] for rule_id, rule in rules_by_id().items()}
    assert "account type (e.g., privileged access, non-privileged access) are addressed in 03.01.02." in discussions[
        "nist_800_171.03.01.01"
    ]
    assert "addressed by 03.01.10." in discussions["nist_800_171.03.01.01"]
    assert not any("cprt" in discussion or "[]" in discussion for discussion in discussions.values())


def test_cross_reference_to_an_unknown_requirement_fails():
    catalog = load_catalog()
    guidance = part_named(find_requirement(catalog, "03.01.08"), "guidance")
    guidance["prose"] += f" See {CPRT_ANCHOR.format(number='03.99.99')}03.99.99."
    with pytest.raises(UnsupportedUpstreamData, match="unknown requirement '03.99.99'"):
        rules_by_id(catalog)


def test_cross_reference_not_followed_by_its_number_fails():
    catalog = load_catalog()
    guidance = part_named(find_requirement(catalog, "03.01.08"), "guidance")
    guidance["prose"] += f" See {CPRT_ANCHOR.format(number='03.01.02')}03.01.10."
    with pytest.raises(UnsupportedUpstreamData, match="link to unknown target"):
        rules_by_id(catalog)


def test_references_split_source_controls_from_publications():
    references = rules_by_id()["nist_800_171.03.01.01"]["references"]
    assert references["source_controls"] == ["AC-02", "AC-02(03)", "AC-02(05)", "AC-02(13)"]
    assert "SP 800-46" in references["publications"]
    assert not set(references["source_controls"]) & set(references["publications"])


def test_source_control_title_not_linking_to_sp_800_53_fails():
    catalog = load_catalog()
    resource = next(
        resource for resource in catalog["catalog"]["back-matter"]["resources"] if resource["title"] == "AC-07"
    )
    resource["rlinks"][0]["href"] = "https://example.com/AC-07"
    with pytest.raises(UnsupportedUpstreamData, match="looks like an SP 800-53 control"):
        rules_by_id(catalog)


def test_framework_version_comes_from_the_cprt_property():
    assert framework_version(load_catalog()) == "3.0.0"


@pytest.mark.parametrize("value", ["SP_800_171_3_0", "SP_800_172_3_0_0", "3.0.0"])
def test_framework_version_of_another_shape_fails(value):
    catalog = load_catalog()
    for prop in catalog["catalog"]["metadata"]["props"]:
        if prop["name"] == "framework-version-identifier":
            prop["value"] = value
    with pytest.raises(UnsupportedUpstreamData, match="unsupported framework-version-identifier"):
        framework_version(catalog)


def test_missing_framework_version_fails():
    catalog = load_catalog()
    catalog["catalog"]["metadata"]["props"] = [
        prop for prop in catalog["catalog"]["metadata"]["props"] if prop["name"] != "framework-version-identifier"
    ]
    with pytest.raises(UnsupportedUpstreamData, match="exactly one 'framework-version-identifier'"):
        framework_version(catalog)


@pytest.mark.parametrize("label", ["SR-03.01.08.a.01", "SR-03.01.09.a", "03.01.08.a", "SR-03.01.08.A"])
def test_unexpected_item_label_fails(label):
    catalog = load_catalog()
    statement = part_named(find_requirement(catalog, "03.01.08"), "statement")
    statement["parts"][0]["props"][0]["value"] = label
    with pytest.raises(UnsupportedUpstreamData, match="unsupported item label"):
        rules_by_id(catalog)


def test_selection_with_another_label_fails():
    catalog = load_catalog()
    select_param = next(param for param in find_requirement(catalog, "03.01.08")["params"] if "select" in param)
    select_param["label"] = "something else"
    with pytest.raises(UnsupportedUpstreamData, match="exactly one of label and select"):
        rules_by_id(catalog)


def test_requirement_label_differing_from_title_and_number_fails():
    catalog = load_catalog()
    requirement = find_requirement(catalog, "03.01.08")
    requirement["props"] = [
        {**prop, "value": "Unsuccessful Logon Attempts (03.01.09)"} if prop["name"] == "label" else prop
        for prop in requirement["props"]
    ]
    with pytest.raises(UnsupportedUpstreamData, match="label differs"):
        rules_by_id(catalog)


def test_sort_id_differing_from_the_number_fails():
    catalog = load_catalog()
    requirement = find_requirement(catalog, "03.01.08")
    requirement["props"] = [
        {**prop, "value": "03.01.09"} if prop["name"] == "sort-id" else prop for prop in requirement["props"]
    ]
    with pytest.raises(UnsupportedUpstreamData, match="sort-id differs"):
        rules_by_id(catalog)


@pytest.mark.parametrize("requirement_id", ["SP_800_171_3.01.08", "SP_800_53_03.01.08", "SP_800_171_03.01.08a"])
def test_requirement_id_of_another_shape_fails(requirement_id):
    catalog = load_catalog()
    find_requirement(catalog, "03.01.08")["id"] = requirement_id
    with pytest.raises(UnsupportedUpstreamData, match="not a requirement id"):
        rules_by_id(catalog)


def test_nested_requirement_fails():
    catalog = load_catalog()
    find_requirement(catalog, "03.01.08")["controls"] = []
    with pytest.raises(UnsupportedUpstreamData, match="requirements cannot nest"):
        rules_by_id(catalog)


def test_unknown_link_rel_fails():
    catalog = load_catalog()
    find_requirement(catalog, "03.01.08")["links"].append({"href": "#x", "rel": "related"})
    with pytest.raises(UnsupportedUpstreamData, match="unsupported link rel 'related'"):
        rules_by_id(catalog)


def test_unknown_statement_class_fails():
    catalog = load_catalog()
    part_named(find_requirement(catalog, "03.01.08"), "statement")["class"] = "other"
    with pytest.raises(UnsupportedUpstreamData, match="unsupported statement class"):
        rules_by_id(catalog)


def test_unknown_status_fails():
    catalog = load_catalog()
    find_requirement(catalog, "03.01.08")["props"].append({"name": "status", "value": "draft"})
    with pytest.raises(UnsupportedUpstreamData, match="unsupported status"):
        rules_by_id(catalog)


def test_group_label_differing_from_title_and_number_fails():
    catalog = load_catalog()
    group = catalog["catalog"]["groups"][0]
    group["props"] = [{**prop, "value": "Access (03.01)"} if prop["name"] == "label" else prop for prop in group["props"]]
    with pytest.raises(UnsupportedUpstreamData, match="label differs"):
        rules_by_id(catalog)


def test_document_without_groups_fails():
    catalog = copy.deepcopy(load_catalog())
    del catalog["catalog"]["groups"]
    with pytest.raises(UnsupportedUpstreamData, match="no catalog.groups list"):
        rules_by_id(catalog)
