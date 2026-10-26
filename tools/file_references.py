"""Checks for the files a rule may reference instead of inlining them.

A check entry or remediation step names a script with `shell_file`, and a
remediation payload names its content with `data_file` (design
2026-10-26-multi-target-checks-design.md, section 7). Each path is
repo-root relative and starts with `baselines/`. The web UI repeats the path,
extension and exactly-one rules in webui/src/logic/fileReferences.ts, the
rule schema repeats them as patterns, and all three are pinned by
tests/fixtures/overlays/cases.json. Only this side can read the files, so
existence, encoding, line endings and content are checked here alone.
"""

import json
import re
from pathlib import Path

REFERENCE_PREFIX = "baselines/"
# Every segment after baselines/ is plain: no percent-encoding, query or
# fragment characters a browser would reinterpret, no empty segment, and no
# leading dot (so no . or .. segment, and nothing the publish copy skips).
PATH_SEGMENT_PATTERN = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*")
SCRIPT_EXTENSIONS_BY_LANGUAGE = {
    "powershell": (".ps1",),
    "bash": (".sh",),
    "zsh": (".sh",),
    "python": (".py",),
}
TEXT_PAYLOAD_EXTENSIONS = (".mobileconfig", ".plist", ".json", ".xml", ".reg", ".admx", ".adml")
BINARY_PAYLOAD_EXTENSIONS = (".pol", ".intunewin")
PAYLOAD_EXTENSIONS = TEXT_PAYLOAD_EXTENSIONS + BINARY_PAYLOAD_EXTENSIONS
ODV_PLACEHOLDER = "$ODV"


def _has_extension(path: str, extensions: tuple[str, ...]) -> bool:
    """Case-sensitive: extensions are lowercase, as in the schema."""
    return any(path.endswith(extension) for extension in extensions)


def _path_problem(path: object) -> str | None:
    if not isinstance(path, str) or not path.startswith(REFERENCE_PREFIX):
        return f"must be a path starting with {REFERENCE_PREFIX!r}, got {path!r}"
    segments = path[len(REFERENCE_PREFIX):].split("/")
    if not all(PATH_SEGMENT_PATTERN.fullmatch(segment) for segment in segments):
        return (
            "must have only plain path segments after baselines/ (letters, digits, '.', '_' and '-', "
            f"not starting with '.'), got {path!r}"
        )
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
    if not _has_extension(path, allowed):
        return f"must end in {' or '.join(allowed)} for {language}, got {path!r}"
    return None


def payload_file_problem(path: object) -> str | None:
    """The path and extension rules for a data_file (no file access)."""
    problem = _path_problem(path)
    if problem:
        return problem
    if not _has_extension(path, PAYLOAD_EXTENSIONS):
        return f"must end in one of {', '.join(PAYLOAD_EXTENSIONS)}, got {path!r}"
    return None


def is_binary_payload(path: str) -> bool:
    return _has_extension(path, BINARY_PAYLOAD_EXTENSIONS)


def _read_text(path: str, repository_root: Path) -> tuple[str | None, str | None]:
    """(text, problem): the file as UTF-8 text with LF line endings."""
    file_path = repository_root / path
    if not file_path.is_file():
        return None, f"{path} does not exist"
    content = file_path.read_bytes()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return None, f"{path} is not UTF-8 text; re-save it as UTF-8"
    if "\r" in text:
        return None, f"{path} must use LF line endings"
    return text, None


def _script_content_problem(path: str, repository_root: Path, is_check: bool) -> str | None:
    text, problem = _read_text(path, repository_root)
    if problem:
        return problem
    if text.strip() == "":
        return f"{path} is empty"
    # The details and settings export decide how $ODV is substituted from the
    # rule as stored, without reading script files, so a check script must
    # not depend on it until they do.
    if is_check and ODV_PLACEHOLDER in text:
        return f"{path} contains {ODV_PLACEHOLDER}, which a check script file cannot use yet; inline the check instead"
    return None


def _payload_content_problem(path: str, repository_root: Path) -> str | None:
    if is_binary_payload(path):
        return None if (repository_root / path).is_file() else f"{path} does not exist"
    text, problem = _read_text(path, repository_root)
    if problem:
        return problem
    if path.endswith(".json"):
        try:
            json.loads(text)
        except ValueError as parse_problem:
            return f"{path} is not valid JSON ({parse_problem})"
    return None


def _script_entries(rule: dict):
    """(where, entry, language, is_check) for every check entry and remediation step."""
    for target, target_check in (rule.get("check") or {}).items():
        if not isinstance(target_check, dict):
            continue
        language = target_check.get("language")
        if isinstance(target_check.get("default"), dict):
            yield f"check.{target}.default", target_check["default"], language, True
        for version, entry in (target_check.get("by_version") or {}).items():
            if isinstance(entry, dict):
                yield f"check.{target}.by_version.{version}", entry, language, True
    for target, target_remediation in (rule.get("remediation") or {}).items():
        if not isinstance(target_remediation, dict):
            continue
        for position, step in enumerate(target_remediation.get("steps") or []):
            if isinstance(step, dict):
                yield f"remediation.{target}.steps[{position}]", step, step.get("language"), False


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
    for where, entry, language, is_check in _script_entries(rule):
        problem = exactly_one_problem(entry, "shell", "shell_file")
        if problem is None and "shell_file" in entry:
            path = entry["shell_file"]
            problem = script_file_problem(path, language) or _script_content_problem(path, repository_root, is_check)
        if problem:
            errors.append(f"{where}: {problem}")
    for where, payload in _payload_entries(rule):
        problem = exactly_one_problem(payload, "data", "data_file")
        if problem is None and "data_file" in payload:
            path = payload["data_file"]
            problem = payload_file_problem(path) or _payload_content_problem(path, repository_root)
        if problem:
            errors.append(f"{where}: {problem}")
    return errors
