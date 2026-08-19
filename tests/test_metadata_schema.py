import copy
import json
from pathlib import Path

import jsonschema
import pytest

from tools.validate_metadata import find_metadata_files, load_schema, schema_errors

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINES_DIR = REPO_ROOT / "baselines"

MINIMAL_VALID_METADATA = {
    "schemaVersion": 1,
    "benchmark": {"name": "Test Benchmark", "version": "1.0.0", "release_date": "25-06-2026"},
    "sections": [
        {"id": "1", "title": "Above Lock", "description": "This section contains recommendations for Above Lock."},
        {"id": "1.1", "title": "Subsection", "description": None},
    ],
}


@pytest.fixture(scope="module")
def validator():
    return jsonschema.Draft202012Validator(load_schema())


def test_minimal_valid_metadata_matches_schema(validator):
    assert schema_errors(MINIMAL_VALID_METADATA, validator) == []


def test_schema_file_is_itself_valid():
    jsonschema.Draft202012Validator.check_schema(load_schema())


def test_release_date_must_be_dd_mm_yyyy_or_null(validator):
    metadata = copy.deepcopy(MINIMAL_VALID_METADATA)
    metadata["benchmark"]["release_date"] = "2026-06-25"

    assert schema_errors(metadata, validator) != []


def test_release_date_null_is_allowed(validator):
    metadata = copy.deepcopy(MINIMAL_VALID_METADATA)
    metadata["benchmark"]["release_date"] = None

    assert schema_errors(metadata, validator) == []


def test_unknown_top_level_field_is_rejected(validator):
    metadata = copy.deepcopy(MINIMAL_VALID_METADATA)
    metadata["extra"] = "nope"

    assert schema_errors(metadata, validator) != []


def test_section_description_may_be_null(validator):
    metadata = copy.deepcopy(MINIMAL_VALID_METADATA)
    metadata["sections"][0]["description"] = None

    assert schema_errors(metadata, validator) == []


@pytest.mark.parametrize("metadata_path", find_metadata_files(BASELINES_DIR), ids=lambda p: str(p))
def test_baseline_metadata_matches_schema(metadata_path, validator):
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

    assert schema_errors(metadata, validator) == []
