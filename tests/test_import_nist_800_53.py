import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from tools import import_asd_ism, import_nist_800_53
from tools.nist_800_53_normalize import CATALOG_PATH, PROFILE_PATHS
from tools.release_import import generate_release
from tools.source_lock import SourceLock, write_source_lock
from tools.validate_library import validate_library

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "nist_800_53"
ASD_ISM_FIXTURE_CATALOG = Path(__file__).parent / "fixtures" / "asd_ism" / "catalog.json"
COMMIT_SHA = "c" * 40
LOCK = SourceLock(
    tag="v1.6.0",
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-11-11",
    repository_url="https://github.com/usnistgov/oscal-content",
    published_date="2026-10-22",
    importer_format="nist-800-53-rev5-oscal-1",
)
ASD_ISM_LOCK = SourceLock(
    tag="v2026.09.4",
    commit_sha="d" * 40,
    retrieved_date="2026-10-23",
    repository_url="https://github.com/AustralianCyberSecurityCentre/ism-oscal",
    published_date="2026-09-03",
    importer_format="asd-ism-oscal-1",
)
CURRENT_RELEASE_PATH = Path("nist_800_53") / "releases" / "v1.6.0"
EXPECTED_RULE_IDS = ["nist_800_53.ac-2", "nist_800_53.ac-2.1", "nist_800_53.pm-1"]
VENDORED_PATHS = (CATALOG_PATH, *PROFILE_PATHS.values())


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def stored_release_dir(sources_dir: Path, lock: SourceLock = LOCK) -> Path:
    return sources_dir / "releases" / lock.tag


def populate_release(release_sources_dir: Path, lock: SourceLock = LOCK) -> None:
    for repository_path in VENDORED_PATHS:
        destination = release_sources_dir / "upstream" / repository_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(FIXTURE_DIRECTORY / repository_path, destination)
    write_source_lock(release_sources_dir / "source.json", lock)


def top_level_names(directory: Path) -> list[str]:
    return sorted(path.name for path in directory.iterdir())


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def run_import(sources_dir, baselines_dir, *arguments):
    return import_nist_800_53.main(
        [*arguments, "--sources-dir", str(sources_dir), "--baselines-dir", str(baselines_dir)]
    )


def upstream_file(sources_dir: Path, repository_path: str) -> Path:
    return stored_release_dir(sources_dir) / "upstream" / repository_path


@pytest.fixture
def workspace(tmp_path):
    sources_dir = tmp_path / "sources" / "nist_800_53"
    populate_release(stored_release_dir(sources_dir))
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    return sources_dir, baselines_dir


def test_generate_release_writes_rules_index_and_manifest(workspace):
    sources_dir, baselines_dir = workspace
    rule_count = generate_release(
        import_nist_800_53.IMPORTER, stored_release_dir(sources_dir) / "upstream", LOCK, baselines_dir
    )

    assert rule_count == 3
    assert validate_library(baselines_dir) == []
    index = read_json(baselines_dir / CURRENT_RELEASE_PATH / "_index.json")
    assert index["source"] == "nist_800_53"
    assert [entry["id"] for entry in index["rules"]] == EXPECTED_RULE_IDS
    assert [entry["file"] for entry in index["rules"]] == [
        f"rules/{rule_id.removeprefix('nist_800_53.')}.json" for rule_id in EXPECTED_RULE_IDS
    ]
    rule = read_json(baselines_dir / CURRENT_RELEASE_PATH / "rules" / "ac-2.1.json")
    assert rule["id"] == "nist_800_53.ac-2.1"
    assert rule["source"]["commit_sha"] == COMMIT_SHA

    manifest = read_json(baselines_dir / "_manifest.json")
    (entry,) = manifest["sources"]
    assert entry == {
        "name": "nist_800_53",
        "display_name": "NIST SP 800-53 Rev. 5",
        "release_tag": "v1.6.0",
        "commit_sha": COMMIT_SHA,
        "retrieved_date": "2026-11-11",
        "repository_url": "https://github.com/usnistgov/oscal-content",
        "license": {
            "name": "CC0 1.0 (public domain)",
            "url": "https://creativecommons.org/publicdomain/zero/1.0/",
            "rights_holder": "National Institute of Standards and Technology",
            "modified": True,
        },
        "index_path": "nist_800_53/releases/v1.6.0/_index.json",
        "rule_count": 3,
        "releases": [
            {
                "tag": "v1.6.0",
                "label": "5.2.0",
                "published_date": "2026-10-22",
                "commit_sha": COMMIT_SHA,
                "retrieved_date": "2026-11-11",
                "importer_format": "nist-800-53-rev5-oscal-1",
                "index_path": "nist_800_53/releases/v1.6.0/_index.json",
                "rule_count": 3,
            }
        ],
    }


def test_release_label_is_the_catalog_version_without_the_tag(workspace):
    sources_dir, _ = workspace
    catalog_path = upstream_file(sources_dir, CATALOG_PATH)
    catalog_path.write_text(
        catalog_path.read_text(encoding="utf-8").replace('"version": "5.2.0"', '"version": "5.3.1"'),
        encoding="utf-8",
    )

    upstream_dir = stored_release_dir(sources_dir) / "upstream"

    assert import_nist_800_53.IMPORTER.release_label("v1.7.0", upstream_dir) == "5.3.1"


def test_release_label_without_a_catalog_version_is_refused(workspace):
    sources_dir, _ = workspace
    catalog_path = upstream_file(sources_dir, CATALOG_PATH)
    catalog_path.write_text(
        catalog_path.read_text(encoding="utf-8").replace('"version": "5.2.0"', '"version-renamed": "5.2.0"'),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="metadata.version"):
        import_nist_800_53.IMPORTER.release_label("v1.6.0", stored_release_dir(sources_dir) / "upstream")


