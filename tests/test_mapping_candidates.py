import json
import math
from pathlib import Path

import pytest

import tools.mapping_candidates as mapping_candidates
from tools.json_output import write_json
from tools.mapping_candidates import (
    REVIEW_STATUSES,
    PairEvidence,
    RuleText,
    SelectionSettings,
    build_candidate_file,
    calibration,
    default_output_path,
    group_into_items,
    inverse_document_frequencies,
    load_current_rules,
    main,
    mapped_pairs,
    neighbours_by_rule,
    rank_key,
    reference_leaves,
    reviewed_pairs,
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


# ---------------------------------------------------------------------------
# Library loading, exclusions and the command line
# ---------------------------------------------------------------------------

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
MSCP_TAG = "release_9"
ISM_TAG = "v9.9.9"
REVIEW_QUEUE_PATH = REPOSITORY_ROOT / "docs" / "mappings" / "mscp-to-asd-ism-review.json"
QUARANTINE_PAIR = ("mscp.quarantine", "asd_ism.ism-1")


def write_release(baselines_dir: Path, source_name: str, tag: str, rules: dict[str, dict]) -> dict:
    release_dir = baselines_dir / source_name / "releases" / tag
    (release_dir / "rules").mkdir(parents=True)
    entries = []
    for upstream_id, rule in rules.items():
        rule_file = f"rules/{upstream_id}.json"
        write_json(release_dir / rule_file, {"id": f"{source_name}.{upstream_id}", **rule})
        entries.append({"id": f"{source_name}.{upstream_id}", "file": rule_file})
    write_json(release_dir / "_index.json", {"rules": entries})
    release = {"tag": tag, "index_path": f"{source_name}/releases/{tag}/_index.json"}
    return {
        "name": source_name,
        "display_name": f"Display {source_name}",
        "release_tag": tag,
        "releases": [release],
    }


def filler_library_rules(prefix: str, count: int = 6) -> dict[str, dict]:
    return {
        f"filler{number}": {
            "title": f"{prefix}alpha{number} {prefix}beta{number} {prefix}gamma{number}",
            "section_path": [f"{prefix}section{number}"],
            "references": {},
        }
        for number in range(count)
    }


MSCP_RULES = {
    "quarantine": {
        "title": "quarantine gatekeeper enforcement",
        "section_path": ["System"],
        "references": {"nist": {"171": ["03.01"]}},
    },
    "other": {"title": "completely different", "section_path": ["Other"], "references": {}},
}
ISM_RULES = {
    "ism-1": {
        "title": "Quarantine gatekeeper enforcement is applied",
        "section_path": ["Guidelines for system hardening", "Apps"],
        "references": {},
    },
    "ism-2": {"title": "Different words entirely", "section_path": ["Guidelines for media"], "references": {}},
}


def build_library(root: Path) -> Path:
    baselines_dir = root / "baselines"
    baselines_dir.mkdir(parents=True)
    sources = [
        write_release(baselines_dir, "asd_ism", ISM_TAG, {**filler_library_rules("ism"), **ISM_RULES}),
        write_release(baselines_dir, "mscp", MSCP_TAG, {**filler_library_rules("mscp"), **MSCP_RULES}),
    ]
    write_json(baselines_dir / "_manifest.json", {"schema_version": 6, "sources": sources})
    return baselines_dir


def endpoint(rule_id: str, release: str) -> dict:
    return {"kind": "rule", "id": rule_id, "release": release}


def write_mapping(baselines_dir: Path, name: str, pairs: list[tuple[str, str]], release: str = "old_release") -> Path:
    mappings_dir = baselines_dir / "_mappings" / "rules"
    mappings_dir.mkdir(parents=True, exist_ok=True)
    links = [
        {"relation": "supports", "from": [endpoint(from_id, release)], "to": [endpoint(to_id, release)]}
        for from_id, to_id in pairs
    ]
    write_json(mappings_dir / f"{name}.json", {"schema_version": 1, "id": name, "links": links})
    return mappings_dir


SETTINGS = SelectionSettings(per_rule=5, min_text_score=3.0)


def build_default(baselines_dir: Path, output_path: Path, review_dir: Path | None = None, **overrides) -> dict:
    arguments = dict(
        baselines_dir=baselines_dir,
        mappings_dir=baselines_dir / "_mappings" / "rules",
        review_dir=review_dir,
        from_source="mscp",
        to_source="asd_ism",
        relation="supports",
        settings=SETTINGS,
        from_sections=[],
        to_sections=[],
        output_path=output_path,
    )
    arguments.update(overrides)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    return build_candidate_file(**arguments)


def candidate_pairs(document: dict) -> set[tuple[str, str]]:
    return {(from_id, item["to"]) for item in document["items"] for from_id in item["from"]}


def test_load_current_rules_reads_the_current_release(tmp_path):
    baselines_dir = build_library(tmp_path)
    release_tag, rules = load_current_rules(baselines_dir, "mscp")
    assert release_tag == MSCP_TAG
    quarantine = next(rule for rule in rules if rule.rule_id == "mscp.quarantine")
    assert quarantine.title == "quarantine gatekeeper enforcement"
    assert quarantine.section_path == ("System",)
    assert quarantine.reference_leaves == frozenset({"nist.171: 03.01"})


def test_load_current_rules_names_an_unknown_source(tmp_path):
    baselines_dir = build_library(tmp_path)
    with pytest.raises(KeyError, match="nope"):
        load_current_rules(baselines_dir, "nope")


def test_already_mapped_pairs_are_excluded_even_when_the_mapping_names_an_older_release(tmp_path):
    baselines_dir = build_library(tmp_path)
    assert QUARANTINE_PAIR in candidate_pairs(build_default(baselines_dir, tmp_path / "first.json"))
    write_mapping(baselines_dir, "existing", [QUARANTINE_PAIR])
    assert QUARANTINE_PAIR not in candidate_pairs(build_default(baselines_dir, tmp_path / "second.json"))


def test_mapped_pairs_skips_unreadable_and_invalid_mapping_files(tmp_path):
    mappings_dir = write_mapping(tmp_path, "good", [("a.x", "b.y")])
    (mappings_dir / "broken.json").write_text("{not json", encoding="utf-8")
    write_json(mappings_dir / "invalid.json", {"schema_version": 1, "id": "invalid"})
    assert mapped_pairs(mappings_dir) == [("a.x", "b.y")]


def write_review_file(review_dir: Path, name: str, items: object) -> Path:
    review_dir.mkdir(parents=True, exist_ok=True)
    path = review_dir / name
    write_json(path, {"items": items})
    return path


def test_pairs_in_a_review_file_are_excluded_whether_it_uses_from_to_or_mscp_ism_keys(tmp_path):
    review_dir = tmp_path / "review"
    write_review_file(review_dir, "old-keys.json", [{"mscp": ["a.1", "a.2"], "ism": "b.1"}, {"mscp": "a.3", "ism": "b.2"}])
    write_review_file(review_dir, "new-keys.json", [{"from": ["c.1"], "to": "d.1"}, {"from": ["c.2"]}, "junk"])
    (review_dir / "not-a-queue.json").write_text('["list"]', encoding="utf-8")
    assert reviewed_pairs(review_dir, skip=None) == frozenset(
        {
            frozenset({"a.1", "b.1"}),
            frozenset({"a.2", "b.1"}),
            frozenset({"a.3", "b.2"}),
            frozenset({"c.1", "d.1"}),
        }
    )
    assert reviewed_pairs(review_dir, skip=review_dir / "old-keys.json") == frozenset({frozenset({"c.1", "d.1"})})
    assert reviewed_pairs(tmp_path / "missing", skip=None) == frozenset()


def test_reviewed_pairs_are_excluded_and_no_exclude_reviewed_proposes_them_again(tmp_path):
    baselines_dir = build_library(tmp_path)
    review_dir = tmp_path / "review"
    write_review_file(review_dir, "queue.json", [{"mscp": ["mscp.quarantine"], "ism": "asd_ism.ism-1"}])
    with_exclusion = build_default(baselines_dir, tmp_path / "with.json", review_dir=review_dir)
    without_exclusion = build_default(baselines_dir, tmp_path / "without.json", review_dir=None)
    assert QUARANTINE_PAIR not in candidate_pairs(with_exclusion)
    assert QUARANTINE_PAIR in candidate_pairs(without_exclusion)


def test_the_output_file_is_not_treated_as_a_review_file_when_replaced_with_force(tmp_path):
    baselines_dir = build_library(tmp_path)
    review_dir = tmp_path / "review"
    output_path = review_dir / "candidates.json"
    review_dir.mkdir()
    first = build_default(baselines_dir, output_path, review_dir=review_dir)
    second = build_default(baselines_dir, output_path, review_dir=review_dir)
    assert candidate_pairs(first)
    assert candidate_pairs(second) == candidate_pairs(first)


def test_section_filters_narrow_each_side_by_top_level_section(tmp_path):
    baselines_dir = build_library(tmp_path)
    unfiltered = build_default(baselines_dir, tmp_path / "a.json")
    wrong_to = build_default(baselines_dir, tmp_path / "b.json", to_sections=["guidelines for MEDIA"])
    to_section_only = build_default(baselines_dir, tmp_path / "c.json", to_sections=["Guidelines for system hardening"])
    from_section_only = build_default(baselines_dir, tmp_path / "e.json", from_sections=["system"])
    wrong_from = build_default(baselines_dir, tmp_path / "d.json", from_sections=["Other"])
    assert QUARANTINE_PAIR in candidate_pairs(unfiltered)
    assert QUARANTINE_PAIR not in candidate_pairs(wrong_to)
    assert candidate_pairs(to_section_only) == {QUARANTINE_PAIR}
    assert candidate_pairs(from_section_only) == {QUARANTINE_PAIR}
    assert QUARANTINE_PAIR not in candidate_pairs(wrong_from)


def test_the_written_file_has_the_designs_keys_statuses_and_item_shape(tmp_path):
    baselines_dir = build_library(tmp_path)
    output_path = tmp_path / "out" / "candidates.json"
    document = build_default(baselines_dir, output_path)
    assert json.loads(output_path.read_text(encoding="utf-8")) == document
    assert list(document) == [
        "description",
        "generated_by",
        "settings",
        "statuses",
        "from_source",
        "to_source",
        "from_release",
        "to_release",
        "relation",
        "cross_cutting_questions",
        "items",
    ]
    assert "Display mscp" in document["description"]
    assert "Display asd_ism" in document["description"]
    assert "unreviewed" in document["description"]
    expected_command = (
        "python tools/mapping_candidates.py mscp asd_ism --min-text-score 3 --no-exclude-reviewed --output "
        + output_path.as_posix()
    )
    assert document["generated_by"] == expected_command
    assert document["settings"] == {
        "relation": "supports",
        "per_rule": 5,
        "min_text_score": 3.0,
        "from_sections": [],
        "to_sections": [],
    }
    assert document["statuses"] == REVIEW_STATUSES
    assert (document["from_source"], document["to_source"]) == ("mscp", "asd_ism")
    assert (document["from_release"], document["to_release"]) == (MSCP_TAG, ISM_TAG)
    assert document["cross_cutting_questions"] == []
    item = document["items"][0]
    assert list(item) == ["id", "from", "to", "to_section", "to_text", "evidence", "proposed_note", "status", "comments"]
    assert item["id"] == "c001"
    assert item["status"] == "open"


def test_the_review_statuses_match_the_committed_review_queue():
    committed = json.loads(REVIEW_QUEUE_PATH.read_text(encoding="utf-8"))
    assert REVIEW_STATUSES == committed["statuses"]


def test_two_runs_write_byte_identical_files(tmp_path):
    baselines_dir = build_library(tmp_path)
    output_path = tmp_path / "candidates.json"
    build_default(baselines_dir, output_path)
    first_bytes = output_path.read_bytes()
    build_default(baselines_dir, output_path)
    assert output_path.read_bytes() == first_bytes


def run_main(monkeypatch, repository_root: Path, *arguments: str) -> int:
    monkeypatch.setattr(mapping_candidates, "REPOSITORY_ROOT", repository_root)
    return main(list(arguments))


def test_default_output_path_uses_hyphenated_source_names(tmp_path):
    expected = tmp_path / "docs" / "mappings" / "asd-ism-to-nist-800-53-candidates.json"
    assert default_output_path(tmp_path, "asd_ism", "nist_800_53") == expected


def test_main_writes_to_the_default_path_and_prints_counts(tmp_path, monkeypatch, capsys):
    build_library(tmp_path)
    assert run_main(monkeypatch, tmp_path, "mscp", "asd_ism", "--min-text-score", "3") == 0
    output_path = default_output_path(tmp_path, "mscp", "asd_ism")
    document = json.loads(output_path.read_text(encoding="utf-8"))
    printed = capsys.readouterr().out
    assert str(output_path) in printed
    assert document["generated_by"] == "python tools/mapping_candidates.py mscp asd_ism --min-text-score 3"
    assert f"{len(document['items'])} item" in printed


def test_an_existing_output_file_is_not_overwritten_without_force(tmp_path, monkeypatch, capsys):
    build_library(tmp_path)
    output_path = default_output_path(tmp_path, "mscp", "asd_ism")
    output_path.parent.mkdir(parents=True)
    output_path.write_text("keep me", encoding="utf-8")
    assert run_main(monkeypatch, tmp_path, "mscp", "asd_ism") == 1
    assert "use --force to replace it" in capsys.readouterr().out
    assert output_path.read_text(encoding="utf-8") == "keep me"
    assert run_main(monkeypatch, tmp_path, "mscp", "asd_ism", "--force") == 0
    assert output_path.read_text(encoding="utf-8") != "keep me"


def test_calibrate_prints_the_recall_of_existing_pairs_and_writes_nothing(tmp_path, monkeypatch, capsys):
    baselines_dir = build_library(tmp_path)
    write_mapping(
        baselines_dir,
        "existing",
        [QUARANTINE_PAIR, ("mscp.other", "asd_ism.ism-2"), ("mscp.quarantine", "nist.unrelated")],
    )
    assert run_main(monkeypatch, tmp_path, "mscp", "asd_ism", "--min-text-score", "3", "--calibrate") == 0
    printed = capsys.readouterr().out
    assert "existing_pairs: 2" in printed
    assert "proposed_existing_pairs: 1" in printed
    assert "recall_percent: 50.0" in printed
    assert "candidate_pairs:" in printed
    assert not (tmp_path / "docs").exists()


def test_calibration_counts_pairs_in_either_direction_once(tmp_path):
    baselines_dir = build_library(tmp_path)
    mappings_dir = write_mapping(
        baselines_dir, "existing", [("asd_ism.ism-1", "mscp.quarantine"), ("mscp.quarantine", "asd_ism.ism-1")]
    )
    result = calibration(baselines_dir, mappings_dir, "mscp", "asd_ism", SETTINGS, [], [])
    assert result["existing_pairs"] == 1
    assert result["proposed_existing_pairs"] == 1
    assert result["recall_percent"] == 100.0


def test_calibration_recall_is_zero_without_existing_pairs(tmp_path):
    baselines_dir = build_library(tmp_path)
    mappings_dir = baselines_dir / "_mappings" / "rules"
    result = calibration(baselines_dir, mappings_dir, "mscp", "asd_ism", SETTINGS, [], [])
    assert result["existing_pairs"] == 0
    assert result["recall_percent"] == 0.0


@pytest.mark.parametrize("arguments", [("mscp", "nope"), ("nope", "asd_ism"), ("mscp", "mscp")])
def test_an_unknown_or_repeated_source_exits_2_naming_the_known_sources(tmp_path, monkeypatch, capsys, arguments):
    build_library(tmp_path)
    assert run_main(monkeypatch, tmp_path, *arguments) == 2
    error_text = capsys.readouterr().err
    assert "asd_ism" in error_text and "mscp" in error_text


def test_the_committed_library_yields_a_well_formed_asd_e4eit_to_mscp_file(tmp_path, monkeypatch):
    output_path = tmp_path / "e4eit-to-mscp.json"
    assert run_main(monkeypatch, REPOSITORY_ROOT, "asd_e4eit", "mscp", "--output", str(output_path)) == 0
    document = json.loads(output_path.read_text(encoding="utf-8"))
    assert document["from_source"] == "asd_e4eit"
    assert document["to_source"] == "mscp"
    assert document["statuses"] == REVIEW_STATUSES
    assert document["items"]
    for item in document["items"]:
        assert item["status"] == "open"
        assert item["from"] and item["to"].startswith("mscp.")
        assert all(from_id.startswith("asd_e4eit.") for from_id in item["from"])
        assert set(item["evidence"]) == set(item["from"])
