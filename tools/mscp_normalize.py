"""Convert upstream mSCP rule YAML into the project's v5 rule JSON shape."""

import json
import re

import yaml

from tools.library_output import SCHEMA_VERSION, UnsupportedUpstreamData
from tools.source_lock import SourceLock

MANUAL_TAG_PRIORITY = ("manual", "inherent", "permanent", "n_a", "not_applicable", "supplemental")

LICENSE = {
    "name": "CC BY 4.0",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "rights_holder": "NIST macOS Security Compliance Project contributors",
    "modified": True,
}

MACOS_TARGET = "macOS"
MSCP_SCRIPT_LANGUAGE = "bash"
VERSION_KEY_PATTERN = re.compile(r"^\d+\.\d+$")
ODV_PLACEHOLDER = "$ODV"
VENDOR_DESCRIPTION_MARKER = "Vendor Description"
UPSTREAM_DATA_DIRECTORY = "src/mscp/data/"

TOP_LEVEL_KEYS = {
    "id", "title", "discussion", "references", "platforms", "tags", "odv",
    "mobileconfig_info", "ddm_info",
}
MACOS_FIXED_KEYS = {"enforcement_info", "introduced"}
VERSION_ENTRY_KEYS = {"benchmarks", "enforcement_info", "mobileconfig_info"}
ENFORCEMENT_INFO_KEYS = {"check", "fix"}
CHECK_KEYS = {"shell", "result", "additional_info"}
VERSION_CHECK_KEYS = CHECK_KEYS | {"fix"}
FIX_KEYS = {"shell", "additional_info", "result"}
RESULT_TYPES = ("integer", "string", "base64")
ODV_DATATYPES = ("number", "string", "enum", "regex")
ODV_NON_BENCHMARK_KEYS = {"hint", "recommended"}


class _FloatFreeSafeLoader(yaml.SafeLoader):
    """SafeLoader that keeps float-looking scalars (such as 8.10) as strings."""


_FloatFreeSafeLoader.yaml_implicit_resolvers = {
    first_character: [
        (tag, pattern) for tag, pattern in resolvers if tag != "tag:yaml.org,2002:float"
    ]
    for first_character, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def _construct_mapping_rejecting_duplicates(loader, node, deep=False):
    seen_keys = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen_keys:
            raise yaml.constructor.ConstructorError(
                None, None, f"duplicate mapping key {key!r}", key_node.start_mark
            )
        seen_keys.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)


_FloatFreeSafeLoader.construct_mapping = _construct_mapping_rejecting_duplicates


def load_mscp_yaml(text: str) -> dict:
    return yaml.load(text, Loader=_FloatFreeSafeLoader)


def _require_known_keys(mapping: dict, allowed: set, where: str, rule_id: str) -> None:
    if not isinstance(mapping, dict):
        raise UnsupportedUpstreamData(f"{rule_id}: {where} must be a mapping")
    unknown = sorted(str(key) for key in mapping if key not in allowed)
    if unknown:
        raise UnsupportedUpstreamData(f"{rule_id}: unsupported keys in {where}: {unknown}")


def _iter_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from _iter_strings(key)
            yield from _iter_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_strings(child)


def _normalize_result(result, where: str, rule_id: str) -> dict | None:
    if result == {}:
        return None
    if not isinstance(result, dict) or len(result) != 1:
        raise UnsupportedUpstreamData(
            f"{rule_id}: {where} result must have exactly one key of {list(RESULT_TYPES)}"
        )
    (result_type, value), = result.items()
    if result_type not in RESULT_TYPES:
        raise UnsupportedUpstreamData(f"{rule_id}: {where} has unknown result type {result_type!r}")
    if result_type == "integer":
        is_plain_integer = isinstance(value, int) and not isinstance(value, bool)
        if not is_plain_integer and value != ODV_PLACEHOLDER:
            raise UnsupportedUpstreamData(
                f"{rule_id}: {where} integer result must be an integer or {ODV_PLACEHOLDER}"
            )
    elif not isinstance(value, str):
        raise UnsupportedUpstreamData(f"{rule_id}: {where} {result_type} result must be a string")
    return {"type": result_type, "value": value}


