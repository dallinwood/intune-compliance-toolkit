import copy
import json
from pathlib import Path

import pytest

from tools.generate_index import find_rule_folders
from tools.generate_manifest import BASELINES_DIR, MANIFEST_PATH, build_manifest, write_manifest

MINIMAL_RULE = {
    "id": "1.1",
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
        "platforms": ["Test Platform"],
        "management_channels": ["intune_settings_catalog"],
    },
    "recommended_state": "Disabled",
    "description": "prose",
    "rationale": "prose",
    "impact": "prose",
    "audit": {
        "methods": [
            {
                "method_name": "Terminal Method",
                "type": "scripted",
                "description": "...",
                "steps": [
                    {
                        "step_role": "compliance_check",
                        "check_command": "$test_rule_a_status = 1",
                        "check_command_verified": True,
                        "output_description": "...",
                        "output_check": [
                            {
                                "variable": "test_rule_a_status",
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


def write_rule(path, rule_id, filename, platform="Test Platform"):
    rule = copy.deepcopy(MINIMAL_RULE)
    rule["id"] = rule_id
    rule["policy_classification"]["platforms"] = [platform]
    (path / filename).write_text(json.dumps(rule), encoding="utf-8")


def test_build_manifest_lists_family_product_version_platform_and_count(tmp_path):
    folder = tmp_path / "cis" / "macos_26_tahoe" / "v1.1.0"
    folder.mkdir(parents=True)
    write_rule(folder, "1.1", "rule_a.json", platform="macOS")
    write_rule(folder, "1.2", "rule_b.json", platform="macOS")

    folders = find_rule_folders(tmp_path)
    manifest = build_manifest(folders, baselines_root=tmp_path)

    assert manifest["schemaVersion"] == 1
    assert manifest["baselines"] == [
        {
            "family": "cis",
            "product": "macos_26_tahoe",
            "version": "v1.1.0",
            "platform": "macOS",
            "indexPath": "cis/macos_26_tahoe/v1.1.0/_index.json",
            "metadataPath": None,
            "ruleCount": 2,
        }
    ]


def test_build_manifest_includes_metadata_path_when_metadata_json_exists(tmp_path):
    folder = tmp_path / "cis" / "macos_26_tahoe" / "v1.1.0"
    folder.mkdir(parents=True)
    write_rule(folder, "1.1", "rule_a.json", platform="macOS")
    (folder / "_metadata.json").write_text("{}", encoding="utf-8")

    folders = find_rule_folders(tmp_path)
    manifest = build_manifest(folders, baselines_root=tmp_path)

    assert manifest["baselines"][0]["metadataPath"] == "cis/macos_26_tahoe/v1.1.0/_metadata.json"


def test_build_manifest_is_sorted_by_family_product_version(tmp_path):
    windows_folder = tmp_path / "cis" / "windows_11" / "v5.0.0"
    windows_folder.mkdir(parents=True)
    write_rule(windows_folder, "1.1", "rule_a.json", platform="Windows 11 (Intune)")

    macos_folder = tmp_path / "cis" / "macos_26_tahoe" / "v1.1.0"
    macos_folder.mkdir(parents=True)
    write_rule(macos_folder, "1.1", "rule_a.json", platform="macOS")

    folders = find_rule_folders(tmp_path)
    manifest = build_manifest(folders, baselines_root=tmp_path)

    assert [entry["product"] for entry in manifest["baselines"]] == ["macos_26_tahoe", "windows_11"]


def test_build_manifest_rejects_folder_not_exactly_family_product_version(tmp_path):
    too_shallow = tmp_path / "cis" / "v1.1.0"
    too_shallow.mkdir(parents=True)
    write_rule(too_shallow, "1.1", "rule_a.json")

    folders = find_rule_folders(tmp_path)

    with pytest.raises(ValueError, match="family/product/version"):
        build_manifest(folders, baselines_root=tmp_path)


def test_write_manifest_is_deterministic(tmp_path):
    folder = tmp_path / "cis" / "macos_26_tahoe" / "v1.1.0"
    folder.mkdir(parents=True)
    write_rule(folder, "1.1", "rule_a.json", platform="macOS")
    manifest_path = tmp_path / "_manifest.json"

    folders = find_rule_folders(tmp_path)
    first_pass = write_manifest(folders, baselines_root=tmp_path, manifest_path=manifest_path).read_text(
        encoding="utf-8"
    )
    second_pass = write_manifest(folders, baselines_root=tmp_path, manifest_path=manifest_path).read_text(
        encoding="utf-8"
    )

    assert first_pass == second_pass


def test_write_manifest_handles_zero_folders(tmp_path):
    manifest_path = tmp_path / "_manifest.json"

    written_path = write_manifest({}, baselines_root=tmp_path, manifest_path=manifest_path)

    assert json.loads(written_path.read_text(encoding="utf-8")) == {"schemaVersion": 1, "baselines": []}


def test_committed_manifest_matches_repo_baselines():
    """Catches a benchmark folder added/removed without re-running generate_manifest.py."""
    folders = find_rule_folders(BASELINES_DIR)
    rebuilt = json.dumps(build_manifest(folders, baselines_root=BASELINES_DIR), indent=2) + "\n"
    committed = MANIFEST_PATH.read_text(encoding="utf-8")

    assert committed == rebuilt
