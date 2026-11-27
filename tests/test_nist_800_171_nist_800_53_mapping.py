import json
import shutil
from pathlib import Path

import pytest

from tools.generate_nist_800_171_nist_800_53_mapping import (
    LINK_NOTE,
    MAPPING_FILE_NAME,
    REPORT_FILE_NAME,
    generate,
    main,
    report_path_for,
)
from tools.json_output import write_json
from tools.mappings import validate_mappings
from tools.nist_800_53_normalize import control_id_for_zero_padded_label

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
COMMITTED_BASELINES_DIR = REPOSITORY_ROOT / "baselines"
COMMITTED_REPORT_PATH = REPOSITORY_ROOT / "docs" / "mappings" / REPORT_FILE_NAME
NIST_800_171_TAG = "v9.1.1"
NIST_800_53_TAG = "v9.5.3"
NIST_800_53_CONTROL_IDS = ["ac-2", "ac-2.3", "ac-7", "cm-5"]


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("AC-02", "ac-2"),
        ("AC-02(03)", "ac-2.3"),
        ("SR-11(12)", "sr-11.12"),
        ("AC-2", None),
        ("AC-02(3)", None),
        ("AC-002", None),
        ("ac-02", None),
        ("AC-02 (03)", None),
    ],
)
def test_control_id_for_zero_padded_label_accepts_only_nists_padded_form(label, expected):
    assert control_id_for_zero_padded_label(label) == expected


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


def requirement(*source_controls: str) -> dict:
    return {"references": {"source_controls": list(source_controls), "publications": ["SP 800-63-3"]}}


def build_library(tmp_path: Path, requirements: dict[str, dict], include_800_53: bool = True) -> Path:
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    sources = [write_release(baselines_dir, "nist_800_171", NIST_800_171_TAG, requirements)]
    if include_800_53:
        controls = {control_id: {} for control_id in NIST_800_53_CONTROL_IDS}
        sources.append(write_release(baselines_dir, "nist_800_53", NIST_800_53_TAG, controls))
    write_json(baselines_dir / "_manifest.json", {"schema_version": 7, "sources": sources})
    return baselines_dir


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_source_controls_become_one_related_link_per_requirement(tmp_path):
    baselines_dir = build_library(
        tmp_path,
        {"03.01.08": requirement("AC-07"), "03.01.01": requirement("AC-02", "AC-02(03)"), "03.02.01": requirement()},
    )

    result = generate(baselines_dir, report_path_for(baselines_dir))

    assert (result.link_count, result.pair_count, result.unresolved) == (2, 3, [])
    assert read_json(baselines_dir / "_mappings" / "rules" / MAPPING_FILE_NAME)["links"] == [
        {
            "relation": "related",
            "from": [{"kind": "rule", "id": "nist_800_171.03.01.01", "release": NIST_800_171_TAG}],
            "to": [
                {"kind": "rule", "id": "nist_800_53.ac-2", "release": NIST_800_53_TAG},
                {"kind": "rule", "id": "nist_800_53.ac-2.3", "release": NIST_800_53_TAG},
            ],
            "note": LINK_NOTE,
        },
        {
            "relation": "related",
            "from": [{"kind": "rule", "id": "nist_800_171.03.01.08", "release": NIST_800_171_TAG}],
            "to": [{"kind": "rule", "id": "nist_800_53.ac-7", "release": NIST_800_53_TAG}],
            "note": LINK_NOTE,
        },
    ]