def _normalize_check(check, where: str, rule_id: str, allowed_keys: set = CHECK_KEYS) -> dict:
    _require_known_keys(check, allowed_keys, where, rule_id)
    if "result" not in check:
        raise UnsupportedUpstreamData(f"{rule_id}: {where} has no result")
    return {
        "shell": check.get("shell"),
        "result": _normalize_result(check["result"], where, rule_id),
        "additional_info": check.get("additional_info"),
    }


def _normalize_fix(fix, where: str, rule_id: str) -> dict:
    _require_known_keys(fix, FIX_KEYS, where, rule_id)
    return {"shell": fix.get("shell"), "additional_info": fix.get("additional_info")}


def _enforcement_info(container: dict, where: str, rule_id: str) -> dict:
    info = container.get("enforcement_info", {})
    _require_known_keys(info, ENFORCEMENT_INFO_KEYS, f"{where} enforcement_info", rule_id)
    return info


def _normalize_benchmarks(version_entry: dict, where: str, rule_id: str) -> list:
    benchmarks = version_entry.get("benchmarks", [])
    if not isinstance(benchmarks, list):
        raise UnsupportedUpstreamData(f"{rule_id}: {where} benchmarks must be a list")
    normalized_benchmarks = []
    for benchmark in benchmarks:
        _require_known_keys(benchmark, {"name", "severity"}, f"{where} benchmark", rule_id)
        if not isinstance(benchmark.get("name"), str):
            raise UnsupportedUpstreamData(f"{rule_id}: {where} benchmark needs a string name")
        normalized_benchmarks.append({"name": benchmark["name"], "severity": benchmark.get("severity")})
    return normalized_benchmarks


