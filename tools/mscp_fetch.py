import shutil
import tarfile
import tempfile
import urllib.request  # tests patch urllib.request.urlopen through this module
from pathlib import Path, PurePosixPath

from tools import github_fetch
from tools.directory_swap import replace_directory
from tools.github_fetch import build_request, default_opener, validate_commit_sha, validate_tag
from tools.source_lock import SourceLock, write_source_lock

MSCP_REPOSITORY = "usnistgov/macos_security"
REPOSITORY_URL = f"https://github.com/{MSCP_REPOSITORY}"
USER_AGENT = "intune-compliance-toolkit-mscp-import"
DATA_PREFIX = ("src", "mscp", "data")
ROOT_FILES = ("LICENSE.md", "CHANGELOG.md")

SUBSET_DIRECTORIES = (("rules",), ("baselines", "macos"))
SUBSET_DATA_FILES = (
    ("schema", "mscp_rule.json"),
    ("templates", "shell_scripts", "compliance_script.sh.jinja"),
    ("templates", "shell_scripts", "check.jinja"),
)


def resolve_tag_commit(tag: str, opener=default_opener) -> str:
    return github_fetch.resolve_tag_commit(MSCP_REPOSITORY, tag, USER_AGENT, opener)


def download_tarball(commit_sha: str, destination_dir: Path, opener=default_opener) -> Path:
    validate_commit_sha(commit_sha)
    url = f"{REPOSITORY_URL}/archive/{commit_sha}.tar.gz"
    tarball_path = destination_dir / f"{commit_sha}.tar.gz"
    with opener(build_request(url, USER_AGENT)) as response:
        tarball_path.write_bytes(response.read())
    return tarball_path


def strip_top_folder(member_name: str) -> str:
    if member_name.startswith("/"):
        raise ValueError(f"Absolute path in tarball: {member_name!r}")
    _, _, relative_name = member_name.partition("/")
    if (
        relative_name.startswith("/")
        or "\\" in relative_name
        or ":" in relative_name
        or ".." in relative_name.split("/")
    ):
        raise ValueError(f"Unsafe path in tarball: {member_name!r}")
    return relative_name


def subset_destination(relative_name: str) -> str | None:
    parts = PurePosixPath(relative_name).parts
    if relative_name in ROOT_FILES:
        return relative_name
    if parts[:3] != DATA_PREFIX:
        return None
    data_parts = parts[3:]
    in_subset_directory = any(
        data_parts[: len(directory)] == directory and len(data_parts) > len(directory)
        for directory in SUBSET_DIRECTORIES
    )
    if in_subset_directory or data_parts in SUBSET_DATA_FILES:
        return "/".join(data_parts)
    return None


def reject_case_insensitive_collisions(destinations: list[str | None]) -> None:
    # Windows and default macOS filesystems would silently merge such files.
    seen: dict[str, str] = {}
    for destination in destinations:
        if destination is None:
            continue
        previous = seen.setdefault(destination.casefold(), destination)
        if previous != destination:
            raise ValueError(
                f"Tarball members collide on case-insensitive filesystems: "
                f"{previous!r} and {destination!r}"
            )


def extract_upstream_subset(tarball_path: Path, upstream_dir: Path) -> list[str]:
    upstream_dir.parent.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(
        tempfile.mkdtemp(prefix=f".{upstream_dir.name}-new-", dir=upstream_dir.parent)
    )
    try:
        written = []
        with tarfile.open(tarball_path) as archive:
            members = archive.getmembers()
            # Validate every member before writing anything.
            relative_names = [strip_top_folder(member.name) for member in members]
            destinations = [
                subset_destination(relative_name) if member.isreg() else None
                for member, relative_name in zip(members, relative_names)
            ]
            reject_case_insensitive_collisions(destinations)
            for member, destination in zip(members, destinations):
                if destination is None:
                    continue
                target_path = staging_dir / destination
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(archive.extractfile(member).read())
                written.append(destination)
        replace_directory(staging_dir, upstream_dir)
    except BaseException:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    return sorted(written)


def fetch(tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock:
    validate_tag(tag)
    commit_sha = resolve_tag_commit(tag, opener)
    with tempfile.TemporaryDirectory() as download_dir:
        tarball_path = download_tarball(commit_sha, Path(download_dir), opener)
        extract_upstream_subset(tarball_path, sources_dir / "upstream")
    lock = SourceLock(
        tag=tag,
        commit_sha=commit_sha,
        retrieved_date=today,
        repository_url=REPOSITORY_URL,
    )
    write_source_lock(sources_dir / "source.json", lock)
    return lock
