import json
import shutil
from pathlib import Path

import pytest

from tools.generate_mscp_nist_800_53_mapping import (
    LINK_NOTE,
    MAPPING_FILE_NAME,
    REPORT_FILE_NAME,
    describe_result,
    generate,
    main,
    report_path_for,
)
from tools.json_output import write_json
from tools.mappings import validate_mappings

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
COMMITTED_BASELINES_DIR = REPOSITORY_ROOT / "baselines"
COMMITTED_REPORT_PATH = REPOSITORY_ROOT / "docs" / "mappings" / REPORT_FILE_NAME
MSCP_TAG = "release_9"
NIST_TAG = "v9.9.9"
NIST_CONTROL_IDS = ["ac-2", "ac-2.1", "cm-5"]


def write_release(baselines_dir: Path, source_name: str, tag: str, rules: dict[str, dict]) -> dict:
    release_dir = baselines_dir / source_name / "releases" / tag
    (release_dir / "rules").mkdir(parents=True)
    entries = []
    for upstream_id, rule in rules.items():
        rule_file = f"rules/{upstream_id}.json"
        write_json(release_dir / rule_file, rule)
        entries.append({"id": f"{source_name}.{upstream_id}", "file": rule_file})
    write_json(release_dir / "_index.json", {"rules": entries})
    release = {"tag": tag, "index_path": f"{source_name}/releases/{tag}/_index.json"}
    return {"name": source_name, "release_tag": tag, "releases": [release]}


def mscp_rule(*citations: str, cite: bool = True) -> dict:
    nist_references = {"800-53r5": list(citations)} if cite else {"800-171r3": ["03.01.01"]}
    return {"references": {"nist": nist_references}}


def build_library(
    tmp_path: Path, mscp_rules: dict[str, dict] | None, include_nist: bool = True
) -> Path:
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    sources = []
    if mscp_rules is not None:
        sources.append(write_release(baselines_dir, "mscp", MSCP_TAG, mscp_rules))
    if include_nist:
        nist_rules = {control_id: {} for control_id in NIST_CONTROL_IDS}
        sources.append(write_release(baselines_dir, "nist_800_53", NIST_TAG, nist_rules))
    write_json(baselines_dir / "_manifest.json", {"schema_version": 6, "sources": sources})
    return baselines_dir


def read_mapping(baselines_dir: Path) -> dict:
    path = baselines_dir / "_mappings" / "rules" / MAPPING_FILE_NAME
    return json.loads(path.read_text(encoding="utf-8"))


def read_report(report_path: Path) -> dict:
    return json.loads(report_path.read_text(encoding="utf-8"))


def test_resolved_citations_become_one_link_per_rule_in_citation_order(tmp_path):
    baselines_dir = build_library(
        tmp_path, {"b_rule": mscp_rule("CM-5"), "a_rule": mscp_rule("AC-2(1)", "AC-2")}
    )

    result = generate(baselines_dir, report_path_for(baselines_dir))

    assert (result.link_count, result.pair_count) == (2, 3)
    assert read_mapping(baselines_dir)["links"] == [
        {
            "relation": "supports",
            "from": [{"kind": "rule", "id": "mscp.a_rule", "release": MSCP_TAG}],
            "to": [
                {"kind": "rule", "id": "nist_800_53.ac-2.1", "release": NIST_TAG},
                {"kind": "rule", "id": "nist_800_53.ac-2", "release": NIST_TAG},
            ],
            "note": LINK_NOTE,
        },
        {
            "relation": "supports",
            "from": [{"kind": "rule", "id": "mscp.b_rule", "release": MSCP_TAG}],
            "to": [{"kind": "rule", "id": "nist_800_53.cm-5", "release": NIST_TAG}],
            "note": LINK_NOTE,
        },
    ]


def test_link_note_wording_is_exact():
    assert LINK_NOTE == (
        "Generated from mSCP's own references: mSCP lists this 800-53 control for this rule. "
        "Not reviewed by this project."
    )


def test_mapping_header_names_the_command_both_releases_and_not_to_edit(tmp_path):
    baselines_dir = build_library(tmp_path, {"a_rule": mscp_rule("AC-2")})

    generate(baselines_dir, report_path_for(baselines_dir))

    mapping = read_mapping(baselines_dir)
    assert (mapping["schema_version"], mapping["id"]) == (1, "mscp-to-nist-800-53")
    for expected_text in (
        "python tools/generate_mscp_nist_800_53_mapping.py",
        MSCP_TAG,
        NIST_TAG,
        "do not edit by hand",
    ):
        assert expected_text in mapping["description"]


def test_rules_without_the_key_or_with_only_failed_citations_have_no_link(tmp_path):
    baselines_dir = build_library(
        tmp_path,
        {
            "no_key": mscp_rule(cite=False),
            "all_fail": mscp_rule("ZZ-9", "nonsense"),
            "empty": mscp_rule(),
            "ok": mscp_rule("AC-2"),
        },
    )

    result = generate(baselines_dir, report_path_for(baselines_dir))

    assert [link["from"][0]["id"] for link in read_mapping(baselines_dir)["links"]] == ["mscp.ok"]
    assert len(result.unresolved) == 2


