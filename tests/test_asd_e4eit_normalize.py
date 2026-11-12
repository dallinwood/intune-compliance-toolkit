import copy
import json
from pathlib import Path

import pytest

from tools.asd_e4eit_normalize import (
    BENCHMARK_BY_DOMAIN,
    BENCHMARK_BY_PHASE,
    CATALOG_FILE_NAME,
    MAPPING_COLLECTION_FILE_NAME,
    MAPPING_FILE_ID,
    PROFILE_FILE_PATTERN,
    REPOSITORY_URL,
    SOURCE_NAME,
    ism_mapping,
    normalize_release,
    phases_by_domain,
)
from tools.asd_ism_normalize import LICENSE
from tools.library_output import UnsupportedUpstreamData
from tools.source_lock import SourceLock
from tools.validate_library import schema_errors

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "asd_e4eit"
COMMIT_SHA = "d" * 40
E4EIT_TAG = "v2026.10.15"
LOCK = SourceLock(
    tag=E4EIT_TAG,
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-11-11",
    repository_url=REPOSITORY_URL,
    published_date="2026-10-15",
    importer_format="asd-e4eit-oscal-1",
)
ALL_ACTION_IDS = {"IT.GOV-01.1", "IT.PRO-01.1", "IT.PRO-13.1", "IT.PRO-13.2"}
DOMAIN_NAMESPACE = "https://www.cyber.gov.au/ns/essentials/oscal/1.0"
FULL_ACTION_ID = "asd_e4eit.it.pro-13.1"


def load_json(file_name: str) -> dict:
    return json.loads((FIXTURE_DIRECTORY / file_name).read_text(encoding="utf-8"))


def load_fixture() -> tuple[dict, list[dict], dict]:
    catalog = load_json(CATALOG_FILE_NAME)
    profile_file_names = sorted(
        path.name for path in FIXTURE_DIRECTORY.iterdir() if PROFILE_FILE_PATTERN.match(path.name)
    )
    profiles = [load_json(file_name) for file_name in profile_file_names]
    return catalog, profiles, load_json(MAPPING_COLLECTION_FILE_NAME)


def normalize_fixture(catalog=None, profiles=None, mapping_collection=None) -> list[dict]:
    fixture_catalog, fixture_profiles, fixture_mapping_collection = load_fixture()
    return normalize_release(
        catalog if catalog is not None else fixture_catalog,
        profiles if profiles is not None else fixture_profiles,
        mapping_collection if mapping_collection is not None else fixture_mapping_collection,
        LOCK,
    )


def rules_by_id() -> dict[str, dict]:
    return {rule["id"]: rule for rule in normalize_fixture()}


def controls_of(catalog: dict) -> list[dict]:
    return [
        control
        for function_group in catalog["catalog"]["groups"]
        for principle_group in function_group["groups"]
        for control in principle_group["controls"]
    ]


def control_with_id(catalog: dict, control_id: str) -> dict:
    return next(control for control in controls_of(catalog) if control["id"] == control_id)


def principle_group_with_id(catalog: dict, principle_id: str) -> dict:
    return next(
        principle_group
        for function_group in catalog["catalog"]["groups"]
        for principle_group in function_group["groups"]
        if principle_group["id"] == principle_id
    )


def indicator_groups_of(control: dict) -> list[dict]:
    indicators_part = next(
        part for part in control["parts"] if part["class"] == "indicators-of-good-practice"
    )
    return indicators_part["parts"]


def profile_with_domain(profiles: list[dict], domain: str) -> dict:
    return next(
        profile
        for profile in profiles
        if any(
            prop["name"] == "domain" and prop["value"] == domain
            for prop in profile["profile"]["metadata"]["props"]
        )
    )


def profile_property(profile: dict, name: str) -> dict:
    return next(prop for prop in profile["profile"]["metadata"]["props"] if prop["name"] == name)


def mapping_with_description(mapping_collection: dict, description: str) -> dict:
    return next(
        mapping
        for mapping in mapping_collection["mapping-collection"]["mappings"]
        if mapping["mapping-description"] == description
    )


