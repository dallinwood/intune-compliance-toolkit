#!/usr/bin/env bash
# Resolve a python interpreter for validate_edited_rule.py without hardcoding
# one path - a committed hook command that only knows ".venv/Scripts/python.exe"
# fails hard (command not found) on every Write/Edit on a POSIX machine or a
# fresh clone with no venv yet, instead of just skipping validation quietly.
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for candidate in \
  "$REPO_ROOT/.venv/Scripts/python.exe" \
  "$REPO_ROOT/.venv/bin/python" \
  "$(command -v python3 2>/dev/null)" \
  "$(command -v python 2>/dev/null)"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    exec "$candidate" "$REPO_ROOT/tools/hooks/validate_edited_rule.py"
  fi
done

exit 0
