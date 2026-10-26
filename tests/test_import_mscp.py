import json
import shutil
import urllib.error
from pathlib import Path

import pytest

from tools import import_mscp
from tools.source_lock import SourceLock, write_source_lock
from tools.validate_library import validate_library

FIXTURE_UPSTREAM = Path(__file__).parent / "fixtures" / "mscp_upstream"
COMMIT_SHA = "c" * 40
LOCK = SourceLock(
    tag="release_27.0",
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-10-20",
    repository_url="https://github.com/usnistgov/macos_security",
)


OTHER_LOCK = SourceLock(
    tag="release_28.0",
    commit_sha="e" * 40,
    retrieved_date="2026-11-01",
    repository_url="https://github.com/usnistgov/macos_security",
)


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def populate_sources(sources_dir: Path) -> None:
    shutil.copytree(FIXTURE_UPSTREAM, sources_dir / "upstream", dirs_exist_ok=True)
    write_source_lock(sources_dir / "source.json", LOCK)


def top_level_names(directory: Path) -> list[str]:
    return sorted(path.name for path in directory.iterdir())


@pytest.fixture
def workspace(tmp_path):
    sources_dir = tmp_path / "sources" / "mscp"
    populate_sources(sources_dir)
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    return sources_dir, baselines_dir


def run_import(sources_dir, baselines_dir, *arguments):
    return import_mscp.main(
        [*arguments, "--sources-dir", str(sources_dir), "--baselines-dir", str(baselines_dir)]
    )


def add_bad_rule(sources_dir: Path) -> None:
    bad_rule = (
        "id: zz_bad_rule\ntitle: T\ndiscussion: D\nplatforms:\n  macOS:\n"
        "    enforcement_info:\n      check:\n        shell: x\n        result:\n          float: 1\n"
    )
    bad_rule_path = sources_dir / "upstream" / "rules" / "os" / "zz_bad_rule.yaml"
    bad_rule_path.write_text(bad_rule, encoding="utf-8")


def test_offline_import_generates_valid_library(workspace, capsys):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    assert validate_library(baselines_dir) == []
    index = json.loads((baselines_dir / "mscp" / "_index.json").read_text(encoding="utf-8"))
    assert [entry["id"] for entry in index["rules"]] == [
        "mscp.os_gatekeeper_enable",
        "mscp.os_inherent_example",
        "mscp.pwpolicy_minimum_length_enforce",
    ]
    assert (baselines_dir / "mscp" / "rules" / "os_gatekeeper_enable.json").is_file()
    assert capsys.readouterr().out.strip() == "Imported 3 mSCP rules from release_27.0 (ccccccc)"


