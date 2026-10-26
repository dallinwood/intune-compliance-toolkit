"""Checks for the files a rule may reference instead of inlining them.

A check entry or remediation step names a script with `shell_file`, and a
remediation payload names its content with `data_file` (design
2026-10-26-multi-target-checks-design.md, section 7). Each path is
repo-root relative and starts with `baselines/`. The web UI repeats the path,
extension and exactly-one rules in webui/src/logic/fileReferences.ts; both
are pinned by tests/fixtures/overlays/cases.json. Only this side can read the
files, so existence, line endings and JSON parsing are checked here alone.
"""

import json
from pathlib import Path, PurePosixPath

REFERENCE_PREFIX = "baselines/"
SCRIPT_EXTENSIONS_BY_LANGUAGE = {
    "powershell": (".ps1",),
    "bash": (".sh",),
    "zsh": (".sh",),
    "python": (".py",),
}
TEXT_PAYLOAD_EXTENSIONS = (".mobileconfig", ".plist", ".json", ".xml", ".reg", ".admx", ".adml")
BINARY_PAYLOAD_EXTENSIONS = (".pol", ".intunewin")
PAYLOAD_EXTENSIONS = TEXT_PAYLOAD_EXTENSIONS + BINARY_PAYLOAD_EXTENSIONS


def _extension(path: str) -> str:
    return PurePosixPath(path).suffix.lower()


def _path_problem(path: object) -> str | None:
    if not isinstance(path, str) or not path.startswith(REFERENCE_PREFIX):
        return f"must be a path starting with {REFERENCE_PREFIX!r}, got {path!r}"
    if "\\" in path or "\n" in path or ":" in path:
        return f"must use forward slashes on one line, got {path!r}"
    if ".." in path.split("/"):
        return f"must not contain a '..' segment, got {path!r}"
    return None


def exactly_one_problem(entry: dict, inline_key: str, file_key: str) -> str | None:
    present = [key for key in (inline_key, file_key) if key in entry]
    if len(present) != 1:
        return f"needs exactly one of {inline_key} and {file_key}, has {present or 'neither'}"
    return None


def script_file_problem(path: object, language: object) -> str | None:
    """The path and extension rules for a shell_file (no file access)."""
    problem = _path_problem(path)
    if problem:
        return problem
    allowed = SCRIPT_EXTENSIONS_BY_LANGUAGE.get(language)
    if allowed is None:
        return f"has no known script extension for language {language!r}"
    if _extension(path) not in allowed:
        return f"must end in {' or '.join(allowed)} for {language}, got {path!r}"
    return None


def payload_file_problem(path: object) -> str | None:
    """The path and extension rules for a data_file (no file access)."""
    problem = _path_problem(path)
    if problem:
        return problem
    if _extension(path) not in PAYLOAD_EXTENSIONS:
        return f"must end in one of {', '.join(PAYLOAD_EXTENSIONS)}, got {path!r}"
    return None


def is_binary_payload(path: str) -> bool:
    return _extension(path) in BINARY_PAYLOAD_EXTENSIONS


def _file_content_problem(path: str, repository_root: Path, *, binary: bool, json_document: bool) -> str | None:
    file_path = repository_root / path
    if not file_path.is_file():
        return f"{path} does not exist"
    if binary:
        return None
    content = file_path.read_bytes()
    if b"\r" in content:
        return f"{path} must use LF line endings"
    if json_document:
        try:
            json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as problem:
            return f"{path} is not valid JSON ({problem})"
    return None


def _script_entries(rule: dict):
    """(where, entry, language) for every check entry and remediation step."""
    for target, target_check in (rule.get("check") or {}).items():
        if not isinstance(target_check, dict):
            continue
        language = target_check.get("language")
        if isinstance(target_check.get("default"), dict):
            yield f"check.{target}.default", target_check["default"], language
        for version, entry in (target_check.get("by_version") or {}).items():
            if isinstance(entry, dict):
                yield f"check.{target}.by_version.{version}", entry, language
    for target, target_remediation in (rule.get("remediation") or {}).items():
        if not isinstance(target_remediation, dict):
            continue
        for position, step in enumerate(target_remediation.get("steps") or []):
            if isinstance(step, dict):
                yield f"remediation.{target}.steps[{position}]", step, step.get("language")


def _payload_entries(rule: dict):
    for target, target_remediation in (rule.get("remediation") or {}).items():
        if not isinstance(target_remediation, dict):
            continue
        for position, payload in enumerate(target_remediation.get("payloads") or []):
            if isinstance(payload, dict):
                yield f"remediation.{target}.payloads[{position}]", payload


def file_reference_errors(rule: dict, repository_root: Path) -> list[str]:
    """Every problem with the rule's shell_file and data_file references."""
    errors: list[str] = []
    for where, entry, language in _script_entries(rule):
        problem = exactly_one_problem(entry, "shell", "shell_file")
        if problem is None and "shell_file" in entry:
            path = entry["shell_file"]
            problem = script_file_problem(path, language) or _file_content_problem(
                path, repository_root, binary=False, json_document=False
            )
        if problem:
            errors.append(f"{where}: {problem}")
    for where, payload in _payload_entries(rule):
        problem = exactly_one_problem(payload, "data", "data_file")
        if problem is None and "data_file" in payload:
            path = payload["data_file"]
            problem = payload_file_problem(path) or _file_content_problem(
                path, repository_root, binary=is_binary_payload(path), json_document=_extension(path) == ".json"
            )
        if problem:
            errors.append(f"{where}: {problem}")
    return errors
