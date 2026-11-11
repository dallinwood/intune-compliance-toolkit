"""Import an mSCP release into the normalized rule library under baselines/mscp/releases/."""

import re
import sys
from pathlib import Path

import yaml

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.json_output import write_json
from tools.library_output import SCHEMA_VERSION, index_entry
from tools.mscp_fetch import IMPORTER_FORMAT, REPOSITORY_URL, fetch
from tools.mscp_normalize import LICENSE, load_mscp_yaml, normalize_rule
from tools.generate_mscp_nist_800_53_mapping import regenerate_after_import
from tools.release_import import SourceImporter, run_cli
from tools.source_lock import SourceLock

SOURCE_NAME = "mscp"
SOURCE_DISPLAY_NAME = "NIST macOS Security Compliance Project"
SAFE_UPSTREAM_ID = re.compile(r"^[A-Za-z0-9_.-]+$")


def discover_rule_paths(upstream_dir: Path) -> list[Path]:
    rules_dir = upstream_dir / "rules"
    if not rules_dir.is_dir():
        raise ValueError(f"{rules_dir}: upstream rules directory not found")
    rule_paths = sorted(
        (
            path
            for path in rules_dir.rglob("*")
            if path.is_file() and not path.name.startswith(".")
        ),
        key=lambda path: path.relative_to(upstream_dir).as_posix(),
    )
    for path in rule_paths:
        if path.suffix != ".yaml":
            raise ValueError(f"{path}: unexpected non-YAML file among upstream rules")
    return rule_paths


def build_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
    (tree_dir / "rules").mkdir(parents=True)
    entries_by_id: dict[str, dict] = {}
    for rule_path in discover_rule_paths(upstream_dir):
        upstream_path = rule_path.relative_to(upstream_dir).as_posix()
        try:
            upstream = load_mscp_yaml(rule_path.read_text(encoding="utf-8"))
        except yaml.YAMLError as problem:
            raise ValueError(f"{upstream_path}: invalid YAML ({problem})") from problem
        rule = normalize_rule(upstream, upstream_path, lock)
        if rule is None:
            continue
        upstream_id = rule["id"].removeprefix(f"{SOURCE_NAME}.")
        if not SAFE_UPSTREAM_ID.fullmatch(upstream_id):
            raise ValueError(f"{upstream_path}: unsafe upstream rule id {upstream_id!r}")
        if upstream_id in entries_by_id:
            raise ValueError(f"{upstream_path}: duplicate upstream rule id {upstream_id}")
        rule_file = f"rules/{upstream_id}.json"
        write_json(tree_dir / rule_file, rule)
        entries_by_id[upstream_id] = index_entry(rule, rule_file)

    ordered_entries = [entries_by_id[upstream_id] for upstream_id in sorted(entries_by_id)]
    write_json(
        tree_dir / "_index.json",
        {"schema_version": SCHEMA_VERSION, "source": SOURCE_NAME, "rules": ordered_entries},
    )
    return len(ordered_entries)


IMPORTER = SourceImporter(
    name=SOURCE_NAME,
    display_name=SOURCE_DISPLAY_NAME,
    repository_url=REPOSITORY_URL,
    license=LICENSE,
    fetch=fetch,
    build_rule_tree_by_format={IMPORTER_FORMAT: build_rule_tree},
    release_label=lambda tag, upstream_dir: tag.removeprefix("release_"),
    after_import=regenerate_after_import,
)


def main(argv: list[str] | None = None) -> int:
    return run_cli(IMPORTER, argv)


if __name__ == "__main__":
    sys.exit(main())
