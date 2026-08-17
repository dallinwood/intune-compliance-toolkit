"""PostToolUse hook: validate a rule JSON file against baselines/_rule.schema.json right after it's written.

Reads the Write/Edit tool's hook payload from stdin. If the touched file is a
rule file under baselines/ (not an underscore-prefixed generated artifact
like _index.json or _rule.schema.json itself), runs tools/validate_rules.py
against just that file so a schema violation surfaces immediately instead of
at the next manual review.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def touched_file_path(payload):
    tool_input = payload.get("tool_input", {}) or {}
    tool_response = payload.get("tool_response", {}) or {}
    return tool_input.get("file_path") or tool_response.get("filePath") or ""


def is_rule_file(path):
    path = Path(path)
    return "baselines" in path.parts and path.suffix == ".json" and not path.name.startswith("_")


def main():
    payload = json.load(sys.stdin)
    file_path = touched_file_path(payload)
    if not file_path or not is_rule_file(file_path):
        return 0

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "tools" / "validate_rules.py"), file_path],
        capture_output=True,
        text=True,
    )
    if "ModuleNotFoundError: No module named 'jsonschema'" in result.stderr:
        sys.stderr.write(
            "Skipping rule validation: jsonschema isn't installed for this interpreter "
            "(pip install -r requirements-dev.txt).\n"
        )
        return 0
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
