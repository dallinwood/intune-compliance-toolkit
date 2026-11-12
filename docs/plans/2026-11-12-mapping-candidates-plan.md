# Mapping Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tools/mapping_candidates.py`, which writes a review-ready file of candidate rule pairs between two sources, ranked by shared mapped neighbours, shared references and weighted word overlap, leaving out pairs already mapped or already reviewed.

**Architecture:** One module. Pure functions (tokenizer, signals, selection, grouping) take plain data and are unit-tested; a thin layer reads the library and existing mapping and review files, and `main` handles arguments and the output file.

**Tech Stack:** Python 3 standard library, pytest. No new dependencies.

**Spec:** `docs/plans/2026-11-12-mapping-candidates-design.md`

**Depends on:** nothing unlanded.

## Global Constraints

- Standard library only. No new packages in any requirements file.
- Never use the em dash character (U+2014) in code, output text or comments.
- PEP 8; full descriptive names, no single-letter variables (including loop counters and comprehensions); comments only for a non-obvious "why".
- Reuse `tools.json_output.read_json_rejecting_duplicates` and `write_json`, and `tools.mappings.load_mappings`, `structure_errors`, `expanded_pairs`. Do not change their behaviour.
- Output must be byte-identical across two runs on the same library: sort every list and dict key that comes from a set.
- Rule ids compare without releases everywhere ("already mapped" ignores endpoint releases).
- Never write under `baselines/`. Default output goes under `docs/mappings/`.
- Verification before calling a task done: `python -m pytest tests/test_mapping_candidates.py -q` and then the full `python -m pytest -q`.
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; other agents may have uncommitted changes. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` in each task's commit.

---

### Task 1: Pure candidate selection

**Files:**
- Create: `tools/mapping_candidates.py` (pure part only)
- Test: `tests/test_mapping_candidates.py`

**Interfaces (exact):**

```python
@dataclass(frozen=True)
class RuleText:
    rule_id: str
    title: str
    section_path: tuple[str, ...]
    reference_leaves: frozenset[str]   # "<dotted key path>: <value>"

@dataclass(frozen=True)
class PairEvidence:
    from_id: str
    to_id: str
    shared_neighbours: tuple[str, ...]   # sorted
    shared_references: tuple[str, ...]   # sorted
    shared_words: tuple[str, ...]        # sorted
    text_score: float

@dataclass(frozen=True)
class SelectionSettings:
    per_rule: int = 5
    min_text_score: float = 8.0

def tokenize(text: str) -> frozenset[str]
def reference_leaves(references: object) -> frozenset[str]
def inverse_document_frequencies(word_sets: Iterable[frozenset[str]]) -> dict[str, float]
def neighbours_by_rule(pairs: Iterable[tuple[str, str]]) -> dict[str, frozenset[str]]
def rank_key(evidence: PairEvidence) -> tuple
def select_candidates(
    from_rules: Sequence[RuleText],
    to_rules: Sequence[RuleText],
    neighbours: Mapping[str, frozenset[str]],
    excluded_pairs: frozenset[frozenset[str]],
    settings: SelectionSettings,
) -> list[PairEvidence]
def group_into_items(evidence: Sequence[PairEvidence], to_rules: Mapping[str, RuleText], from_rules: Mapping[str, RuleText]) -> list[dict]
```

**Exact behaviour:**
- `tokenize`: design section 4.1 word rules, in this order: lower-case, split on `[^a-z0-9]+`, drop words under 3 characters and all-digit words, drop stop words (a module constant `STOP_WORDS`, a frozenset of at least: the, and, for, are, with, that, this, from, not, all, any, each, its, use, used, using, must, should, when, where, which, will, been, has, have, into, only, other, such, than, their, them, then, there, these, they, via, within, without), then the `ise` family to `ize`, then the trailing-`s` rule.
- `reference_leaves`: walk dicts by key; a list of strings at the end of a key path yields `"<path joined by '.'>: <value>"` per string; non-string list items and other types are ignored; `None` or a non-dict gives an empty set.
- A rule's words are `tokenize(title)` union `tokenize` of each `section_path` element.
- `inverse_document_frequencies`: `ln(N / df)` with N the number of word sets.
- `neighbours_by_rule`: undirected adjacency from (rule id, rule id) pairs.
- Shared neighbours of A and B: `neighbours[A] & neighbours[B]` minus `{A, B}`.
- `rank_key`: `(-len(shared_neighbours), -len(shared_references), -text_score, to_id, from_id)`.
- `select_candidates`: IDF over the words of `from_rules` plus `to_rules`; a pair is kept when it has a shared neighbour, a shared reference, or `text_score >= settings.min_text_score`, and `frozenset({from_id, to_id})` is not in `excluded_pairs`; then per from-rule the first `settings.per_rule` by `rank_key`; returned sorted by `rank_key`. Use an inverted word index from the to-rules so the pass is not a full cross product of word sets.
- `group_into_items`: design section 4.3 and the item shape in section 5 (`to_section` joined with `" > "`, `text_score` rounded to 2 places, `proposed_note` "", `status` "open", `comments` []), ids `c001` upward, zero-padded to at least 3 digits and to the width of the item count.

- [ ] **Step 1: Write the failing tests:**
  - `tokenize lower-cases, splits, drops short, numeric and stop words`
  - `tokenize maps British -ise spellings to -ize and drops plural s but not ss, us, is`
  - `reference_leaves flattens nested lists into dotted path and value`
  - `a shared reference alone makes a candidate`
  - `a shared mapped neighbour alone makes a candidate`
  - `words alone make a candidate only at or above the threshold`
  - `excluded pairs are left out in either direction`
  - `each from-rule keeps at most per_rule candidates, best first`
  - `ranking prefers neighbours, then references, then text score, then ids`
  - `items group by to-rule, ordered by best pair, numbered c001 upward`
  - `a rule with no references or words still loads without error`
- [ ] **Step 2: Run to verify failure.** `python -m pytest tests/test_mapping_candidates.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the pure part of `tools/mapping_candidates.py`, with a module docstring pointing at the design.
- [ ] **Step 4: Run to verify pass**, then the full `python -m pytest -q`.
- [ ] **Step 5: Commit**: `feat: add mapping candidate selection logic`

