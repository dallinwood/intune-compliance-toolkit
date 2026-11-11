import json

import pytest

from tools.asd_e4eit_fetch import REPOSITORY, USER_AGENT, fetch
from tools.source_lock import read_source_lock

TAG = "v2026.10.15"
COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567"
REFERENCE_URL = f"https://api.github.com/repos/{REPOSITORY}/git/ref/tags/{TAG}"
RELEASE_URL = f"https://api.github.com/repos/{REPOSITORY}/releases/tags/{TAG}"
LISTING_URL = f"https://api.github.com/repos/{REPOSITORY}/contents?ref={COMMIT_SHA}"
RAW_URL_PREFIX = f"https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT_SHA}"
REFERENCE_BODY = json.dumps({"object": {"type": "commit", "sha": COMMIT_SHA}}).encode()
RELEASE_BODY = json.dumps({"published_at": "2026-10-15T01:02:03Z"}).encode()
PROFILE_NAMES = (
    "E4EIT_boundary-services-domain_profile.json",
    "E4EIT_user-devices-domain_profile.json",
)
UNRELATED_NAMES = (
    "E4EIT_boundary-services-domain_profile.xml",
    "E4EIT_boundary-services-domain_resolved-catalog.json",
    "E4EIT_catalog.xml",
    "LICENSE",
)
FILE_BODIES = {
    "README.md": b"# E4EIT OSCAL\r\nCreative Commons Attribution 4.0\r\n",
    "E4EIT_catalog.json": b'{"catalog": {"title": "caf\xc3\xa9"}}\r\n\xe2\x80\x93 trailing\r\n',
    "E4EIT_mapping-collection.json": b'{"mapping-collection": {}}\n',
    PROFILE_NAMES[0]: b'{"profile": "boundary"}\r\n',
    PROFILE_NAMES[1]: b'{"profile": "devices"}\n',
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


def listing_body(file_names) -> bytes:
    return json.dumps([{"name": name, "type": "file"} for name in file_names]).encode()


def release_bodies(root_file_names, file_bodies=FILE_BODIES) -> dict:
    bodies = {
        REFERENCE_URL: REFERENCE_BODY,
        RELEASE_URL: RELEASE_BODY,
        LISTING_URL: listing_body(root_file_names),
    }
    bodies.update({f"{RAW_URL_PREFIX}/{name}": body for name, body in file_bodies.items()})
    return bodies


def test_user_agent_and_repository():
    assert REPOSITORY == "AustralianCyberSecurityCentre/e4eit-oscal"
    assert USER_AGENT == "intune-compliance-toolkit-asd-e4eit-import"


def test_fetch_downloads_only_the_wanted_files_pinned_to_the_commit(tmp_path):
    opener = FakeOpener(release_bodies([*FILE_BODIES, *UNRELATED_NAMES]))

    lock = fetch(TAG, tmp_path, "2026-11-11", opener)

    requested_urls = [request.full_url for request in opener.requests]
    assert requested_urls == [
        REFERENCE_URL,
        RELEASE_URL,
        LISTING_URL,
        *[f"{RAW_URL_PREFIX}/{name}" for name in FILE_BODIES],
    ]
    assert all(request.get_header("User-agent") == USER_AGENT for request in opener.requests)
    upstream_dir = tmp_path / "upstream"
    assert sorted(path.name for path in upstream_dir.iterdir()) == sorted(FILE_BODIES)
    for name, body in FILE_BODIES.items():
        assert (upstream_dir / name).read_bytes() == body
    assert lock.commit_sha == COMMIT_SHA
    assert lock.tag == TAG
    assert lock.retrieved_date == "2026-11-11"
    assert lock.published_date == "2026-10-15"
    assert lock.importer_format == "asd-e4eit-oscal-1"
    assert lock.repository_url == "https://github.com/AustralianCyberSecurityCentre/e4eit-oscal"
    assert read_source_lock(tmp_path / "source.json") == lock


@pytest.mark.parametrize("bad_tag", ["", ".", "..", "../x", "a/b", "a b", "a\\b", "tag?x"])
def test_fetch_rejects_invalid_tag_without_requests(tmp_path, bad_tag):
    opener = FakeOpener({})
    with pytest.raises(ValueError, match="Invalid tag"):
        fetch(bad_tag, tmp_path, "2026-11-11", opener)
    assert opener.requests == []
    assert list(tmp_path.iterdir()) == []


def test_fetch_fails_when_the_listing_has_no_profiles(tmp_path):
    opener = FakeOpener(release_bodies(["README.md", "E4EIT_catalog.json", *UNRELATED_NAMES]))
    with pytest.raises(ValueError, match="no domain profile files"):
        fetch(TAG, tmp_path, "2026-11-11", opener)
    assert list(tmp_path.iterdir()) == []


def test_failed_download_leaves_existing_upstream_untouched(tmp_path):
    upstream_dir = tmp_path / "upstream"
    upstream_dir.mkdir()
    (upstream_dir / "E4EIT_catalog.json").write_bytes(b"old")
    incomplete_bodies = {name: body for name, body in FILE_BODIES.items() if name != PROFILE_NAMES[1]}
    opener = FakeOpener(release_bodies(list(FILE_BODIES), incomplete_bodies))
    with pytest.raises(KeyError):
        fetch(TAG, tmp_path, "2026-11-11", opener)
    assert (upstream_dir / "E4EIT_catalog.json").read_bytes() == b"old"
    assert sorted(path.name for path in tmp_path.iterdir()) == ["upstream"]
