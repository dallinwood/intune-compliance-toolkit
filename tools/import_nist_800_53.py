"""Import a NIST SP 800-53 Rev. 5 OSCAL release into the normalized rule library under baselines/nist_800_53/releases/."""

import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.json_output import read_json_rejecting_duplicates, write_json
from tools.library_output import SCHEMA_VERSION, index_entry
from tools.nist_800_53_fetch import IMPORTER_FORMAT, fetch
from tools.nist_800_53_normalize import (
    CATALOG_PATH,
    LICENSE,
    PROFILE_PATHS,
    REPOSITORY_URL,
    SOURCE_NAME,
    normalize_catalog,
)
from tools.generate_mscp_nist_800_53_mapping import regenerate_after_import
from tools.release_import import SourceImporter, run_cli
from tools.source_lock import SourceLock

SOURCE_DISPLAY_NAME = "NIST SP 800-53 Rev. 5"


def read_upstream_json(upstream_dir: Path, repository_path: str) -> dict:
    return read_json_rejecting_duplicates(upstream_dir / repository_path, "upstream file")


def build_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
    catalog_document = read_upstream_json(upstream_dir, CATALOG_PATH)
    profile_documents = {
        benchmark_name: read_upstream_json(upstream_dir, repository_path)
        for benchmark_name, repository_path in PROFILE_PATHS.items()
    }
    rules = normalize_catalog(catalog_document, profile_documents, lock)
    (tree_dir / "rules").mkdir(parents=True)
    entries = []
    for rule in rules:
        control_id = rule["source"]["upstream_rule_id"]
        rule_file = f"rules/{control_id}.json"
        write_json(tree_dir / rule_file, rule)
        entries.append(index_entry(rule, rule_file))
    write_json(
        tree_dir / "_index.json",
        {"schema_version": SCHEMA_VERSION, "source": SOURCE_NAME, "rules": entries},
    )
    return len(entries)


def release_label(tag: str, upstream_dir: Path) -> str:
    catalog_document = read_upstream_json(upstream_dir, CATALOG_PATH)
    catalog = catalog_document.get("catalog") if isinstance(catalog_document, dict) else None
    metadata = catalog.get("metadata") if isinstance(catalog, dict) else None
    version = metadata.get("version") if isinstance(metadata, dict) else None
    if not isinstance(version, str) or not version:
        raise ValueError(f"{upstream_dir / CATALOG_PATH}: catalog has no metadata.version")
    return version


IMPORTER = SourceImporter(
    name=SOURCE_NAME,
    display_name=SOURCE_DISPLAY_NAME,
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
