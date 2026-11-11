import copy
import json
from pathlib import Path

import pytest

from tools.library_output import UnsupportedUpstreamData
from tools.nist_800_53_normalize import (
    CATALOG_PATH,
    LICENSE,
    PROFILE_PATHS,
    REPOSITORY_URL,
    SOURCE_NAME,
    control_id_for_label,
    label_for_control_id,
    normalize_catalog,
)
from tools.source_lock import SourceLock
from tools.validate_library import schema_errors

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "nist_800_53"
COMMIT_SHA = "f" * 40
LOCK = SourceLock(
    tag="v1.6.0",
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-11-11",
    repository_url=REPOSITORY_URL,
    published_date="2026-10-22",
    importer_format="nist-800-53-rev5-oscal-1",
)
FIXTURE_RULE_IDS = ["nist_800_53.ac-2", "nist_800_53.ac-2.1", "nist_800_53.pm-1"]
SECURITY_PUBLICATION = "NIST Special Publication 800-12"

EXPECTED_AC_2_STATEMENT = "\n".join(
    [
        "- a. Define account types [Assignment: organization-defined frequency]",
        "  - 1. Notify [Assignment: organization-defined personnel or roles]",
        "    - (a) Use one of [Selection (one or more): individual accounts;"
        " accounts reviewed [Assignment: organization-defined frequency]]",
        "- b. Review accounts [Selection: remove; disable].",
    ]
)


def read_fixture(repository_path: str) -> dict:
    return json.loads((FIXTURE_DIRECTORY / repository_path).read_text(encoding="utf-8"))


def load_catalog() -> dict:
    return read_fixture(CATALOG_PATH)


def load_profiles() -> dict[str, dict]:
    return {name: read_fixture(path) for name, path in PROFILE_PATHS.items()}


def normalize(catalog: dict | None = None, profiles: dict[str, dict] | None = None) -> list[dict]:
    return normalize_catalog(
        load_catalog() if catalog is None else catalog,
        load_profiles() if profiles is None else profiles,
        LOCK,
    )


def rules_by_id() -> dict[str, dict]:
    return {rule["id"]: rule for rule in normalize()}


def find_control(catalog: dict, control_id: str) -> dict:
    for group in catalog["catalog"]["groups"]:
        for control in group["controls"]:
            if control["id"] == control_id:
                return control
            for enhancement in control.get("controls", []):
                if enhancement["id"] == control_id:
                    return enhancement
    raise KeyError(control_id)


def test_entries_become_v5_rules():
    rules = normalize()

    assert [rule["id"] for rule in rules] == FIXTURE_RULE_IDS
    for rule in rules:
        assert schema_errors(rule, "rule") == []


def test_base_control_fields():
    rule = rules_by_id()["nist_800_53.ac-2"]

    assert rule["schema_version"] == 5
    assert rule["title"] == "Account Management"
    assert rule["discussion_format"] == "markdown"
    assert rule["section_path"] == ["Access Control", "AC-02 Account Management"]
    assert rule["source"] == {
        "name": SOURCE_NAME,
        "release_tag": "v1.6.0",
        "commit_sha": COMMIT_SHA,
        "upstream_rule_id": "ac-2",
        "upstream_path": CATALOG_PATH,
        "upstream_revision": None,
        "upstream_updated": None,
        "upstream_url": f"{REPOSITORY_URL}/blob/{COMMIT_SHA}/{CATALOG_PATH}",
        "license": LICENSE,
    }
    assert rule["assessment"] == {"status": "manual", "manual_reason": "no_check"}
    assert rule["applicability"] == [
        {
            "target": None,
            "version": None,
            "benchmarks": [
                {"name": "nist_800_53_low", "severity": None},
                {"name": "nist_800_53_moderate", "severity": None},
                {"name": "nist_800_53_high", "severity": None},
            ],
        }
    ]
    assert rule["tags"] == []
    assert rule["references"] == {
        "related_controls": ["PM-1", "AC-2(1)"],
        "publications": [SECURITY_PUBLICATION, "OMB Circular A-130"],
    }
    for absent_field in ("check", "odv", "remediation", "architecture"):
        assert rule[absent_field] is None


