"""Import CIS benchmarks from a ComplianceAsCode release into the normalized rule library under baselines/<benchmark>/releases/."""

import argparse
import sys
from dataclasses import replace
from pathlib import Path

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import yaml

from tools.cac_benchmarks import BENCHMARKS, LICENSE, REPOSITORY_URL, BenchmarkSpec
from tools.cac_controls import read_controls
from tools.cac_fetch import IMPORTER_FORMAT, fetch
from tools.cac_normalize import normalize_benchmark
from tools.github_fetch import default_opener
from tools.library_output import SCHEMA_VERSION, index_entry
from tools.json_output import write_json
from tools.release_import import SourceImporter, build_argument_parser, run_cli
from tools.source_lock import SourceLock


def build_importer(spec: BenchmarkSpec) -> SourceImporter:
    def fetch_release(tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock:
        return fetch(spec, tag, sources_dir, today, opener)

    def build_rule_tree(upstream_dir: Path, lock: SourceLock, tree_dir: Path) -> int:
        _, rules = normalize_benchmark(upstream_dir, spec, lock)
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
        controls_text = (upstream_dir / spec.controls_path).read_text(encoding="utf-8")
        benchmark_version, _ = read_controls(yaml.safe_load(controls_text), spec)
        return f"v{benchmark_version}"

    return SourceImporter(
        name=spec.source_name,
        display_name=spec.display_name,
        provenance=spec.provenance,
        repository_url=REPOSITORY_URL,
        license=LICENSE,
        fetch=fetch_release,
        build_rule_tree_by_format={IMPORTER_FORMAT: build_rule_tree},
        release_label=release_label,
    )


IMPORTERS: dict[str, SourceImporter] = {name: build_importer(spec) for name, spec in BENCHMARKS.items()}


def main(argv: list[str] | None = None) -> int:
    benchmark_parser = argparse.ArgumentParser(add_help=False)
    benchmark_parser.add_argument("--benchmark", choices=sorted(IMPORTERS))
    benchmark_arguments, remaining_arguments = benchmark_parser.parse_known_args(argv)
    if benchmark_arguments.benchmark is None:
        # Exits: with --help it prints every option, otherwise it reports the missing --benchmark.
        usage_parser().parse_args(argv)
    return run_cli(IMPORTERS[benchmark_arguments.benchmark], remaining_arguments)


def usage_parser() -> argparse.ArgumentParser:
    any_benchmark = replace(next(iter(IMPORTERS.values())), name="<benchmark>", display_name="a CIS benchmark")
    parser = build_argument_parser(any_benchmark)
    parser.description = __doc__
    parser.add_argument("--benchmark", required=True, choices=sorted(IMPORTERS), help="the benchmark to import")
    return parser


if __name__ == "__main__":
    sys.exit(main())
