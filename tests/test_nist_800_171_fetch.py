import json

import pytest

from tools.nist_800_171_fetch import FILE_PATHS, IMPORTER_FORMAT, REPOSITORY, USER_AGENT, fetch
from tools.source_lock import read_source_lock

COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567"
REFERENCE_URL = f"https://api.github.com/repos/{REPOSITORY}/git/ref/tags/v1.6.0"
RELEASE_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/tags/v1.6.0"
RELEASE_BODY = json.dumps({"published_at": "2026-10-22T22:59:02Z"}).encode()
RAW_URL_PREFIX = f"https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT_SHA}"
EXPECTED_FILE_PATHS = (
    "LICENSE.md",
    "nist.gov/SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json",
)
BODIES_BY_PATH = {
    repository_path: f"contents of {repository_path}\r\n\xe2\x80\x93 caf\xc3\xa9\r\n".encode("latin-1")
    for repository_path in EXPECTED_FILE_PATHS
}


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


def full_opener() -> FakeOpener:
    bodies_by_url = {
        REFERENCE_URL: json.dumps({"object": {"type": "commit", "sha": COMMIT_SHA}}).encode(),
        RELEASE_URL: RELEASE_BODY,
    }
    bodies_by_url.update(
        {f"{RAW_URL_PREFIX}/{repository_path}": body for repository_path, body in BODIES_BY_PATH.items()}
    )
    return FakeOpener(bodies_by_url)


def test_vendored_file_paths():
    assert FILE_PATHS == EXPECTED_FILE_PATHS
    assert REPOSITORY == "usnistgov/oscal-content"
    assert USER_AGENT == "intune-compliance-toolkit-nist-800-171-import"
    assert IMPORTER_FORMAT == "nist-800-171-rev3-oscal-1"


def test_fetch_downloads_every_file_pinned_to_the_commit_at_its_repository_path(tmp_path):
    opener = full_opener()

    lock = fetch("v1.6.0", tmp_path, "2026-11-27", opener)

    assert [request.full_url for request in opener.requests] == [
        REFERENCE_URL,
        RELEASE_URL,
        *(f"{RAW_URL_PREFIX}/{repository_path}" for repository_path in EXPECTED_FILE_PATHS),
    ]
    assert all(request.get_header("User-agent") == USER_AGENT for request in opener.requests)
    for repository_path, body in BODIES_BY_PATH.items():
        assert (tmp_path / "upstream" / repository_path).read_bytes() == body
    assert lock.commit_sha == COMMIT_SHA
    assert lock.published_date == "2026-10-22"
    assert lock.importer_format == IMPORTER_FORMAT
    assert lock.repository_url == "https://github.com/usnistgov/oscal-content"
    assert read_source_lock(tmp_path / "source.json") == lock


@pytest.mark.parametrize("bad_tag", ["", "..", "../x", "a/b", "tag?x"])
def test_fetch_rejects_invalid_tag_without_requests(tmp_path, bad_tag):
    opener = FakeOpener({})
    with pytest.raises(ValueError, match="Invalid tag"):
        fetch(bad_tag, tmp_path, "2026-11-27", opener)
    assert opener.requests == []


def test_failed_download_leaves_existing_upstream_untouched(tmp_path):
    upstream_dir = tmp_path / "upstream"
    upstream_dir.mkdir()
    (upstream_dir / "LICENSE.md").write_bytes(b"old")
    opener = full_opener()
    del opener.bodies_by_url[f"{RAW_URL_PREFIX}/{EXPECTED_FILE_PATHS[-1]}"]

    with pytest.raises(KeyError):
        fetch("v1.6.0", tmp_path, "2026-11-27", opener)

    assert (upstream_dir / "LICENSE.md").read_bytes() == b"old"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["upstream"]
