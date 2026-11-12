"""Propose candidate rule pairs between two sources for the mapping review workflow.

Design: docs/plans/2026-11-12-mapping-candidates-design.md. The selection functions are pure and work on rule text; loading, file
writing and the command line sit below them.
"""

import argparse
import math
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.json_output import read_json_rejecting_duplicates, write_json
from tools.library_output import MANIFEST_FILE_NAME
from tools.mappings import REPOSITORY_ROOT, expanded_pairs, load_mappings, structure_errors

WORD_SEPARATOR_PATTERN = re.compile(r"[^a-z0-9]+")
MINIMUM_WORD_LENGTH = 3
MINIMUM_LENGTH_TO_DROP_PLURAL_S = 5
PLURAL_S_EXCEPTION_ENDINGS = ("ss", "us", "is")
BRITISH_SUFFIX_REPLACEMENTS = (
    ("isation", "ization"),
    ("ising", "izing"),
    ("ised", "ized"),
    ("ise", "ize"),
)
SECTION_SEPARATOR = " > "
SCORE_DECIMAL_PLACES = 2

STOP_WORDS = frozenset(
    {
        "the", "and", "for", "are", "with", "that", "this", "from", "not", "all", "any", "each", "its",
        "use", "used", "using", "must", "should", "when", "where", "which", "will", "been", "has", "have",
        "into", "only", "other", "such", "than", "their", "them", "then", "there", "these", "they", "via",
        "within", "without",
    }
)


@dataclass(frozen=True)
class RuleText:
    rule_id: str
    title: str
    section_path: tuple[str, ...]
    reference_leaves: frozenset[str]


@dataclass(frozen=True)
class PairEvidence:
    from_id: str
    to_id: str
    shared_neighbours: tuple[str, ...]
    shared_references: tuple[str, ...]
    shared_words: tuple[str, ...]
    text_score: float


@dataclass(frozen=True)
class SelectionSettings:
    per_rule: int = 5
    min_text_score: float = 8.0


def _normalise_word(word: str) -> str:
    # Plural first, so "organisations" and "organizations" meet at the same stem.
    if len(word) >= MINIMUM_LENGTH_TO_DROP_PLURAL_S and word.endswith("s") and not word.endswith(PLURAL_S_EXCEPTION_ENDINGS):
        word = word[:-1]
    for british_suffix, american_suffix in BRITISH_SUFFIX_REPLACEMENTS:
        if word.endswith(british_suffix):
            return word[: -len(british_suffix)] + american_suffix
    return word


def tokenize(text: str) -> frozenset[str]:
    candidate_words = WORD_SEPARATOR_PATTERN.split(text.lower())
    kept_words = (
        word
        for word in candidate_words
        if len(word) >= MINIMUM_WORD_LENGTH and not word.isdigit() and word not in STOP_WORDS
    )
    return frozenset(_normalise_word(word) for word in kept_words)


def reference_leaves(references: object) -> frozenset[str]:
    leaves: set[str] = set()

    def walk(value: object, key_path: tuple[str, ...]) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                walk(child, key_path + (str(key),))
        elif isinstance(value, list) and key_path:
            dotted_path = ".".join(key_path)
            leaves.update(f"{dotted_path}: {item}" for item in value if isinstance(item, str))

    walk(references, ())
    return frozenset(leaves)


def inverse_document_frequencies(word_sets: Iterable[frozenset[str]]) -> dict[str, float]:
    document_counts: dict[str, int] = defaultdict(int)
    total_documents = 0
    for word_set in word_sets:
        total_documents += 1
        for word in word_set:
            document_counts[word] += 1
    return {word: math.log(total_documents / count) for word, count in document_counts.items()}


def neighbours_by_rule(pairs: Iterable[tuple[str, str]]) -> dict[str, frozenset[str]]:
    adjacency: dict[str, set[str]] = defaultdict(set)
    for first_id, second_id in pairs:
        adjacency[first_id].add(second_id)
        adjacency[second_id].add(first_id)
    return {rule_id: frozenset(neighbour_ids) for rule_id, neighbour_ids in adjacency.items()}


