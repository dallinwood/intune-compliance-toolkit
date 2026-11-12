import math

from tools.mapping_candidates import (
    PairEvidence,
    RuleText,
    SelectionSettings,
    group_into_items,
    inverse_document_frequencies,
    neighbours_by_rule,
    rank_key,
    reference_leaves,
    select_candidates,
    tokenize,
)

NO_EXCLUSIONS: frozenset = frozenset()
NO_NEIGHBOURS: dict = {}
WORDS_ONLY_ANYTHING_GOES = SelectionSettings(per_rule=5, min_text_score=0.0001)


def make_rule(
    rule_id: str,
    title: str = "",
    section_path: tuple[str, ...] = (),
    leaves: frozenset[str] = frozenset(),
) -> RuleText:
    return RuleText(rule_id, title, section_path, leaves)


def filler_rules(prefix: str, count: int) -> list[RuleText]:
    return [make_rule(f"{prefix}.filler{number}", f"{prefix}alpha{number} {prefix}beta{number} {prefix}gamma{number}") for number in range(count)]


def test_tokenize_lower_cases_splits_and_drops_short_numeric_and_stop_words():
    words = tokenize("The AB 2024 Firewall, and the USB-C port; use 42 ports within it")
    assert words == frozenset({"firewall", "usb", "port"})


def test_tokenize_maps_british_ise_spellings_to_ize_and_drops_plural_s_but_not_ss_us_is():
    assert tokenize("organise") == tokenize("organize")
    assert tokenize("organised organising organisation") == frozenset({"organized", "organizing", "organization"})
    assert tokenize("organisations") == tokenize("organizations")
    assert tokenize("messages") == frozenset({"message"})
    assert tokenize("access status analysis") == frozenset({"access", "status", "analysis"})


def test_reference_leaves_flattens_nested_lists_into_dotted_path_and_value():
    references = {
        "nist": {"800-171r3": ["03.01.01", "03.01.02"], "csf": ["PR.AA", 7]},
        "flat": ["x"],
        "scalar": "ignored",
        "empty": [],
    }
    assert reference_leaves(references) == frozenset(
        {"nist.800-171r3: 03.01.01", "nist.800-171r3: 03.01.02", "nist.csf: PR.AA", "flat: x"}
    )
    assert reference_leaves(None) == frozenset()
    assert reference_leaves(["not", "a", "dict"]) == frozenset()


def test_inverse_document_frequencies_is_log_of_rules_over_rules_containing_the_word():
    frequencies = inverse_document_frequencies(
        [frozenset({"common", "rare"}), frozenset({"common"}), frozenset({"common"}), frozenset({"common"})]
    )
    assert frequencies["common"] == 0.0
    assert math.isclose(frequencies["rare"], math.log(4))


def test_neighbours_by_rule_is_undirected():
    neighbours = neighbours_by_rule([("a", "x"), ("b", "x"), ("a", "y")])
    assert neighbours == {"a": frozenset({"x", "y"}), "b": frozenset({"x"}), "x": frozenset({"a", "b"}), "y": frozenset({"a"})}


def test_a_shared_reference_alone_makes_a_candidate():
    from_rules = [make_rule("from.a", "alpha", leaves=frozenset({"nist: 1"}))] + filler_rules("from", 3)
    to_rules = [make_rule("to.b", "beta", leaves=frozenset({"nist: 1", "nist: 2"}))] + filler_rules("to", 3)
    evidence = select_candidates(from_rules, to_rules, NO_NEIGHBOURS, NO_EXCLUSIONS, SelectionSettings())
    assert [(pair.from_id, pair.to_id) for pair in evidence] == [("from.a", "to.b")]
    assert evidence[0].shared_references == ("nist: 1",)
    assert evidence[0].shared_neighbours == ()
    assert evidence[0].shared_words == ()


def test_a_shared_mapped_neighbour_alone_makes_a_candidate():
    from_rules = [make_rule("from.a", "alpha")] + filler_rules("from", 3)
    to_rules = [make_rule("to.b", "beta")] + filler_rules("to", 3)
    neighbours = neighbours_by_rule([("from.a", "other.x"), ("to.b", "other.x"), ("to.b", "from.a")])
    evidence = select_candidates(from_rules, to_rules, neighbours, NO_EXCLUSIONS, SelectionSettings())
    assert [(pair.from_id, pair.to_id) for pair in evidence] == [("from.a", "to.b")]
    assert evidence[0].shared_neighbours == ("other.x",)


def test_words_alone_make_a_candidate_only_at_or_above_the_threshold():
    from_rules = [make_rule("from.a", "quarantine gatekeeper")] + filler_rules("from", 6)
    to_rules = [make_rule("to.b", "quarantine gatekeeper")] + filler_rules("to", 6)
    score = 2 * math.log(14 / 2)
    at_threshold = SelectionSettings(min_text_score=score)
    above_threshold = SelectionSettings(min_text_score=score + 0.001)
    kept = select_candidates(from_rules, to_rules, NO_NEIGHBOURS, NO_EXCLUSIONS, at_threshold)
    dropped = select_candidates(from_rules, to_rules, NO_NEIGHBOURS, NO_EXCLUSIONS, above_threshold)
    assert [(pair.from_id, pair.to_id) for pair in kept] == [("from.a", "to.b")]
    assert kept[0].shared_words == ("gatekeeper", "quarantine")
    assert math.isclose(kept[0].text_score, score)
    assert dropped == []


