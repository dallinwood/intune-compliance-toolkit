import json
import re
import urllib.error
import urllib.request
from collections.abc import Iterable
from pathlib import Path

NETWORK_TIMEOUT_SECONDS = 60
COMMIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
DATE_PREFIX_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}")


def default_opener(request: urllib.request.Request):
    return urllib.request.urlopen(request, timeout=NETWORK_TIMEOUT_SECONDS)


def validate_tag(tag: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", tag) or tag in (".", ".."):
        raise ValueError(f"Invalid tag name: {tag!r}")


def validate_commit_sha(commit_sha: str) -> None:
    if not COMMIT_SHA_PATTERN.fullmatch(commit_sha):
        raise ValueError(f"Invalid commit sha: {commit_sha!r}")


def build_request(
    url: str, user_agent: str, accept: str | None = None
) -> urllib.request.Request:
    headers = {"User-Agent": user_agent}
    if accept is not None:
        headers["Accept"] = accept
    return urllib.request.Request(url, headers=headers)


def get_json(url: str, user_agent: str, opener) -> dict:
    request = build_request(url, user_agent, accept="application/vnd.github+json")
    with opener(request) as response:
        return json.loads(response.read())


def resolve_tag_commit(
    repository: str, tag: str, user_agent: str, opener=default_opener
) -> str:
    validate_tag(tag)
    reference = get_json(
        f"https://api.github.com/repos/{repository}/git/ref/tags/{tag}", user_agent, opener
    )
    target = reference.get("object", {})
    if target.get("type") == "tag" and "url" in target:
        target = get_json(target["url"], user_agent, opener).get("object", {})
    if target.get("type") != "commit" or "sha" not in target:
        raise ValueError(f"Tag {tag!r} does not resolve to a commit")
    return target["sha"]


def fetch_release_published_date(
    repository: str, tag: str, user_agent: str, opener=default_opener
) -> str:
    validate_tag(tag)
    try:
        release = get_json(
            f"https://api.github.com/repos/{repository}/releases/tags/{tag}", user_agent, opener
        )
    except urllib.error.HTTPError as problem:
        if problem.code != 404:
            raise
        problem.close()
        raise ValueError(
            f"{repository} has no GitHub Release for tag {tag!r} (HTTP 404). "
            "The tag may exist without a GitHub Release, which this importer needs for the published date."
        ) from problem
    published_at = release.get("published_at")
    if not isinstance(published_at, str) or not DATE_PREFIX_PATTERN.match(published_at):
        raise ValueError(f"Release {tag!r} has no usable published_at date")
    return published_at[:10]


def list_root_file_names(
    repository: str, commit_sha: str, user_agent: str, opener=default_opener
) -> list[str]:
    validate_commit_sha(commit_sha)
    request = build_request(
        f"https://api.github.com/repos/{repository}/contents?ref={commit_sha}",
        user_agent,
        accept="application/vnd.github+json",
    )
    with opener(request) as response:
        entries = json.loads(response.read())
    if not isinstance(entries, list) or not all(isinstance(entry, dict) for entry in entries):
        raise ValueError(f"{repository} root listing is not a list of objects")
    return sorted(entry["name"] for entry in entries if entry.get("type") == "file")


def download_pinned_files(
    repository: str,
    commit_sha: str,
    file_names: Iterable[str],
    destination_dir: Path,
    user_agent: str,
    opener=default_opener,
) -> None:
    validate_commit_sha(commit_sha)
    for file_name in file_names:
        url = f"https://raw.githubusercontent.com/{repository}/{commit_sha}/{file_name}"
        with opener(build_request(url, user_agent)) as response:
            body = response.read()
        destination_path = destination_dir / file_name
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        destination_path.write_bytes(body)
