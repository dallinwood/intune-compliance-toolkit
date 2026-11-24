import io
import json
import tarfile
import urllib.error

import pytest

from tests.test_lockdown_normalize import FIXTURE_SPEC
from tools.lockdown_fetch import IMPORTER_FORMAT, extract_subset, fetch, resolve_branch_commit
from tools.source_lock import read_source_lock

ROLE_COMMIT = "0123456789abcdef0123456789abcdef01234567"
AUDIT_COMMIT = "fedcba9876543210fedcba9876543210fedcba98"
ROLE_URL = FIXTURE_SPEC.role_url
AUDIT_URL = FIXTURE_SPEC.audit_url
TAG = FIXTURE_SPEC.role_tag
ROLE_API = f"https://api.github.com/repos/{FIXTURE_SPEC.role_repository}"
AUDIT_API = f"https://api.github.com/repos/{FIXTURE_SPEC.audit_repository}"
GOSS_BYTES = b"file:\r\n  C:\\x:\r\n    exists: true\r\n"


def tarball_of(top_folder: str, members: dict[str, bytes], extra=()) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name, data in {**members, **dict(extra)}.items():
            info = tarfile.TarInfo(f"{top_folder}/{name}")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        link = tarfile.TarInfo(f"{top_folder}/tasks/linked.yml")
        link.type = tarfile.SYMTYPE
        link.linkname = "main.yml"
        archive.addfile(link)
    return buffer.getvalue()


ROLE_MEMBERS = {
    "LICENSE": b"MIT role",
    "README.md": b"readme",
    "defaults/main/main.yml": b"win22cis_x: 1\r\n",
    "tasks/main.yml": b"- name: t\r\n",
    "tasks/section_1/section_1.1.x.yml": b"- name: u\r\n",
    "tasks/not_yaml.txt": b"no",
    "templates/audit.j2": b"no",
    "site.yml": b"no",
}
AUDIT_MEMBERS = {
    "LICENSE": b"MIT audit",
    "README.md": b"readme",
    "coverage.json": b"[]",
    "goss.yml": b"no",
    "run_audit.ps1": b"no",
    "section_1/section_1.1.x/cis_1.1.1.yml": GOSS_BYTES,
    "section_1/section_1.1.x/notes.yml": b"no",
    "vars/vars.yml": b"no",
}


class FakeResponse:
    def __init__(self, body):
        self.stream = io.BytesIO(body)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def read(self, size=-1):
        return self.stream.read(size)


def build_opener(responses: dict[str, bytes], requested: list[str] | None = None):
    def opener(request):
        if requested is not None:
            requested.append(request.full_url)
        try:
            return FakeResponse(responses[request.full_url])
        except KeyError:
            raise urllib.error.HTTPError(request.full_url, 404, "not found", {}, io.BytesIO(b"")) from None

    return opener


def standard_responses() -> dict[str, bytes]:
    return {
        f"{ROLE_API}/git/ref/tags/{TAG}": json.dumps({"object": {"type": "commit", "sha": ROLE_COMMIT}}).encode(),
        f"{ROLE_API}/releases/tags/{TAG}": json.dumps({"published_at": "2026-10-02T12:00:00Z"}).encode(),
        f"{AUDIT_API}/git/ref/heads/{FIXTURE_SPEC.audit_branch}": json.dumps(
            {"object": {"type": "commit", "sha": AUDIT_COMMIT}}
        ).encode(),
        f"{ROLE_URL}/archive/{ROLE_COMMIT}.tar.gz": tarball_of("Windows-2022-CIS-4.2.0", ROLE_MEMBERS),
        f"{AUDIT_URL}/archive/{AUDIT_COMMIT}.tar.gz": tarball_of("Windows-2022-CIS-Audit-abc", AUDIT_MEMBERS),
    }


def files_under(directory) -> list[str]:
    return sorted(path.relative_to(directory).as_posix() for path in directory.rglob("*") if path.is_file())


def test_fetch_extracts_only_the_needed_subset_of_each_repository(tmp_path):
    fetch(FIXTURE_SPEC, TAG, tmp_path / "release", "2026-11-24", build_opener(standard_responses()))
    assert files_under(tmp_path / "release" / "upstream") == [
        "audit/LICENSE",
        "audit/coverage.json",
        "audit/section_1/section_1.1.x/cis_1.1.1.yml",
        "role/LICENSE",
        "role/defaults/main/main.yml",
        "role/tasks/main.yml",
        "role/tasks/section_1/section_1.1.x.yml",
    ]


def test_fetch_copies_bytes_unchanged(tmp_path):
    fetch(FIXTURE_SPEC, TAG, tmp_path / "release", "2026-11-24", build_opener(standard_responses()))
    upstream = tmp_path / "release" / "upstream"
    assert (upstream / "audit/section_1/section_1.1.x/cis_1.1.1.yml").read_bytes() == GOSS_BYTES
    assert (upstream / "role/defaults/main/main.yml").read_bytes() == b"win22cis_x: 1\r\n"


