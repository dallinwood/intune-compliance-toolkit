"""Import an ASD Essentials for enterprise IT OSCAL release into the normalized rule library under baselines/asd_e4eit/releases/."""

import sys
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.asd_e4eit_fetch import IMPORTER_FORMAT, fetch
from tools.asd_e4eit_normalize import (
    CATALOG_FILE_NAME,
    ISM_SOURCE_NAME,
    LICENSE,
    MAPPING_COLLECTION_FILE_NAME,
    MAPPING_FILE_ID,
    PROFILE_FILE_PATTERN,
    REPOSITORY_URL,
    SOURCE_NAME,
    catalog_action_ids,
    ism_mapping,
    normalize_release,
)
from tools.asd_oscal import release_label as release_label_from_tag
from tools.json_output import read_json_rejecting_duplicates, write_json
from tools.library_output import MANIFEST_FILE_NAME, SCHEMA_VERSION, index_entry
from tools.release_import import RELEASES_DIR_NAME, SourceImporter, run_cli
from tools.source_lock import SourceLock

SOURCE_DISPLAY_NAME = "ASD Essentials for enterprise IT"


def read_upstream_json(upstream_dir: Path, file_name: str) -> dict:
    return read_json_rejecting_duplicates(upstream_dir / file_name, "upstream file")


def build_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
    profile_file_names = sorted(
        path.name for path in upstream_dir.iterdir() if PROFILE_FILE_PATTERN.match(path.name)
    )
    rules = normalize_release(
        read_upstream_json(upstream_dir, CATALOG_FILE_NAME),
        [read_upstream_json(upstream_dir, file_name) for file_name in profile_file_names],
        read_upstream_json(upstream_dir, MAPPING_COLLECTION_FILE_NAME),
        lock,
    )
    (tree_dir / "rules").mkdir(parents=True)
    entries = []
    for rule in rules:
        rule_file = f"rules/{rule['id'].removeprefix(SOURCE_NAME + '.')}.json"
        write_json(tree_dir / rule_file, rule)
        entries.append(index_entry(rule, rule_file))
    write_json(
        tree_dir / "_index.json",
        {"schema_version": SCHEMA_VERSION, "source": SOURCE_NAME, "rules": entries},
    )
    return len(entries)


def release_label(tag: str, upstream_dir: Path) -> str:
    return release_label_from_tag(tag)


def manifest_source(manifest: dict, source_name: str) -> dict:
    source = next((source for source in manifest["sources"] if source["name"] == source_name), None)
    if source is None:
        raise ValueError(f"source {source_name!r} is not in the manifest")
    return source


def ism_rule_ids(baselines_dir: Path, manifest: dict, ism_tag: str) -> set[str]:
    release = next(
        (
            release
            for release in manifest_source(manifest, ISM_SOURCE_NAME)["releases"]
            if release["tag"] == ism_tag
        ),
        None,
    )
    if release is None:
        raise ValueError(
            f"ASD's E4EIT mapping targets ISM release {ism_tag}, which is not imported; "
            f"run tools/import_asd_ism.py --tag {ism_tag} first"
        )
    index = read_json_rejecting_duplicates(baselines_dir / release["index_path"], "ISM release index")
    return {rule["id"] for rule in index["rules"]}


def write_ism_mapping(sources_dir: Path, baselines_dir: Path) -> None:
    """Write the E4EIT to ISM mapping from the current E4EIT release's vendored mapping collection."""
    manifest = read_json_rejecting_duplicates(baselines_dir / MANIFEST_FILE_NAME, "manifest")
    e4eit_tag = manifest_source(manifest, SOURCE_NAME)["release_tag"]
    upstream_dir = sources_dir / RELEASES_DIR_NAME / e4eit_tag / "upstream"
    mapping, ism_tag = ism_mapping(
        read_upstream_json(upstream_dir, MAPPING_COLLECTION_FILE_NAME),
        catalog_action_ids(read_upstream_json(upstream_dir, CATALOG_FILE_NAME)),
        e4eit_tag,
    )
    available_ism_rule_ids = ism_rule_ids(baselines_dir, manifest, ism_tag)
    missing_ism_rule_ids = sorted(
        {
            target["id"]
            for link in mapping["links"]
            for target in link["to"]
            if target["id"] not in available_ism_rule_ids
        }
    )
    if missing_ism_rule_ids:
        raise ValueError(f"ISM release {ism_tag} has no rule for: {', '.join(missing_ism_rule_ids)}")
    mapping_path = baselines_dir / "_mappings" / "rules" / f"{MAPPING_FILE_ID}.json"
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(mapping_path, mapping)
    pair_count = sum(len(link["to"]) for link in mapping["links"])
    print(
        f"Wrote {len(mapping['links'])} links ({pair_count} pairs) from ASD E4EIT "
        f"{e4eit_tag} to ISM {ism_tag}"
    )


IMPORTER = SourceImporter(
    name=SOURCE_NAME,
    display_name=SOURCE_DISPLAY_NAME,
    repository_url=REPOSITORY_URL,
    license=LICENSE,
    fetch=fetch,
    build_rule_tree_by_format={IMPORTER_FORMAT: build_rule_tree},
    release_label=release_label,
    after_import=write_ism_mapping,
)


def main(argv: list[str] | None = None) -> int:
    return run_cli(IMPORTER, argv)


if __name__ == "__main__":
    sys.exit(main())
