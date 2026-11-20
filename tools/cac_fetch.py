import hashlib
import shutil
import tempfile
import zipfile
from pathlib import Path

from tools import github_fetch
from tools.cac_benchmarks import REPOSITORY_URL, BenchmarkSpec
from tools.directory_swap import replace_directory
from tools.github_fetch import build_request, default_opener, validate_tag
from tools.source_lock import SourceLock, write_source_lock

REPOSITORY = "ComplianceAsCode/content"
USER_AGENT = "intune-compliance-toolkit-cac-cis-import"
IMPORTER_FORMAT = "cac-cis-1"
LICENSE_FILE_PATH = "LICENSE"
DOWNLOAD_CHUNK_BYTES = 1024 * 1024


def release_asset_url(tag: str, file_name: str) -> str:
    return f"{REPOSITORY_URL}/releases/download/{tag}/{file_name}"


def fetch(
    spec: BenchmarkSpec, tag: str, sources_dir: Path, today: str, opener=default_opener
) -> SourceLock:
    validate_tag(tag)
    commit_sha = github_fetch.resolve_tag_commit(REPOSITORY, tag, USER_AGENT, opener)
    published_date = github_fetch.fetch_release_published_date(REPOSITORY, tag, USER_AGENT, opener)
    upstream_dir = sources_dir / "upstream"
    sources_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{upstream_dir.name}-new-", dir=sources_dir))
    try:
        github_fetch.download_pinned_files(
            REPOSITORY, commit_sha, (LICENSE_FILE_PATH, spec.controls_path), staging_dir, USER_AGENT, opener
        )
        _extract_datastream(spec, tag, staging_dir / "release", opener)
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


def _extract_datastream(spec: BenchmarkSpec, tag: str, release_dir: Path, opener) -> None:
    version = tag.removeprefix("v")
    zip_name = f"scap-security-guide-{version}.zip"
    datastream_name = f"ssg-{spec.product}-ds.xml"
    member_name = f"scap-security-guide-{version}/{datastream_name}"
    expected_digest = _download_expected_digest(tag, f"{zip_name}.sha512", opener)
    with tempfile.TemporaryDirectory(prefix="cac-release-") as download_dir:
        zip_path = Path(download_dir) / zip_name
        actual_digest = _download_hashing(release_asset_url(tag, zip_name), zip_path, opener)
        if actual_digest != expected_digest:
            raise ValueError(
                f"{zip_name}: SHA-512 mismatch (expected {expected_digest}, got {actual_digest})"
            )
        with zipfile.ZipFile(zip_path) as archive:
            try:
                member = archive.open(member_name)
            except KeyError:
                raise ValueError(f"{zip_name}: no member {member_name} ({datastream_name} not found)") from None
            release_dir.mkdir(parents=True)
            with member, (release_dir / datastream_name).open("wb") as destination:
                shutil.copyfileobj(member, destination)


def _download_expected_digest(tag: str, checksum_name: str, opener) -> str:
    with opener(build_request(release_asset_url(tag, checksum_name), USER_AGENT)) as response:
        tokens = response.read().decode("utf-8").split()
    if not tokens:
        raise ValueError(f"{checksum_name}: checksum file is empty")
    return tokens[0].lower()


def _download_hashing(url: str, destination_path: Path, opener) -> str:
    digest = hashlib.sha512()
    with opener(build_request(url, USER_AGENT)) as response, destination_path.open("wb") as destination:
        while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
            digest.update(chunk)
            destination.write(chunk)
    return digest.hexdigest()