def test_section_path_words_count_toward_the_text_score():
    from_rules = [make_rule("from.a", "alpha", ("Quarantine",))] + filler_rules("from", 3)
    to_rules = [make_rule("to.b", "beta", ("Quarantine",))] + filler_rules("to", 3)
    evidence = select_candidates(from_rules, to_rules, NO_NEIGHBOURS, NO_EXCLUSIONS, WORDS_ONLY_ANYTHING_GOES)
    assert evidence[0].shared_words == ("quarantine",)


def test_excluded_pairs_are_left_out_in_either_direction():
    from_rules = [make_rule("from.a", leaves=frozenset({"k: 1"})), make_rule("from.c", leaves=frozenset({"k: 1"}))]
    to_rules = [make_rule("to.b", leaves=frozenset({"k: 1"}))]
    excluded = frozenset({frozenset({"to.b", "from.a"})})
    evidence = select_candidates(from_rules, to_rules, NO_NEIGHBOURS, excluded, SelectionSettings())
    assert [(pair.from_id, pair.to_id) for pair in evidence] == [("from.c", "to.b")]


def test_each_from_rule_keeps_at_most_per_rule_candidates_best_first():
    from_rules = [make_rule("from.a", leaves=frozenset({"k: 1", "k: 2", "k: 3"}))]
    to_rules = [
        make_rule("to.one", leaves=frozenset({"k: 1"})),
        make_rule("to.three", leaves=frozenset({"k: 1", "k: 2", "k: 3"})),
        make_rule("to.two", leaves=frozenset({"k: 1", "k: 2"})),
    ]
    settings = SelectionSettings(per_rule=2)
    evidence = select_candidates(from_rules, to_rules, NO_NEIGHBOURS, NO_EXCLUSIONS, settings)
    assert [pair.to_id for pair in evidence] == ["to.three", "to.two"]


def make_evidence(from_id="f", to_id="t", neighbours=(), references=(), score=0.0) -> PairEvidence:
    return PairEvidence(from_id, to_id, tuple(neighbours), tuple(references), (), score)


def test_ranking_prefers_neighbours_then_references_then_text_score_then_ids():
    ranked = sorted(
        [
            make_evidence("f", "t1", score=9.0),
            make_evidence("f", "t2", references=["r"]),
            make_evidence("f", "t3", neighbours=["n"]),
            make_evidence("g", "t4", score=9.0),
            make_evidence("f", "t4", score=9.0),
        ],
        key=rank_key,
    )
    assert [(pair.from_id, pair.to_id) for pair in ranked] == [("f", "t3"), ("f", "t2"), ("f", "t1"), ("f", "t4"), ("g", "t4")]


def test_items_group_by_to_rule_ordered_by_best_pair_numbered_c001_upward():
    from_rules = {
        "f.a": make_rule("f.a", "From A"),
        "f.b": make_rule("f.b", "From B"),
    }
    to_rules = {
        "t.x": make_rule("t.x", "Target X text", ("Guidelines", "Area")),
        "t.y": make_rule("t.y", "Target Y text", ("Other",)),
    }
    evidence = sorted(
        [
            make_evidence("f.a", "t.y", references=["r"]),
            make_evidence("f.a", "t.x", score=9.123456),
            make_evidence("f.b", "t.x", neighbours=["n"], score=1.0),
        ],
        key=rank_key,
    )
    items = group_into_items(evidence, to_rules, from_rules)
    assert [item["id"] for item in items] == ["c001", "c002"]
    assert [item["to"] for item in items] == ["t.x", "t.y"]
    first = items[0]
    assert first["from"] == ["f.b", "f.a"]
    assert first["to_section"] == "Guidelines > Area"
    assert first["to_text"] == "Target X text"
    assert first["evidence"]["f.a"]["text_score"] == 9.12
    assert first["evidence"]["f.b"]["title"] == "From B"
    assert first["evidence"]["f.b"]["shared_neighbours"] == ["n"]
    assert first["proposed_note"] == ""
    assert first["status"] == "open"
    assert first["comments"] == []


def test_item_ids_widen_beyond_999_items():
    from_rules = {"f.a": make_rule("f.a")}
    to_rules = {f"t.{number:05d}": make_rule(f"t.{number:05d}") for number in range(1000)}
    evidence = [make_evidence("f.a", to_id, score=1.0) for to_id in to_rules]
    items = group_into_items(sorted(evidence, key=rank_key), to_rules, from_rules)
    assert items[0]["id"] == "c0001"
    assert items[-1]["id"] == "c1000"


def test_a_rule_with_no_references_or_words_still_loads_without_error():
    from_rules = [make_rule("from.a")]
    to_rules = [make_rule("to.b")]
    assert select_candidates(from_rules, to_rules, NO_NEIGHBOURS, NO_EXCLUSIONS, SelectionSettings()) == []
    assert group_into_items([], {}, {}) == []
