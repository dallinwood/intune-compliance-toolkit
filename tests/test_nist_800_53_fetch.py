import json

import pytest

from tools.nist_800_53_fetch import FILE_PATHS, IMPORTER_FORMAT, REPOSITORY, USER_AGENT, fetch
from tools.source_lock import read_source_lock

COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567"
REFERENCE_URL = f"https://api.github.com/repos/{REPOSITORY}/git/ref/tags/v1.6.0"
RELEASE_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/tags/v1.6.0"
RELEASE_BODY = json.dumps({"published_at": "2026-10-22T22:59:02Z"}).encode()
RAW_URL_PREFIX = f"https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT_SHA}"
EXPECTED_FILE_PATHS = (
    "LICENSE.md",
    "nist.gov/SP800-53/README.md",
    "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json",
    "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_LOW-baseline_profile.json",
    "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_MODERATE-baseline_profile.json",
    "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_HIGH-baseline_profile.json",
    "nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_PRIVACY-baseline_profile.json",
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


def resolving_bodies() -> dict[str, bytes]:
    return {
        REFERENCE_URL: json.dumps({"object": {"type": "commit", "sha": COMMIT_SHA}}).encode(),
        RELEASE_URL: RELEASE_BODY,
    }


def full_opener() -> FakeOpener:
    bodies_by_url = resolving_bodies()
    bodies_by_url.update(
        {f"{RAW_URL_PREFIX}/{repository_path}": body for repository_path, body in BODIES_BY_PATH.items()}
    )
    return FakeOpener(bodies_by_url)


def test_vendored_file_paths():
    assert FILE_PATHS == EXPECTED_FILE_PATHS
    assert REPOSITORY == "usnistgov/oscal-content"
    assert USER_AGENT == "intune-compliance-toolkit-nist-800-53-import"
    assert IMPORTER_FORMAT == "nist-800-53-rev5-oscal-1"


def test_fetch_downloads_every_file_pinned_to_the_commit_at_its_repository_path(tmp_path):
    opener = full_opener()
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()

    lock = fetch("v1.6.0", sources_dir, "2026-11-11", opener)

    requested_urls = [request.full_url for request in opener.requests]
    assert requested_urls == [
        REFERENCE_URL,
        RELEASE_URL,
        *(f"{RAW_URL_PREFIX}/{repository_path}" for repository_path in EXPECTED_FILE_PATHS),
    ]
    assert all(request.get_header("User-agent") == USER_AGENT for request in opener.requests)
    for repository_path, body in BODIES_BY_PATH.items():
        assert (sources_dir / "upstream" / repository_path).read_bytes() == body
    stored_paths = sorted(
        path.relative_to(sources_dir / "upstream").as_posix()
        for path in (sources_dir / "upstream").rglob("*")
        if path.is_file()
    )
    assert stored_paths == sorted(EXPECTED_FILE_PATHS)
    assert lock.commit_sha == COMMIT_SHA
    assert lock.tag == "v1.6.0"
    assert lock.retrieved_date == "2026-11-11"
    assert lock.published_date == "2026-10-22"
    assert lock.importer_format == "nist-800-53-rev5-oscal-1"
    assert lock.repository_url == "https://github.com/usnistgov/oscal-content"
    assert read_source_lock(sources_dir / "source.json") == lock


def test_fetch_resolves_an_annotated_tag(tmp_path):
    tag_object_url = f"https://api.github.com/repos/{REPOSITORY}/git/tags/abc"
    opener = full_opener()
    opener.bodies_by_url[REFERENCE_URL] = json.dumps(
        {"object": {"type": "tag", "sha": "abc", "url": tag_object_url}}
    ).encode()
    opener.bodies_by_url[tag_object_url] = json.dumps({"object": {"type": "commit", "sha": COMMIT_SHA}}).encode()

    assert fetch("v1.6.0", tmp_path, "2026-11-11", opener).commit_sha == COMMIT_SHA


@pytest.mark.parametrize("bad_tag", ["", ".", "..", "../x", "a/b", "a b", "a\\b", "tag?x"])
def test_fetch_rejects_invalid_tag_without_requests(tmp_path, bad_tag):
    opener = FakeOpener({})
    with pytest.raises(ValueError, match="Invalid tag"):
        fetch(bad_tag, tmp_path, "2026-11-11", opener)
    assert opener.requests == []
    assert list(tmp_path.iterdir()) == []


def test_failed_download_leaves_existing_upstream_untouched(tmp_path):
    upstream_dir = tmp_path / "upstream"
    upstream_dir.mkdir()
    (upstream_dir / "LICENSE.md").write_bytes(b"old")
    opener = full_opener()
    del opener.bodies_by_url[f"{RAW_URL_PREFIX}/{EXPECTED_FILE_PATHS[-1]}"]

    with pytest.raises(KeyError):
        fetch("v1.6.0", tmp_path, "2026-11-11", opener)

    assert (upstream_dir / "LICENSE.md").read_bytes() == b"old"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["upstream"]
    assert sorted(path.name for path in upstream_dir.iterdir()) == ["LICENSE.md"]
