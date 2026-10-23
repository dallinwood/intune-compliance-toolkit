import json
import shutil
from pathlib import Path

import pytest

from tools import import_asd_ism
from tools.import_asd_ism import generate_library
from tools.import_mscp import generate_library as generate_mscp_library
from tools.source_lock import SourceLock, write_source_lock
from tools.validate_library import validate_library

FIXTURE_CATALOG_PATH = Path(__file__).parent / "fixtures" / "asd_ism" / "catalog.json"
MSCP_FIXTURE_UPSTREAM = Path(__file__).parent / "fixtures" / "mscp_upstream"
COMMIT_SHA = "c" * 40
LOCK = SourceLock(
    tag="v2026.09.4",
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-10-23",
    repository_url="https://github.com/AustralianCyberSecurityCentre/ism-oscal",
)
MSCP_LOCK = SourceLock(
    tag="release_27.0",
    commit_sha="d" * 40,
    retrieved_date="2026-10-20",
    repository_url="https://github.com/usnistgov/macos_security",
)
EXPECTED_RULE_IDS = ["asd_ism.ism-0001", "asd_ism.ism-0859", "asd_ism.ism-1667"]


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def populate_sources(sources_dir: Path) -> None:
    upstream_dir = sources_dir / "upstream"
    upstream_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(FIXTURE_CATALOG_PATH, upstream_dir / "ISM_catalog.json")
    write_source_lock(sources_dir / "source.json", LOCK)


def top_level_names(directory: Path) -> list[str]:
    return sorted(path.name for path in directory.iterdir())


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def run_import(sources_dir, baselines_dir, *arguments):
    return import_asd_ism.main(
        [*arguments, "--sources-dir", str(sources_dir), "--baselines-dir", str(baselines_dir)]
    )


@pytest.fixture
def workspace(tmp_path):
    sources_dir = tmp_path / "sources" / "asd_ism"
    populate_sources(sources_dir)
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    return sources_dir, baselines_dir


def replace_in_catalog(sources_dir: Path, old: str, new: str) -> None:
    catalog_path = sources_dir / "upstream" / "ISM_catalog.json"
    catalog_text = catalog_path.read_text(encoding="utf-8")
    assert old in catalog_text
    catalog_path.write_text(catalog_text.replace(old, new), encoding="utf-8")


def corrupt_catalog(sources_dir: Path) -> None:
    replace_in_catalog(sources_dir, '"revision"', '"revision-renamed"')


def test_generate_library_writes_rules_index_and_manifest(workspace):
    sources_dir, baselines_dir = workspace
    rule_count = generate_library(sources_dir / "upstream", LOCK, baselines_dir)

    assert rule_count == 3
    assert validate_library(baselines_dir) == []
    index = read_json(baselines_dir / "asd_ism" / "_index.json")
    assert index["source"] == "asd_ism"
    assert [entry["id"] for entry in index["rules"]] == EXPECTED_RULE_IDS
    assert [entry["file"] for entry in index["rules"]] == [
        f"rules/{rule_id.removeprefix('asd_ism.')}.json" for rule_id in EXPECTED_RULE_IDS
    ]
    rule = read_json(baselines_dir / "asd_ism" / "rules" / "ism-1667.json")
    assert rule["id"] == "asd_ism.ism-1667"
    assert rule["source"]["commit_sha"] == COMMIT_SHA

    manifest = read_json(baselines_dir / "_manifest.json")
    (entry,) = manifest["sources"]
    assert entry == {
        "name": "asd_ism",
        "display_name": "ASD Information Security Manual",
        "release_tag": "v2026.09.4",
        "commit_sha": COMMIT_SHA,
        "retrieved_date": "2026-10-23",
        "repository_url": "https://github.com/AustralianCyberSecurityCentre/ism-oscal",
        "license": {
            "name": "CC BY 4.0",
            "url": "https://creativecommons.org/licenses/by/4.0/",
            "rights_holder": "Commonwealth of Australia (Australian Signals Directorate)",
            "modified": True,
        },
        "index_path": "asd_ism/_index.json",
        "rule_count": 3,
    }


