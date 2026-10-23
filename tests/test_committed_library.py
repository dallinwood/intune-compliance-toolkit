import shutil
from pathlib import Path

from tools.import_mscp import generate_library
from tools.source_lock import read_source_lock
from tools.validate_library import validate_library

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINES_DIR = REPO_ROOT / "baselines"
MSCP_SOURCES_DIR = REPO_ROOT / "sources" / "mscp"


def generated_files(baselines_dir: Path) -> dict[str, bytes]:
    paths = list((baselines_dir / "mscp").rglob("*")) + [baselines_dir / "_manifest.json"]
    return {
        path.relative_to(baselines_dir).as_posix(): path.read_bytes()
        for path in sorted(paths)
        if path.is_file()
    }


def test_committed_library_is_valid():
    assert validate_library(BASELINES_DIR) == []


def test_committed_library_matches_regeneration(tmp_path):
    regenerated_dir = tmp_path / "baselines"
    shutil.copytree(BASELINES_DIR, regenerated_dir)

    generate_library(
        MSCP_SOURCES_DIR / "upstream",
        read_source_lock(MSCP_SOURCES_DIR / "source.json"),
        regenerated_dir,
    )

    committed = generated_files(BASELINES_DIR)
    regenerated = generated_files(regenerated_dir)
    assert regenerated.keys() == committed.keys()
    differing = [name for name in committed if committed[name] != regenerated[name]]
    assert differing == []


def test_committed_library_has_lf_line_endings_only():
    carriage_return_files = [
        path.relative_to(BASELINES_DIR).as_posix()
        for path in BASELINES_DIR.rglob("*")
        if path.is_file() and b"\r" in path.read_bytes()
    ]
    assert carriage_return_files == []


def test_vendored_license_present():
    license_text = (MSCP_SOURCES_DIR / "upstream" / "LICENSE.md").read_text(encoding="utf-8")
    assert "CC BY 4.0" in license_text