def test_generate_release_keeps_other_sources_manifest_entries(workspace):
    sources_dir, baselines_dir = workspace
    asd_ism_upstream = tmp_asd_ism_upstream(sources_dir.parent.parent)
    generate_release(import_asd_ism.IMPORTER, asd_ism_upstream, ASD_ISM_LOCK, baselines_dir)
    asd_ism_entry = read_json(baselines_dir / "_manifest.json")["sources"][0]
    asd_ism_files_before = snapshot(baselines_dir / "asd_ism")

    generate_release(
        import_nist_800_53.IMPORTER, stored_release_dir(sources_dir) / "upstream", LOCK, baselines_dir
    )

    manifest = read_json(baselines_dir / "_manifest.json")
    assert [source["name"] for source in manifest["sources"]] == ["asd_ism", "nist_800_53"]
    assert manifest["sources"][0] == asd_ism_entry
    assert snapshot(baselines_dir / "asd_ism") == asd_ism_files_before
    assert validate_library(baselines_dir) == []


def tmp_asd_ism_upstream(root: Path) -> Path:
    upstream_dir = root / "asd_ism_upstream"
    upstream_dir.mkdir()
    shutil.copyfile(ASD_ISM_FIXTURE_CATALOG, upstream_dir / "ISM_catalog.json")
    return upstream_dir


def test_offline_import_is_byte_stable(workspace, capsys):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    first = snapshot(baselines_dir)
    assert (
        capsys.readouterr().out.strip()
        == "Imported 3 NIST SP 800-53 Rev. 5 rules from v1.6.0 (ccccccc)"
    )

    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    assert snapshot(baselines_dir) == first
    assert all(b"\r" not in content for content in first.values())
    assert len(capsys.readouterr().out.strip().splitlines()) == 1


def test_failed_normalization_leaves_library_untouched(workspace, capsys):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    before = snapshot(baselines_dir)
    capsys.readouterr()

    catalog_path = upstream_file(sources_dir, CATALOG_PATH)
    catalog_path.write_text(
        catalog_path.read_text(encoding="utf-8").replace('"sort-id"', '"sort-id-renamed"'), encoding="utf-8"
    )

    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "sort-id" in capsys.readouterr().err
    assert snapshot(baselines_dir) == before
    assert top_level_names(baselines_dir.parent) == ["baselines", "sources"]


@pytest.mark.parametrize("missing_path", [CATALOG_PATH, *PROFILE_PATHS.values()])
def test_offline_missing_upstream_file_exits_one(workspace, capsys, missing_path):
    sources_dir, baselines_dir = workspace
    upstream_file(sources_dir, missing_path).unlink()

    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert Path(missing_path).name in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def test_profile_that_is_not_json_exits_one(workspace, capsys):
    sources_dir, baselines_dir = workspace
    profile_path = PROFILE_PATHS["nist_800_53_low"]
    upstream_file(sources_dir, profile_path).write_text("not json", encoding="utf-8")

    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert Path(profile_path).name in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def test_catalog_with_a_duplicate_key_exits_one(workspace, capsys):
    sources_dir, baselines_dir = workspace
    catalog_path = upstream_file(sources_dir, CATALOG_PATH)
    catalog_path.write_text(
        catalog_path.read_text(encoding="utf-8").replace("{", '{"repeated": 1, "repeated": 2,', 1),
        encoding="utf-8",
    )

    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    error_output = capsys.readouterr().err
    assert Path(CATALOG_PATH).name in error_output
    assert "duplicate key" in error_output
    assert snapshot(baselines_dir) == {}


def fake_fetch_writing_fixture(tag, release_sources_dir, today, opener=None):
    populate_release(release_sources_dir)
    return LOCK


def patch_fetch(monkeypatch, fetch_function) -> None:
    monkeypatch.setattr(
        import_nist_800_53,
        "IMPORTER",
        replace(import_nist_800_53.IMPORTER, fetch=fetch_function),
    )


def test_tag_import_replaces_sources_and_baselines(workspace, monkeypatch, capsys):
    sources_dir, baselines_dir = workspace
    shutil.rmtree(sources_dir)
    patch_fetch(monkeypatch, fake_fetch_writing_fixture)

    assert run_import(sources_dir, baselines_dir, "--tag", "v1.6.0") == 0

    assert validate_library(baselines_dir) == []
    assert (stored_release_dir(sources_dir) / "source.json").is_file()
    assert (stored_release_dir(sources_dir) / "upstream" / CATALOG_PATH).is_file()
    assert top_level_names(sources_dir.parent) == ["nist_800_53"]
    assert "v1.6.0" in capsys.readouterr().out


def test_tag_failure_in_normalizer_leaves_everything_untouched(workspace, monkeypatch):
    sources_dir, baselines_dir = workspace
    run_import(sources_dir, baselines_dir, "--offline")
    sources_before = snapshot(sources_dir)
    baselines_before = snapshot(baselines_dir)

    def fetch_bad_upstream(tag, staging_sources_dir, today, opener=None):
        populate_release(staging_sources_dir)
        catalog_path = staging_sources_dir / "upstream" / CATALOG_PATH
        catalog_path.write_text(
            catalog_path.read_text(encoding="utf-8").replace('"sort-id"', '"sort-id-renamed"'),
            encoding="utf-8",
        )
        return LOCK

    patch_fetch(monkeypatch, fetch_bad_upstream)

    assert run_import(sources_dir, baselines_dir, "--tag", "v1.6.0") == 1
    assert snapshot(sources_dir) == sources_before
    assert snapshot(baselines_dir) == baselines_before
    assert top_level_names(baselines_dir.parent) == ["baselines", "sources"]