def test_manifest_entry_matches_lock(workspace):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    manifest = json.loads((baselines_dir / "_manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 5
    (entry,) = manifest["sources"]
    assert entry["name"] == "mscp"
    assert entry["display_name"] == "NIST macOS Security Compliance Project"
    assert entry["commit_sha"] == COMMIT_SHA
    assert entry["index_path"] == "mscp/_index.json"
    assert entry["rule_count"] == 3


def test_import_is_byte_stable(workspace):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    first = snapshot(baselines_dir)
    run_import(sources_dir, baselines_dir, "--offline")
    assert snapshot(baselines_dir) == first
    assert all(b"\r" not in content for content in first.values())


def test_failure_leaves_baselines_untouched(workspace, capsys):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    before = snapshot(baselines_dir)
    write_source_lock(sources_dir / "source.json", OTHER_LOCK)
    add_bad_rule(sources_dir)
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "zz_bad_rule" in capsys.readouterr().err
    assert snapshot(baselines_dir) == before
    assert top_level_names(baselines_dir.parent) == ["baselines", "sources"]


def test_manifest_preserves_other_sources(workspace):
    sources_dir, baselines_dir = workspace
    windows_source = {
        "name": "windows",
        "display_name": "Windows",
        "release_tag": "v1",
        "commit_sha": "d" * 40,
        "retrieved_date": "2026-01-01",
        "repository_url": "https://example.invalid/windows",
        "license": {
            "name": "MIT",
            "url": "https://example.invalid",
            "rights_holder": "Example",
            "modified": True,
        },
        "index_path": "windows/_index.json",
        "rule_count": 0,
    }
    (baselines_dir / "_manifest.json").write_text(
        json.dumps({"schema_version": 5, "sources": [windows_source]}), encoding="utf-8"
    )
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    manifest = json.loads((baselines_dir / "_manifest.json").read_text(encoding="utf-8"))
    assert [source["name"] for source in manifest["sources"]] == ["mscp", "windows"]
    assert manifest["sources"][1] == windows_source


def test_import_leaves_hand_edited_vocabulary_untouched(workspace):
    sources_dir, baselines_dir = workspace
    vocabulary_path = baselines_dir / "_vocabulary.json"
    vocabulary_bytes = b'{"schema_version": 1, "vocabularies": {"tags": []}}\n'
    vocabulary_path.write_bytes(vocabulary_bytes)
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    assert vocabulary_path.read_bytes() == vocabulary_bytes


def test_tag_and_offline_are_mutually_exclusive(workspace):
    sources_dir, baselines_dir = workspace
    with pytest.raises(SystemExit):
        run_import(sources_dir, baselines_dir, "--offline", "--tag", "release_27.0")
    with pytest.raises(SystemExit):
        run_import(sources_dir, baselines_dir)


def test_offline_missing_source_lock_exits_one(workspace, capsys):
    sources_dir, baselines_dir = workspace
    (sources_dir / "source.json").unlink()
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "source.json" in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def test_offline_missing_sources_dir_exits_one(tmp_path, capsys):
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    assert run_import(tmp_path / "missing", baselines_dir, "--offline") == 1
    assert capsys.readouterr().err != ""


def test_non_yaml_rule_file_raises(workspace, capsys):
    sources_dir, baselines_dir = workspace
    (sources_dir / "upstream" / "rules" / "os" / "notes.txt").write_text("x", encoding="utf-8")
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "notes.txt" in capsys.readouterr().err


def test_hidden_files_among_rules_are_ignored(workspace):
    sources_dir, baselines_dir = workspace
    (sources_dir / "upstream" / "rules" / "os" / ".DS_Store").write_bytes(b"\x00\x01")
    assert run_import(sources_dir, baselines_dir, "--offline") == 0


def test_duplicate_yaml_key_reports_file_path(workspace, capsys):
    sources_dir, baselines_dir = workspace
    rule_path = sources_dir / "upstream" / "rules" / "os" / "os_inherent_example.yaml"
    rule_path.write_text(
        rule_path.read_text(encoding="utf-8") + "references: {}\n", encoding="utf-8"
    )
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    error_output = capsys.readouterr().err
    assert "os_inherent_example.yaml" in error_output
    assert "duplicate mapping key" in error_output


def test_change_summary_lists_added_removed_rules_and_tags(workspace, capsys):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    capsys.readouterr()
    rules_dir = sources_dir / "upstream" / "rules"
    (rules_dir / "os" / "os_inherent_example.yaml").unlink()
    (rules_dir / "os" / "os_new_example.yaml").write_text(
        "id: os_new_example\ntitle: T\ndiscussion: D\nreferences: {}\n"
        "platforms:\n  macOS:\n    '27.0':\n      benchmarks: []\ntags:\n  - manual\n  - fresh_tag\n",
        encoding="utf-8",
    )
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    output_lines = capsys.readouterr().out.strip().splitlines()
    assert output_lines[1:] == [
        "Added rules: mscp.os_new_example",
        "Removed rules: mscp.os_inherent_example",
        "New tags: fresh_tag, manual",
        "Tags no longer present: inherent",
    ]


def test_change_summary_is_silent_when_nothing_changed(workspace, capsys):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    capsys.readouterr()
    run_import(sources_dir, baselines_dir, "--offline")
    assert len(capsys.readouterr().out.strip().splitlines()) == 1


def test_duplicate_rule_id_raises(workspace, capsys):
    sources_dir, baselines_dir = workspace
    rules_dir = sources_dir / "upstream" / "rules"
    shutil.copy(
        rules_dir / "os" / "os_gatekeeper_enable.yaml",
        rules_dir / "pwpolicy" / "copy_of_gatekeeper.yaml",
    )
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "os_gatekeeper_enable" in capsys.readouterr().err


def fake_fetch_writing_fixture(tag, sources_dir, today, opener=None):
    populate_sources(sources_dir)
    return LOCK


def test_tag_import_replaces_sources_and_baselines(workspace, monkeypatch, capsys):
    sources_dir, baselines_dir = workspace
    shutil.rmtree(sources_dir)
    monkeypatch.setattr(import_mscp, "fetch", fake_fetch_writing_fixture)
    assert run_import(sources_dir, baselines_dir, "--tag", "release_27.0") == 0
    assert validate_library(baselines_dir) == []
    assert (sources_dir / "source.json").is_file()
    assert top_level_names(sources_dir.parent) == ["mscp"]
    assert "release_27.0" in capsys.readouterr().out


def test_tag_failure_in_normalizer_leaves_everything_untouched(workspace, monkeypatch):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    sources_before = snapshot(sources_dir)
    baselines_before = snapshot(baselines_dir)

    def fetch_bad_upstream(tag, staging_sources_dir, today, opener=None):
        populate_sources(staging_sources_dir)
        add_bad_rule(staging_sources_dir)
        write_source_lock(staging_sources_dir / "source.json", OTHER_LOCK)
        return OTHER_LOCK

    monkeypatch.setattr(import_mscp, "fetch", fetch_bad_upstream)
    assert run_import(sources_dir, baselines_dir, "--tag", "release_27.0") == 1
    assert snapshot(sources_dir) == sources_before
    assert snapshot(baselines_dir) == baselines_before
    assert top_level_names(baselines_dir.parent) == ["baselines", "sources"]
    assert top_level_names(sources_dir.parent) == ["mscp"]


def test_tag_failure_in_fetch_leaves_everything_untouched(workspace, monkeypatch, capsys):
    sources_dir, baselines_dir = workspace
    sources_before = snapshot(sources_dir)

    def failing_fetch(tag, staging_sources_dir, today, opener=None):
        (staging_sources_dir / "partial").write_text("half", encoding="utf-8")
        raise urllib.error.URLError("network down")

    monkeypatch.setattr(import_mscp, "fetch", failing_fetch)
    assert run_import(sources_dir, baselines_dir, "--tag", "release_27.0") == 1
    assert "network down" in capsys.readouterr().err
    assert snapshot(sources_dir) == sources_before
    assert snapshot(baselines_dir) == {}
    assert top_level_names(sources_dir.parent) == ["mscp"]


@pytest.mark.parametrize(
    "manifest_text",
    ["not json", "{}", "[]", '{"schema_version": 5, "sources": [{"display_name": "x"}]}'],
)
def test_malformed_existing_manifest_exits_one(workspace, capsys, manifest_text):
    sources_dir, baselines_dir = workspace
    (baselines_dir / "_manifest.json").write_text(manifest_text, encoding="utf-8")
    before = snapshot(baselines_dir)
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "_manifest.json" in capsys.readouterr().err
    assert snapshot(baselines_dir) == before
    assert top_level_names(baselines_dir.parent) == ["baselines", "sources"]


@pytest.mark.parametrize("lock_text", ["{}", "[]", "not json"])
def test_malformed_source_lock_exits_one(workspace, capsys, lock_text):
    sources_dir, baselines_dir = workspace
    (sources_dir / "source.json").write_text(lock_text, encoding="utf-8")
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "source.json" in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def test_upstream_id_with_trailing_newline_is_rejected(workspace, capsys):
    sources_dir, baselines_dir = workspace
    rule_path = sources_dir / "upstream" / "rules" / "os" / "os_gatekeeper_enable.yaml"
    rule_text = rule_path.read_text(encoding="utf-8")
    rule_path.write_text(
        rule_text.replace("id: os_gatekeeper_enable", 'id: "os_gatekeeper_enable\\n"'),
        encoding="utf-8",
    )
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "unsafe upstream rule id" in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}
