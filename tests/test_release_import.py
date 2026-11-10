import json
import urllib.error
from dataclasses import replace
from pathlib import Path

import pytest

from tools import import_asd_ism, import_mscp
from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData, index_entry
from tools.json_output import write_json
from tools.release_import import (
    SourceImporter,
    generate_release,
    import_stored_release,
    import_stored_releases,
    import_tag,
    release_change_summary,
    run_cli,
)
from tools.source_lock import SourceLock, read_source_lock, write_source_lock
from tools.validate_library import validate_library

LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "rights_holder": "Example rights holder",
    "modified": True,
}
STUB_FORMAT = "stub-1"
OLDER_LOCK = SourceLock(
    tag="A",
    commit_sha="a" * 40,
    retrieved_date="2026-10-01",
    repository_url="https://example.com/stub",
    published_date="2025-12-09",
    importer_format=STUB_FORMAT,
)
NEWER_LOCK = SourceLock(
    tag="B",
    commit_sha="b" * 40,
    retrieved_date="2026-10-02",
    repository_url="https://example.com/stub",
    published_date="2026-09-03",
    importer_format=STUB_FORMAT,
)
RULE_IDS_BY_TAG = {"A": ["one", "two"], "B": ["two", "three"]}


def stub_rule(upstream_rule_id: str, lock: SourceLock) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "id": f"stub.{upstream_rule_id}",
        "title": f"Rule {upstream_rule_id}",
        "discussion": "Discussion.",
        "discussion_format": "markdown",
        "section_path": ["Section"],
        "source": {
            "name": "stub",
            "release_tag": lock.tag,
            "commit_sha": lock.commit_sha,
            "upstream_rule_id": upstream_rule_id,
            "upstream_path": "ids.txt",
            "upstream_revision": None,
            "upstream_updated": None,
            "upstream_url": f"https://example.com/blob/{lock.commit_sha}/ids.txt",
            "license": LICENSE,
        },
        "assessment": {"status": "manual", "manual_reason": "no_check"},
        "architecture": None,
        "applicability": [{"target": None, "version": None, "benchmarks": []}],
        "tags": [],
        "references": {},
        "check": None,
        "odv": None,
        "remediation": None,
    }


def build_stub_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
    upstream_rule_ids = (upstream_dir / "ids.txt").read_text(encoding="utf-8").split()
    (tree_dir / "rules").mkdir(parents=True)
    entries = []
    for upstream_rule_id in upstream_rule_ids:
        rule = stub_rule(upstream_rule_id, lock)
        rule_file = f"rules/{upstream_rule_id}.json"
        write_json(tree_dir / rule_file, rule)
        entries.append(index_entry(rule, rule_file))
    write_json(
        tree_dir / "_index.json",
        {"schema_version": SCHEMA_VERSION, "source": "stub", "rules": entries},
    )
    return len(entries)


def write_stub_release(sources_dir: Path, lock: SourceLock) -> None:
    release_sources_dir = sources_dir / "releases" / lock.tag
    (release_sources_dir / "upstream").mkdir(parents=True)
    (release_sources_dir / "upstream" / "ids.txt").write_text(
        "\n".join(RULE_IDS_BY_TAG[lock.tag]), encoding="utf-8"
    )
    write_source_lock(release_sources_dir / "source.json", lock)


def stub_fetch(tag: str, release_sources_dir: Path, today: str) -> SourceLock:
    lock = {"A": OLDER_LOCK, "B": NEWER_LOCK}[tag]
    (release_sources_dir / "upstream").mkdir(parents=True)
    (release_sources_dir / "upstream" / "ids.txt").write_text(
        "\n".join(RULE_IDS_BY_TAG[tag]), encoding="utf-8"
    )
    write_source_lock(release_sources_dir / "source.json", lock)
    return lock


STUB_IMPORTER = SourceImporter(
    name="stub",
    display_name="Stub source",
    repository_url="https://example.com/stub",
    license=LICENSE,
    fetch=stub_fetch,
    build_rule_tree_by_format={STUB_FORMAT: build_stub_rule_tree},
    release_label=lambda tag: f"Release {tag}",
)


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def read_manifest(baselines_dir: Path) -> dict:
    return json.loads((baselines_dir / "_manifest.json").read_text(encoding="utf-8"))


@pytest.fixture
def workspace(tmp_path):
    sources_dir = tmp_path / "sources" / "stub"
    write_stub_release(sources_dir, OLDER_LOCK)
    write_stub_release(sources_dir, NEWER_LOCK)
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()
    return sources_dir, baselines_dir


