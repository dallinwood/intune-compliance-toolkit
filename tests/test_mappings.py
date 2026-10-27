import json
import warnings
from pathlib import Path

import pytest

from tools import mappings
from tools.mappings import MappingWarning, expanded_pairs, load_mappings, validate_mappings

# A stale release is a warning by design; without this, `python -m pytest -W
# error` would turn it into a failure. A mark outranks the command-line -W,
# an ini or conftest filter does not.
pytestmark = pytest.mark.filterwarnings("default::tools.mappings.MappingWarning")

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINES_DIR = REPO_ROOT / "baselines"
MAPPINGS_DIR = BASELINES_DIR / "_mappings" / "rules"
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures" / "mappings"
INVALID_CASES = sorted(path for path in (FIXTURES_DIR / "invalid").iterdir() if path.is_dir())

GATEKEEPER = "mscp.os_gatekeeper_enable"
DICTATION = "mscp.os_dictation_disable"
ISM_1622 = "asd_ism.ism-1622"
# The fixtures are checked against whatever release the library is at, so a
# re-import does not break them; the stale samples use releases that are
# deliberately old.
CURRENT_RELEASES = {
    source["name"]: source["release_tag"]
    for source in json.loads((BASELINES_DIR / "_manifest.json").read_text(encoding="utf-8"))["sources"]
}
ISM_RELEASE = CURRENT_RELEASES["asd_ism"]
MSCP_RELEASE = CURRENT_RELEASES["mscp"]
STALE_MSCP_RELEASE = "release_0.0"

# The message each invalid case must produce, so a case cannot pass by
# failing for an unrelated reason.
EXPECTED_ERROR_BY_CASE = {
    "unknown-top-level-key": "unexpected key(s): owner",
    "unknown-link-key": "unexpected key(s): weight",
    "unknown-endpoint-key": "unexpected key(s): title",
    "bad-id": "id must match",
    "duplicate-id": "id 'same' is already used by a.json",
    "empty-from": "from must be a non-empty list",
    "empty-to": "to must be a non-empty list",
    "empty-links": "links must be a non-empty list",
    "unknown-relation": "unknown relation 'supersedes'",
    "unknown-kind": "unknown kind 'benchmark'",
    "unknown-kind-not-string": "unknown kind []",
    "endpoint-without-release": "missing key(s): release",
    "missing-rule": "rule asd_ism.ism-0000 does not exist in the committed library",
    "self-link": f"rule {ISM_1622} is linked to itself",
    "duplicate-pair-in-one-list": "is already defined by a.json links[0]",
    "duplicate-pair-across-files": "is already defined by a.json links[0]",
    "two-relations": "is already linked as implements",
    "both-directions": "is already linked in the other direction",
    "related-twice-reversed": "is already defined by a.json links[0]",
    "note-not-string": "note must be a string or null",
    "wrong-schema-version": "schema_version must be 1",
    "not-json": "cannot read JSON",
}


def rule_endpoint(rule_id: str, release: str) -> dict:
    return {"kind": "rule", "id": rule_id, "release": release}


def copy_with_current_releases(source_dir: Path, destination_dir: Path) -> Path:
    """Copy each mapping file, setting every endpoint's release to its source's current release."""
    destination_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(source_dir.glob("*.json")):
        mapping = json.loads(path.read_text(encoding="utf-8"))
        for link in mapping["links"]:
            for endpoint in [*link["from"], *link["to"]]:
                endpoint["release"] = CURRENT_RELEASES[endpoint["id"].split(".", 1)[0]]
        (destination_dir / path.name).write_bytes((json.dumps(mapping, indent=2) + "\n").encode("utf-8"))
    return destination_dir


def write_bytes(directory: Path, file_name: str, content: bytes) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / file_name).write_bytes(content)


def simple_mapping(mapping_id: str) -> dict:
    return {
        "schema_version": 1,
        "id": mapping_id,
        "links": [
            {
                "relation": "related",
                "from": [rule_endpoint(GATEKEEPER, MSCP_RELEASE)],
                "to": [rule_endpoint(ISM_1622, ISM_RELEASE)],
            }
        ],
    }


def test_committed_mappings_are_valid():
    errors, mapping_warnings = validate_mappings(MAPPINGS_DIR, BASELINES_DIR)
    for message in mapping_warnings:
        warnings.warn(message, MappingWarning)
    assert errors == []


def test_committed_mappings_folder_exists_for_maintainers():
    assert (MAPPINGS_DIR / ".gitkeep").is_file()


def test_valid_samples_have_no_errors_or_warnings(tmp_path):
    valid_dir = copy_with_current_releases(FIXTURES_DIR / "valid", tmp_path / "valid")
    assert sorted(path.name for path in valid_dir.iterdir()) == sorted(path.name for path in (FIXTURES_DIR / "valid").iterdir())
    assert validate_mappings(valid_dir, BASELINES_DIR) == ([], [])


def test_every_invalid_case_has_an_expected_message():
    assert sorted(EXPECTED_ERROR_BY_CASE) == [case.name for case in INVALID_CASES]


