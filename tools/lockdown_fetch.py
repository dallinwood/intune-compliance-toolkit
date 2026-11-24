"""Fetch one ansible-lockdown Windows CIS release: the role at its tag and the Audit repo at its branch.

Both repositories are downloaded as tarballs at a pinned commit and only the files the importer reads
are copied: `role/` gets LICENSE, defaults and task files, `audit/` gets LICENSE, coverage.json and the
`cis_<ID>.yml` controls. Nothing comes from CIS itself.
"""

import re
import shutil
import tarfile
import tempfile
from collections.abc import Callable
from pathlib import Path

from tools import github_fetch
from tools.directory_swap import replace_directory
from tools.github_fetch import build_request, default_opener, validate_commit_sha, validate_tag
from tools.lockdown_sources import LockdownSpec
from tools.mscp_fetch import reject_case_insensitive_collisions, strip_top_folder
from tools.source_lock import SourceLock, write_source_lock

USER_AGENT = "intune-compliance-toolkit-lockdown-import"
IMPORTER_FORMAT = "lockdown-cis-1"
ROLE_SUBDIRECTORY = "role"
AUDIT_SUBDIRECTORY = "audit"
BRANCH_PATTERN = re.compile(r"[A-Za-z0-9._-]+")
AUDIT_CONTROL_PATTERN = re.compile(r"section_[^/]+/(?:[^/]+/)*cis_[^/]+\.yml")


def role_destination(relative_name: str) -> str | None:
    if relative_name == "LICENSE":
        return relative_name
    if relative_name.startswith(("defaults/", "tasks/")) and relative_name.endswith(".yml"):
        return relative_name
    return None


def audit_destination(relative_name: str) -> str | None:
    if relative_name in ("LICENSE", "coverage.json") or AUDIT_CONTROL_PATTERN.fullmatch(relative_name):
        return relative_name
    return None


def resolve_branch_commit(repository: str, branch: str, opener=default_opener) -> str:
    if not BRANCH_PATTERN.fullmatch(branch) or branch in (".", ".."):
        raise ValueError(f"Invalid branch name: {branch!r}")
    reference = github_fetch.get_json(
        f"https://api.github.com/repos/{repository}/git/ref/heads/{branch}", USER_AGENT, opener
    )
    target = reference.get("object", {})
    if target.get("type") != "commit" or "sha" not in target:
        raise ValueError(f"Branch {branch!r} of {repository} does not resolve to a commit")
    return target["sha"]


def download_tarball(repository: str, commit_sha: str, destination_dir: Path, opener=default_opener) -> Path:
    validate_commit_sha(commit_sha)
    tarball_path = destination_dir / f"{repository.replace('/', '_')}-{commit_sha}.tar.gz"
    url = f"https://github.com/{repository}/archive/{commit_sha}.tar.gz"
    with opener(build_request(url, USER_AGENT)) as response:
        tarball_path.write_bytes(response.read())
    return tarball_path


def extract_subset(
    tarball_path: Path, destination_dir: Path, subset_destination: Callable[[str], str | None]
) -> list[str]:
    """Write the regular files `subset_destination` accepts under destination_dir; every member is checked first."""
    written = []
    with tarfile.open(tarball_path) as archive:
        members = archive.getmembers()
        relative_names = [strip_top_folder(member.name) for member in members]
        destinations = [
            subset_destination(relative_name) if member.isreg() else None
            for member, relative_name in zip(members, relative_names)
        ]
        reject_case_insensitive_collisions(destinations)
        for member, destination in zip(members, destinations):
            if destination is None:
                continue
            target_path = destination_dir / destination
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(archive.extractfile(member).read())
            written.append(destination)
    return sorted(written)


def fetch(spec: LockdownSpec, tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock:
    validate_tag(tag)
    role_commit = github_fetch.resolve_tag_commit(spec.role_repository, tag, USER_AGENT, opener)
    published_date = github_fetch.fetch_release_published_date(spec.role_repository, tag, USER_AGENT, opener)
    audit_commit = resolve_branch_commit(spec.audit_repository, spec.audit_branch, opener)
    upstream_dir = sources_dir / "upstream"
    sources_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{upstream_dir.name}-new-", dir=sources_dir))
    try:
        with tempfile.TemporaryDirectory() as download_dir:
            for repository, commit_sha, subdirectory, subset_destination in (
                (spec.role_repository, role_commit, ROLE_SUBDIRECTORY, role_destination),
                (spec.audit_repository, audit_commit, AUDIT_SUBDIRECTORY, audit_destination),
            ):
                tarball_path = download_tarball(repository, commit_sha, Path(download_dir), opener)
                extract_subset(tarball_path, staging_dir / subdirectory, subset_destination)
        replace_directory(staging_dir, upstream_dir)
    except BaseException:
        shutil.rmtree(staging_dir, ignore_errors=True)
        raise
    lock = SourceLock(
        tag=tag,
        commit_sha=role_commit,
        retrieved_date=today,
        repository_url=spec.role_url,
        published_date=published_date,
        importer_format=IMPORTER_FORMAT,
        details={
            "audit_repository": spec.audit_repository,
            "audit_branch": spec.audit_branch,
            "audit_commit": audit_commit,
            "benchmark_version": spec.benchmark_version,
        },
    )
    write_source_lock(sources_dir / "source.json", lock)
    return lock