def test_every_rule_validates_against_the_rule_schema():
    rules = normalize_fixture()
    assert [rule["id"] for rule in rules] == [
        "asd_e4eit.it.gov-01.1",
        "asd_e4eit.it.pro-01.1",
        "asd_e4eit.it.pro-13.1",
        "asd_e4eit.it.pro-13.2",
    ]
    for rule in rules:
        assert schema_errors(rule) == [], rule["id"]


def test_constants_match_the_design():
    assert SOURCE_NAME == "asd_e4eit"
    assert CATALOG_FILE_NAME == "E4EIT_catalog.json"
    assert MAPPING_COLLECTION_FILE_NAME == "E4EIT_mapping-collection.json"
    assert MAPPING_FILE_ID == "asd-e4eit-to-asd-ism"
    assert list(BENCHMARK_BY_PHASE.values()) == [
        "e4eit_phase_1",
        "e4eit_phase_2",
        "e4eit_phase_3",
    ]
    assert list(BENCHMARK_BY_DOMAIN) == [
        "boundary-services",
        "identity-services",
        "critical-processes-and-services",
        "privileged-environments",
        "business-systems",
        "governance-and-culture",
        "user-devices",
        "visibility-and-response",
    ]
    assert list(BENCHMARK_BY_DOMAIN.values()) == [
        "e4eit_boundary_services",
        "e4eit_identity_services",
        "e4eit_critical_processes_and_services",
        "e4eit_privileged_environments",
        "e4eit_business_systems",
        "e4eit_governance_and_culture",
        "e4eit_user_devices",
        "e4eit_visibility_and_response",
    ]
    assert PROFILE_FILE_PATTERN.match("E4EIT_user-devices-domain_profile.json")
    assert not PROFILE_FILE_PATTERN.match("E4EIT_user-devices-domain_resolved-catalog.json")


def test_full_action_has_exact_field_values():
    rule = rules_by_id()[FULL_ACTION_ID]
    assert rule["schema_version"] == 5
    assert rule["id"] == FULL_ACTION_ID
    assert rule["title"] == "Require multi-factor authentication for all remote access."
    assert rule["discussion_format"] == "markdown"
    assert rule["section_path"] == [
        "Protect principles",
        "PRO-13 - Identity, credential and access management",
    ]
    assert rule["source"] == {
        "name": "asd_e4eit",
        "release_tag": E4EIT_TAG,
        "commit_sha": COMMIT_SHA,
        "upstream_rule_id": "IT.PRO-13.1",
        "upstream_path": "E4EIT_catalog.json",
        "upstream_revision": None,
        "upstream_updated": None,
        "upstream_url": f"{REPOSITORY_URL}/blob/{COMMIT_SHA}/E4EIT_catalog.json",
        "license": LICENSE,
    }
    assert rule["applicability"] == [
        {
            "target": None,
            "version": None,
            "benchmarks": [
                {"name": name, "severity": None}
                for name in [
                    "e4eit_phase_1",
                    "e4eit_phase_3",
                    "e4eit_boundary_services",
                    "e4eit_governance_and_culture",
                    "e4eit_user_devices",
                ]
            ],
        }
    ]
    assert rule["assessment"] == {"status": "manual", "manual_reason": "no_check"}
    assert rule["references"] == {
        "aemo": {"aescsf_v2": ["ACCESS-1b", "ACCESS-1c"]},
        "mitre": {"attack_v19": ["T1078", "T1110"]},
        "nist": {"800-171r3": ["03.05.03"], "csf_2.0": ["PR.AA-01", "PR.AA-03"]},
    }
    assert rule["tags"] == []
    for null_field in ("architecture", "check", "odv", "remediation"):
        assert rule[null_field] is None


def test_discussion_is_built_exactly_as_the_design_shows():
    assert rules_by_id()[FULL_ACTION_ID]["discussion"] == (
        "# Principle\n"
        "\n"
        "Identities and credentials are managed and access is authorised.\n"
        "\n"
        "# Indicators of Good Practice\n"
        "\n"
        "Not effective:\n"
        "- Passwords alone protect remote access.\n"
        "- MFA is optional for staff.\n"
        "\n"
        "Partially effective:\n"
        "- MFA covers some remote access paths.\n"
        "\n"
        "Fully effective:\n"
        "- MFA is enforced on every remote access path."
    )


