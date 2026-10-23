import copy
import json
from pathlib import Path

import pytest

from tools.asd_ism_normalize import (
    CATALOG_FILE_NAME,
    LICENSE,
    REPOSITORY_URL,
    SOURCE_NAME,
    normalize_catalog,
    rewrite_resource_links,
    split_statement,
)
from tools.library_output import UnsupportedUpstreamData
from tools.source_lock import SourceLock
from tools.validate_library import schema_errors

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "asd_ism" / "catalog.json"
COMMIT_SHA = "c" * 40
LOCK = SourceLock(
    tag="v2026.09.4",
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-10-23",
    repository_url=REPOSITORY_URL,
)
EXPECTED_FIXTURE_RULE_IDS = ["asd_ism.ism-0001", "asd_ism.ism-0859", "asd_ism.ism-1667"]
PROCUREMENT_RESOURCE_UUID = "f37a4848-0791-4870-b316-5536c2681c28"


def load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def rules_by_id(document: dict | None = None) -> dict:
    rules = normalize_catalog(document if document is not None else load_fixture(), LOCK)
    return {rule["id"]: rule for rule in rules}


def control_of(document: dict, control_id: str) -> dict:
    return next(iter(controls_of(document, control_id)))


def controls_of(document: dict, control_id: str):
    def walk(groups):
        for group in groups:
            for control in group.get("controls", []):
                if control["id"] == control_id:
                    yield control
            yield from walk(group.get("groups", []))

    yield from walk(document["catalog"]["groups"])


def topic_of(document: dict, control_id: str) -> dict:
    def walk(groups):
        for group in groups:
            if any(control["id"] == control_id for control in group.get("controls", [])):
                yield group
            yield from walk(group.get("groups", []))

    return next(iter(walk(document["catalog"]["groups"])))


def resource_of(document: dict, uuid: str) -> dict:
    return next(
        resource
        for resource in document["catalog"]["back-matter"]["resources"]
        if resource["uuid"] == uuid
    )


def test_constants_name_the_upstream_source():
    assert SOURCE_NAME == "asd_ism"
    assert REPOSITORY_URL == "https://github.com/AustralianCyberSecurityCentre/ism-oscal"
    assert CATALOG_FILE_NAME == "ISM_catalog.json"
    assert LICENSE == {
        "name": "CC BY 4.0",
        "url": "https://creativecommons.org/licenses/by/4.0/",
        "rights_holder": "Commonwealth of Australia (Australian Signals Directorate)",
        "modified": True,
    }


def test_controls_become_v4_rules():
    rules = normalize_catalog(load_fixture(), LOCK)

    assert [rule["id"] for rule in rules] == EXPECTED_FIXTURE_RULE_IDS
    assert not any("principle" in rule["id"] for rule in rules)
    for rule in rules:
        assert schema_errors(rule) == []


def test_rule_fields_follow_the_mapping():
    rule = rules_by_id()["asd_ism.ism-1667"]

    assert rule["schema_version"] == 4
    assert rule["id"] == "asd_ism.ism-1667"
    assert rule["title"] == "Microsoft Office is blocked from creating child processes."
    assert rule["discussion_format"] == "markdown"
    assert rule["section_path"] == [
        "Guidelines for system hardening",
        "Application hardening",
        "Microsoft Office macros and child processes",
    ]
    assert rule["source"] == {
        "name": "asd_ism",
        "release_tag": "v2026.09.4",
        "commit_sha": COMMIT_SHA,
        "upstream_rule_id": "ism-1667",
        "upstream_path": "ISM_catalog.json",
        "upstream_revision": "0",
        "upstream_updated": "Sep-21",
        "upstream_url": (
            "https://github.com/AustralianCyberSecurityCentre/ism-oscal/blob/"
            f"{COMMIT_SHA}/ISM_catalog.json"
        ),
        "license": LICENSE,
    }
    assert rule["applicability"] == [
        {
            "target": None,
            "version": None,
            "benchmarks": [
                {"name": "ism_non_classified", "severity": None},
                {"name": "ism_official_sensitive", "severity": None},
                {"name": "ism_protected", "severity": None},
                {"name": "ism_secret", "severity": None},
                {"name": "ism_top_secret", "severity": None},
                {"name": "e8_ml2", "severity": None},
                {"name": "e8_ml3", "severity": None},
            ],
        }
    ]
    assert rule["assessment"] == {"status": "manual", "manual_reason": "no_check"}
    assert rule["tags"] == []
    assert rule["references"] == {}
    for absent_field in ("check", "odv", "remediation", "architecture"):
        assert rule[absent_field] is None


def test_license_block_is_a_copy_per_rule():
    rules = normalize_catalog(load_fixture(), LOCK)

    rules[0]["source"]["license"]["name"] = "changed"

    assert rules[1]["source"]["license"] == LICENSE


def test_native_classification_only_control_lists_one_benchmark():
    rule = rules_by_id()["asd_ism.ism-0001"]

    assert rule["applicability"][0]["benchmarks"] == [{"name": "ism_non_classified", "severity": None}]