def test_enhancement_fields():
    rule = rules_by_id()["nist_800_53.ac-2.1"]

    assert rule["title"] == "Account Management | Automated System Account Management"
    assert rule["section_path"] == ["Access Control", "AC-02 Account Management"]
    assert rule["source"]["upstream_rule_id"] == "ac-2.1"
    assert rule["references"] == {"related_controls": ["AC-2"]}
    assert rule["applicability"][0]["target"] is None
    for absent_field in ("check", "odv", "remediation", "architecture"):
        assert rule[absent_field] is None


def test_control_without_references_gets_an_empty_object_and_family_section():
    catalog = load_catalog()
    find_control(catalog, "pm-1")["links"] = []

    rule = next(rule for rule in normalize(catalog) if rule["id"] == "nist_800_53.pm-1")

    assert rule["references"] == {}
    assert rule["section_path"] == ["Program Management", "PM-01 Policy and Procedures"]


def test_statement_rendering():
    discussion = rules_by_id()["nist_800_53.ac-2"]["discussion"]

    assert discussion.startswith(f"## Control\n\n{EXPECTED_AC_2_STATEMENT}\n\n## Discussion\n\n")


def test_statement_prose_inserts_parameters_from_the_base_control():
    discussion = rules_by_id()["nist_800_53.ac-2.1"]["discussion"]

    assert discussion.startswith(
        "## Control\n\nSupport the management of system accounts using"
        " [Assignment: organization-defined automated mechanisms] reviewed"
        " [Assignment: organization-defined frequency].\n\n## Discussion\n\n"
    )


def test_statement_with_prose_and_items_starts_with_the_prose():
    catalog = load_catalog()
    statement = find_control(catalog, "ac-2")["parts"][0]
    statement["prose"] = "The organization:"

    discussion = next(rule for rule in normalize(catalog) if rule["id"] == "nist_800_53.ac-2")["discussion"]

    assert discussion.startswith(f"## Control\n\nThe organization:\n\n{EXPECTED_AC_2_STATEMENT}\n\n")


def test_guidance_links():
    discussion = rules_by_id()["nist_800_53.ac-2"]["discussion"]
    guidance = discussion.split("## Discussion\n\n")[1]

    assert guidance == (
        "Accounts are described in [NIST SP 800-12](https://doi.org/10.6028/NIST.SP.800-12r1)"
        " and relate to PM-1, item AC-2a and the PM family.\n\nSecond paragraph about accounts."
    )
    assert all("](#" not in rule["discussion"] for rule in normalize())


def test_statement_links_are_rewritten_like_guidance_links():
    catalog = load_catalog()
    statement_of(catalog)["parts"][1]["prose"] = (
        "Review accounts as defined in [AC-2a](#ac-2_smt.a) and [SP 800-12](#11111111-1111-1111-1111-111111111111)."
    )

    discussion = next(rule for rule in normalize(catalog) if rule["id"] == "nist_800_53.ac-2")["discussion"]

    assert "- b. Review accounts as defined in AC-2a and [SP 800-12](https://doi.org/10.6028/NIST.SP.800-12r1)." in discussion
    assert "](#" not in discussion


def test_statement_link_to_unknown_target_fails():
    def link_nowhere(catalog):
        statement_of(catalog, "pm-1")["prose"] = "See [here](#nowhere)."

    mutate_catalog(link_nowhere, "unknown target 'nowhere'")


def test_benchmarks_follow_profiles():
    rules = rules_by_id()
    enhancement_benchmarks = [
        benchmark["name"] for benchmark in rules["nist_800_53.ac-2.1"]["applicability"][0]["benchmarks"]
    ]

    assert enhancement_benchmarks == ["nist_800_53_moderate", "nist_800_53_high", "nist_800_53_privacy"]
    assert rules["nist_800_53.pm-1"]["applicability"][0]["benchmarks"] == []
    assert list(PROFILE_PATHS) == [
        "nist_800_53_low",
        "nist_800_53_moderate",
        "nist_800_53_high",
        "nist_800_53_privacy",
    ]


def test_benchmark_order_ignores_the_order_of_the_profile_documents():
    profiles = load_profiles()
    reversed_profiles = dict(reversed(list(profiles.items())))

    assert normalize(profiles=reversed_profiles) == normalize(profiles=profiles)