def test_generate_library_keeps_the_mscp_manifest_entry(workspace):
    sources_dir, baselines_dir = workspace
    generate_mscp_library(MSCP_FIXTURE_UPSTREAM, MSCP_LOCK, baselines_dir)
    mscp_entry = read_json(baselines_dir / "_manifest.json")["sources"][0]
    mscp_files_before = snapshot(baselines_dir / "mscp")

    generate_library(sources_dir / "upstream", LOCK, baselines_dir)

    manifest = read_json(baselines_dir / "_manifest.json")
    assert [source["name"] for source in manifest["sources"]] == ["asd_ism", "mscp"]
    assert manifest["sources"][1] == mscp_entry
    assert snapshot(baselines_dir / "mscp") == mscp_files_before
    assert validate_library(baselines_dir) == []


def test_offline_import_is_byte_stable(workspace, capsys):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    first = snapshot(baselines_dir)
    assert capsys.readouterr().out.strip() == "Imported 3 ASD ISM controls from v2026.09.4 (ccccccc)"

    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    assert snapshot(baselines_dir) == first
    assert all(b"\r" not in content for content in first.values())
    assert len(capsys.readouterr().out.strip().splitlines()) == 1


def test_failed_normalization_leaves_library_untouched(workspace, capsys):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    before = snapshot(baselines_dir)
    capsys.readouterr()

    corrupt_catalog(sources_dir)

    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "revision" in capsys.readouterr().err
    assert snapshot(baselines_dir) == before
    assert top_level_names(baselines_dir.parent) == ["baselines", "sources"]


def test_change_summary_lists_added_and_removed_rules(workspace, capsys):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    capsys.readouterr()
    replace_in_catalog(sources_dir, '"ism-0001"', '"ism-0002"')

    assert run_import(sources_dir, baselines_dir, "--offline") == 0

    output_lines = capsys.readouterr().out.strip().splitlines()
    assert output_lines[1:] == [
        "Added rules: asd_ism.ism-0002",
        "Removed rules: asd_ism.ism-0001",
    ]


def test_tag_and_offline_are_mutually_exclusive(workspace):
    sources_dir, baselines_dir = workspace
    with pytest.raises(SystemExit):
        run_import(sources_dir, baselines_dir, "--offline", "--tag", "v2026.09.4")
    with pytest.raises(SystemExit):
        run_import(sources_dir, baselines_dir)


def test_offline_missing_source_lock_exits_one(workspace, capsys):
    sources_dir, baselines_dir = workspace
    (sources_dir / "source.json").unlink()
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "source.json" in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def test_offline_missing_catalog_exits_one(workspace, capsys):
    sources_dir, baselines_dir = workspace
    (sources_dir / "upstream" / "ISM_catalog.json").unlink()
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "ISM_catalog.json" in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def test_catalog_that_is_not_json_exits_one(workspace, capsys):
    sources_dir, baselines_dir = workspace
    (sources_dir / "upstream" / "ISM_catalog.json").write_text("not json", encoding="utf-8")
    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "ISM_catalog.json" in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def fake_fetch_writing_fixture(tag, sources_dir, today, opener=None):
    populate_sources(sources_dir)
    return LOCK


def test_tag_import_replaces_sources_and_baselines(workspace, monkeypatch, capsys):
    sources_dir, baselines_dir = workspace
    shutil.rmtree(sources_dir)
    monkeypatch.setattr(import_asd_ism, "fetch", fake_fetch_writing_fixture)
    assert run_import(sources_dir, baselines_dir, "--tag", "v2026.09.4") == 0
    assert validate_library(baselines_dir) == []
    assert (sources_dir / "source.json").is_file()
    assert top_level_names(sources_dir.parent) == ["asd_ism"]
    assert "v2026.09.4" in capsys.readouterr().out


def test_tag_failure_in_normalizer_leaves_everything_untouched(workspace, monkeypatch):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    sources_before = snapshot(sources_dir)
    baselines_before = snapshot(baselines_dir)

    def fetch_bad_upstream(tag, staging_sources_dir, today, opener=None):
        populate_sources(staging_sources_dir)
        corrupt_catalog(staging_sources_dir)
        return LOCK

    monkeypatch.setattr(import_asd_ism, "fetch", fetch_bad_upstream)
    assert run_import(sources_dir, baselines_dir, "--tag", "v2026.09.4") == 1
    assert snapshot(sources_dir) == sources_before
    assert snapshot(baselines_dir) == baselines_before
    assert top_level_names(baselines_dir.parent) == ["baselines", "sources"]
    assert top_level_names(sources_dir.parent) == ["asd_ism"]
