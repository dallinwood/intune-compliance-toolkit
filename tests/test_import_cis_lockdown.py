import json
import shutil
from pathlib import Path

import pytest

from tests.test_lockdown_normalize import FIXTURES, FIXTURE_SPEC, LOCK, NETBT_DEFAULT
from tools import import_cis_lockdown
from tools.lockdown_fetch import IMPORTER_FORMAT
from tools.lockdown_sources import SOURCES
from tools.source_lock import write_source_lock
from tools.validate_library import validate_library


@pytest.fixture
def sources_dir(tmp_path) -> Path:
    release_dir = tmp_path / "sources" / FIXTURE_SPEC.source_name / "releases" / LOCK.tag
    shutil.copytree(FIXTURES / "role", release_dir / "upstream" / "role")
    shutil.copytree(FIXTURES / "audit", release_dir / "upstream" / "audit")
    with open(release_dir / "upstream" / "role" / "defaults" / "main" / "main.yml", "a", encoding="utf-8", newline="") as defaults:
        defaults.write(NETBT_DEFAULT)
    write_source_lock(release_dir / "source.json", LOCK)
    return tmp_path / "sources" / FIXTURE_SPEC.source_name


def run_offline(sources_dir: Path, baselines_dir: Path) -> int:
    baselines_dir.mkdir(exist_ok=True)
    return import_cis_lockdown.main(
        [
            "--source", FIXTURE_SPEC.source_name, "--offline",
            "--sources-dir", str(sources_dir), "--baselines-dir", str(baselines_dir),
        ]
    )


def snapshot(directory: Path) -> dict[str, bytes]:
    return {path.relative_to(directory).as_posix(): path.read_bytes() for path in sorted(directory.rglob("*")) if path.is_file()}


def test_there_is_one_importer_per_source():
    assert sorted(import_cis_lockdown.IMPORTERS) == sorted(SOURCES)
    for source_name, importer in import_cis_lockdown.IMPORTERS.items():
        assert importer.name == source_name
        assert importer.display_name == SOURCES[source_name].display_name
        assert importer.provenance == "community"
        assert IMPORTER_FORMAT in importer.build_rule_tree_by_format


def test_the_offline_import_writes_a_valid_library(sources_dir, tmp_path, capsys):
    baselines_dir = tmp_path / "baselines"
    assert run_offline(sources_dir, baselines_dir) == 0
    assert validate_library(baselines_dir) == []
    manifest = json.loads((baselines_dir / "_manifest.json").read_text(encoding="utf-8"))
    (source,) = manifest["sources"]
    assert source["name"] == "cis_windows2022"
    assert source["provenance"] == "community"
    assert source["license"]["name"] == "MIT"
    (release,) = source["releases"]
    assert release["tag"] == "4.2.0" and release["label"] == "v4.0.0" and release["commit_sha"] == "a" * 40
    index = json.loads((baselines_dir / "cis_windows2022" / "releases" / "4.2.0" / "_index.json").read_text(encoding="utf-8"))
    assert index["source"] == "cis_windows2022"
    assert release["rule_count"] == len(index["rules"]) == 28
    assert "Imported 28 CIS Windows Server 2022 (ansible-lockdown) rules from 4.2.0" in capsys.readouterr().out


def test_every_rule_file_is_named_by_its_cis_id(sources_dir, tmp_path):
    baselines_dir = tmp_path / "baselines"
    run_offline(sources_dir, baselines_dir)
    release_dir = baselines_dir / "cis_windows2022" / "releases" / "4.2.0"
    assert (release_dir / "rules" / "18.4.2.json").is_file()
    assert (release_dir / "rules" / "2.3.10.6.json").is_file()


def test_the_offline_import_is_deterministic_byte_for_byte(sources_dir, tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    assert run_offline(sources_dir, first) == 0
    assert run_offline(sources_dir, second) == 0
    assert snapshot(first) == snapshot(second)


def test_the_importer_format_is_taken_from_the_stored_lock(sources_dir, tmp_path):
    lock_path = sources_dir / "releases" / LOCK.tag / "source.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    lock["importer_format"] = "unknown-9"
    lock_path.write_text(json.dumps(lock), encoding="utf-8")
    assert run_offline(sources_dir, tmp_path / "baselines") == 1


def test_main_requires_a_known_source():
    with pytest.raises(SystemExit):
        import_cis_lockdown.main(["--source", "cis_windows95", "--offline"])
    with pytest.raises(SystemExit):
        import_cis_lockdown.main(["--offline"])