def test_rules_are_sorted_by_sort_id_not_by_id_text():
    catalog = load_catalog()
    access_control = catalog["catalog"]["groups"][0]
    ac_10 = copy.deepcopy(find_control(catalog, "pm-1"))
    ac_10.update(
        {
            "id": "ac-10",
            "title": "Concurrent Session Control",
            "props": [
                {"name": "label", "value": "AC-10"},
                {"name": "label", "value": "AC-10", "class": "zero-padded"},
                {"name": "sort-id", "value": "ac-10"},
            ],
            "links": [],
        }
    )
    ac_10["parts"][0]["id"] = "ac-10_smt"
    ac_10["parts"][1]["id"] = "ac-10_gdn"
    access_control["controls"].append(ac_10)

    assert [rule["id"] for rule in normalize(catalog)] == [
        "nist_800_53.ac-2",
        "nist_800_53.ac-2.1",
        "nist_800_53.ac-10",
        "nist_800_53.pm-1",
    ]


def test_label_round_trip():
    assert label_for_control_id("ac-20.1") == "AC-20(1)"
    assert label_for_control_id("ac-2") == "AC-2"
    assert control_id_for_label("AC-20(1)") == "ac-20.1"
    assert control_id_for_label("AC-2") == "ac-2"
    for control_id in ("ac-2", "ac-20.1", "pm-31", "sc-7.21"):
        assert control_id_for_label(label_for_control_id(control_id)) == control_id


@pytest.mark.parametrize(
    "malformed_label", ["", "ac-2", "AC-2(", "AC-2()", "AC-2(1)(2)", "AC2", "A-2", "AC-2 ", " AC-2", "AC-2(a)", "AC-2(1)\n", "AC-\u0662"]
)
def test_malformed_labels_give_none(malformed_label):
    assert control_id_for_label(malformed_label) is None


@pytest.mark.parametrize("malformed_id", ["", "AC-2", "ac-2.", "ac-2.1.1", "a-2", "../x", "ac-2\n", "ac-\u0662"])
def test_label_for_malformed_id_is_refused(malformed_id):
    with pytest.raises(UnsupportedUpstreamData, match="not a control id"):
        label_for_control_id(malformed_id)


def mutate_catalog(mutation, expected_message: str) -> None:
    catalog = load_catalog()
    mutation(catalog)
    with pytest.raises(UnsupportedUpstreamData, match=expected_message):
        normalize(catalog)


def add_key(control_id: str, key: str):
    return lambda catalog: find_control(catalog, control_id).update({key: []})


def append_prop(control_id: str, prop: dict):
    return lambda catalog: find_control(catalog, control_id)["props"].append(prop)


def set_field(control_id: str, field: str, value):
    return lambda catalog: find_control(catalog, control_id).update({field: value})


def statement_of(catalog: dict, control_id: str = "ac-2") -> dict:
    return next(part for part in find_control(catalog, control_id)["parts"] if part["name"] == "statement")


def guidance_of(catalog: dict, control_id: str = "ac-2") -> dict:
    return next(part for part in find_control(catalog, control_id)["parts"] if part["name"] == "guidance")


def param_of(catalog: dict, param_id: str) -> dict:
    for control_id in ("ac-2", "ac-2.1"):
        for param in find_control(catalog, control_id).get("params", []):
            if param["id"] == param_id:
                return param
    raise KeyError(param_id)


def test_unknown_control_key_fails():
    mutate_catalog(add_key("ac-2", "surprise"), "unsupported control key 'surprise'")


def test_unknown_control_class_fails():
    mutate_catalog(set_field("pm-1", "class", "SP800-53B"), "pm-1: unsupported class 'SP800-53B'")


def test_enhancement_class_on_a_base_control_fails():
    mutate_catalog(set_field("pm-1", "class", "SP800-53-enhancement"), "unsupported class")


def test_unknown_property_name_fails():
    mutate_catalog(append_prop("ac-2", {"name": "surprise", "value": "x"}), "unsupported property 'surprise'")


def test_unknown_property_key_fails():
    mutate_catalog(
        append_prop("ac-2", {"name": "status", "value": "withdrawn", "remarks": "x"}),
        "unsupported property key 'remarks'",
    )


def test_unknown_status_value_fails():
    mutate_catalog(append_prop("pm-1", {"name": "status", "value": "draft"}), "unsupported status")


def test_unknown_part_name_fails():
    mutate_catalog(
        lambda catalog: find_control(catalog, "pm-1")["parts"].append({"id": "pm-1_x", "name": "example", "prose": "x"}),
        "unsupported part 'example'",
    )