def test_unknown_importer_format_is_rejected(workspace):
    sources_dir, baselines_dir = workspace
    unknown_format_lock = replace(OLDER_LOCK, importer_format="unknown-9")

    with pytest.raises(ValueError, match="no importer for format 'unknown-9'"):
        generate_release(STUB_IMPORTER, sources_dir / "releases" / "A" / "upstream", unknown_format_lock, baselines_dir)

    assert snapshot(baselines_dir) == {}


def test_import_stored_releases_is_idempotent(workspace):
    sources_dir, baselines_dir = workspace

    import_stored_releases(STUB_IMPORTER, sources_dir, baselines_dir)
    first = snapshot(baselines_dir)
    import_stored_releases(STUB_IMPORTER, sources_dir, baselines_dir)

    assert snapshot(baselines_dir) == first
    assert validate_library(baselines_dir) == []
    (source,) = read_manifest(baselines_dir)["sources"]
    assert [release["tag"] for release in source["releases"]] == ["A", "B"]
    assert [release["label"] for release in source["releases"]] == ["Release A", "Release B"]


def test_importing_an_older_release_does_not_change_current(workspace):
    sources_dir, baselines_dir = workspace
    import_stored_release(STUB_IMPORTER, sources_dir, baselines_dir, "B")

    import_stored_release(STUB_IMPORTER, sources_dir, baselines_dir, "A")

    (source,) = read_manifest(baselines_dir)["sources"]
    assert source["release_tag"] == "B"
    assert source["index_path"] == "stub/releases/B/_index.json"
    assert [release["tag"] for release in source["releases"]] == ["A", "B"]


def test_importing_in_either_order_gives_the_same_library(workspace, tmp_path):
    sources_dir, baselines_dir = workspace
    import_stored_release(STUB_IMPORTER, sources_dir, baselines_dir, "A")
    import_stored_release(STUB_IMPORTER, sources_dir, baselines_dir, "B")
    other_baselines_dir = tmp_path / "other_baselines"
    other_baselines_dir.mkdir()
    import_stored_release(STUB_IMPORTER, sources_dir, other_baselines_dir, "B")
    import_stored_release(STUB_IMPORTER, sources_dir, other_baselines_dir, "A")

    assert snapshot(baselines_dir) == snapshot(other_baselines_dir)


def test_release_change_summary_lists_added_and_removed_ids(workspace):
    sources_dir, baselines_dir = workspace
    import_stored_releases(STUB_IMPORTER, sources_dir, baselines_dir)

    assert release_change_summary(baselines_dir, "stub", "A") is None
    assert release_change_summary(baselines_dir, "stub", "B") == (["stub.three"], ["stub.one"])


def test_stored_release_whose_lock_names_another_tag_is_rejected(workspace):
    sources_dir, baselines_dir = workspace
    write_source_lock(sources_dir / "releases" / "A" / "source.json", NEWER_LOCK)

    with pytest.raises(ValueError, match="source.json"):
        import_stored_release(STUB_IMPORTER, sources_dir, baselines_dir, "A")


def test_import_stored_release_without_a_lock_file_names_the_file(workspace):
    sources_dir, baselines_dir = workspace
    (sources_dir / "releases" / "A" / "source.json").unlink()

    with pytest.raises(ValueError, match="source.json"):
        import_stored_release(STUB_IMPORTER, sources_dir, baselines_dir, "A")


def test_import_tag_stores_the_release_under_its_own_folder(tmp_path):
    sources_dir = tmp_path / "sources" / "stub"
    baselines_dir = tmp_path / "baselines"

    lock, rule_count = import_tag(STUB_IMPORTER, "A", sources_dir, baselines_dir, "2026-10-01")

    assert (lock, rule_count) == (OLDER_LOCK, 2)
    assert read_source_lock(sources_dir / "releases" / "A" / "source.json") == OLDER_LOCK
    assert (baselines_dir / "stub" / "releases" / "A" / "_index.json").is_file()
    assert sorted(path.name for path in (sources_dir / "releases").iterdir()) == ["A"]


def test_import_tag_failure_leaves_sources_and_baselines_untouched(workspace):
    sources_dir, baselines_dir = workspace
    import_stored_releases(STUB_IMPORTER, sources_dir, baselines_dir)
    sources_before = snapshot(sources_dir)
    baselines_before = snapshot(baselines_dir)

    def failing_fetch(tag: str, release_sources_dir: Path, today: str) -> SourceLock:
        (release_sources_dir / "partial").write_text("half", encoding="utf-8")
        raise urllib.error.URLError("network down")

    failing_importer = replace(STUB_IMPORTER, fetch=failing_fetch)

    with pytest.raises(urllib.error.URLError):
        import_tag(failing_importer, "B", sources_dir, baselines_dir, "2026-10-02")

    assert snapshot(sources_dir) == sources_before
    assert snapshot(baselines_dir) == baselines_before
    assert sorted(path.name for path in (sources_dir / "releases").iterdir()) == ["A", "B"]


