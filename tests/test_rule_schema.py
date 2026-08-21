import copy
import json
from pathlib import Path

import jsonschema
import pytest

from tools.validate_rules import (
    convention_errors,
    file_slug,
    find_rule_files,
    load_schema,
    schema_errors,
    validate_rule_file,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINES_DIR = REPO_ROOT / "baselines"
EXAMPLES_DIR = REPO_ROOT / ".claude" / "skills" / "compliance-benchmark-json" / "references" / "examples"

MINIMAL_VALID_RULE = {
    "id": "12",
    "title": "Ensure Something",
    "assessment_status": "Automated",
    "authoring_mode": "independent",
    "framework_mappings": [
        {
            "framework": "example",
            "framework_product": "example_product",
            "framework_version": "1.0.0",
            "control_id": "1.1",
            "framework_level": ["Level 1"],
            "checked_date": "2026-08-20",
        }
    ],
    "policy_classification": {
        "control_surface": "device_config_profile",
        "platforms": ["windows_11"],
        "management_channels": ["intune_settings_catalog"],
    },
    "recommended_state": "Disabled",
    "description": "...",
    "rationale": "...",
    "impact": "...",
    "audit": {
        "methods": [
            {
                "method_name": "Terminal Method",
                "type": "scripted",
                "description": "...",
                "steps": [
                    {
                        "step_role": "compliance_check",
                        "check_command": "test_12_status=1",
                        "check_command_verified": True,
                        "output_description": "...",
                        "output_check": [
                            {
                                "variable": "test_12_status",
                                "data_type": "integer",
                                "operator": "eq",
                                "value": 1,
                                "value_source": "rule_defined",
                            }
                        ],
                    }
                ],
            }
        ]
    },
    "remediation": {"methods": [{"method_name": "x", "type": "manual_steps", "description": "..."}]},
    "default_value": None,
    "references": [],
    "additional_information": None,
}


@pytest.fixture(scope="module")
def validator():
    return jsonschema.Draft202012Validator(load_schema())


def test_minimal_valid_rule_matches_schema(validator):
    assert schema_errors(MINIMAL_VALID_RULE, validator) == []


def test_organization_defined_value_source_requires_null_value(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    output_check = rule["audit"]["methods"][0]["steps"][0]["output_check"][0]
    output_check["value_source"] = "organization_defined"
    output_check["value"] = 5

    assert schema_errors(rule, validator) != []


def test_lookup_step_requires_empty_output_check(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["audit"]["methods"][0]["steps"][0]["step_role"] = "lookup"

    assert schema_errors(rule, validator) != []


def test_manual_method_forbids_steps(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["audit"]["methods"][0]["type"] = "manual"

    assert schema_errors(rule, validator) != []


def test_schema_file_is_itself_valid():
    jsonschema.Draft202012Validator.check_schema(load_schema())


def test_framework_mappings_requires_at_least_one_entry(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["framework_mappings"] = []

    assert schema_errors(rule, validator) != []


def test_licensed_adaptation_requires_source_license(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["authoring_mode"] = "licensed_adaptation"

    assert schema_errors(rule, validator) != []


def test_licensed_adaptation_with_source_license_is_valid(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["authoring_mode"] = "licensed_adaptation"
    rule["source_license"] = {
        "framework": "example",
        "license_name": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "rights_holder": "Example Rights Holder",
        "source_url": "https://example.invalid/source",
        "retrieved_date": "2026-08-20",
        "modified": True,
    }

    assert schema_errors(rule, validator) == []


def test_independent_mode_forbids_source_license(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["source_license"] = {
        "framework": "example",
        "license_name": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "rights_holder": "Example Rights Holder",
        "source_url": "https://example.invalid/source",
        "retrieved_date": "2026-08-20",
        "modified": True,
    }

    assert schema_errors(rule, validator) != []


def test_framework_level_accepts_multiple_cumulative_levels(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["framework_mappings"][0]["framework_level"] = ["Maturity Level 1", "Maturity Level 2"]

    assert schema_errors(rule, validator) == []


def test_id_rejects_a_framework_shaped_value(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["id"] = "4.11.15.3.1"  # a framework's own dotted numbering, not a toolkit id

    assert schema_errors(rule, validator) != []


def test_id_accepts_a_plain_toolkit_assigned_integer(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["id"] = "347"

    assert schema_errors(rule, validator) == []


def test_audit_step_has_no_original_command_field(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["audit"]["methods"][0]["steps"][0]["original_command"] = None

    assert schema_errors(rule, validator) != []


def test_a_rule_named_by_the_file_naming_convention_passes_every_check(tmp_path, validator):
    """End-to-end proof that the file-naming convention and the variable-naming
    convention are mutually satisfiable.

    Both derive from the same filename, and a mismatch between them is
    invisible to every other test here: the schema never sees a filename, and
    the parametrized baseline tests collect nothing while baselines/ holds no
    rules. An earlier `<id>_<title-slug>.json` convention was in fact
    unsatisfiable - the derived variable prefix started with the id's digit
    and kept the title slug's hyphens, neither of which is legal in a
    PowerShell or bash identifier.
    """
    rule_path = tmp_path / "rule_12_ensure-example-setting-is-configured.json"
    variable = f"{file_slug(rule_path)}_status"
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    step = rule["audit"]["methods"][0]["steps"][0]
    step["check_command"] = f"${variable} = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Example' -Name 'Status').Status"
    step["output_check"][0]["variable"] = variable
    rule_path.write_text(json.dumps(rule), encoding="utf-8")

    assert validate_rule_file(rule_path, validator) == []


@pytest.mark.parametrize("rule_path", find_rule_files(BASELINES_DIR), ids=lambda p: p.name)
def test_baseline_rule_matches_schema(rule_path, validator):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))

    assert schema_errors(rule, validator) == []


@pytest.mark.parametrize("rule_path", find_rule_files(BASELINES_DIR), ids=lambda p: p.name)
def test_baseline_rule_follows_variable_conventions(rule_path):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))

    assert convention_errors(rule, file_slug(rule_path)) == []


@pytest.mark.parametrize("example_path", sorted(EXAMPLES_DIR.glob("*.json")), ids=lambda p: p.name)
def test_bundled_example_matches_schema(example_path, validator):
    rule = json.loads(example_path.read_text(encoding="utf-8"))

    assert schema_errors(rule, validator) == []
