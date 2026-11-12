"""Propose candidate rule pairs between two sources for the mapping review workflow.

Design: docs/plans/2026-11-12-mapping-candidates-design.md. This part is pure: it
works on rule text already read from the library and never touches the disk.
"""

import math
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Mapping, Sequence

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
