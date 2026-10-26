import os
import shutil
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

RENAME_ATTEMPTS = 5
RENAME_RETRY_DELAY_SECONDS = 0.5


def _retry_on_permission_error(action: Callable[[], None]) -> None:
    # On Windows a virus scanner or indexer can briefly hold a freshly written
    # file or directory open, making a rename or replace fail with PermissionError.
    for attempt in range(1, RENAME_ATTEMPTS + 1):
        try:
            action()
            return
        except PermissionError:
            if attempt == RENAME_ATTEMPTS:
                raise
            time.sleep(RENAME_RETRY_DELAY_SECONDS * attempt)


def rename_directory(source: Path, destination: Path) -> None:
    _retry_on_permission_error(lambda: source.rename(destination))


def replace_file(source: Path, destination: Path) -> None:
    _retry_on_permission_error(lambda: os.replace(source, destination))


def replace_directory(staging_dir: Path, target_dir: Path) -> None:
    if not target_dir.exists():
        rename_directory(staging_dir, target_dir)
        return
    backup_dir = Path(
        tempfile.mkdtemp(prefix=f".{target_dir.name}-old-", dir=target_dir.parent)
    )
    backup_dir.rmdir()
    rename_directory(target_dir, backup_dir)
    try:
        rename_directory(staging_dir, target_dir)
    except BaseException:
        rename_directory(backup_dir, target_dir)
        raise
    # The swap already succeeded; a leftover backup must not make it look failed.
    shutil.rmtree(backup_dir, ignore_errors=True)