### Task 2: Library loading, exclusions, command line and calibration

**Files:**
- Modify: `tools/mapping_candidates.py`
- Test: `tests/test_mapping_candidates.py`

**Interfaces (exact):**

```python
REVIEW_STATUSES: dict[str, str]   # the five statuses, text copied from docs/mappings/mscp-to-asd-ism-review.json
def load_current_rules(baselines_dir: Path, source_name: str) -> tuple[str, list[RuleText]]   # (release tag, rules)
def mapped_pairs(mappings_dir: Path) -> list[tuple[str, str]]
def reviewed_pairs(review_dir: Path, skip: Path | None) -> frozenset[frozenset[str]]
def default_output_path(repository_root: Path, from_source: str, to_source: str) -> Path
def build_candidate_file(baselines_dir: Path, mappings_dir: Path, review_dir: Path | None, from_source: str, to_source: str, relation: str, settings: SelectionSettings, from_sections: Sequence[str], to_sections: Sequence[str], output_path: Path) -> dict
def calibration(baselines_dir: Path, mappings_dir: Path, from_source: str, to_source: str, settings: SelectionSettings, from_sections: Sequence[str], to_sections: Sequence[str]) -> dict   # {"existing_pairs", "proposed_existing_pairs", "recall_percent", "candidate_pairs"}
def main(argv: list[str] | None = None) -> int
```

**Exact behaviour:**
- `load_current_rules`: read `_manifest.json`, find the source (raise `KeyError` naming it if absent), its release whose `tag` equals `release_tag`, its `_index.json`, and each rule file; build `RuleText` from `id`, `title`, `section_path` and `reference_leaves(references)`.
- `mapped_pairs`: every `(from id, to id)` from `expanded_pairs` of each mapping that `load_mappings` read without error and `structure_errors` accepts; others are skipped silently (the validator reports them).
- `reviewed_pairs`: every `*.json` in `review_dir` except `skip` whose top level is a dict with an `items` list; per item, from ids are `item["from"]` or `item["mscp"]` (a list or a single string), the to id is `item["to"]` or `item["ism"]`; items missing either are skipped.
- `default_output_path`: `docs/mappings/<from>-to-<to>-candidates.json` with `_` replaced by `-`.
- `build_candidate_file`: apply section filters (case-insensitive exact match on `section_path[0]`; no filter keeps all), exclude `mapped_pairs` and (when `review_dir` is not None) `reviewed_pairs(review_dir, skip=output_path)`, run `select_candidates`, and return the document in design section 5's shape, keys in that order (`description` names both display names from the manifest and says the pairs are machine-proposed and unreviewed; `generated_by` is the command with only non-default options, in the order of the usage line).
- `calibration`: the same selection with no mapped or reviewed exclusion; `existing_pairs` counts distinct mapped pairs whose two ids belong one to each source (after section filters); `proposed_existing_pairs` how many of those `select_candidates` returned; `recall_percent` rounded to 1 place (0.0 when there are none).
- `main`: arguments as in design section 6. Unknown or identical sources: print an error listing known source names to stderr, return 2. Output exists without `--force`: print the path and "use --force to replace it", return 1. `--calibrate`: print the four numbers, one per line, write nothing, return 0. Otherwise write with `write_json`, print item count, pair count and the path, return 0. `--no-exclude-reviewed` passes `review_dir=None`. The default review directory is `docs/mappings/` beside `baselines/`.

