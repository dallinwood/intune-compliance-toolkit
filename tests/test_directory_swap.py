from pathlib import Path

import pytest

from tools.directory_swap import replace_directory


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