def rank_key(evidence: PairEvidence) -> tuple:
    return (
        -len(evidence.shared_neighbours),
        -len(evidence.shared_references),
        -evidence.text_score,
        evidence.to_id,
        evidence.from_id,
    )


def rule_words(rule: RuleText) -> frozenset[str]:
    words = set(tokenize(rule.title))
    for section in rule.section_path:
        words |= tokenize(section)
    return frozenset(words)


def _inverted_index(keys_by_rule_id: Mapping[str, Iterable[str]]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = defaultdict(list)
    for rule_id, keys in keys_by_rule_id.items():
        for key in keys:
            index[key].append(rule_id)
    return index


def select_candidates(
    from_rules: Sequence[RuleText],
    to_rules: Sequence[RuleText],
    neighbours: Mapping[str, frozenset[str]],
    excluded_pairs: frozenset[frozenset[str]],
    settings: SelectionSettings,
) -> list[PairEvidence]:
    words_by_rule_id = {rule.rule_id: rule_words(rule) for rule in [*from_rules, *to_rules]}
    frequencies = inverse_document_frequencies(
        rule_words(rule) for rule in [*from_rules, *to_rules]
    )
    no_neighbours: frozenset[str] = frozenset()

    to_rules_by_id = {rule.rule_id: rule for rule in to_rules}
    to_ids_by_word = _inverted_index({rule.rule_id: words_by_rule_id[rule.rule_id] for rule in to_rules})
    to_ids_by_reference = _inverted_index({rule.rule_id: rule.reference_leaves for rule in to_rules})
    to_ids_by_neighbour = _inverted_index({rule.rule_id: neighbours.get(rule.rule_id, no_neighbours) for rule in to_rules})

    selected: list[PairEvidence] = []
    for from_rule in from_rules:
        from_id = from_rule.rule_id
        from_words = words_by_rule_id[from_id]
        from_neighbours = neighbours.get(from_id, no_neighbours)
        reachable_to_ids: set[str] = set()
        for word in from_words:
            reachable_to_ids.update(to_ids_by_word.get(word, ()))
        for reference in from_rule.reference_leaves:
            reachable_to_ids.update(to_ids_by_reference.get(reference, ()))
        for neighbour in from_neighbours:
            reachable_to_ids.update(to_ids_by_neighbour.get(neighbour, ()))

        pairs_of_from_rule: list[PairEvidence] = []
        for to_id in reachable_to_ids:
            if to_id == from_id or frozenset({from_id, to_id}) in excluded_pairs:
                continue
            to_rule = to_rules_by_id[to_id]
            shared_neighbours = tuple(
                sorted((from_neighbours & neighbours.get(to_id, no_neighbours)) - {from_id, to_id})
            )
            shared_references = tuple(sorted(from_rule.reference_leaves & to_rule.reference_leaves))
            shared_words = tuple(sorted(from_words & words_by_rule_id[to_id]))
            text_score = sum(frequencies[word] for word in shared_words)
            if not (shared_neighbours or shared_references or text_score >= settings.min_text_score):
                continue
            pairs_of_from_rule.append(
                PairEvidence(from_id, to_id, shared_neighbours, shared_references, shared_words, text_score)
            )
        pairs_of_from_rule.sort(key=rank_key)
        selected.extend(pairs_of_from_rule[: settings.per_rule])
    return sorted(selected, key=rank_key)


def group_into_items(
    evidence: Sequence[PairEvidence],
    to_rules: Mapping[str, RuleText],
    from_rules: Mapping[str, RuleText],
) -> list[dict]:
    pairs_by_to_id: dict[str, list[PairEvidence]] = defaultdict(list)
    for pair in evidence:
        pairs_by_to_id[pair.to_id].append(pair)
    ordered_groups = sorted(
        ((sorted(pairs, key=rank_key), to_id) for to_id, pairs in pairs_by_to_id.items()),
        key=lambda group: (rank_key(group[0][0]), group[1]),
    )
    id_width = max(3, len(str(len(ordered_groups))))
    items: list[dict] = []
    for position, (pairs, to_id) in enumerate(ordered_groups, start=1):
        to_rule = to_rules[to_id]
        items.append(
            {
                "id": f"c{position:0{id_width}d}",
                "from": [pair.from_id for pair in pairs],
                "to": to_id,
                "to_section": SECTION_SEPARATOR.join(to_rule.section_path),
                "to_text": to_rule.title,
                "evidence": {
                    pair.from_id: {
                        "title": from_rules[pair.from_id].title,
                        "shared_neighbours": list(pair.shared_neighbours),
                        "shared_references": list(pair.shared_references),
                        "shared_words": list(pair.shared_words),
                        "text_score": round(pair.text_score, SCORE_DECIMAL_PLACES),
                    }
                    for pair in pairs
                },
                "proposed_note": "",
                "status": "open",
                "comments": [],
            }
        )
    return items


REVIEW_STATUSES = {
    "open": "not yet researched beyond the first pass",
    "mapped": "confirmed and moved into baselines/_mappings/rules/",
    "rejected": "researched and found not to support the control",
    "needs_maintainer": (
        "still uncertain after research; the maintainer makes the call (the last comment holds the question)"
    ),
    "answered": "a cross-cutting question that has been settled",
}
DEFAULT_RELATION = "supports"
RELATIONS = ("supports", "related")
COMMAND_PREFIX = "python tools/mapping_candidates.py"


def _manifest_sources(baselines_dir: Path) -> dict[str, dict]:
    manifest = read_json_rejecting_duplicates(baselines_dir / MANIFEST_FILE_NAME, "library manifest")
    return {source["name"]: source for source in manifest["sources"]}


def load_current_rules(baselines_dir: Path, source_name: str) -> tuple[str, list[RuleText]]:
    sources = _manifest_sources(baselines_dir)
    if source_name not in sources:
        raise KeyError(source_name)
    source = sources[source_name]
    release_tag = source["release_tag"]
    release = next(release for release in source["releases"] if release["tag"] == release_tag)
    index_path = baselines_dir / release["index_path"]
    index = read_json_rejecting_duplicates(index_path, "release index")
    rules: list[RuleText] = []
    for entry in index["rules"]:
        rule = read_json_rejecting_duplicates(index_path.parent / entry["file"], "rule file")
        rules.append(
            RuleText(
                rule_id=entry["id"],
                title=rule.get("title") or "",
                section_path=tuple(rule.get("section_path") or ()),
                reference_leaves=reference_leaves(rule.get("references")),
            )
        )
    return release_tag, rules


def mapped_pairs(mappings_dir: Path) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for loaded in load_mappings(mappings_dir):
        if "error" in loaded or structure_errors(loaded["mapping"]):
            continue
        pairs.extend((pair["from"]["id"], pair["to"]["id"]) for pair in expanded_pairs(loaded["mapping"]))
    return pairs


def _as_id_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [element for element in value if isinstance(element, str)]
    return []


def reviewed_pairs(review_dir: Path, skip: Path | None) -> frozenset[frozenset[str]]:
    if not review_dir.is_dir():
        return frozenset()
    skipped_path = skip.resolve() if skip is not None else None
    pairs: set[frozenset[str]] = set()
    for path in sorted(review_dir.glob("*.json")):
        if skipped_path is not None and path.resolve() == skipped_path:
            continue
        try:
            document = read_json_rejecting_duplicates(path, "review file")
        except ValueError:
            continue
        if not isinstance(document, dict) or not isinstance(document.get("items"), list):
            continue
        for item in document["items"]:
            if not isinstance(item, dict):
                continue
            from_ids = _as_id_list(item.get("from") or item.get("mscp"))
            to_ids = _as_id_list(item.get("to") or item.get("ism"))
            pairs.update(frozenset({from_id, to_id}) for from_id in from_ids for to_id in to_ids)
    return frozenset(pairs)


def default_output_path(repository_root: Path, from_source: str, to_source: str) -> Path:
    file_name = f"{from_source}-to-{to_source}-candidates.json".replace("_", "-")
    return repository_root / "docs" / "mappings" / file_name


def _in_sections(rules: Sequence[RuleText], sections: Sequence[str]) -> list[RuleText]:
    if not sections:
        return list(rules)
    wanted_sections = {section.lower() for section in sections}
    return [rule for rule in rules if rule.section_path and rule.section_path[0].lower() in wanted_sections]


def _generated_by(
    from_source: str,
    to_source: str,
    relation: str,
    settings: SelectionSettings,
    from_sections: Sequence[str],
    to_sections: Sequence[str],
    exclude_reviewed: bool,
    output_path: Path,
    default_path: Path,
) -> str:
    defaults = SelectionSettings()
    words = [COMMAND_PREFIX, from_source, to_source]
    if relation != DEFAULT_RELATION:
        words += ["--relation", relation]
    if settings.per_rule != defaults.per_rule:
        words += ["--per-rule", str(settings.per_rule)]
    if settings.min_text_score != defaults.min_text_score:
        words += ["--min-text-score", f"{settings.min_text_score:g}"]
    for section in from_sections:
        words += ["--from-section", section]
    for section in to_sections:
        words += ["--to-section", section]
    if not exclude_reviewed:
        words.append("--no-exclude-reviewed")
    if output_path != default_path:
        words += ["--output", output_path.as_posix()]
    return " ".join(words)


def build_candidate_file(
    baselines_dir: Path,
    mappings_dir: Path,
    review_dir: Path | None,
    from_source: str,
    to_source: str,
    relation: str,
    settings: SelectionSettings,
    from_sections: Sequence[str],
    to_sections: Sequence[str],
    output_path: Path,
) -> dict:
    display_names = {name: source["display_name"] for name, source in _manifest_sources(baselines_dir).items()}
    from_release, all_from_rules = load_current_rules(baselines_dir, from_source)
    to_release, all_to_rules = load_current_rules(baselines_dir, to_source)
    from_rules = _in_sections(all_from_rules, from_sections)
    to_rules = _in_sections(all_to_rules, to_sections)

    mapped = mapped_pairs(mappings_dir)
    excluded_pairs = {frozenset(pair) for pair in mapped}
    if review_dir is not None:
        excluded_pairs |= reviewed_pairs(review_dir, skip=output_path)
    evidence = select_candidates(
        from_rules, to_rules, neighbours_by_rule(mapped), frozenset(excluded_pairs), settings
    )
    items = group_into_items(
        evidence,
        {rule.rule_id: rule for rule in to_rules},
        {rule.rule_id: rule for rule in from_rules},
    )
    default_path = default_output_path(baselines_dir.parent, from_source, to_source)
    document = {
        "description": (
            f"Candidate {display_names[from_source]} to {display_names[to_source]} pairs proposed by "
            "tools/mapping_candidates.py for review. They are machine-proposed and unreviewed: a reviewer "
            "judges each one, sets its status, and moves confirmed links into baselines/_mappings/rules/."
        ),
        "generated_by": _generated_by(
            from_source, to_source, relation, settings, from_sections, to_sections,
            review_dir is not None, output_path, default_path,
        ),
        "settings": {
            "relation": relation,
            "per_rule": settings.per_rule,
            "min_text_score": settings.min_text_score,
            "from_sections": list(from_sections),
            "to_sections": list(to_sections),
        },
        "statuses": dict(REVIEW_STATUSES),
        "from_source": from_source,
        "to_source": to_source,
        "from_release": from_release,
        "to_release": to_release,
        "relation": relation,
        "cross_cutting_questions": [],
        "items": items,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(output_path, document)
    return document


def calibration(
    baselines_dir: Path,
    mappings_dir: Path,
    from_source: str,
    to_source: str,
    settings: SelectionSettings,
    from_sections: Sequence[str],
    to_sections: Sequence[str],
) -> dict:
    _, all_from_rules = load_current_rules(baselines_dir, from_source)
    _, all_to_rules = load_current_rules(baselines_dir, to_source)
    from_rules = _in_sections(all_from_rules, from_sections)
    to_rules = _in_sections(all_to_rules, to_sections)
    from_ids = {rule.rule_id for rule in from_rules}
    to_ids = {rule.rule_id for rule in to_rules}

    mapped = mapped_pairs(mappings_dir)
    existing_pairs: set[tuple[str, str]] = set()
    for first_id, second_id in mapped:
        if first_id in from_ids and second_id in to_ids:
            existing_pairs.add((first_id, second_id))
        elif second_id in from_ids and first_id in to_ids:
            existing_pairs.add((second_id, first_id))

    evidence = select_candidates(from_rules, to_rules, neighbours_by_rule(mapped), frozenset(), settings)
    proposed_pairs = {(pair.from_id, pair.to_id) for pair in evidence}
    proposed_existing_pairs = len(existing_pairs & proposed_pairs)
    recall_percent = round(100 * proposed_existing_pairs / len(existing_pairs), 1) if existing_pairs else 0.0
    return {
        "existing_pairs": len(existing_pairs),
        "proposed_existing_pairs": proposed_existing_pairs,
        "recall_percent": recall_percent,
        "candidate_pairs": len(evidence),
    }


def _argument_parser() -> argparse.ArgumentParser:
    defaults = SelectionSettings()
    parser = argparse.ArgumentParser(
        prog="mapping_candidates.py",
        description="Write a review-ready file of candidate rule pairs between two sources.",
    )
    parser.add_argument("from_source")
    parser.add_argument("to_source")
    parser.add_argument("--relation", choices=RELATIONS, default=DEFAULT_RELATION)
    parser.add_argument("--per-rule", type=int, default=defaults.per_rule)
    parser.add_argument("--min-text-score", type=float, default=defaults.min_text_score)
    parser.add_argument("--from-section", action="append", default=[])
    parser.add_argument("--to-section", action="append", default=[])
    parser.add_argument("--no-exclude-reviewed", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--calibrate", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    arguments = _argument_parser().parse_args(argv)
    baselines_dir = REPOSITORY_ROOT / "baselines"
    mappings_dir = baselines_dir / "_mappings" / "rules"
    review_dir = REPOSITORY_ROOT / "docs" / "mappings"
    known_sources = sorted(_manifest_sources(baselines_dir))
    for source_name in (arguments.from_source, arguments.to_source):
        if source_name not in known_sources:
            print(f"unknown source {source_name!r}; known sources: {', '.join(known_sources)}", file=sys.stderr)
            return 2
    if arguments.from_source == arguments.to_source:
        print(f"the two sources must differ; known sources: {', '.join(known_sources)}", file=sys.stderr)
        return 2

    settings = SelectionSettings(per_rule=arguments.per_rule, min_text_score=arguments.min_text_score)
    if arguments.calibrate:
        result = calibration(
            baselines_dir, mappings_dir, arguments.from_source, arguments.to_source,
            settings, arguments.from_section, arguments.to_section,
        )
        for name, value in result.items():
            print(f"{name}: {value}")
        return 0

    output_path = arguments.output or default_output_path(REPOSITORY_ROOT, arguments.from_source, arguments.to_source)
    if output_path.exists() and not arguments.force:
        print(f"{output_path} already exists; use --force to replace it")
        return 1
    document = build_candidate_file(
        baselines_dir, mappings_dir, None if arguments.no_exclude_reviewed else review_dir,
        arguments.from_source, arguments.to_source, arguments.relation,
        settings, arguments.from_section, arguments.to_section, output_path,
    )
    pair_count = sum(len(item["from"]) for item in document["items"])
    print(f"{len(document['items'])} items, {pair_count} candidate pairs written to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
