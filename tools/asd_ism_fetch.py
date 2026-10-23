import shutil
import tempfile
from pathlib import Path

from tools import github_fetch
from tools.directory_swap import replace_directory
from tools.github_fetch import build_request, default_opener, validate_commit_sha, validate_tag
from tools.source_lock import SourceLock, write_source_lock

REPOSITORY = "AustralianCyberSecurityCentre/ism-oscal"
REPOSITORY_URL = f"https://github.com/{REPOSITORY}"
USER_AGENT = "intune-compliance-toolkit-asd-ism-import"
FILE_NAMES = ("ISM_catalog.json", "README.md")


def resolve_tag_commit(tag: str, opener=default_opener) -> str:
    return github_fetch.resolve_tag_commit(REPOSITORY, tag, USER_AGENT, opener)


def download_file(commit_sha: str, file_name: str, destination_path: Path, opener=default_opener) -> None:
    validate_commit_sha(commit_sha)
    url = f"https://raw.githubusercontent.com/{REPOSITORY}/{commit_sha}/{file_name}"
    with opener(build_request(url, USER_AGENT)) as response:
        destination_path.write_bytes(response.read())


def fetch(tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock:
    validate_tag(tag)
    commit_sha = resolve_tag_commit(tag, opener)
    upstream_dir = sources_dir / "upstream"
    sources_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{upstream_dir.name}-new-", dir=sources_dir))
    try:
        for file_name in FILE_NAMES:
            download_file(commit_sha, file_name, staging_dir / file_name, opener)
        replace_directory(staging_dir, upstream_dir)
    except BaseException:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    lock = SourceLock(
        tag=tag,
        commit_sha=commit_sha,
        retrieved_date=today,
        repository_url=REPOSITORY_URL,
    )
    write_source_lock(sources_dir / "source.json", lock)
    return lock