def test_multi_paragraph_statement():
    rule = rules_by_id()["asd_ism.ism-0859"]
    statement = control_of(load_fixture(), "ism-0859")["parts"][0]["prose"]

    assert rule["title"] == "A cyber security incident register contains the following for each cyber security incident:"
    assert "- the date the cyber security incident occurred" in statement
    assert rule["discussion"].startswith(statement + "\n\n")
    assert "- to whom the cyber security incident was reported.\n\nRegisters help with incident handling" in (
        rule["discussion"]
    )


def test_single_paragraph_statement_discussion_is_the_overview():
    rule = rules_by_id()["asd_ism.ism-0001"]

    assert rule["title"] == "Cloud service providers are assessed before use."
    assert rule["discussion"] == "Cloud services need governance."


def test_resource_links_are_rewritten():
    rules = rules_by_id()

    assert (
        "[Guidelines for procurement and outsourcing](https://www.cyber.gov.au/ism/procurement)"
        in rules["asd_ism.ism-1667"]["discussion"]
    )
    incident_register_discussion = rules["asd_ism.ism-0859"]["discussion"]
    assert "(https://www.cisa.gov/ict-supply-chain-resource-library)" in incident_register_discussion
    assert "example.invalid" not in incident_register_discussion
    for rule in rules.values():
        assert "(#" not in rule["discussion"]


def test_rules_are_sorted_by_id_regardless_of_catalog_order():
    document = load_fixture()
    for guideline in document["catalog"]["groups"]:
        guideline["groups"].reverse()
    document["catalog"]["groups"].reverse()

    ids = [rule["id"] for rule in normalize_catalog(document, LOCK)]

    assert ids == EXPECTED_FIXTURE_RULE_IDS


def test_rewrite_resource_links_replaces_every_link():
    prose = "[one](#aaa) and [two](#bbb) and [again](#aaa)"

    rewritten = rewrite_resource_links(prose, {"aaa": "https://a.example", "bbb": "https://b.example"}, "ism-1")

    assert rewritten == "[one](https://a.example) and [two](https://b.example) and [again](https://a.example)"


def test_rewrite_resource_links_leaves_other_links_alone():
    prose = "[site](https://example.com/x#frag) and (#not-a-link-target without close"

    assert rewrite_resource_links(prose, {}, "ism-1") == prose


def test_rewrite_resource_links_names_the_location_when_the_uuid_is_unknown():
    with pytest.raises(UnsupportedUpstreamData, match=r"ism-77.*missing-uuid"):
        rewrite_resource_links("[x](#missing-uuid)", {}, "ism-77")


@pytest.mark.parametrize(
    ("statement", "expected"),
    [
        ("One sentence.", ("One sentence.", False)),
        ("Lead-in:\n\n- a\n- b", ("Lead-in:", True)),
        ("Line one\nline two\n\nSecond paragraph.", ("Line one\nline two", True)),
    ],
)
def test_split_statement(statement, expected):
    assert split_statement(statement) == expected


def drop_statement_part(document):
    control_of(document, "ism-1667")["parts"] = []


def add_second_statement_part(document):
    control = control_of(document, "ism-1667")
    control["parts"].append({"id": "ism-1667_smt2", "name": "statement", "prose": "Another."})


def add_unknown_prop(document):
    control_of(document, "ism-1667")["props"].append({"name": "label", "value": "X"})


def set_unknown_applicability(document):
    control = control_of(document, "ism-1667")
    next(prop for prop in control["props"] if prop["name"] == "applicability")["value"] = "XX"


def set_unknown_essential_eight_applicability(document):
    control = control_of(document, "ism-1667")
    next(prop for prop in control["props"] if prop["name"] == "essential-eight-applicability")["value"] = "ML4"


def set_essential_eight_value_on_classification_prop(document):
    control = control_of(document, "ism-1667")
    next(prop for prop in control["props"] if prop["name"] == "applicability")["value"] = "ML1"


def remove_revision(document):
    control = control_of(document, "ism-1667")
    control["props"] = [prop for prop in control["props"] if prop["name"] != "revision"]


def remove_updated(document):
    control = control_of(document, "ism-1667")
    control["props"] = [prop for prop in control["props"] if prop["name"] != "updated"]


def duplicate_revision(document):
    control = control_of(document, "ism-1667")
    control["props"].append(next(prop for prop in control["props"] if prop["name"] == "revision"))


def link_to_unknown_uuid(document):
    topic_of(document, "ism-1667")["parts"][0]["prose"] = "See [x](#00000000-0000-4000-8000-000000000000)."


def remove_resource_links(document):
    del resource_of(document, PROCUREMENT_RESOURCE_UUID)["rlinks"]


def empty_resource_links(document):
    resource_of(document, PROCUREMENT_RESOURCE_UUID)["rlinks"] = []


def remove_topic_overview(document):
    del topic_of(document, "ism-1667")["parts"]


def duplicate_topic_overview(document):
    topic = topic_of(document, "ism-1667")
    topic["parts"].append(copy.deepcopy(topic["parts"][0]))


