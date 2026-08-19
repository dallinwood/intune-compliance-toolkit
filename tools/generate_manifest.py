"""Generate baselines/_manifest.json - the top-level list of every ruleset
folder (family/product/version) that has an _index.json.

GitHub Pages serves the baselines/ tree as static files with no directory
listing, so a static consumer (the webui/ rule browser) has no way to
discover what benchmark/product/version folders exist without a manifest
telling it up front. This walks the same tree generate_index.py does and
reuses its folder-discovery logic, so the two never disagree about what
counts as a rule folder.

Like _index.json, this is deterministic - no generated-at timestamp - so it
diffs cleanly in git and only changes when a ruleset is actually added,
removed, or renamed.
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from tools.generate_index import INDEX_FILENAME, find_rule_folders  # noqa: E402
from tools.generate_metadata import METADATA_FILENAME  # noqa: E402

BASELINES_DIR = REPO_ROOT / "baselines"
MANIFEST_PATH = BASELINES_DIR / "_manifest.json"


def folder_entry(folder, rule_files, baselines_root):
    """Describe one rule folder as {family, product, version, platform,
    indexPath, ruleCount}. family/product/version are the folder slugs
    (e.g. "macos_26_tahoe", "v1.1.0"), not the human-readable
    benchmark.product/version strings inside the rule JSON - slugs are what
    deterministically reconstruct a fetch URL, so a consumer never has to
    guess a path from display text.
    """
    relative_parts = folder.relative_to(baselines_root).parts
    if len(relative_parts) != 3:
        raise ValueError(
            f"Expected a family/product/version folder three levels under {baselines_root}, "
            f"got {len(relative_parts)} level(s): {folder}"
        )
    family, product, version = relative_parts

    first_rule = json.loads(rule_files[0].read_text(encoding="utf-8"))
    platform = first_rule.get("benchmark", {}).get("platform")

    has_metadata = (folder / METADATA_FILENAME).is_file()

    return {
        "family": family,
        "product": product,
        "version": version,
        "platform": platform,
        "indexPath": "/".join((*relative_parts, INDEX_FILENAME)),
        "metadataPath": "/".join((*relative_parts, METADATA_FILENAME)) if has_metadata else None,
        "ruleCount": len(rule_files),
    }


def build_manifest(folders, baselines_root):
    entries = sorted(
        (folder_entry(folder, rule_files, baselines_root) for folder, rule_files in folders.items()),
        key=lambda entry: (entry["family"], entry["product"], entry["version"]),
    )
    return {"schemaVersion": 1, "baselines": entries}


def write_manifest(folders, baselines_root, manifest_path):
    manifest = build_manifest(folders, baselines_root)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else BASELINES_DIR
    folders = find_rule_folders(root_dir)

    if not folders:
        print(f"No rule files found under {root_dir}")
        return 1

    manifest_path = write_manifest(folders, baselines_root=root_dir, manifest_path=MANIFEST_PATH)
    print(f"{manifest_path} <- {len(folders)} folder(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