def test_unknown_link_rel_fails():
    mutate_catalog(
        lambda catalog: find_control(catalog, "pm-1")["links"].append({"href": "#ac-2", "rel": "supersedes"}),
        "unsupported link rel 'supersedes'",
    )


def test_unknown_group_class_fails():
    mutate_catalog(lambda catalog: catalog["catalog"]["groups"][0].update({"class": "section"}), "unsupported group class")


def test_unknown_group_key_fails():
    mutate_catalog(lambda catalog: catalog["catalog"]["groups"][0].update({"groups": []}), "unsupported group key 'groups'")


@pytest.mark.parametrize("malformed_id", ["AC-2x", "ac-2.1.1", "a-2", "ac-02a"])
def test_id_not_matching_the_control_pattern_fails(malformed_id):
    def rename(catalog):
        find_control(catalog, "pm-1")["id"] = malformed_id

    mutate_catalog(rename, "not safe to use in a rule id")


def test_duplicate_id_fails():
    def duplicate(catalog):
        catalog["catalog"]["groups"][1]["controls"].append(copy.deepcopy(find_control(catalog, "pm-1")))

    mutate_catalog(duplicate, "pm-1: duplicate id")


def test_label_differing_from_the_derived_label_fails():
    def relabel(catalog):
        find_control(catalog, "pm-1")["props"][0]["value"] = "PM-2"

    mutate_catalog(relabel, "pm-1: label 'PM-2' differs")


def test_missing_zero_padded_label_fails():
    def drop_zero_padded_label(catalog):
        props = find_control(catalog, "pm-1")["props"]
        props[:] = [prop for prop in props if prop.get("class") != "zero-padded"]

    mutate_catalog(drop_zero_padded_label, "exactly one 'label' property of class 'zero-padded'")


@pytest.mark.parametrize("missing_part_name", ["statement", "guidance"])
def test_current_entry_without_statement_or_guidance_fails(missing_part_name):
    def drop_part(catalog):
        parts = find_control(catalog, "pm-1")["parts"]
        parts[:] = [part for part in parts if part["name"] != missing_part_name]

    mutate_catalog(drop_part, "exactly one statement part and one guidance part")


def test_second_statement_part_fails():
    def add_second_statement(catalog):
        parts = find_control(catalog, "pm-1")["parts"]
        parts.append({**parts[0], "id": "pm-1_smt2"})

    mutate_catalog(add_second_statement, "exactly one statement part and one guidance part")


def test_item_without_a_label_fails():
    def drop_label(catalog):
        statement_of(catalog)["parts"][0]["props"] = []

    mutate_catalog(drop_label, "exactly one 'label' property")


def test_item_with_two_labels_fails():
    def double_label(catalog):
        statement_of(catalog)["parts"][0]["props"].append({"name": "label", "value": "x."})

    mutate_catalog(double_label, "exactly one 'label' property")


def test_statement_items_nested_deeper_than_three_levels_fail():
    def nest_one_more(catalog):
        deepest = statement_of(catalog)["parts"][0]["parts"][0]["parts"][0]
        deepest["parts"] = [
            {"id": "ac-2_smt.deep", "name": "item", "props": [{"name": "label", "value": "1."}], "prose": "x"}
        ]

    mutate_catalog(nest_one_more, "nested deeper than 3 levels")


def test_unknown_item_key_fails():
    def add_key_to_item(catalog):
        statement_of(catalog)["parts"][0]["links"] = []

    mutate_catalog(add_key_to_item, "unsupported item key 'links'")


@pytest.mark.parametrize(
    "expression",
    ["{{ insert: odp, ac-02_odp.01 }}", "{{ something else }}", "{{ insert: param, ac-02_odp.01 ", "{{insert param ac-02_odp.01}}"],
)
def test_unsupported_expression_fails(expression):
    def use_expression(catalog):
        statement_of(catalog, "ac-2.1")["prose"] = f"Do {expression} now."

    mutate_catalog(use_expression, r"unsupported \{\{ \.\.\. \}\} expression")


def test_insert_of_unknown_param_fails():
    def insert_unknown(catalog):
        statement_of(catalog, "ac-2.1")["prose"] = "Do {{ insert: param, nowhere }} now."

    mutate_catalog(insert_unknown, "insert of unknown parameter 'nowhere'")


