import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

from tests.test_cac_controls import FIXTURE_SPEC
from tools.cac_fetch import IMPORTER_FORMAT, fetch, release_asset_url
from tools.source_lock import read_source_lock

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "cis_cac"
TAG = "v9.9.9"
COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567"
REPOSITORY = "ComplianceAsCode/content"
REFERENCE_URL = f"https://api.github.com/repos/{REPOSITORY}/git/ref/tags/{TAG}"
RELEASE_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/tags/{TAG}"
RAW_URL_PREFIX = f"https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT_SHA}"
ZIP_URL = release_asset_url(TAG, "scap-security-guide-9.9.9.zip")
CHECKSUM_URL = release_asset_url(TAG, "scap-security-guide-9.9.9.zip.sha512")
DATASTREAM_BYTES = (FIXTURE_DIRECTORY / "ssg-fixture-ds.xml").read_bytes()
CONTROLS_BYTES = (FIXTURE_DIRECTORY / "controls.yml").read_bytes()
LICENSE_BYTES = b"SPDX license identifier: BSD-3-Clause\r\n"


class FakeResponse:
    def __init__(self, body):
        self.stream = io.BytesIO(body)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def read(self, size=-1):
        return self.stream.read(size)


class FakeOpener:
    def __init__(self, bodies_by_url):
        self.bodies_by_url = bodies_by_url
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        return FakeResponse(self.bodies_by_url[request.full_url])


def build_zip(member_name: str = "scap-security-guide-9.9.9/ssg-fixture-ds.xml") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("scap-security-guide-9.9.9/ssg-other-ds.xml", b"other product")
        archive.writestr(member_name, DATASTREAM_BYTES)
    return buffer.getvalue()


def full_opener(zip_bytes: bytes | None = None, checksum_text: str | None = None) -> FakeOpener:
    zip_bytes = build_zip() if zip_bytes is None else zip_bytes
    if checksum_text is None:
        checksum_text = f"{hashlib.sha512(zip_bytes).hexdigest()}  scap-security-guide-9.9.9.zip\n"
    return FakeOpener(
        {
            REFERENCE_URL: json.dumps({"object": {"type": "commit", "sha": COMMIT_SHA}}).encode(),
            RELEASE_URL: json.dumps({"published_at": "2026-11-01T10:00:00Z"}).encode(),
            CHECKSUM_URL: checksum_text.encode(),
            ZIP_URL: zip_bytes,
            f"{RAW_URL_PREFIX}/LICENSE": LICENSE_BYTES,
            f"{RAW_URL_PREFIX}/{FIXTURE_SPEC.controls_path}": CONTROLS_BYTES,
        }
    )


def stored_paths(upstream_dir: Path) -> list[str]:
    return sorted(path.relative_to(upstream_dir).as_posix() for path in upstream_dir.rglob("*") if path.is_file())


def test_release_asset_url():
    assert release_asset_url("v0.1.82", "scap-security-guide-0.1.82.zip") == (
        "https://github.com/ComplianceAsCode/content/releases/download/v0.1.82/scap-security-guide-0.1.82.zip"
    )


def test_fetch_stores_expected_files(tmp_path):
    sources_dir = tmp_path / "sources"

    lock = fetch(FIXTURE_SPEC, TAG, sources_dir, "2026-11-20", full_opener())

    upstream_dir = sources_dir / "upstream"
    assert stored_paths(upstream_dir) == ["LICENSE", FIXTURE_SPEC.controls_path, "release/ssg-fixture-ds.xml"]
    assert (upstream_dir / "release" / "ssg-fixture-ds.xml").read_bytes() == DATASTREAM_BYTES
    assert (upstream_dir / FIXTURE_SPEC.controls_path).read_bytes() == CONTROLS_BYTES
    assert (upstream_dir / "LICENSE").read_bytes() == LICENSE_BYTES
    assert lock.commit_sha == COMMIT_SHA
    assert lock.published_date == "2026-11-01"
    assert lock.importer_format == IMPORTER_FORMAT == "cac-cis-1"
    assert lock.repository_url == "https://github.com/ComplianceAsCode/content"
    assert read_source_lock(sources_dir / "source.json") == lock
    assert sorted(path.name for path in sources_dir.iterdir()) == ["source.json", "upstream"]


def test_checksum_mismatch_fails_and_stores_nothing(tmp_path):
    opener = full_opener(checksum_text="0" * 128 + "  scap-security-guide-9.9.9.zip\n")

    with pytest.raises(ValueError, match="SHA-512"):
        fetch(FIXTURE_SPEC, TAG, tmp_path, "2026-11-20", opener)

    assert list(tmp_path.iterdir()) == []


def test_missing_zip_member_fails(tmp_path):
    opener = full_opener(zip_bytes=build_zip("scap-security-guide-9.9.9/ssg-renamed-ds.xml"))

    with pytest.raises(ValueError, match="ssg-fixture-ds.xml"):
        fetch(FIXTURE_SPEC, TAG, tmp_path, "2026-11-20", opener)

    assert list(tmp_path.iterdir()) == []