def test_single_domain_action_gets_its_phase_and_domain_benchmarks_only():
    benchmarks = rules_by_id()["asd_e4eit.it.gov-01.1"]["applicability"][0]["benchmarks"]
    assert [benchmark["name"] for benchmark in benchmarks] == [
        "e4eit_phase_3",
        "e4eit_governance_and_culture",
    ]


def test_action_with_domains_in_two_phases_gets_both_phase_benchmarks():
    benchmarks = rules_by_id()["asd_e4eit.it.pro-01.1"]["applicability"][0]["benchmarks"]
    assert [benchmark["name"] for benchmark in benchmarks] == [
        "e4eit_phase_1",
        "e4eit_phase_3",
        "e4eit_boundary_services",
        "e4eit_user_devices",
    ]


def test_editing_a_profile_phase_changes_the_phase_benchmarks():
    catalog, profiles, mapping_collection = load_fixture()
    profile_property(profile_with_domain(profiles, "boundary-services"), "domain-priority-phase")[
        "value"
    ] = "phase-2"
    rules = {rule["id"]: rule for rule in normalize_fixture(catalog, profiles, mapping_collection)}
    benchmarks = rules["asd_e4eit.it.pro-01.1"]["applicability"][0]["benchmarks"]
    assert [benchmark["name"] for benchmark in benchmarks] == [
        "e4eit_phase_2",
        "e4eit_phase_3",
        "e4eit_boundary_services",
        "e4eit_user_devices",
    ]


def test_phases_by_domain_reads_each_profile():
    _, profiles, _ = load_fixture()
    assert phases_by_domain(profiles) == {
        "boundary-services": ["phase-1"],
        "governance-and-culture": ["phase-3"],
        "user-devices": ["phase-3"],
    }


def test_a_domain_spanning_several_phases_gets_every_phase_benchmark():
    catalog, profiles, mapping_collection = load_fixture()
    governance_profile = profile_with_domain(profiles, "governance-and-culture")
    metadata_props = governance_profile["profile"]["metadata"]["props"]
    for phase in ("phase-2", "phase-1"):
        metadata_props.append(
            {"name": "domain-priority-phase", "ns": DOMAIN_NAMESPACE, "value": phase}
        )
    assert phases_by_domain(profiles)["governance-and-culture"] == ["phase-1", "phase-2", "phase-3"]
    rules = {rule["id"]: rule for rule in normalize_fixture(catalog, profiles, mapping_collection)}
    benchmarks = rules["asd_e4eit.it.gov-01.1"]["applicability"][0]["benchmarks"]
    assert [benchmark["name"] for benchmark in benchmarks] == [
        "e4eit_phase_1",
        "e4eit_phase_2",
        "e4eit_phase_3",
        "e4eit_governance_and_culture",
    ]


def test_rule_without_any_references_has_an_empty_object():
    assert rules_by_id()["asd_e4eit.it.gov-01.1"]["references"] == {}


def test_references_with_only_one_framework_leave_out_the_others():
    assert rules_by_id()["asd_e4eit.it.pro-13.2"]["references"] == {
        "nist": {"csf_2.0": ["PR.AA-05"]}
    }


def test_mitre_ids_land_under_the_attack_version_key():
    references = rules_by_id()[FULL_ACTION_ID]["references"]
    assert references["mitre"] == {"attack_v19": ["T1078", "T1110"]}


def test_mitre_key_follows_the_version_in_the_resource_href():
    catalog, profiles, mapping_collection = load_fixture()
    for resource in catalog["catalog"]["back-matter"]["resources"]:
        resource["rlinks"][0]["href"] = resource["rlinks"][0]["href"].replace("v19", "v20")
    rules = {rule["id"]: rule for rule in normalize_fixture(catalog, profiles, mapping_collection)}
    assert list(rules[FULL_ACTION_ID]["references"]["mitre"]) == ["attack_v20"]