def test_fetch_records_role_tag_and_commit_audit_branch_and_commit_and_benchmark_version(tmp_path):
    lock = fetch(FIXTURE_SPEC, TAG, tmp_path / "release", "2026-11-24", build_opener(standard_responses()))
    assert lock.tag == TAG
    assert lock.commit_sha == ROLE_COMMIT
    assert lock.repository_url == ROLE_URL
    assert lock.published_date == "2026-10-02"
    assert lock.retrieved_date == "2026-11-24"
    assert lock.importer_format == IMPORTER_FORMAT
    assert lock.details == {
        "audit_repository": FIXTURE_SPEC.audit_repository,
        "audit_branch": FIXTURE_SPEC.audit_branch,
        "audit_commit": AUDIT_COMMIT,
        "benchmark_version": FIXTURE_SPEC.benchmark_version,
    }
    assert read_source_lock(tmp_path / "release" / "source.json") == lock


def test_fetch_downloads_both_repositories_at_their_pinned_commits(tmp_path):
    requested: list[str] = []
    fetch(FIXTURE_SPEC, TAG, tmp_path / "release", "2026-11-24", build_opener(standard_responses(), requested))
    assert f"{ROLE_URL}/archive/{ROLE_COMMIT}.tar.gz" in requested
    assert f"{AUDIT_URL}/archive/{AUDIT_COMMIT}.tar.gz" in requested
    assert all(url.startswith(("https://api.github.com/", "https://github.com/")) for url in requested)


def test_a_missing_audit_archive_leaves_no_release_behind(tmp_path):
    responses = standard_responses()
    del responses[f"{AUDIT_URL}/archive/{AUDIT_COMMIT}.tar.gz"]
    with pytest.raises(urllib.error.HTTPError) as problem:
        fetch(FIXTURE_SPEC, TAG, tmp_path / "release", "2026-11-24", build_opener(responses))
    problem.value.close()
    assert not (tmp_path / "release" / "upstream").exists()
    assert not (tmp_path / "release" / "source.json").exists()


def test_branch_commit_is_resolved_through_the_refs_api():
    opener = build_opener(standard_responses())
    assert resolve_branch_commit(FIXTURE_SPEC.audit_repository, FIXTURE_SPEC.audit_branch, opener) == AUDIT_COMMIT


def test_a_branch_ref_that_is_not_a_commit_is_refused():
    responses = {
        f"{AUDIT_API}/git/ref/heads/latest": json.dumps({"object": {"type": "tag", "sha": AUDIT_COMMIT}}).encode()
    }
    with pytest.raises(ValueError, match="commit"):
        resolve_branch_commit(FIXTURE_SPEC.audit_repository, "latest", build_opener(responses))


@pytest.mark.parametrize("branch", ["../evil", "a b", "", "x?y"])
def test_an_unsafe_branch_name_is_refused(branch):
    with pytest.raises(ValueError, match="branch"):
        resolve_branch_commit(FIXTURE_SPEC.audit_repository, branch, build_opener({}))


@pytest.mark.parametrize(
    "member_name",
    ["tasks/../../evil.yml", "/etc/evil.yml", "tasks/c:evil.yml", "tasks/back\\slash.yml"],
)
def test_an_unsafe_member_path_fails_before_anything_is_written(tmp_path, member_name):
    responses = standard_responses()
    responses[f"{ROLE_URL}/archive/{ROLE_COMMIT}.tar.gz"] = tarball_of(
        "Windows-2022-CIS-4.2.0", ROLE_MEMBERS, [(member_name, b"evil")]
    )
    with pytest.raises(ValueError):
        fetch(FIXTURE_SPEC, TAG, tmp_path / "release", "2026-11-24", build_opener(responses))
    assert not (tmp_path / "release" / "upstream").exists()


def test_members_that_collide_on_a_case_insensitive_filesystem_fail(tmp_path):
    responses = standard_responses()
    responses[f"{ROLE_URL}/archive/{ROLE_COMMIT}.tar.gz"] = tarball_of(
        "Windows-2022-CIS-4.2.0", ROLE_MEMBERS, [("tasks/Main.yml", b"other case")]
    )
    with pytest.raises(ValueError, match="case-insensitive"):
        fetch(FIXTURE_SPEC, TAG, tmp_path / "release", "2026-11-24", build_opener(responses))


def test_extract_subset_ignores_members_outside_the_subset_even_when_they_collide(tmp_path):
    archive_path = tmp_path / "role.tar.gz"
    archive_path.write_bytes(tarball_of("top", ROLE_MEMBERS, [("docs/Readme.md", b"a"), ("docs/README.md", b"b")]))
    written = extract_subset(archive_path, tmp_path / "out", lambda name: name if name == "LICENSE" else None)
    assert written == ["LICENSE"]


def test_an_invalid_tag_is_refused_before_any_request(tmp_path):
    requested: list[str] = []
    with pytest.raises(ValueError):
        fetch(FIXTURE_SPEC, "../x", tmp_path / "release", "2026-11-24", build_opener({}, requested))
    assert requested == []
