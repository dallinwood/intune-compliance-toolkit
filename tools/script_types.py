"""The check types and remediation types an index entry lists for a rule.

The rule table filters on these without loading each rule's full file.
"""


def check_types(check: dict | None) -> list[str]:
    if check is None:
        return []
    return sorted({item["language"] for items in check.values() for item in items})


def remediation_types(remediation: dict | None) -> list[str]:
    if remediation is None:
        return []
    types: set[str] = set()
    for target_remediation in remediation.values():
        types.update(step["language"] for step in target_remediation["steps"])
        types.update(payload["kind"] for payload in target_remediation["payloads"])
    return sorted(types)
