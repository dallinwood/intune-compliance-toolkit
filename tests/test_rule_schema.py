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
)

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINES_DIR = REPO_ROOT / "baselines"
EXAMPLES_DIR = REPO_ROOT / ".claude" / "skills" / "compliance-benchmark-json" / "references" / "examples"

MINIMAL_VALID_RULE = {
    "id": "1.1",
    "title": "Ensure Something",
    "assessment_status": "Automated",
    "benchmark": {"product": "Test Benchmark", "version": "1.0.0", "platform": "Test"},
    "profile_applicability": ["Level 1"],
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
                        "original_command": None,
                        "check_command": "test_1_1_status=1",
                        "check_command_verified": True,
                        "output_description": "...",
                        "output_check": [
                            {
                                "variable": "test_1_1_status",
                                "data_type": "integer",
                                "operator": "eq",
                                "value": 1,
                                "value_source": "benchmark",
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
