import os
from pathlib import Path

import pytest

from tools import directory_swap
from tools.directory_swap import replace_directory, replace_file


def make_directory(path, name, content):
    path.mkdir()
    (path / name).write_text(content)
    return path


def test_swap_with_existing_target(tmp_path):
    target = make_directory(tmp_path / "target", "old.txt", "old")
    staging = make_directory(tmp_path / "staging", "new.txt", "new")
    replace_directory(staging, target)
    assert sorted(path.name for path in target.iterdir()) == ["new.txt"]
    assert sorted(path.name for path in tmp_path.iterdir()) == ["target"]


def test_swap_without_existing_target(tmp_path):
    staging = make_directory(tmp_path / "staging", "new.txt", "new")
    replace_directory(staging, tmp_path / "target")
    assert (tmp_path / "target" / "new.txt").read_text() == "new"
    assert not staging.exists()


def test_failed_staging_rename_restores_target(tmp_path, monkeypatch):
    target = make_directory(tmp_path / "target", "old.txt", "old")
    staging = make_directory(tmp_path / "staging", "new.txt", "new")
    original_rename = Path.rename

    def failing_rename(self, destination):
        if self == staging:
            raise OSError("simulated failure")
        return original_rename(self, destination)

    monkeypatch.setattr(Path, "rename", failing_rename)
    with pytest.raises(OSError):
        replace_directory(staging, target)
    assert [path.name for path in target.iterdir()] == ["old.txt"]
    assert (target / "old.txt").read_text() == "old"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["staging", "target"]


def test_transient_permission_error_is_retried(tmp_path, monkeypatch):
    staging = make_directory(tmp_path / "staging", "new.txt", "new")
    original_rename = Path.rename
    failures_remaining = [2]

    def flaky_rename(self, destination):
        if self == staging and failures_remaining[0] > 0:
            failures_remaining[0] -= 1
            raise PermissionError("simulated scanner lock")
        return original_rename(self, destination)

    monkeypatch.setattr(Path, "rename", flaky_rename)
    monkeypatch.setattr(directory_swap, "RENAME_RETRY_DELAY_SECONDS", 0)
    replace_directory(staging, tmp_path / "target")
    assert (tmp_path / "target" / "new.txt").read_text() == "new"


def test_persistent_permission_error_is_raised(tmp_path, monkeypatch):
    staging = make_directory(tmp_path / "staging", "new.txt", "new")

    def locked_rename(self, destination):
        raise PermissionError("simulated scanner lock")

    monkeypatch.setattr(Path, "rename", locked_rename)
    monkeypatch.setattr(directory_swap, "RENAME_RETRY_DELAY_SECONDS", 0)
    with pytest.raises(PermissionError):
        replace_directory(staging, tmp_path / "target")


def test_replace_file_retries_a_transient_permission_error(tmp_path, monkeypatch):
    source = tmp_path / "new.json"
    source.write_text("new")
    destination = tmp_path / "manifest.json"
    destination.write_text("old")
    original_replace = os.replace
    failures_remaining = [2]

    def flaky_replace(source_path, destination_path):
        if failures_remaining[0] > 0:
            failures_remaining[0] -= 1
            raise PermissionError("simulated scanner lock")
        return original_replace(source_path, destination_path)

    monkeypatch.setattr(os, "replace", flaky_replace)
    monkeypatch.setattr(directory_swap, "RENAME_RETRY_DELAY_SECONDS", 0)
    replace_file(source, destination)
    assert destination.read_text() == "new"


def test_replace_file_raises_a_persistent_permission_error(tmp_path, monkeypatch):
    source = tmp_path / "new.json"
    source.write_text("new")

    def locked_replace(source_path, destination_path):
        raise PermissionError("simulated scanner lock")

    monkeypatch.setattr(os, "replace", locked_replace)
    monkeypatch.setattr(directory_swap, "RENAME_RETRY_DELAY_SECONDS", 0)
    with pytest.raises(PermissionError):
        replace_file(source, tmp_path / "manifest.json")
