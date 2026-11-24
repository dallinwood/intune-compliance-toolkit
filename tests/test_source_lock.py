import json

from tools.source_lock import SourceLock, read_source_lock, write_source_lock

BASE_FIELDS = {
    "tag": "v1",
    "commit_sha": "a" * 40,
    "retrieved_date": "2026-11-24",
    "repository_url": "https://github.com/example/repo",
    "published_date": "2026-11-01",
    "importer_format": "example-1",
}


def test_a_lock_without_details_writes_exactly_the_original_fields(tmp_path):
    write_source_lock(tmp_path / "source.json", SourceLock(**BASE_FIELDS))
    assert json.loads((tmp_path / "source.json").read_text(encoding="utf-8")) == BASE_FIELDS


def test_a_lock_file_written_before_details_existed_still_reads(tmp_path):
    (tmp_path / "source.json").write_text(json.dumps(BASE_FIELDS), encoding="utf-8")
    assert read_source_lock(tmp_path / "source.json") == SourceLock(**BASE_FIELDS)
    assert read_source_lock(tmp_path / "source.json").details == {}


def test_details_round_trip(tmp_path):
    lock = SourceLock(**BASE_FIELDS, details={"audit_branch": "latest", "audit_commit": "b" * 40})
    write_source_lock(tmp_path / "source.json", lock)
    assert read_source_lock(tmp_path / "source.json") == lock
