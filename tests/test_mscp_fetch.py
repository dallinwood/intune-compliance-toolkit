import io
import json
import tarfile
from pathlib import Path

import pytest

from tools.mscp_fetch import (
    MSCP_REPOSITORY,
    download_tarball,
    extract_upstream_subset,
    fetch,
    resolve_tag_commit,
)
from tools.mscp_source_lock import read_source_lock

TOP_FOLDER = "macos_security-release_27.0"
RULE_BYTES = b"id: a\r\ntitle: caf\xc3\xa9\r\n"


def add_file(archive, name, data):
    info = tarfile.TarInfo(f"{TOP_FOLDER}/{name}")
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))


def build_tarball(path, extra_members=()):
    with tarfile.open(path, "w:gz") as archive:
        add_file(archive, "src/mscp/data/rules/os/a.yaml", RULE_BYTES)
        add_file(archive, "src/mscp/data/baselines/macos/x.yaml", b"x")
        add_file(archive, "src/mscp/data/baselines/ios/y.yaml", b"y")
        add_file(archive, "src/mscp/data/schema/mscp_rule.json", b"{}")
        add_file(archive, "src/mscp/data/schema/other.json", b"{}")
        add_file(archive, "LICENSE.md", b"CC BY 4.0")
        add_file(archive, "CHANGELOG.md", b"changes")
        add_file(archive, "README.md", b"readme")
        symlink = tarfile.TarInfo(f"{TOP_FOLDER}/rules")
        symlink.type = tarfile.SYMTYPE
        symlink.linkname = "src/mscp/data/rules"
        archive.addfile(symlink)
        hardlink = tarfile.TarInfo(f"{TOP_FOLDER}/src/mscp/data/rules/os/hard.yaml")
        hardlink.type = tarfile.LNKTYPE
        hardlink.linkname = f"{TOP_FOLDER}/src/mscp/data/rules/os/a.yaml"
        archive.addfile(hardlink)
        nested_symlink = tarfile.TarInfo(f"{TOP_FOLDER}/src/mscp/data/rules/os/soft.yaml")
        nested_symlink.type = tarfile.SYMTYPE
        nested_symlink.linkname = "a.yaml"
        archive.addfile(nested_symlink)
        for name, data in extra_members:
            add_file(archive, name, data)
    return path


@pytest.fixture
def tarball(tmp_path):
    return build_tarball(tmp_path / "release.tar.gz")


def test_extracts_only_subset(tarball, tmp_path):
    written = extract_upstream_subset(tarball, tmp_path / "upstream")
    assert written == [
        "CHANGELOG.md",
        "LICENSE.md",
        "baselines/macos/x.yaml",
        "rules/os/a.yaml",
        "schema/mscp_rule.json",
    ]
    assert sorted(
        path.relative_to(tmp_path / "upstream").as_posix()
        for path in (tmp_path / "upstream").rglob("*")
        if path.is_file()
    ) == written


def test_bytes_identical(tarball, tmp_path):
    extract_upstream_subset(tarball, tmp_path / "upstream")
    assert (tmp_path / "upstream/rules/os/a.yaml").read_bytes() == RULE_BYTES


def test_symlink_and_hardlink_skipped(tarball, tmp_path):
    written = extract_upstream_subset(tarball, tmp_path / "upstream")
    assert "rules/os/hard.yaml" not in written
    assert "rules/os/soft.yaml" not in written
    assert not (tmp_path / "upstream/rules/os/hard.yaml").exists()
    assert not (tmp_path / "upstream/rules/os/soft.yaml").exists()