def test_unlinkable_source_controls_are_reported(tmp_path):
    baselines_dir = build_library(tmp_path, {"03.01.01": requirement("AC-02", "ZZ-01", "AC-2", "AC-02")})
    report_path = report_path_for(baselines_dir)

    result = generate(baselines_dir, report_path)

    assert read_json(report_path) == {
        "schema_version": 1,
        "nist_800_171_release": NIST_800_171_TAG,
        "nist_800_53_release": NIST_800_53_TAG,
        "unresolved": [
            {"rule": "nist_800_171.03.01.01", "citation": "AC-02", "reason": "duplicate_citation"},
            {"rule": "nist_800_171.03.01.01", "citation": "AC-2", "reason": "unrecognised_format"},
            {"rule": "nist_800_171.03.01.01", "citation": "ZZ-01", "reason": "not_in_release"},
        ],
    }
    assert result.pair_count == 1


def test_note_and_header_say_where_the_links_come_from(tmp_path):
    assert LINK_NOTE == (
        "Generated from NIST's catalog: NIST lists these SP 800-53 controls (as published in 800-53 5.1.1) "
        "as the source controls of this requirement. Not reviewed by this project."
    )
    baselines_dir = build_library(tmp_path, {"03.01.08": requirement("AC-07")})

    generate(baselines_dir, report_path_for(baselines_dir))

    mapping = read_json(baselines_dir / "_mappings" / "rules" / MAPPING_FILE_NAME)
    assert (mapping["id"], mapping["generated_by"]) == (
        "nist-800-171-to-nist-800-53",
        "python tools/generate_nist_800_171_nist_800_53_mapping.py",
    )
    assert mapping["description"] == (
        "NIST SP 800-171 requirements linked to the NIST SP 800-53 controls NIST lists as their source controls. "
        "Generated by `python tools/generate_nist_800_171_nist_800_53_mapping.py` from NIST SP 800-171 "
        f"{NIST_800_171_TAG} and NIST SP 800-53 {NIST_800_53_TAG}; do not edit by hand."
    )


def test_nothing_is_written_without_800_53(tmp_path, capsys):
    baselines_dir = build_library(tmp_path, {"03.01.08": requirement("AC-07")}, include_800_53=False)

    assert main(["--baselines-dir", str(baselines_dir)]) == 1
    assert not (baselines_dir / "_mappings").exists()
    assert "needs both 'nist_800_171' and 'nist_800_53'" in capsys.readouterr().err


def test_cli_summary(tmp_path, capsys):
    baselines_dir = build_library(tmp_path, {"03.01.08": requirement("AC-07")})

    assert main(["--baselines-dir", str(baselines_dir)]) == 0
    assert capsys.readouterr().out == (
        f"Wrote 1 links (1 pairs) from NIST SP 800-171 {NIST_800_171_TAG} to NIST SP 800-53 "
        f"{NIST_800_53_TAG}; 0 citations unresolved\n"
    )


def test_committed_mapping_and_report_are_what_the_generator_produces(tmp_path):
    baselines_copy = tmp_path / "baselines"
    shutil.copytree(COMMITTED_BASELINES_DIR, baselines_copy)
    (baselines_copy / "_mappings" / "rules" / MAPPING_FILE_NAME).unlink()
    report_copy = tmp_path / "report.json"

    generate(baselines_copy, report_copy)

    committed_mapping = COMMITTED_BASELINES_DIR / "_mappings" / "rules" / MAPPING_FILE_NAME
    assert (baselines_copy / "_mappings" / "rules" / MAPPING_FILE_NAME).read_bytes() == committed_mapping.read_bytes()
    assert report_copy.read_bytes() == COMMITTED_REPORT_PATH.read_bytes()


def test_committed_mapping_has_the_expected_size_and_validates():
    mappings_dir = COMMITTED_BASELINES_DIR / "_mappings" / "rules"
    links = read_json(mappings_dir / MAPPING_FILE_NAME)["links"]
    assert len(links) == 97
    assert sum(len(link["to"]) for link in links) == 157
    assert read_json(COMMITTED_REPORT_PATH)["unresolved"] == []

    errors, warnings = validate_mappings(mappings_dir, COMMITTED_BASELINES_DIR)

    assert errors == []
    assert [warning for warning in warnings if MAPPING_FILE_NAME in warning] == []