def test_output_is_independent_of_input_order():
    catalog, profiles, mapping_collection = load_fixture()
    expected = normalize_fixture(catalog, profiles, mapping_collection)
    function_groups = catalog["catalog"]["groups"]
    function_groups.reverse()
    assert normalize_fixture(catalog, list(reversed(profiles)), mapping_collection) == expected


def test_ism_mapping_content():
    _, _, mapping_collection = load_fixture()
    content, ism_tag = ism_mapping(mapping_collection, ALL_ACTION_IDS, E4EIT_TAG)
    assert ism_tag == "v2026.09.4"

    def link(action_id: str, ism_ids: list[str], note: str) -> dict:
        return {
            "relation": "related",
            "from": [{"kind": "rule", "id": action_id, "release": E4EIT_TAG}],
            "to": [{"kind": "rule", "id": ism_id, "release": ism_tag} for ism_id in ism_ids],
            "note": note,
        }

    ism_note = (
        "ASD lists these ISM controls as potential evidence sources for this action "
        "(E4EIT to ISM, excluding Essential Eight)."
    )
    essential_eight_note = (
        "ASD lists these ISM controls as potential evidence sources for this action "
        "(E4EIT to Essential Eight)."
    )
    assert content == {
        "schema_version": 1,
        "id": "asd-e4eit-to-asd-ism",
        "generated_by": "python tools/import_asd_e4eit.py",
        "description": (
            "Generated by tools/import_asd_e4eit.py from ASD's E4EIT mapping collection "
            "v2026.10.15 (Potential Evidence Sources). Do not edit by hand."
        ),
        "links": [
            link("asd_e4eit.it.gov-01.1", ["asd_ism.ism-1997", "asd_ism.ism-1998"], ism_note),
            link("asd_e4eit.it.pro-13.1", ["asd_ism.ism-0974"], ism_note),
            link(
                "asd_e4eit.it.pro-13.1",
                ["asd_ism.ism-1173", "asd_ism.ism-1504"],
                essential_eight_note,
            ),
        ],
    }


def test_ism_mapping_ignores_the_framework_mappings_that_are_not_ism():
    _, _, mapping_collection = load_fixture()
    content, _ = ism_mapping(mapping_collection, ALL_ACTION_IDS, E4EIT_TAG)
    mapped_targets = {endpoint["id"] for link in content["links"] for endpoint in link["to"]}
    assert all(target.startswith("asd_ism.ism-") for target in mapped_targets)


def test_ism_mapping_names_the_release_of_the_target_resource():
    _, _, mapping_collection = load_fixture()
    for resource in mapping_collection["mapping-collection"]["back-matter"]["resources"]:
        resource["rlinks"][0]["href"] = resource["rlinks"][0]["href"].replace(
            "v2026.09.4", "v2026.12.1"
        )
    content, ism_tag = ism_mapping(mapping_collection, ALL_ACTION_IDS, E4EIT_TAG)
    assert ism_tag == "v2026.12.1"
    assert {endpoint["release"] for link in content["links"] for endpoint in link["to"]} == {
        "v2026.12.1"
    }


def test_ism_mapping_rejects_disagreeing_target_releases():
    _, _, mapping_collection = load_fixture()
    for resource in mapping_collection["mapping-collection"]["back-matter"]["resources"]:
        if resource["title"] == "ASD Essential Eight":
            resource["rlinks"][0]["href"] = resource["rlinks"][0]["href"].replace(
                "v2026.09.4", "v2026.12.1"
            )
    with pytest.raises(UnsupportedUpstreamData, match="release"):
        ism_mapping(mapping_collection, ALL_ACTION_IDS, E4EIT_TAG)


def test_ism_mapping_rejects_an_ism_resource_link_of_the_wrong_shape():
    _, _, mapping_collection = load_fixture()
    for resource in mapping_collection["mapping-collection"]["back-matter"]["resources"]:
        if resource["title"].startswith("ASD Information"):
            resource["rlinks"][0]["href"] = "https://www.cyber.gov.au/ism/oscal/latest/ISM_catalog.xml"
    with pytest.raises(UnsupportedUpstreamData, match="ISM"):
        ism_mapping(mapping_collection, ALL_ACTION_IDS, E4EIT_TAG)


