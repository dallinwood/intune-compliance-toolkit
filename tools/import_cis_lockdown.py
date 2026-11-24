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
from tools.source_lock import SourceLock


def build_importer(spec: LockdownSpec) -> SourceImporter:
    def fetch_release(tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock:
        return fetch(spec, tag, sources_dir, today, opener)

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
    source_arguments, remaining_arguments = source_parser.parse_known_args(argv)
    if source_arguments.source is None:
        # Exits: with --help it prints every option, otherwise it reports the missing --source.
        usage_parser().parse_args(argv)
    return run_cli(IMPORTERS[source_arguments.source], remaining_arguments)


def usage_parser() -> argparse.ArgumentParser:
    any_source = replace(next(iter(IMPORTERS.values())), name="<source>", display_name="a Windows CIS benchmark")
    parser = build_argument_parser(any_source)
    parser.description = __doc__
    parser.add_argument("--source", required=True, choices=sorted(IMPORTERS), help="the benchmark source to import")
    return parser


if __name__ == "__main__":
    sys.exit(main())