def run_stub_cli(sources_dir: Path, baselines_dir: Path, *arguments: str) -> int:
    return run_cli(
        STUB_IMPORTER,
        [*arguments, "--sources-dir", str(sources_dir), "--baselines-dir", str(baselines_dir)],
    )


def test_cli_offline_imports_every_stored_release_and_prints_each_summary(workspace, capsys):
    sources_dir, baselines_dir = workspace

    assert run_stub_cli(sources_dir, baselines_dir, "--offline") == 0

    assert capsys.readouterr().out.splitlines() == [
        "Imported 2 Stub source rules from A (aaaaaaa)",
        "Imported 2 Stub source rules from B (bbbbbbb)",
        "Added rules (1): stub.three",
        "Removed rules (1): stub.one",
    ]


def test_cli_offline_release_imports_only_that_release(workspace, capsys):
    sources_dir, baselines_dir = workspace

    assert run_stub_cli(sources_dir, baselines_dir, "--offline", "--release", "A") == 0

    (source,) = read_manifest(baselines_dir)["sources"]
    assert [release["tag"] for release in source["releases"]] == ["A"]
    assert capsys.readouterr().out.splitlines() == ["Imported 2 Stub source rules from A (aaaaaaa)"]


def test_cli_a_failing_change_summary_does_not_fail_a_successful_import(workspace, capsys, monkeypatch):
    sources_dir, baselines_dir = workspace

    def broken_summary(baselines_dir, source_name, tag):
        raise ValueError("summary unavailable")

    monkeypatch.setattr("tools.release_import.release_change_summary", broken_summary)

    assert run_stub_cli(sources_dir, baselines_dir, "--offline") == 0

    captured = capsys.readouterr()
    assert "Imported 2 Stub source rules from A" in captured.out
    assert "summary unavailable" in captured.err
    assert (baselines_dir / "stub" / "releases" / "B" / "_index.json").is_file()


def test_cli_release_requires_offline(workspace):
    sources_dir, baselines_dir = workspace
    with pytest.raises(SystemExit):
        run_stub_cli(sources_dir, baselines_dir, "--tag", "A", "--release", "A")


def test_cli_tag_and_offline_are_mutually_exclusive(workspace):
    sources_dir, baselines_dir = workspace
    with pytest.raises(SystemExit):
        run_stub_cli(sources_dir, baselines_dir, "--offline", "--tag", "A")
    with pytest.raises(SystemExit):
        run_stub_cli(sources_dir, baselines_dir)


def test_cli_offline_without_stored_releases_exits_one(tmp_path, capsys):
    baselines_dir = tmp_path / "baselines"
    baselines_dir.mkdir()

    assert run_stub_cli(tmp_path / "missing", baselines_dir, "--offline") == 1

    assert "no stored releases" in capsys.readouterr().err


def test_cli_reports_an_unsupported_upstream_failure_and_exits_one(workspace, capsys):
    sources_dir, baselines_dir = workspace

    def unsupported_build(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
        raise UnsupportedUpstreamData("unsupported shape")

    importer = replace(STUB_IMPORTER, build_rule_tree_by_format={STUB_FORMAT: unsupported_build})

    exit_code = run_cli(
        importer,
        ["--offline", "--sources-dir", str(sources_dir), "--baselines-dir", str(baselines_dir)],
    )

    assert exit_code == 1
    assert "unsupported shape" in capsys.readouterr().err
    assert snapshot(baselines_dir) == {}


def test_release_labels():
    assert import_mscp.IMPORTER.release_label("release_27.1") == "27.1"
    assert import_asd_ism.IMPORTER.release_label("v2025.12.9") == "Dec 2025"
    assert import_asd_ism.IMPORTER.release_label("v2026.09.4") == "Sep 2026"


def test_asd_ism_release_label_rejects_a_tag_without_a_year_and_month():
    with pytest.raises(ValueError, match="release label"):
        import_asd_ism.IMPORTER.release_label("latest")


def test_importers_register_their_formats():
    assert list(import_mscp.IMPORTER.build_rule_tree_by_format) == ["mscp-2"]
    assert list(import_asd_ism.IMPORTER.build_rule_tree_by_format) == ["asd-ism-oscal-1"]