def _version_parts(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def _applicability_sort_key(entry: dict) -> tuple:
    version = entry["version"]
    version_parts = _version_parts(version) if version is not None else ()
    return (entry["target"] is not None, entry["target"] or "", version is not None, version_parts)


def _fix_has_content(fix: dict) -> bool:
    return fix["shell"] is not None or fix["additional_info"] is not None


def _remediation_step(fix: dict, versions: list[str] | None) -> dict:
    return {
        "name": None,
        "language": MSCP_SCRIPT_LANGUAGE,
        "shell": fix["shell"],
        "additional_info": fix["additional_info"],
        "versions": versions,
    }


def _remediation_steps(default_fix: dict, fix_by_version: dict, listed_versions: list[str]) -> list[dict]:
    """The default fix first, for the versions without their own, then each version's fix.

    A fix with neither a shell nor additional_info gives no step, and neither
    does a default fix that every listed version overrides (the schema has
    no empty versions list, and such a fix would apply nowhere).
    """
    steps = []
    if _fix_has_content(default_fix):
        if not fix_by_version or not listed_versions:
            steps.append(_remediation_step(default_fix, None))
        else:
            uncovered_versions = sorted(
                (version for version in listed_versions if version not in fix_by_version), key=_version_parts
            )
            if uncovered_versions:
                steps.append(_remediation_step(default_fix, uncovered_versions))
    for version in sorted(fix_by_version, key=_version_parts):
        if _fix_has_content(fix_by_version[version]):
            steps.append(_remediation_step(fix_by_version[version], [version]))
    return steps


def _remediation_payloads(mobileconfig_info, mobileconfig_by_version: dict, ddm_info) -> list[dict]:
    payloads = []
    if mobileconfig_info is not None:
        payloads.append({"kind": "mobileconfig", "versions": None, "data": mobileconfig_info})
    for version in sorted(mobileconfig_by_version, key=_version_parts):
        payloads.append({"kind": "mobileconfig", "versions": [version], "data": mobileconfig_by_version[version]})
    if ddm_info is not None:
        payloads.append({"kind": "ddm", "versions": None, "data": ddm_info})
    return payloads


def _remediation(
    default_fix: dict,
    fix_by_version: dict,
    listed_versions: list[str],
    mobileconfig_info,
    mobileconfig_by_version: dict,
    ddm_info,
) -> dict | None:
    steps = _remediation_steps(default_fix, fix_by_version, listed_versions)
    payloads = _remediation_payloads(mobileconfig_info, mobileconfig_by_version, ddm_info)
    if not steps and not payloads:
        return None
    return {MACOS_TARGET: {"steps": steps, "payloads": payloads}}


def _manual_reason(tags: list, upstream_rule_id: str, has_check: bool):
    for tag in MANUAL_TAG_PRIORITY:
        if tag in tags:
            return "n_a" if tag == "not_applicable" else tag
    if upstream_rule_id.startswith("supplemental"):
        return "supplemental"
    if not has_check:
        return "no_check"
    return None


def _architecture(tags: list, rule_id: str):
    present = [tag for tag in ("arm64", "i386") if tag in tags]
    if len(present) > 1:
        raise UnsupportedUpstreamData(f"{rule_id}: tagged with both arm64 and i386")
    return present[0] if present else None


def _normalize_odv(odv, macos_benchmark_names: set, rule_id: str):
    if odv is None:
        return None
    if not isinstance(odv, dict):
        raise UnsupportedUpstreamData(f"{rule_id}: odv must be a mapping")
    hint = odv.get("hint")
    if not isinstance(hint, dict) or "recommended" not in odv:
        raise UnsupportedUpstreamData(f"{rule_id}: odv needs a hint mapping and a recommended value")
    if hint.get("datatype") not in ODV_DATATYPES:
        raise UnsupportedUpstreamData(f"{rule_id}: odv datatype {hint.get('datatype')!r} is unsupported")
    return {
        "datatype": hint["datatype"],
        "description": hint.get("description"),
        "validation": hint.get("validation"),
        "recommended": odv["recommended"],
        "by_benchmark": {
            name: value
            for name, value in odv.items()
            if name not in ODV_NON_BENCHMARK_KEYS and name in macos_benchmark_names
        },
    }


def normalize_rule(upstream: dict, upstream_path: str, lock: SourceLock) -> dict | None:
    rule_id = str(upstream.get("id", "<unknown>")) if isinstance(upstream, dict) else "<unknown>"
    _require_known_keys(upstream, TOP_LEVEL_KEYS, "rule", rule_id)
    for required_key in ("id", "title", "discussion"):
        if required_key not in upstream:
            raise UnsupportedUpstreamData(f"{rule_id}: missing {required_key}")
    if any(VENDOR_DESCRIPTION_MARKER in text for text in _iter_strings(upstream)):
        raise UnsupportedUpstreamData(
            f"{rule_id}: contains {VENDOR_DESCRIPTION_MARKER!r} text, which is excluded from the licence grant"
        )

    platforms = upstream.get("platforms", {})
    if not isinstance(platforms, dict):
        raise UnsupportedUpstreamData(f"{rule_id}: platforms must be a mapping")
    if "macOS" not in platforms:
        return None
    macos = platforms["macOS"]
    if not isinstance(macos, dict):
        raise UnsupportedUpstreamData(f"{rule_id}: platforms.macOS must be a mapping")

    version_keys = [key for key in macos if VERSION_KEY_PATTERN.match(str(key))]
    _require_known_keys(macos, MACOS_FIXED_KEYS | set(version_keys), "platforms.macOS", rule_id)

    benchmarks_by_version = {}
    check_by_version = {}
    fix_by_version = {}
    mobileconfig_by_version = {}
    for version in version_keys:
        version_entry = macos[version]
        where = f"platforms.macOS.{version}"
        _require_known_keys(version_entry, VERSION_ENTRY_KEYS, where, rule_id)
        benchmarks_by_version[version] = _normalize_benchmarks(version_entry, where, rule_id)
        info = _enforcement_info(version_entry, where, rule_id)
        if "check" in info:
            check_by_version[version] = _normalize_check(
                info["check"], f"{where} check", rule_id, VERSION_CHECK_KEYS
            )
            # Upstream sometimes misindents a version's fix so it sits inside its check.
            if "fix" in info["check"]:
                if "fix" in info:
                    raise UnsupportedUpstreamData(f"{rule_id}: {where} has both a nested and a sibling fix")
                fix_by_version[version] = _normalize_fix(info["check"]["fix"], f"{where} check fix", rule_id)
        if "fix" in info:
            fix_by_version[version] = _normalize_fix(info["fix"], f"{where} fix", rule_id)
        if "mobileconfig_info" in version_entry:
            mobileconfig_by_version[version] = version_entry["mobileconfig_info"]

    default_info = _enforcement_info(macos, "platforms.macOS", rule_id)
    default_check = (
        _normalize_check(default_info["check"], "platforms.macOS check", rule_id)
        if "check" in default_info
        else None
    )
    default_fix = (
        _normalize_fix(default_info["fix"], "platforms.macOS fix", rule_id)
        if "fix" in default_info
        else {"shell": None, "additional_info": None}
    )
    check = (
        {
            MACOS_TARGET: {
                "language": MSCP_SCRIPT_LANGUAGE,
                "default": default_check,
                "by_version": check_by_version,
            }
        }
        if default_check is not None or check_by_version
        else None
    )

    raw_tags = upstream.get("tags", [])
    if not isinstance(raw_tags, list) or not all(isinstance(tag, str) for tag in raw_tags):
        raise UnsupportedUpstreamData(f"{rule_id}: tags must be a list of strings")
    tags = sorted(raw_tags)
    manual_reason = _manual_reason(tags, rule_id, check is not None)
    if manual_reason is None and check is not None:
        every_check = [default_check, *check_by_version.values()]
        if any(entry is not None and entry["result"] is None for entry in every_check):
            raise UnsupportedUpstreamData(f"{rule_id}: automated rule has a check with an empty result")
    macos_benchmark_names = {
        benchmark["name"] for benchmarks in benchmarks_by_version.values() for benchmark in benchmarks
    }
    applicability = sorted(
        (
            {"target": MACOS_TARGET, "version": version, "benchmarks": benchmarks}
            for version, benchmarks in benchmarks_by_version.items()
        ),
        key=_applicability_sort_key,
    ) or [{"target": MACOS_TARGET, "version": None, "benchmarks": []}]

    full_rule_id = f"mscp.{rule_id}"
    normalized = {
        "schema_version": SCHEMA_VERSION,
        "id": full_rule_id,
        "title": upstream["title"],
        "discussion": upstream["discussion"],
        "discussion_format": "asciidoc",
        "section_path": section_path_of(upstream_path, full_rule_id),
        "source": {
            "name": "mscp",
            "release_tag": lock.tag,
            "commit_sha": lock.commit_sha,
            "upstream_rule_id": rule_id,
            "upstream_path": upstream_path,
            "upstream_revision": None,
            "upstream_updated": None,
            "upstream_url": (
                f"{lock.repository_url.rstrip('/')}/blob/{lock.commit_sha}/"
                f"{UPSTREAM_DATA_DIRECTORY}{upstream_path}"
            ),
            "license": dict(LICENSE),
        },
        "assessment": {
            "status": "automated" if manual_reason is None else "manual",
            "manual_reason": manual_reason,
        },
        "architecture": _architecture(tags, rule_id),
        "applicability": applicability,
        "tags": tags,
        "references": upstream.get("references") or {},
        "check": check,
        "odv": _normalize_odv(upstream.get("odv"), macos_benchmark_names, rule_id),
        "remediation": _remediation(
            default_fix,
            fix_by_version,
            list(benchmarks_by_version),
            upstream.get("mobileconfig_info"),
            mobileconfig_by_version,
            upstream.get("ddm_info"),
        ),
    }
    if normalized["odv"] is None and any(
        ODV_PLACEHOLDER in text for text in _iter_strings(normalized)
    ):
        raise UnsupportedUpstreamData(
            f"{rule_id}: uses {ODV_PLACEHOLDER} but the rule has no odv block"
        )
    return normalized


def section_path_of(upstream_path: str, rule_id: str) -> list[str]:
    parts = upstream_path.split("/")
    if len(parts) != 3 or parts[0] != "rules" or not parts[1] or not parts[2].endswith(".yaml"):
        raise UnsupportedUpstreamData(
            f"{rule_id}: upstream path {upstream_path!r} is not of the form rules/<section>/<file>.yaml"
        )
    return [parts[1]]
