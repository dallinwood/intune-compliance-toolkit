import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from tools import import_nist_800_171
from tools.nist_800_171_normalize import CATALOG_PATH
from tools.release_import import generate_release
from tools.source_lock import SourceLock, write_source_lock
from tools.validate_library import validate_library

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "nist_800_171"
COMMIT_SHA = "c" * 40
LOCK = SourceLock(
    tag="v1.6.0",
    commit_sha=COMMIT_SHA,
    retrieved_date="2026-11-27",
    repository_url="https://github.com/usnistgov/oscal-content",
    published_date="2026-10-22",
    importer_format="nist-800-171-rev3-oscal-1",
)
CURRENT_RELEASE_PATH = Path("nist_800_171") / "releases" / "v1.6.0"
EXPECTED_RULE_IDS = [
    "nist_800_171.03.01.01",
    "nist_800_171.03.01.02",
    "nist_800_171.03.01.08",
    "nist_800_171.03.01.10",
    "nist_800_171.03.15.01",
]


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def stored_release_dir(sources_dir: Path) -> Path:
    return sources_dir / "releases" / LOCK.tag


def populate_release(release_sources_dir: Path) -> None:
    destination = release_sources_dir / "upstream" / CATALOG_PATH
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(FIXTURE_DIRECTORY / CATALOG_PATH, destination)
    write_source_lock(release_sources_dir / "source.json", LOCK)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def run_import(sources_dir, baselines_dir, *arguments):
    return import_nist_800_171.main(
        [*arguments, "--sources-dir", str(sources_dir), "--baselines-dir", str(baselines_dir)]
    )


def catalog_file(sources_dir: Path) -> Path:
    return stored_release_dir(sources_dir) / "upstream" / CATALOG_PATH


@pytest.fixture
def workspace(tmp_path):
    sources_dir = tmp_path / "sources" / "nist_800_171"
    populate_release(stored_release_dir(sources_dir))
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    return sources_dir, baselines_dir


def test_generate_release_writes_rules_index_and_manifest(workspace):
    sources_dir, baselines_dir = workspace
    rule_count = generate_release(
        import_nist_800_171.IMPORTER, stored_release_dir(sources_dir) / "upstream", LOCK, baselines_dir
    )

    assert rule_count == 5
    assert validate_library(baselines_dir) == []
    index = read_json(baselines_dir / CURRENT_RELEASE_PATH / "_index.json")
    assert index["source"] == "nist_800_171"
    assert [entry["id"] for entry in index["rules"]] == EXPECTED_RULE_IDS
    assert [entry["file"] for entry in index["rules"]] == [
        f"rules/{rule_id.removeprefix('nist_800_171.')}.json" for rule_id in EXPECTED_RULE_IDS
    ]
    assert read_json(baselines_dir / CURRENT_RELEASE_PATH / "rules" / "03.01.08.json")["id"] == "nist_800_171.03.01.08"

    (entry,) = read_json(baselines_dir / "_manifest.json")["sources"]
    assert entry["display_name"] == "NIST SP 800-171 Rev. 3"
    assert entry["license"]["name"] == "CC0 1.0 (public domain)"
    assert entry["releases"] == [
        {
            "tag": "v1.6.0",
            "label": "3.0.0",
            "published_date": "2026-10-22",
            "commit_sha": COMMIT_SHA,
            "retrieved_date": "2026-11-27",
            "importer_format": "nist-800-171-rev3-oscal-1",
            "index_path": "nist_800_171/releases/v1.6.0/_index.json",
            "rule_count": 5,
        }
    ]


def test_release_label_is_the_framework_version_not_the_oscal_file_version(workspace):
    sources_dir, _ = workspace
    path = catalog_file(sources_dir)
    path.write_text(
        path.read_text(encoding="utf-8").replace('"SP_800_171_3_0_0"', '"SP_800_171_3_1_0"'), encoding="utf-8"
    )

    assert import_nist_800_171.IMPORTER.release_label("v1.7.0", stored_release_dir(sources_dir) / "upstream") == "3.1.0"


def test_offline_import_is_byte_stable(workspace, capsys):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    first = snapshot(baselines_dir)
    assert capsys.readouterr().out.strip() == "Imported 5 NIST SP 800-171 Rev. 3 rules from v1.6.0 (ccccccc)"

    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    assert snapshot(baselines_dir) == first
    assert all(b"\r" not in content for content in first.values())


def test_failed_normalization_leaves_library_untouched(workspace, capsys):
    sources_dir, baselines_dir = workspace
    assert run_import(sources_dir, baselines_dir, "--offline") == 0
    before = snapshot(baselines_dir)
    capsys.readouterr()

    path = catalog_file(sources_dir)
    path.write_text(path.read_text(encoding="utf-8").replace('"sort-id"', '"sort-id-renamed"'), encoding="utf-8")

    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert "sort-id" in capsys.readouterr().err
    assert snapshot(baselines_dir) == before


def test_missing_catalog_exits_one(workspace, capsys):
    sources_dir, baselines_dir = workspace
    catalog_file(sources_dir).unlink()

    assert run_import(sources_dir, baselines_dir, "--offline") == 1
    assert Path(CATALOG_PATH).name in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def test_tag_import_stores_sources_and_baselines(workspace, monkeypatch, capsys):
    sources_dir, baselines_dir = workspace
    shutil.rmtree(sources_dir)

    def fake_fetch(tag, release_sources_dir, today, opener=None):
        populate_release(release_sources_dir)
        return LOCK

    monkeypatch.setattr(
        import_nist_800_171, "IMPORTER", replace(import_nist_800_171.IMPORTER, fetch=fake_fetch)
    )

    assert run_import(sources_dir, baselines_dir, "--tag", "v1.6.0") == 0
    assert validate_library(baselines_dir) == []
    assert catalog_file(sources_dir).is_file()
    assert "v1.6.0" in capsys.readouterr().out
