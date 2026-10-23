import json

import pytest

from tools.asd_ism_fetch import FILE_NAMES, REPOSITORY, USER_AGENT, fetch
from tools.source_lock import read_source_lock

COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567"
REFERENCE_URL = f"https://api.github.com/repos/{REPOSITORY}/git/ref/tags/v2026.09.4"
RAW_URL_PREFIX = f"https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT_SHA}"
CATALOG_BYTES = b'{"catalog": {"title": "caf\xc3\xa9"}}\r\n\xe2\x80\x93 trailing\r\n'
README_BYTES = b"# ISM OSCAL\r\nCreative Commons Attribution 4.0\r\n"


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def read(self):
        return self.body


class FakeOpener:
    def __init__(self, bodies_by_url):
        self.bodies_by_url = bodies_by_url
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        return FakeResponse(self.bodies_by_url[request.full_url])


def test_vendored_file_names():
    assert FILE_NAMES == ("ISM_catalog.json", "README.md")
    assert REPOSITORY == "AustralianCyberSecurityCentre/ism-oscal"
    assert USER_AGENT == "intune-compliance-toolkit-asd-ism-import"


def test_fetch_downloads_both_files_pinned_to_the_commit(tmp_path):
    opener = FakeOpener(
        {
            REFERENCE_URL: json.dumps({"object": {"type": "commit", "sha": COMMIT_SHA}}).encode(),
            f"{RAW_URL_PREFIX}/ISM_catalog.json": CATALOG_BYTES,
            f"{RAW_URL_PREFIX}/README.md": README_BYTES,
        }
    )
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()

    lock = fetch("v2026.09.4", sources_dir, "2026-10-23", opener)

    requested_urls = [request.full_url for request in opener.requests]
    assert requested_urls == [
        REFERENCE_URL,
        f"{RAW_URL_PREFIX}/ISM_catalog.json",
        f"{RAW_URL_PREFIX}/README.md",
    ]
    assert all(request.get_header("User-agent") == USER_AGENT for request in opener.requests)
    assert (sources_dir / "upstream" / "ISM_catalog.json").read_bytes() == CATALOG_BYTES
    assert (sources_dir / "upstream" / "README.md").read_bytes() == README_BYTES
    assert sorted(path.name for path in (sources_dir / "upstream").iterdir()) == sorted(FILE_NAMES)
    assert lock.commit_sha == COMMIT_SHA
    assert lock.tag == "v2026.09.4"
    assert lock.retrieved_date == "2026-10-23"
    assert lock.repository_url == "https://github.com/AustralianCyberSecurityCentre/ism-oscal"
    assert read_source_lock(sources_dir / "source.json") == lock


def test_fetch_resolves_an_annotated_tag(tmp_path):
    tag_object_url = f"https://api.github.com/repos/{REPOSITORY}/git/tags/abc"
    opener = FakeOpener(
        {
            REFERENCE_URL: json.dumps(
                {"object": {"type": "tag", "sha": "abc", "url": tag_object_url}}
            ).encode(),
            tag_object_url: json.dumps({"object": {"type": "commit", "sha": COMMIT_SHA}}).encode(),
            f"{RAW_URL_PREFIX}/ISM_catalog.json": CATALOG_BYTES,
            f"{RAW_URL_PREFIX}/README.md": README_BYTES,
        }
    )
    assert fetch("v2026.09.4", tmp_path, "2026-10-23", opener).commit_sha == COMMIT_SHA


@pytest.mark.parametrize("bad_tag", ["", ".", "..", "../x", "a/b", "a b", "a\\b", "tag?x"])
def test_fetch_rejects_invalid_tag_without_requests(tmp_path, bad_tag):
    opener = FakeOpener({})
    with pytest.raises(ValueError, match="Invalid tag"):
        fetch(bad_tag, tmp_path, "2026-10-23", opener)
    assert opener.requests == []
    assert list(tmp_path.iterdir()) == []


def test_failed_download_leaves_existing_upstream_untouched(tmp_path):
    upstream_dir = tmp_path / "upstream"
    upstream_dir.mkdir()
    (upstream_dir / "ISM_catalog.json").write_bytes(b"old")
    opener = FakeOpener(
        {
            REFERENCE_URL: json.dumps({"object": {"type": "commit", "sha": COMMIT_SHA}}).encode(),
            f"{RAW_URL_PREFIX}/ISM_catalog.json": CATALOG_BYTES,
        }
    )
    with pytest.raises(KeyError):
        fetch("v2026.09.4", tmp_path, "2026-10-23", opener)
    assert (upstream_dir / "ISM_catalog.json").read_bytes() == b"old"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["upstream"]
    assert sorted(path.name for path in upstream_dir.iterdir()) == ["ISM_catalog.json"]