@pytest.mark.parametrize(
    "member_name",
    [
        "src/mscp/data/rules/../../../evil",
        "/etc/evil",
        "src/mscp/data/rules/c:evil",
        "src/mscp/data/rules/back\slash",
    ],
)
def test_unsafe_path_raises_and_leaves_upstream_unchanged(tmp_path, member_name):
    tarball_path = build_tarball(tmp_path / "bad.tar.gz", [(member_name, b"evil")])
    upstream_dir = tmp_path / "upstream"
    upstream_dir.mkdir()
    (upstream_dir / "keep.txt").write_text("keep")
    with pytest.raises(ValueError):
        extract_upstream_subset(tarball_path, upstream_dir)
    assert [path.name for path in upstream_dir.iterdir()] == ["keep.txt"]
    assert [path.name for path in tmp_path.iterdir() if path.is_dir()] == ["upstream"]


def test_absolute_path_member_raises(tmp_path):
    tarball_path = tmp_path / "abs.tar.gz"
    with tarfile.open(tarball_path, "w:gz") as archive:
        info = tarfile.TarInfo("//etc/evil")
        info.size = 1
        archive.addfile(info, io.BytesIO(b"x"))
    with pytest.raises(ValueError):
        extract_upstream_subset(tarball_path, tmp_path / "upstream")


def test_existing_upstream_replaced(tarball, tmp_path):
    upstream_dir = tmp_path / "upstream"
    upstream_dir.mkdir()
    (upstream_dir / "stale.txt").write_text("stale")
    extract_upstream_subset(tarball, upstream_dir)
    assert not (upstream_dir / "stale.txt").exists()
    assert (upstream_dir / "LICENSE.md").exists()


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


REF_URL = f"https://api.github.com/repos/{MSCP_REPOSITORY}/git/ref/tags/release_27.0"
TAG_OBJECT_URL = f"https://api.github.com/repos/{MSCP_REPOSITORY}/git/tags/abc"


def test_resolve_annotated_tag():
    opener = FakeOpener(
        {
            REF_URL: json.dumps(
                {"object": {"type": "tag", "sha": "abc", "url": TAG_OBJECT_URL}}
            ).encode(),
            TAG_OBJECT_URL: json.dumps({"object": {"type": "commit", "sha": "c0ffee"}}).encode(),
        }
    )
    assert resolve_tag_commit("release_27.0", opener) == "c0ffee"
    for request in opener.requests:
        assert request.get_header("User-agent") == "intune-compliance-toolkit-mscp-import"
        assert request.get_header("Accept") == "application/vnd.github+json"


def test_resolve_lightweight_tag():
    opener = FakeOpener(
        {REF_URL: json.dumps({"object": {"type": "commit", "sha": "deadbeef"}}).encode()}
    )
    assert resolve_tag_commit("release_27.0", opener) == "deadbeef"
    assert len(opener.requests) == 1


def test_download_tarball(tmp_path, tarball):
    url = f"https://github.com/{MSCP_REPOSITORY}/archive/refs/tags/release_27.0.tar.gz"
    opener = FakeOpener({url: tarball.read_bytes()})
    destination_dir = tmp_path / "downloads"
    destination_dir.mkdir()
    downloaded = download_tarball("release_27.0", destination_dir, opener)
    assert downloaded.parent == destination_dir
    assert downloaded.read_bytes() == tarball.read_bytes()
    assert opener.requests[0].get_header("User-agent") == "intune-compliance-toolkit-mscp-import"


def test_fetch_writes_upstream_and_source_lock(tmp_path, tarball):
    tarball_url = f"https://github.com/{MSCP_REPOSITORY}/archive/refs/tags/release_27.0.tar.gz"
    opener = FakeOpener(
        {
            REF_URL: json.dumps({"object": {"type": "commit", "sha": "deadbeef"}}).encode(),
            tarball_url: tarball.read_bytes(),
        }
    )
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    lock = fetch("release_27.0", sources_dir, "2026-10-20", opener)
    assert lock.commit_sha == "deadbeef"
    assert lock.repository_url == "https://github.com/usnistgov/macos_security"
    assert read_source_lock(sources_dir / "source.json") == lock
    assert lock.retrieved_date == "2026-10-20"
    assert (sources_dir / "upstream/LICENSE.md").read_bytes() == b"CC BY 4.0"
