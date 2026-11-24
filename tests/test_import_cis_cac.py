import json
import shutil
from pathlib import Path

import pytest

from tests.test_cac_controls import FIXTURE_SPEC
from tools import import_cis_cac
from tools.cac_benchmarks import BENCHMARKS
from tools.cac_fetch import IMPORTER_FORMAT
from tools.release_import import generate_release
from tools.source_lock import SourceLock
from tools.validate_library import validate_library

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "cis_cac"
LOCK = SourceLock(
    tag="v0.0.0",
    commit_sha="a" * 40,
    retrieved_date="2026-11-20",
    repository_url="https://github.com/ComplianceAsCode/content",
    published_date="2026-11-01",
    importer_format=IMPORTER_FORMAT,
)


def test_there_is_one_importer_per_benchmark():
    assert sorted(import_cis_cac.IMPORTERS) == sorted(BENCHMARKS)
    for source_name, importer in import_cis_cac.IMPORTERS.items():
        assert importer.name == source_name
        assert importer.display_name == BENCHMARKS[source_name].display_name


def test_generate_release_from_fixture(tmp_path):
    upstream_dir = tmp_path / "upstream"
    (upstream_dir / "controls").mkdir(parents=True)
    (upstream_dir / "release").mkdir()
    shutil.copy(FIXTURE_DIRECTORY / "controls.yml", upstream_dir / FIXTURE_SPEC.controls_path)
    shutil.copy(FIXTURE_DIRECTORY / "ssg-fixture-ds.xml", upstream_dir / "release" / "ssg-fixture-ds.xml")
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()

    rule_count = generate_release(
        import_cis_cac.build_importer(FIXTURE_SPEC), upstream_dir, LOCK, baselines_dir
    )

    assert rule_count == 7
    assert validate_library(baselines_dir) == []
    manifest = json.loads((baselines_dir / "_manifest.json").read_text(encoding="utf-8"))
    (source,) = manifest["sources"]
    assert source["name"] == "cis_fixture"
    assert source["releases"][0]["label"] == "v9.9.9"
    index = json.loads((baselines_dir / "cis_fixture" / "releases" / "v0.0.0" / "_index.json").read_text(encoding="utf-8"))
    assert index["source"] == "cis_fixture"
    assert [entry["file"] for entry in index["rules"]][0] == "rules/1.1.1.json"


def test_main_requires_known_benchmark(tmp_path):
    with pytest.raises(SystemExit):
        import_cis_cac.main(["--benchmark", "cis_unknown", "--offline"])
    with pytest.raises(SystemExit):
        import_cis_cac.main(["--offline"])


def test_help_without_benchmark_lists_every_option(capsys):
    with pytest.raises(SystemExit) as exit_info:
        import_cis_cac.main(["--help"])
    assert exit_info.value.code == 0
    usage = capsys.readouterr().out
    for option in ("--benchmark", "--tag", "--offline", "--release", "--sources-dir", "--baselines-dir"):
        assert option in usage
    assert "cac_cis_rhel9" in usage
