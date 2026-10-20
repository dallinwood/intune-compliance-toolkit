import shutil
import tempfile
from pathlib import Path


def replace_directory(staging_dir: Path, target_dir: Path) -> None:
    if not target_dir.exists():
        staging_dir.rename(target_dir)
        return
    backup_dir = Path(
        tempfile.mkdtemp(prefix=f".{target_dir.name}-old-", dir=target_dir.parent)
    )
    backup_dir.rmdir()
    target_dir.rename(backup_dir)
    try:
        staging_dir.rename(target_dir)
    except BaseException:
        backup_dir.rename(target_dir)
        raise
    # The swap already succeeded; a leftover backup must not make it look failed.
    shutil.rmtree(backup_dir, ignore_errors=True)
