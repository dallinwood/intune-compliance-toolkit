import json

import pytest

from tools.github_fetch import download_pinned_files, list_root_file_names

REPOSITORY = "example/repo"
COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567"
USER_AGENT = "test-agent"


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
    def __init__(self, body):
        self.body = body
        self.requested_urls = []

    def __call__(self, request):
        self.requested_urls.append(request.full_url)
        return FakeResponse(self.body)


def test_list_root_file_names_keeps_files_only_and_sorts_them():
    entries = [
        {"name": "b.json", "type": "file"},
        {"name": "docs", "type": "dir"},
        {"name": "a.json", "type": "file"},
    ]
    opener = FakeOpener(json.dumps(entries).encode())

    assert list_root_file_names(REPOSITORY, COMMIT_SHA, USER_AGENT, opener) == ["a.json", "b.json"]
    assert opener.requested_urls == [f"https://api.github.com/repos/{REPOSITORY}/contents?ref={COMMIT_SHA}"]


@pytest.mark.parametrize("body", [b'{"name": "a"}', b'["a.json"]'])
def test_list_root_file_names_rejects_a_response_that_is_not_a_list_of_objects(body):
    with pytest.raises(ValueError, match="not a list of objects"):
        list_root_file_names(REPOSITORY, COMMIT_SHA, USER_AGENT, FakeOpener(body))


def test_download_pinned_files_writes_the_bytes_unchanged_from_sha_pinned_urls(tmp_path):
    body = b"line one\r\n\xe2\x80\x93 caf\xc3\xa9\r\n"
    opener = FakeOpener(body)

    download_pinned_files(REPOSITORY, COMMIT_SHA, ["a.json", "nested/b.json"], tmp_path, USER_AGENT, opener)

    assert opener.requested_urls == [
        f"https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT_SHA}/a.json",
        f"https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT_SHA}/nested/b.json",
    ]
    assert (tmp_path / "a.json").read_bytes() == body
    assert (tmp_path / "nested" / "b.json").read_bytes() == body


def test_download_pinned_files_rejects_a_branch_name_instead_of_a_sha(tmp_path):
    with pytest.raises(ValueError, match="Invalid commit sha"):
        download_pinned_files(REPOSITORY, "main", ["a.json"], tmp_path, USER_AGENT, FakeOpener(b""))
