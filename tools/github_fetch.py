import json
import re
import urllib.request

NETWORK_TIMEOUT_SECONDS = 60
COMMIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")


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