- [ ] **Step 1: Write the failing tests** (tmp libraries via a local `write_release` helper like `tests/test_mscp_nist_800_53_mapping.py`):
  - `already mapped pairs are excluded even when the mapping names an older release`
  - `pairs in a review file are excluded whether it uses from/to or mscp/ism keys`
  - `--no-exclude-reviewed proposes reviewed pairs again`
  - `the output file is not treated as a review file when replaced with --force`
  - `section filters narrow each side by top-level section`
  - `the written file has the design's keys, statuses and item shape`
  - `two runs write byte-identical files`
  - `an existing output file is not overwritten without --force`
  - `--calibrate prints the recall of existing pairs and writes nothing`
  - `an unknown or repeated source exits 2 naming the known sources`
  - `the committed library yields a well-formed asd_e4eit to mscp file` (written to `tmp_path`; assert shape only, never counts)
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass**, then the full `python -m pytest -q`.
- [ ] **Step 5: Calibrate on the real library.** Run `python tools/mapping_candidates.py mscp asd_ism --calibrate` and `python tools/mapping_candidates.py asd_e4eit asd_ism --relation related --calibrate`, then the same at `--min-text-score` 4, 6, 10 and 12. If another value gives clearly better recall without more than doubling the candidate pairs, change the default in `SelectionSettings` and the design. Record every number in the progress log entry. Do not commit any candidate file.
- [ ] **Step 6: Commit**: `feat: add the mapping candidates command`

### Task 3: Documentation

**Files:**
- Modify: `README.md` (in the mappings section, after the paragraph on `docs/mappings/mscp-to-asd-ism-review.json`: what the command does, its default output path, the three signals, the exclusions, `--calibrate`, and that the output starts every item `open` for the existing review workflow), `docs/2026-11-11-ciso-assistant-analysis.md` (mark idea 4 built, with the Task 2 commit hash), the design's Status line.

- [ ] **Step 1:** Write the README text. Plain prose, no em dashes.
- [ ] **Step 2:** Update the analysis doc and the design status.
- [ ] **Step 3: Commit**: `docs: describe the mapping candidates command`

## Progress log

- 2026-11-12: Task 1 done, the pure selection logic in `tools/mapping_candidates.py` (tokenizer, reference leaves, IDF, shared-neighbour/reference/word signals, ranking, per-rule cap, grouping into items) with 15 tests. The tokenizer applies the plural rule before the -ise family so "organisations" and "organizations" share a stem. `to_text` is the to-rule title, because the ISM rule title is the control text. Landed in 476a5d8 feat: add mapping candidate selection logic.
- 2026-11-12: Task 2 done, library loading, exclusions (mapped pairs by id across releases, reviewed pairs from any file with an `items` list, the output file itself skipped), section filters, the command line and `--calibrate`, with 21 more tests (36 in the file). Calibration on the committed library, existing hand-written pairs recalled / candidate pairs at `--min-text-score` 4, 6, 8, 10, 12 (default `--per-rule 5`): mscp to asd_ism (222 existing) 34 (15.3%) / 1472, 23 (10.4%) / 787, 17 (7.7%) / 317, 8 (3.6%) / 112, 3 (1.4%) / 34; asd_e4eit to asd_ism with `--relation related` (325 existing) 69 (21.2%) / 290, 69 (21.2%) / 290, 69 (21.2%) / 283, 68 (20.9%) / 250, 57 (17.5%) / 179. No other value gives clearly better recall without more than doubling the pairs (6 is 2.5 times the pairs for 2.7 points of recall; 4 is 4.6 times), so 8.0 stays. `--per-rule 20` at 8.0 adds only 1 pair of recall (18, 8.1%, 373 pairs), so the cap is not what limits recall: most hand-written mSCP to ISM pairs rest on a judgement that shares few words. The first real mscp to asd_ism run proposes 187 items and 303 pairs. Landed in 0e04ca8 feat: add the mapping candidates command.
- 2026-11-12: Task 3 done, the README paragraph on `tools/mapping_candidates.py` after the review queue paragraph, idea 4 in the analysis doc marked built (0e04ca8), and the design marked implemented. Plan closed. Landed in 0205e17 docs: describe the mapping candidates command.
