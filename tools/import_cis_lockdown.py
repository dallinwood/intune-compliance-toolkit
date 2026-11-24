"""Import Windows CIS benchmarks from ansible-lockdown (role release plus Audit repo) into baselines/<source>/releases/."""

import argparse
import sys
from dataclasses import replace
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.github_fetch import default_opener
from tools.json_output import write_json
from tools.library_output import SCHEMA_VERSION, index_entry
from tools.lockdown_fetch import AUDIT_SUBDIRECTORY, IMPORTER_FORMAT, ROLE_SUBDIRECTORY, fetch
from tools.lockdown_normalize import normalize_rules
from tools.lockdown_sources import SOURCES, LockdownSpec
from tools.release_import import SourceImporter, build_argument_parser, run_cli
from tools.source_lock import SourceLock, read_source_lock

AUDIT_COMMIT_KEY = "audit_commit"


def refuse_unnoticed_audit_change(spec: LockdownSpec, lock: SourceLock, existing_release_dir: Path) -> None:
    """Fail when a release that is already stored would silently take different Audit content.

    The role is pinned by its tag, but the Audit repo follows a branch (the 2019 one tracks `latest`), so
    importing the same tag again later can pair the role with newer goss tests.
    """
    existing_lock_path = existing_release_dir / "source.json"
    if not existing_lock_path.is_file():
        return
    recorded = read_source_lock(existing_lock_path).details.get(AUDIT_COMMIT_KEY)
    fetched = lock.details.get(AUDIT_COMMIT_KEY)
    if recorded is not None and recorded != fetched:
        raise ValueError(
            f"{spec.source_name} {lock.tag} is already imported with Audit commit {recorded}, but "
            f"{spec.audit_repository} is now at {fetched}; pass --replace-release to replace the release "
            "with the newer Audit content"
        )


def build_importer(spec: LockdownSpec, replace_release: bool = False) -> SourceImporter:
    def fetch_release(tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock:
        lock = fetch(spec, tag, sources_dir, today, opener)
        if not replace_release:
            # sources_dir is the staging folder next to the stored release folders of the same source.
            refuse_unnoticed_audit_change(spec, lock, sources_dir.parent / tag)
        return lock

    def build_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
        rules = normalize_rules(spec, upstream_dir / ROLE_SUBDIRECTORY, upstream_dir / AUDIT_SUBDIRECTORY, lock)
        (tree_dir / "rules").mkdir(parents=True)
        entries = []
        for rule in rules:
            rule_file = f"rules/{rule['references']['cis']['id']}.json"
            write_json(tree_dir / rule_file, rule)
            entries.append(index_entry(rule, rule_file))
        write_json(
            tree_dir / "_index.json",
            {"schema_version": SCHEMA_VERSION, "source": spec.source_name, "rules": entries},
        )
        return len(entries)

    def release_label(tag: str, upstream_dir: Path) -> str:
        return spec.benchmark_version

    return SourceImporter(
        name=spec.source_name,
        display_name=spec.display_name,
        provenance=spec.provenance,
        repository_url=spec.role_url,
        license=spec.license,
        fetch=fetch_release,
        build_rule_tree_by_format={IMPORTER_FORMAT: build_rule_tree},
        release_label=release_label,
    )


IMPORTERS: dict[str, SourceImporter] = {name: build_importer(spec) for name, spec in SOURCES.items()}


def main(argv: list[str] | None = None) -> int:
    source_parser = argparse.ArgumentParser(add_help=False)
    source_parser.add_argument("--source", choices=sorted(IMPORTERS))
    source_parser.add_argument("--replace-release", action="store_true")
    source_arguments, remaining_arguments = source_parser.parse_known_args(argv)
    if source_arguments.source is None:
        # Exits: with --help it prints every option, otherwise it reports the missing --source.
        usage_parser().parse_args(argv)
    importer = build_importer(SOURCES[source_arguments.source], source_arguments.replace_release)
    return run_cli(importer, remaining_arguments)


def usage_parser() -> argparse.ArgumentParser:
    any_source = replace(next(iter(IMPORTERS.values())), name="<source>", display_name="a Windows CIS benchmark")
    parser = build_argument_parser(any_source)
    parser.description = __doc__
    parser.add_argument("--source", required=True, choices=sorted(IMPORTERS), help="the benchmark source to import")
    parser.add_argument(
        "--replace-release",
        action="store_true",
        help="with --tag, replace a stored release even when the Audit repo has moved to a different commit",
    )
    return parser


if __name__ == "__main__":
    sys.exit(main())