def move_control_two_groups_deep(document):
    topic = topic_of(document, "ism-1667")
    section = document["catalog"]["groups"][0]["groups"][0]
    section["controls"] = topic.pop("controls")


def nest_control_four_groups_deep(document):
    topic = topic_of(document, "ism-1667")
    topic["groups"] = [
        {"title": "Too deep", "props": [], "parts": [{"name": "overview", "prose": "x"}],
         "controls": topic.pop("controls")}
    ]


def duplicate_control_id(document):
    topic = topic_of(document, "ism-0001")
    topic["controls"].append(copy.deepcopy(control_of(document, "ism-0001")))


def unsafe_control_id(document):
    control_of(document, "ism-1667")["id"] = "ism/../x"


def uppercase_control_id(document):
    control_of(document, "ism-1667")["id"] = "ISM-1667"


def trailing_newline_control_id(document):
    control_of(document, "ism-1667")["id"] = "ism-1667\n"


def unknown_control_class(document):
    control_of(document, "ism-1667")["class"] = "ISM-guideline"


def unknown_class_on_a_principle_like_entry(document):
    topic = topic_of(document, "ism-0001")
    principle = next(entry for entry in topic["controls"] if entry["class"] == "ISM-principle")
    principle["class"] = "ISM-surprise"


def empty_statement(document):
    control_of(document, "ism-1667")["parts"][0]["prose"] = ""


def statement_part_without_prose(document):
    del control_of(document, "ism-1667")["parts"][0]["prose"]


def remove_back_matter(document):
    del document["catalog"]["back-matter"]


FAIL_LOUDLY_CASES = {
    "no statement part": (drop_statement_part, "ism-1667.*statement"),
    "two statement parts": (add_second_statement_part, "ism-1667.*statement"),
    "empty statement": (empty_statement, "ism-1667.*statement"),
    "statement without prose": (statement_part_without_prose, "ism-1667.*statement"),
    "unknown prop name": (add_unknown_prop, "ism-1667.*label"),
    "unknown applicability value": (set_unknown_applicability, "ism-1667.*XX"),
    "unknown essential eight value": (set_unknown_essential_eight_applicability, "ism-1667.*ML4"),
    "essential eight value in classification prop": (
        set_essential_eight_value_on_classification_prop,
        "ism-1667.*ML1",
    ),
    "missing revision": (remove_revision, "ism-1667.*revision"),
    "missing updated": (remove_updated, "ism-1667.*updated"),
    "duplicate revision": (duplicate_revision, "ism-1667.*revision"),
    "link to unknown uuid": (link_to_unknown_uuid, "ism-1667.*00000000-0000-4000-8000-000000000000"),
    "resource without rlinks": (remove_resource_links, PROCUREMENT_RESOURCE_UUID),
    "resource with empty rlinks": (empty_resource_links, PROCUREMENT_RESOURCE_UUID),
    "topic without overview": (remove_topic_overview, "ism-1667.*overview"),
    "topic with two overviews": (duplicate_topic_overview, "ism-1667.*overview"),
    "control two groups deep": (move_control_two_groups_deep, "ism-1667.*three groups"),
    "control four groups deep": (nest_control_four_groups_deep, "ism-1667.*three groups"),
    "duplicate id": (duplicate_control_id, "ism-0001.*duplicate"),
    "unsafe id": (unsafe_control_id, "ism/"),
    "uppercase id": (uppercase_control_id, "ISM-1667"),
    "id with trailing newline": (trailing_newline_control_id, "ism-1667"),
    "unknown control class": (unknown_control_class, "ism-1667.*ISM-guideline"),
    "unknown class beside a principle": (unknown_class_on_a_principle_like_entry, "ISM-surprise"),
    "no back-matter": (remove_back_matter, "back-matter"),
}


@pytest.mark.parametrize(
    ("mutate", "message_pattern"),
    FAIL_LOUDLY_CASES.values(),
    ids=FAIL_LOUDLY_CASES.keys(),
)
def test_unsupported_upstream_shapes_fail_loudly(mutate, message_pattern):
    document = load_fixture()
    mutate(document)

    with pytest.raises(UnsupportedUpstreamData, match=message_pattern):
        normalize_catalog(document, LOCK)


def test_principle_props_are_not_checked_because_principles_are_skipped():
    document = load_fixture()
    principle = next(
        entry
        for entry in topic_of(document, "ism-0001")["controls"]
        if entry["class"] == "ISM-principle"
    )

    assert any(prop["name"] == "label" for prop in principle["props"])
    assert "asd_ism.ism-principle-gov-01" not in rules_by_id(document)


def test_unused_resource_without_rlinks_still_fails_so_bad_data_is_never_silently_ignored():
    document = load_fixture()
    document["catalog"]["back-matter"]["resources"].append(
        {"uuid": "99999999-9999-4999-8999-999999999999", "title": "Unused"}
    )

    with pytest.raises(UnsupportedUpstreamData, match="99999999"):
        normalize_catalog(document, LOCK)