def test_param_with_both_label_and_select_fails():
    mutate_catalog(
        lambda catalog: param_of(catalog, "ac-02_odp.01").update({"select": {"choice": ["x"]}}),
        "exactly one of label and select",
    )


def test_param_with_neither_label_nor_select_fails():
    mutate_catalog(lambda catalog: param_of(catalog, "ac-02_odp.01").pop("label"), "exactly one of label and select")


def test_unknown_how_many_fails():
    mutate_catalog(
        lambda catalog: param_of(catalog, "ac-02_odp.04")["select"].update({"how-many": "all"}),
        "unsupported how-many 'all'",
    )


def test_unknown_param_key_fails():
    mutate_catalog(
        lambda catalog: param_of(catalog, "ac-02_odp.01").update({"values": ["x"]}),
        "unsupported parameter key 'values'",
    )


def test_insert_cycle_fails():
    def make_cycle(catalog):
        param_of(catalog, "ac-02_odp.02")["select"]["choice"].append("again {{ insert: param, ac-02_odp.02 }}")

    mutate_catalog(make_cycle, "inserts itself")


def test_link_to_unknown_target_fails():
    def link_nowhere(catalog):
        guidance_of(catalog)["prose"] = "See [here](#nowhere)."

    mutate_catalog(link_nowhere, "unknown target 'nowhere'")


def test_related_link_to_unknown_control_fails():
    mutate_catalog(
        lambda catalog: find_control(catalog, "pm-1")["links"].append({"href": "#zz-9", "rel": "related"}),
        "related link to unknown control 'zz-9'",
    )


def test_reference_link_to_unknown_resource_fails():
    mutate_catalog(
        lambda catalog: find_control(catalog, "pm-1")["links"].append({"href": "#nowhere", "rel": "reference"}),
        "reference link to unknown back-matter resource 'nowhere'",
    )


def test_back_matter_resource_without_an_href_fails():
    mutate_catalog(
        lambda catalog: catalog["catalog"]["back-matter"]["resources"][0].update({"rlinks": []}),
        "has no rlinks href",
    )


def test_document_without_groups_fails():
    with pytest.raises(UnsupportedUpstreamData, match="catalog.groups"):
        normalize({"catalog": {}})


def mutate_profile(mutation, expected_message: str, benchmark_name: str = "nist_800_53_low") -> None:
    profiles = load_profiles()
    mutation(profiles[benchmark_name]["profile"])
    with pytest.raises(UnsupportedUpstreamData, match=expected_message):
        normalize(profiles=profiles)


def test_profile_with_two_imports_fails():
    mutate_profile(lambda profile: profile["imports"].append(copy.deepcopy(profile["imports"][0])), "exactly one import")


def test_profile_selecting_children_fails():
    mutate_profile(
        lambda profile: profile["imports"][0]["include-controls"][0].update({"with-child-controls": "yes"}),
        "may only use with-ids",
    )


def test_profile_with_exclusions_fails():
    mutate_profile(
        lambda profile: profile["imports"][0].update({"exclude-controls": [{"with-ids": ["ac-2"]}]}),
        "unsupported profile import key 'exclude-controls'",
    )


def test_profile_that_modifies_fails():
    mutate_profile(lambda profile: profile.update({"merge": {"flat": {}}}), "merge must be as-is")


def test_profile_listing_a_withdrawn_control_fails():
    mutate_profile(
        lambda profile: profile["imports"][0]["include-controls"][0]["with-ids"].append("ac-2.2"),
        "'ac-2.2', which is withdrawn or not in the catalog",
    )


def test_profile_listing_an_unknown_control_fails():
    mutate_profile(
        lambda profile: profile["imports"][0]["include-controls"][0]["with-ids"].append("zz-1"),
        "'zz-1', which is withdrawn or not in the catalog",
    )


def test_profile_listing_a_control_twice_fails():
    mutate_profile(
        lambda profile: profile["imports"][0]["include-controls"][0]["with-ids"].append("ac-2"),
        "more than once",
    )


def test_missing_profile_fails():
    profiles = load_profiles()
    del profiles["nist_800_53_privacy"]
    with pytest.raises(UnsupportedUpstreamData, match="missing baseline profile 'nist_800_53_privacy'"):
        normalize(profiles=profiles)


def test_withdrawn_entries_need_no_statement_or_guidance():
    rules = normalize()

    assert "nist_800_53.ac-2.2" not in [rule["id"] for rule in rules]
