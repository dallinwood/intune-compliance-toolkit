import json
import re
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath

from tools.directory_swap import replace_directory
from tools.mscp_source_lock import SourceLock, write_source_lock

MSCP_REPOSITORY = "usnistgov/macos_security"
REPOSITORY_URL = f"https://github.com/{MSCP_REPOSITORY}"
NETWORK_TIMEOUT_SECONDS = 60
USER_AGENT = "intune-compliance-toolkit-mscp-import"
DATA_PREFIX = ("src", "mscp", "data")
ROOT_FILES = ("LICENSE.md", "CHANGELOG.md")

UPSTREAM_SUBSET = (
    "src/mscp/data/rules/**",
    "src/mscp/data/baselines/macos/**",
    "src/mscp/data/schema/mscp_rule.json",
    "LICENSE.md",
    "CHANGELOG.md",
)


def default_opener(request: urllib.request.Request):
    return urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT_SECONDS)


def validate_tag(tag: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", tag) or tag in (".", ".."):
        raise ValueError(f"Invalid tag name: {tag!r}")


def build_request(url: str, accept: str | None = None) -> urllib.request.Request:
    headers = {"User-Agent": USER_AGENT}
    if accept is not None:
        headers["Accept"] = accept
    return urllib.request.Request(url, headers=headers)


def get_json(url: str, opener) -> dict:
    with opener(build_request(url, accept="application/vnd.github+json")) as response:
        return json.loads(response.read())


def resolve_tag_commit(tag: str, opener=default_opener) -> str:
    validate_tag(tag)
    reference = get_json(
        f"https://api.github.com/repos/{MSCP_REPOSITORY}/git/ref/tags/{tag}", opener
    )
    target = reference.get("object", {})
    if target.get("type") == "tag" and "url" in target:
        target = get_json(target["url"], opener).get("object", {})
    if target.get("type") != "commit" or "sha" not in target:
        raise ValueError(f"Tag {tag!r} does not resolve to a commit")
    return target["sha"]


def download_tarball(tag: str, destination_dir: Path, opener=default_opener) -> Path:
    validate_tag(tag)
    url = f"{REPOSITORY_URL}/archive/refs/tags/{tag}.tar.gz"
    tarball_path = destination_dir / f"{tag}.tar.gz"
    with opener(build_request(url)) as response:
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
    if data_parts[:1] == ("rules",) and len(data_parts) > 1:
        return "/".join(data_parts)
    if data_parts[:2] == ("baselines", "macos") and len(data_parts) > 2:
        return "/".join(data_parts)
    if data_parts == ("schema", "mscp_rule.json"):
        return "/".join(data_parts)
    return None


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
            for member, relative_name in zip(members, relative_names):
                if not member.isreg():
                    continue
                destination = subset_destination(relative_name)
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
        tarball_path = download_tarball(tag, Path(download_dir), opener)
        extract_upstream_subset(tarball_path, sources_dir / "upstream")
    lock = SourceLock(
        tag=tag,
        commit_sha=commit_sha,
        retrieved_date=today,
        repository_url=REPOSITORY_URL,
    )
    write_source_lock(sources_dir / "source.json", lock)
    return lock
