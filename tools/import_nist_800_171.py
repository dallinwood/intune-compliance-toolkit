"""Import a NIST SP 800-171 Rev. 3 OSCAL release into the normalized rule library under baselines/nist_800_171/releases/."""

import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.json_output import read_json_rejecting_duplicates, write_json
from tools.library_output import SCHEMA_VERSION, index_entry
from tools.nist_800_171_fetch import IMPORTER_FORMAT, fetch
from tools.nist_800_171_normalize import (
    CATALOG_PATH,
    LICENSE,
    REPOSITORY_URL,
    SOURCE_NAME,
    framework_version,
    normalize_catalog,
)
from tools.generate_mscp_nist_800_171_mapping import regenerate_after_import
from tools.release_import import SourceImporter, run_cli
from tools.source_lock import SourceLock

SOURCE_DISPLAY_NAME = "NIST SP 800-171 Rev. 3"


def read_catalog(upstream_dir: Path) -> dict:
    return read_json_rejecting_duplicates(upstream_dir / CATALOG_PATH, "upstream file")


def build_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
    rules = normalize_catalog(read_catalog(upstream_dir), lock)
    (tree_dir / "rules").mkdir(parents=True)
    entries = []
    for rule in rules:
        requirement_number = rule["id"].removeprefix(f"{SOURCE_NAME}.")
        rule_file = f"rules/{requirement_number}.json"
        write_json(tree_dir / rule_file, rule)
        entries.append(index_entry(rule, rule_file))
    write_json(
        tree_dir / "_index.json",
        {"schema_version": SCHEMA_VERSION, "source": SOURCE_NAME, "rules": entries},
    )
    return len(entries)


def release_label(tag: str, upstream_dir: Path) -> str:
    return framework_version(read_catalog(upstream_dir))


IMPORTER = SourceImporter(
    name=SOURCE_NAME,
    display_name=SOURCE_DISPLAY_NAME,
    provenance="official",
    repository_url=REPOSITORY_URL,
    license=LICENSE,
    fetch=fetch,
    build_rule_tree_by_format={IMPORTER_FORMAT: build_rule_tree},
    release_label=release_label,
    after_import=regenerate_after_import,
)


def main(argv: list[str] | None = None) -> int:
    return run_cli(IMPORTER, argv)


if __name__ == "__main__":
    sys.exit(main())
