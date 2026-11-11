import shutil
import tempfile
from pathlib import Path

from tools import github_fetch
from tools.asd_ism_normalize import REPOSITORY_URL
from tools.directory_swap import replace_directory
from tools.github_fetch import default_opener, validate_tag
from tools.source_lock import SourceLock, write_source_lock

REPOSITORY = "AustralianCyberSecurityCentre/ism-oscal"
USER_AGENT = "intune-compliance-toolkit-asd-ism-import"
FILE_NAMES = ("ISM_catalog.json", "README.md")
IMPORTER_FORMAT = "asd-ism-oscal-1"


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
        github_fetch.download_pinned_files(REPOSITORY, commit_sha, FILE_NAMES, staging_dir, USER_AGENT, opener)
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