def test_each_unresolved_reason_is_reported_in_the_result_and_the_file(tmp_path):
    baselines_dir = build_library(
        tmp_path,
        {
            "rule_b": mscp_rule("AC-2", "AC-2", "ac-2"),
            "rule_a": mscp_rule("ZZ-9", "AC-2"),
        },
    )
    report_path = report_path_for(baselines_dir)

    result = generate(baselines_dir, report_path)

    expected = [
        {"rule": "mscp.rule_a", "citation": "ZZ-9", "reason": "not_in_release"},
        {"rule": "mscp.rule_b", "citation": "AC-2", "reason": "duplicate_citation"},
        {"rule": "mscp.rule_b", "citation": "ac-2", "reason": "unrecognised_format"},
    ]
    assert result.unresolved == expected
    assert read_report(report_path) == {
        "schema_version": 1,
        "mscp_release": MSCP_TAG,
        "nist_800_53_release": NIST_TAG,
        "unresolved": expected,
    }


def test_a_repeated_citation_is_kept_once(tmp_path):
    baselines_dir = build_library(tmp_path, {"rule": mscp_rule("AC-2", "CM-5", "AC-2")})

    result = generate(baselines_dir, report_path_for(baselines_dir))

    (link,) = read_mapping(baselines_dir)["links"]
    assert [endpoint["id"] for endpoint in link["to"]] == ["nist_800_53.ac-2", "nist_800_53.cm-5"]
    assert [item["reason"] for item in result.unresolved] == ["duplicate_citation"]


@pytest.mark.parametrize("missing", ["mscp", "nist_800_53"])
def test_nothing_is_written_when_a_source_is_missing(tmp_path, missing, capsys):
    baselines_dir = build_library(
        tmp_path,
        None if missing == "mscp" else {"rule": mscp_rule("AC-2")},
        include_nist=missing != "nist_800_53",
    )
    report_path = report_path_for(baselines_dir)

    assert generate(baselines_dir, report_path) is None
    assert main(["--baselines-dir", str(baselines_dir)]) == 1

    assert not (baselines_dir / "_mappings").exists()
    assert not report_path.exists()
    assert "needs both" in capsys.readouterr().err


def test_two_runs_give_identical_bytes(tmp_path):
    baselines_dir = build_library(tmp_path, {"rule": mscp_rule("AC-2", "ZZ-9")})
    report_path = report_path_for(baselines_dir)
    mapping_path = baselines_dir / "_mappings" / "rules" / MAPPING_FILE_NAME

    generate(baselines_dir, report_path)
    first_bytes = (mapping_path.read_bytes(), report_path.read_bytes())
    generate(baselines_dir, report_path)

    assert (mapping_path.read_bytes(), report_path.read_bytes()) == first_bytes


def test_cli_prints_the_summary_and_warns_about_each_unresolved_citation(tmp_path, capsys):
    baselines_dir = build_library(tmp_path, {"rule": mscp_rule("AC-2", "ZZ-9")})

    assert main(["--baselines-dir", str(baselines_dir)]) == 0

    captured = capsys.readouterr()
    assert captured.out == (
        f"Wrote 1 links (1 pairs) from mSCP {MSCP_TAG} to NIST SP 800-53 {NIST_TAG}; "
        "1 citations unresolved\n"
    )
    assert "mscp.rule" in captured.err and "ZZ-9" in captured.err and "not_in_release" in captured.err


def test_committed_mapping_and_report_are_what_the_generator_produces(tmp_path):
    baselines_copy = tmp_path / "baselines"
    shutil.copytree(COMMITTED_BASELINES_DIR, baselines_copy)
    (baselines_copy / "_mappings" / "rules" / MAPPING_FILE_NAME).unlink()
    report_copy = tmp_path / "report.json"

    generate(baselines_copy, report_copy)

    committed_mapping_path = COMMITTED_BASELINES_DIR / "_mappings" / "rules" / MAPPING_FILE_NAME
    regenerated_mapping_path = baselines_copy / "_mappings" / "rules" / MAPPING_FILE_NAME
    assert regenerated_mapping_path.read_bytes() == committed_mapping_path.read_bytes()
    assert report_copy.read_bytes() == COMMITTED_REPORT_PATH.read_bytes()


def test_committed_mapping_has_the_expected_size_and_validates():
    mappings_dir = COMMITTED_BASELINES_DIR / "_mappings" / "rules"
    links = json.loads((mappings_dir / MAPPING_FILE_NAME).read_text(encoding="utf-8"))["links"]
    assert len(links) == 290
    assert sum(len(link["to"]) for link in links) == 678
    assert read_report(COMMITTED_REPORT_PATH)["unresolved"] == []

    errors, warnings = validate_mappings(mappings_dir, COMMITTED_BASELINES_DIR)

    assert errors == []
    assert [warning for warning in warnings if MAPPING_FILE_NAME in warning] == []


def test_describe_result_wording(tmp_path):
    baselines_dir = build_library(tmp_path, {"rule": mscp_rule("AC-2")})
    result = generate(baselines_dir, report_path_for(baselines_dir))
    assert describe_result(result).startswith("Wrote 1 links (1 pairs) from mSCP release_9")