def test_ism_mapping_rejects_a_source_that_is_not_an_action():
    _, _, mapping_collection = load_fixture()
    with pytest.raises(UnsupportedUpstreamData, match="IT.PRO-13.2|not an action"):
        ism_mapping(mapping_collection, ALL_ACTION_IDS - {"IT.PRO-13.1"}, E4EIT_TAG)


def drop_function_group_title(catalog, profiles, mapping_collection):
    del catalog["catalog"]["groups"][0]["title"]


def drop_principle_group_title(catalog, profiles, mapping_collection):
    del principle_group_with_id(catalog, "PRO-13")["title"]


def move_control_directly_under_function_group(catalog, profiles, mapping_collection):
    function_group = catalog["catalog"]["groups"][0]
    function_group["controls"] = function_group["groups"][0].pop("controls")
    function_group["groups"][0]["controls"] = []


def nest_principle_group_one_level_deeper(catalog, profiles, mapping_collection):
    principle_group = principle_group_with_id(catalog, "GOV-01")
    principle_group["groups"] = [
        {"id": "extra", "title": "Extra", "controls": principle_group.pop("controls")}
    ]
    principle_group["controls"] = []


def change_principle_class(catalog, profiles, mapping_collection):
    principle_group_with_id(catalog, "PRO-13")["class"] = "ISM-principle"


def remove_principle_overview(catalog, profiles, mapping_collection):
    principle_group_with_id(catalog, "PRO-13")["parts"] = []


def duplicate_principle_overview(catalog, profiles, mapping_collection):
    parts = principle_group_with_id(catalog, "PRO-13")["parts"]
    parts.append(copy.deepcopy(parts[0]))


def remove_principle_overview_prose(catalog, profiles, mapping_collection):
    del principle_group_with_id(catalog, "PRO-13")["parts"][0]["prose"]