@pytest.mark.parametrize("case", INVALID_CASES, ids=lambda path: path.name)
def test_invalid_case_is_an_error_with_its_own_message(case):
    errors, _ = validate_mappings(case, BASELINES_DIR)

    assert errors != []
    assert any(EXPECTED_ERROR_BY_CASE[case.name] in error for error in errors), errors
    file_names = [path.name for path in case.iterdir()]
    assert all(any(file_name in error for file_name in file_names) for error in errors)


def test_a_release_other_than_the_library_release_is_a_warning_not_an_error():
    errors, mapping_warnings = validate_mappings(FIXTURES_DIR / "stale", BASELINES_DIR)

    assert errors == []
    assert len(mapping_warnings) == 1
    assert "older-release.json" in mapping_warnings[0]
    assert GATEKEEPER in mapping_warnings[0]
    assert STALE_MSCP_RELEASE in mapping_warnings[0] and MSCP_RELEASE in mapping_warnings[0]


def test_mapping_warnings_are_reported_without_failing_under_warnings_as_errors():
    _, mapping_warnings = validate_mappings(FIXTURES_DIR / "stale", BASELINES_DIR)

    with pytest.warns(MappingWarning):
        for message in mapping_warnings:
            warnings.warn(message, MappingWarning)


def test_a_link_expands_to_every_from_and_to_pair():
    mapping = {
        "links": [
            {
                "relation": "implements",
                "from": [rule_endpoint("mscp.a", "r"), rule_endpoint("mscp.b", "r"), rule_endpoint("mscp.c", "r")],
                "to": [rule_endpoint("asd_ism.x", "v"), rule_endpoint("asd_ism.y", "v")],
                "note": "Shared note.",
            }
        ]
    }

    pairs = expanded_pairs(mapping)

    assert [(pair["from"]["id"], pair["to"]["id"]) for pair in pairs] == [
        ("mscp.a", "asd_ism.x"),
        ("mscp.a", "asd_ism.y"),
        ("mscp.b", "asd_ism.x"),
        ("mscp.b", "asd_ism.y"),
        ("mscp.c", "asd_ism.x"),
        ("mscp.c", "asd_ism.y"),
    ]
    assert all(pair["relation"] == "implements" and pair["note"] == "Shared note." for pair in pairs)


def test_missing_or_empty_mapping_folder_is_valid(tmp_path):
    assert validate_mappings(tmp_path / "missing", BASELINES_DIR) == ([], [])
    assert validate_mappings(tmp_path, BASELINES_DIR) == ([], [])


def test_load_mappings_reads_json_files_in_file_name_order_skipping_hidden_files(tmp_path):
    write_bytes(tmp_path, "b.json", json.dumps(simple_mapping("b")).encode("utf-8"))
    write_bytes(tmp_path, "a.json", json.dumps(simple_mapping("a")).encode("utf-8"))
    write_bytes(tmp_path, ".gitkeep", b"")
    write_bytes(tmp_path, ".hidden.json", json.dumps(simple_mapping("hidden")).encode("utf-8"))
    write_bytes(tmp_path, "notes.txt", b"not a mapping\n")

    loaded = load_mappings(tmp_path)

    assert [entry["file_name"] for entry in loaded] == ["a.json", "b.json"]
    assert loaded[0]["mapping"]["id"] == "a"


# These two are written here rather than committed as fixtures: git's
# line-ending conversion could rewrite a committed CRLF sample.
def test_a_crlf_file_is_an_error(tmp_path):
    content = json.dumps(simple_mapping("crlf"), indent=2).replace("\n", "\r\n").encode("utf-8")
    write_bytes(tmp_path, "crlf.json", content)

    errors, _ = validate_mappings(tmp_path, BASELINES_DIR)

    assert errors == ["crlf.json: the file must use LF line endings, not CRLF"]


def test_a_file_that_is_not_utf8_is_an_error(tmp_path):
    mapping = simple_mapping("latin")
    mapping["description"] = "Café"
    write_bytes(tmp_path, "latin.json", json.dumps(mapping, ensure_ascii=False).encode("latin-1"))

    errors, _ = validate_mappings(tmp_path, BASELINES_DIR)

    assert errors == ["latin.json: the file is not UTF-8"]


def test_a_file_name_outside_the_safe_segment_rule_is_an_error(tmp_path):
    write_bytes(tmp_path, "has space.json", json.dumps(simple_mapping("space")).encode("utf-8"))

    errors, _ = validate_mappings(tmp_path, BASELINES_DIR)

    assert len(errors) == 1
    assert errors[0].startswith("has space.json: the file name")


def test_main_returns_one_on_errors_and_zero_otherwise(tmp_path, capsys):
    valid_dir = copy_with_current_releases(FIXTURES_DIR / "valid", tmp_path / "valid")
    assert mappings.main([str(valid_dir), str(BASELINES_DIR)]) == 0
    assert capsys.readouterr().err == ""
    assert mappings.main([str(FIXTURES_DIR / "stale"), str(BASELINES_DIR)]) == 0
    assert "warning:" in capsys.readouterr().err
    assert mappings.main([str(FIXTURES_DIR / "invalid" / "self-link"), str(BASELINES_DIR)]) == 1
    assert "error:" in capsys.readouterr().err
