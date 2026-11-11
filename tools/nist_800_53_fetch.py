import shutil
import tempfile
from pathlib import Path

from tools import github_fetch
from tools.directory_swap import replace_directory
from tools.github_fetch import default_opener, validate_tag
from tools.nist_800_53_normalize import (
    CATALOG_PATH,
    LICENSE_FILE_PATH,
    PROFILE_PATHS,
    README_FILE_PATH,
    REPOSITORY_URL,
)
from tools.source_lock import SourceLock, write_source_lock

REPOSITORY = "usnistgov/oscal-content"
USER_AGENT = "intune-compliance-toolkit-nist-800-53-import"
FILE_PATHS = (LICENSE_FILE_PATH, README_FILE_PATH, CATALOG_PATH, *PROFILE_PATHS.values())
IMPORTER_FORMAT = "nist-800-53-rev5-oscal-1"


def resolve_tag_commit(tag: str, opener=default_opener) -> str:
    return github_fetch.resolve_tag_commit(REPOSITORY, tag, USER_AGENT, opener)


def fetch_published_date(tag: str, opener=default_opener) -> str:
    return github_fetch.fetch_release_published_date(REPOSITORY, tag, USER_AGENT, opener)


def fetch(tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock:
    validate_tag(tag)
    commit_sha = resolve_tag_commit(tag, opener)
    published_date = fetch_published_date(tag, opener)
    upstream_dir = sources_dir / "upstream"
    sources_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{upstream_dir.name}-new-", dir=sources_dir))
    try:
        github_fetch.download_pinned_files(REPOSITORY, commit_sha, FILE_PATHS, staging_dir, USER_AGENT, opener)
        replace_directory(staging_dir, upstream_dir)
    except BaseException:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    lock = SourceLock(
        tag=tag,
        commit_sha=commit_sha,
        retrieved_date=today,
        repository_url=REPOSITORY_URL,
        published_date=published_date,
        importer_format=IMPORTER_FORMAT,
    )
    write_source_lock(sources_dir / "source.json", lock)
    return lock