def add_control_class(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["class"] = "essentials-action"


def add_control_params(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["params"] = []


def add_nested_controls(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["controls"] = []


def use_unsafe_control_id(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["id"] = "IT.PRO 13.1"


def use_trailing_newline_in_control_id(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["id"] = "IT.PRO-13.1\n"


def add_control_whose_lowercased_id_collides(catalog, profiles, mapping_collection):
    colliding = copy.deepcopy(control_with_id(catalog, "IT.PRO-13.2"))
    colliding["id"] = "it.pro-13.2"
    principle_group_with_id(catalog, "PRO-13")["controls"].append(colliding)


def add_unknown_control_property(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["props"].append({"name": "label", "value": "x"})


def put_domain_property_in_another_namespace(catalog, profiles, mapping_collection):
    domain_prop = next(
        prop
        for prop in control_with_id(catalog, "IT.PRO-13.2")["props"]
        if prop["name"] == "domain"
    )
    domain_prop["ns"] = "https://example.invalid/ns"


def use_unknown_domain(catalog, profiles, mapping_collection):
    domain_prop = next(
        prop
        for prop in control_with_id(catalog, "IT.PRO-13.2")["props"]
        if prop["name"] == "domain"
    )
    domain_prop["value"] = "cloud-services"


def remove_every_domain(catalog, profiles, mapping_collection):
    control = control_with_id(catalog, "IT.PRO-13.2")
    control["props"] = [prop for prop in control["props"] if prop["name"] != "domain"]


def add_third_control_part(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["parts"].append(
        {"name": "statement", "class": "extra", "prose": "x"}
    )


def remove_indicators_part(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["parts"].pop()


def split_action_into_two_paragraphs(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["parts"][0]["prose"] = "First.\n\nSecond."


def empty_the_action(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["parts"][0]["prose"] = ""


def drop_an_indicator_group(catalog, profiles, mapping_collection):
    indicator_groups_of(control_with_id(catalog, "IT.PRO-13.1")).pop()


def rename_an_indicator_group(catalog, profiles, mapping_collection):
    indicator_groups_of(control_with_id(catalog, "IT.PRO-13.1"))[0]["title"] = "Ineffective"


def repeat_an_indicator_group(catalog, profiles, mapping_collection):
    groups = indicator_groups_of(control_with_id(catalog, "IT.PRO-13.1"))
    groups[2]["title"] = groups[1]["title"]


def empty_an_indicator_group(catalog, profiles, mapping_collection):
    indicator_groups_of(control_with_id(catalog, "IT.PRO-13.1"))[1]["parts"] = []


def remove_indicator_prose(catalog, profiles, mapping_collection):
    del indicator_groups_of(control_with_id(catalog, "IT.PRO-13.1"))[1]["parts"][0]["prose"]


def put_a_line_break_in_an_indicator(catalog, profiles, mapping_collection):
    indicator_groups_of(control_with_id(catalog, "IT.PRO-13.1"))[0]["parts"][0]["prose"] = "a\nb"


def put_carriage_return_in_action(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["parts"][0]["prose"] = "Action text.\r"


def put_carriage_return_in_indicator(catalog, profiles, mapping_collection):
    indicator_groups_of(control_with_id(catalog, "IT.PRO-13.1"))[2]["parts"][0]["prose"] = "a\rb"


def put_carriage_return_in_principle_overview(catalog, profiles, mapping_collection):
    principle_group_with_id(catalog, "PRO-13")["parts"][0]["prose"] = "Overview.\r\nMore."


def link_to_an_unknown_resource_in_prose(catalog, profiles, mapping_collection):
    principle_group_with_id(catalog, "PRO-13")["parts"][0]["prose"] = "See [x](#no-such-resource)."


def use_another_link_relation(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["links"][0]["rel"] = "reference"


def link_to_an_unknown_technique_resource(catalog, profiles, mapping_collection):
    control_with_id(catalog, "IT.PRO-13.1")["links"][0]["href"] = "#no-such-resource"


def point_technique_at_a_page_that_is_not_a_technique(catalog, profiles, mapping_collection):
    catalog["catalog"]["back-matter"]["resources"][0]["rlinks"][0]["href"] = (
        "https://attack.mitre.org/versions/v19/tactics/TA0001/"
    )


def point_technique_at_another_site(catalog, profiles, mapping_collection):
    catalog["catalog"]["back-matter"]["resources"][0]["rlinks"][0]["href"] = (
        "https://example.invalid/versions/v19/techniques/T1078/"
    )


def remove_the_profile_of_a_catalog_domain(catalog, profiles, mapping_collection):
    profiles.remove(profile_with_domain(profiles, "boundary-services"))


def add_a_profile_for_an_unknown_domain(catalog, profiles, mapping_collection):
    extra = copy.deepcopy(profile_with_domain(profiles, "user-devices"))
    profile_property(extra, "domain")["value"] = "cloud-services"
    profiles.append(extra)


def add_a_second_profile_for_one_domain(catalog, profiles, mapping_collection):
    profiles.append(copy.deepcopy(profile_with_domain(profiles, "user-devices")))


def use_a_phase_outside_the_known_range(catalog, profiles, mapping_collection):
    profile_property(profile_with_domain(profiles, "user-devices"), "domain-priority-phase")[
        "value"
    ] = "phase-4"


def drop_a_control_from_a_profile_list(catalog, profiles, mapping_collection):
    profile_with_domain(profiles, "user-devices")["profile"]["imports"][0]["include-controls"][0][
        "with-ids"
    ].remove("IT.PRO-13.2")


def add_an_extra_control_to_a_profile_list(catalog, profiles, mapping_collection):
    profile_with_domain(profiles, "boundary-services")["profile"]["imports"][0][
        "include-controls"
    ][0]["with-ids"].append("IT.PRO-13.2")


def drop_the_profile_imports(catalog, profiles, mapping_collection):
    profile_with_domain(profiles, "user-devices")["profile"]["imports"] = []


def drop_the_profile_phase(catalog, profiles, mapping_collection):
    metadata_props = profile_with_domain(profiles, "user-devices")["profile"]["metadata"]["props"]
    metadata_props[:] = [prop for prop in metadata_props if prop["name"] != "domain-priority-phase"]


def use_an_unknown_mapping_description(catalog, profiles, mapping_collection):
    mapping_collection["mapping-collection"]["mappings"][2]["mapping-description"] = "E4EIT to X"


def use_a_relationship_of_subset_of(catalog, profiles, mapping_collection):
    mapping_collection["mapping-collection"]["mappings"][0]["maps"][0]["relationship"] = "subset-of"


def use_a_target_endpoint_type_other_than_control(catalog, profiles, mapping_collection):
    mapping_collection["mapping-collection"]["mappings"][2]["maps"][0]["targets"][0]["type"] = (
        "statement"
    )


def use_a_source_endpoint_type_other_than_control(catalog, profiles, mapping_collection):
    mapping_collection["mapping-collection"]["mappings"][2]["maps"][0]["sources"][0]["type"] = (
        "statement"
    )


def map_a_source_that_is_not_an_action(catalog, profiles, mapping_collection):
    mapping_collection["mapping-collection"]["mappings"][2]["maps"][0]["sources"][0]["id-ref"] = (
        "IT.NOPE-01.1"
    )


def map_a_pair_twice(catalog, profiles, mapping_collection):
    maps = mapping_collection["mapping-collection"]["mappings"][2]["maps"]
    maps.append(copy.deepcopy(maps[0]))


def map_with_two_targets(catalog, profiles, mapping_collection):
    maps = mapping_collection["mapping-collection"]["mappings"][2]["maps"]
    maps[0]["targets"].append({"type": "control", "id-ref": "PR.AA-09"})


FAIL_LOUDLY_CASES = {
    "function group without a title": (drop_function_group_title, "title"),
    "principle group without a title": (drop_principle_group_title, "title"),
    "control directly under a function group": (move_control_directly_under_function_group, "two"),
    "control three groups deep": (nest_principle_group_one_level_deeper, "two"),
    "principle class wrong": (change_principle_class, "essentials-principle"),
    "principle without an overview": (remove_principle_overview, "overview"),
    "principle with two overviews": (duplicate_principle_overview, "overview"),
    "principle overview without prose": (remove_principle_overview_prose, "overview"),
    "control class": (add_control_class, "class"),
    "control params": (add_control_params, "params"),
    "nested controls": (add_nested_controls, "controls"),
    "unsafe control id": (use_unsafe_control_id, "not safe"),
    "control id with a trailing newline": (use_trailing_newline_in_control_id, "not safe"),
    "lowercase colliding control ids": (add_control_whose_lowercased_id_collides, "collid"),
    "unknown control property": (add_unknown_control_property, "property"),
    "domain property in another namespace": (put_domain_property_in_another_namespace, "namespace"),
    "unknown domain": (use_unknown_domain, "cloud-services"),
    "control with no domain": (remove_every_domain, "domain"),
    "a third control part": (add_third_control_part, "part"),
    "no indicators part": (remove_indicators_part, "part"),
    "action in two paragraphs": (split_action_into_two_paragraphs, "paragraph"),
    "empty action": (empty_the_action, "prose"),
    "a missing indicator group": (drop_an_indicator_group, "indicator group"),
    "an unknown indicator group title": (rename_an_indicator_group, "indicator group"),
    "a repeated indicator group title": (repeat_an_indicator_group, "indicator group"),
    "an empty indicator group": (empty_an_indicator_group, "indicator"),
    "an indicator without prose": (remove_indicator_prose, "prose"),
    "a line break inside an indicator": (put_a_line_break_in_an_indicator, "line break"),
    "carriage return in the action": (put_carriage_return_in_action, "carriage return"),
    "carriage return in an indicator": (put_carriage_return_in_indicator, "carriage return"),
    "carriage return in a principle overview": (put_carriage_return_in_principle_overview, "carriage return"),
    "prose link to an unknown resource": (link_to_an_unknown_resource_in_prose, "unknown"),
    "another link relation": (use_another_link_relation, "rel"),
    "link to an unknown technique resource": (link_to_an_unknown_technique_resource, "unknown"),
    "technique resource that is not a technique": (
        point_technique_at_a_page_that_is_not_a_technique,
        "technique",
    ),
    "technique resource on another site": (point_technique_at_another_site, "technique"),
    "missing profile for a catalog domain": (remove_the_profile_of_a_catalog_domain, "boundary-services"),
    "profile for an unknown domain": (add_a_profile_for_an_unknown_domain, "cloud-services"),
    "two profiles for one domain": (add_a_second_profile_for_one_domain, "user-devices"),
    "phase outside phase-1 to phase-3": (use_a_phase_outside_the_known_range, "phase-4"),
    "profile list missing a control": (drop_a_control_from_a_profile_list, "IT.PRO-13.2"),
    "profile list with an extra control": (add_an_extra_control_to_a_profile_list, "IT.PRO-13.2"),
    "profile without imports": (drop_the_profile_imports, "imports"),
    "profile without a phase": (drop_the_profile_phase, "domain-priority-phase"),
}

MAPPING_FAIL_LOUDLY_CASES = {
    "unknown mapping description": (use_an_unknown_mapping_description, "E4EIT to X"),
    "relationship of subset-of": (use_a_relationship_of_subset_of, "subset-of"),
    "target endpoint of another type": (use_a_target_endpoint_type_other_than_control, "statement"),
    "source endpoint of another type": (use_a_source_endpoint_type_other_than_control, "statement"),
    "mapping source that is not an action": (map_a_source_that_is_not_an_action, "IT.NOPE-01.1"),
    "duplicate mapping pair": (map_a_pair_twice, "duplicate"),
    "map with two targets": (map_with_two_targets, "one source and one target"),
}


ALL_FAIL_LOUDLY_CASES = {**FAIL_LOUDLY_CASES, **MAPPING_FAIL_LOUDLY_CASES}


@pytest.mark.parametrize(
    ("mutation", "expected_message"),
    ALL_FAIL_LOUDLY_CASES.values(),
    ids=ALL_FAIL_LOUDLY_CASES.keys(),
)
def test_normalize_release_fails_loudly(mutation, expected_message):
    catalog, profiles, mapping_collection = load_fixture()
    mutation(catalog, profiles, mapping_collection)
    with pytest.raises(UnsupportedUpstreamData, match=expected_message):
        normalize_fixture(catalog, profiles, mapping_collection)


@pytest.mark.parametrize("case_name", MAPPING_FAIL_LOUDLY_CASES)
def test_ism_mapping_fails_loudly_on_the_same_mapping_problems(case_name):
    mutation, expected_message = MAPPING_FAIL_LOUDLY_CASES[case_name]
    catalog, profiles, mapping_collection = load_fixture()
    mutation(catalog, profiles, mapping_collection)
    with pytest.raises(UnsupportedUpstreamData, match=expected_message):
        ism_mapping(mapping_collection, ALL_ACTION_IDS, E4EIT_TAG)


def test_a_mapping_collection_without_ism_maps_has_no_release_to_name():
    _, _, mapping_collection = load_fixture()
    mappings = mapping_collection["mapping-collection"]["mappings"]
    mappings[:] = [
        mapping for mapping in mappings if "ISM" not in mapping["mapping-description"]
        and mapping["mapping-description"] != "E4EIT to E8"
    ]
    with pytest.raises(UnsupportedUpstreamData, match="ISM"):
        ism_mapping(mapping_collection, ALL_ACTION_IDS, E4EIT_TAG)


def test_a_document_without_catalog_groups_is_rejected():
    _, profiles, mapping_collection = load_fixture()
    with pytest.raises(UnsupportedUpstreamData, match="groups"):
        normalize_release({"catalog": {}}, profiles, mapping_collection, LOCK)


def test_normalize_does_not_modify_its_inputs():
    catalog, profiles, mapping_collection = load_fixture()
    snapshot = copy.deepcopy((catalog, profiles, mapping_collection))
    normalize_fixture(catalog, profiles, mapping_collection)
    assert (catalog, profiles, mapping_collection) == snapshot
