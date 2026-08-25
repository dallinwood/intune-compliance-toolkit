import copy

import jsonschema
import pytest

from tools.validate_specs import load_schema, schema_errors

MINIMAL_VALID_SPEC = {
    "mechanism": {
        "type": "registry_value",
        "identifier": "HKLM:\\SOFTWARE\\Example\\Setting",
        "data_type": "integer",
        "secure_value": 1,
        "current_default": 0,
        "value_source": "rule_defined",
    },
    "platform": "windows_11",
    "applicability_tags": ["enterprise"],
    "rationale_tags": ["reduces_attack_surface"],
    "description_intent": "Plain-English statement of what the control requires, written independently of any source framework's own wording.",
    "rationale_intent": "Plain-English statement of the underlying security concern, written independently.",
    "framework_mapping_refs": [
        {
            "framework": "example",
            "framework_product": "windows_11",
            "control_id": "1.1",
            "framework_version": "1.0.0",
            "framework_level": ["Level 1"],
            "checked_date": "2026-08-20",
        }
    ],
    "control_surface": "device_config_profile",
    "management_channels": ["intune_settings_catalog"],
}


@pytest.fixture(scope="module")
def validator():
    return jsonschema.Draft202012Validator(load_schema())


def test_minimal_valid_spec_matches_schema(validator):
    assert schema_errors(MINIMAL_VALID_SPEC, validator) == []


def test_schema_file_is_itself_valid():
    jsonschema.Draft202012Validator.check_schema(load_schema())


def test_organization_defined_value_source_allows_null_secure_value(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["mechanism"]["value_source"] = "organization_defined"
    spec["mechanism"]["secure_value"] = None

    assert schema_errors(spec, validator) == []


def test_organization_defined_value_source_requires_null_secure_value(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["mechanism"]["value_source"] = "organization_defined"
    spec["mechanism"]["secure_value"] = 1

    assert schema_errors(spec, validator) != []


def test_rationale_tags_must_be_from_the_fixed_vocabulary(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["rationale_tags"] = ["made_up_tag_not_in_vocabulary"]

    assert schema_errors(spec, validator) != []


def test_rationale_tags_requires_at_least_one_entry(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["rationale_tags"] = []

    assert schema_errors(spec, validator) != []


def test_framework_mapping_refs_requires_at_least_one_entry(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["framework_mapping_refs"] = []

    assert schema_errors(spec, validator) != []


def test_no_free_text_field_beyond_the_two_intent_fields(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["notes"] = "a free-text field that must not be allowed to exist"

    assert schema_errors(spec, validator) != []


def test_control_surface_must_be_from_the_fixed_enum(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["control_surface"] = "made_up_surface"

    assert schema_errors(spec, validator) != []


def test_control_surface_is_required(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    del spec["control_surface"]

    assert schema_errors(spec, validator) != []


def test_management_channels_is_required(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    del spec["management_channels"]

    assert schema_errors(spec, validator) != []


def test_framework_product_is_required(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    del spec["framework_mapping_refs"][0]["framework_product"]

    assert schema_errors(spec, validator) != []


def test_framework_product_accepts_null(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["framework_mapping_refs"][0]["framework_product"] = None

    assert schema_errors(spec, validator) == []
