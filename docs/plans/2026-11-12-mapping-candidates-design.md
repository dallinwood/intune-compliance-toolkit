# Design: mapping candidate skeletons for review

Date: 2026-11-12
Status: Implemented 2026-11-12 (the calls in section 8 were made without the maintainer and still await review)

## 1. Intent

Hand-written mappings start as a review queue: a file of candidate rule pairs that a
maintainer or a model judges one by one (`docs/mappings/mscp-to-asd-ism-review.json`). The
first mSCP to ISM queue was built by subagents reading every rule. That does not scale to
four sources (mSCP, ASD ISM, NIST SP 800-53, ASD E4EIT) and the pairs between them.

This design adds `tools/mapping_candidates.py`, idea 4 in
`docs/2026-11-11-ciso-assistant-analysis.md` section 3 (after CISO Assistant's
`prepare_mapping_v2.py`). For two sources it writes a review-ready candidate file in the
review queue's shape, so the existing workflow (research pass, status, maintainer call,
move confirmed links into `baselines/_mappings/rules/`) applies unchanged. Candidate
selection is cheap and needs no new package: shared references, shared mapped neighbours,
and weighted word overlap on titles and section paths. Pairs already mapped or already in a
review queue are left out.

## 2. Goals, non-goals, anti-goals

### Goals

- One command: `python tools/mapping_candidates.py <from source> <to source>` writes
  `docs/mappings/<from>-to-<to>-candidates.json`.
- Each candidate shows its evidence (which references, which neighbours, which words), so a
  reviewer sees why it was proposed.
- Deterministic output for the same library: same items, same order, same ids.
- A calibration mode that measures how many of the existing hand-written pairs between the
  two sources the settings would have proposed, so the threshold rests on data.
- Standard library only.

### Non-goals (for now)

- Judging candidates. The tool proposes; people or a later model pass decide.
- Writing anything into `baselines/_mappings/rules/`. Moving a confirmed item stays manual.
- Merging new candidates into an existing review file. A new run writes a new file.
- Embeddings, fuzzy matching packages or any ML dependency.
- Reading rule discussion text (see section 8).

### Anti-goals (failure even if it technically works)

- Proposing a pair that is already mapped, or already judged in a review queue (any status).
- A file so long that nobody reviews it: every from-rule is capped (`--per-rule`, default 5).
- Output that differs between runs on the same library (unstable sort, set iteration order).
- Overwriting a candidate file someone has started commenting in.

## 3. Facts that shape this design

- `baselines/_manifest.json` lists each source and its current release (`release_tag`);
  each release's `_index.json` lists `{id, file}` per rule (pattern in
  `tools/generate_mscp_nist_800_53_mapping.py`, `_current_release` and
  `_read_rule_ids_and_files`).
- Rules have `title`, `section_path` and a nested `references` object. Measured on the
  committed library (2026-11-12):
  - mSCP (352 rules): `nist.800-53r5` (290), `nist.800-171r3` (233), `cis.controls_v8` (197),
    `disa.*`, `nist.cce.*` and more.
  - E4EIT (58): `nist.800-171r3`, `nist.csf_2.0`, `aemo.aescsf_v2` (all 58), `mitre.attack_v19`.
  - NIST SP 800-53 (1014): `related_controls` (651), `publications`.
  - ISM (1143): no references at all.
  So a shared reference value under the same key path (for example
  `nist.800-171r3: 03.01.01`) links mSCP and E4EIT directly; ISM can only be reached through
  existing mappings or words.
- Existing mappings: hand-written mSCP to ISM `supports` (release_27.0 endpoints), generated
  mSCP to 800-53 `supports` (one link per mSCP rule to the controls it cites), generated
  E4EIT to ISM `related`. `tools/mappings.py` has `load_mappings`, `structure_errors` and
  `expanded_pairs` (one `{from, to, relation, ...}` per pair).
- Mapping endpoints carry a release; the current mSCP release is release_27.1 while the
  hand-written ISM links name release_27.0. "Already mapped" must compare rule ids only.
- The review queue item shape: `{id, mscp: [ids], ism: id, ism_section, ism_text,
  proposed_note, status, comments: [...], final_note?}`, with top-level `description`,
  `statuses`, `mscp_release`, `ism_release`, `cross_cutting_questions`, `items`. Nothing in
  code reads it; it is a working document for people and agents.
- A shared mapped neighbour already gives real candidates: an mSCP rule linked to both an ISM
  control (hand-written) and an 800-53 control (generated) proposes that ISM control and
  800-53 control as a pair for an ISM to 800-53 run.

## 4. Candidate selection

All work happens on the current release of each source.

### 4.1 Signals per pair (A from the from-source, B from the to-source)

1. **Shared neighbours**: rule ids X, in any source, with an existing mapping link between A
   and X and another between B and X (any relation, either direction, release ignored).
2. **Shared references**: leaves present in both rules' `references`, as
   `"<dotted key path>: <value>"` (for example `"nist.800-171r3: 03.01.01"`). A leaf is a
   string inside a list at the end of a key path; values compare as exact strings.
3. **Text score**: the sum, over distinct words both rules share, of each word's inverse
   document frequency, `ln(N / df)`, where N is the number of rules from both sources in this
   run and df the number of those rules containing the word. A rule's words come from its
   title and every `section_path` element.

Word rules (`tokenize`): lower-case; split on anything that is not `a-z` or `0-9`; drop words
shorter than 3 characters, words made only of digits, and a fixed stop-word list in the
module; British spellings ending in `ise`, `ised`, `ising`, `isation` become `ize`, `ized`,
`izing`, `ization` (mSCP is American, ISM and E4EIT Australian); a trailing `s` is dropped
from words longer than 4 characters not ending in `ss`, `us` or `is`. The same rules apply
to both sides, so a rare odd stem only affects matching symmetrically.

### 4.2 Which pairs become candidates

A pair is a candidate when it has at least one shared neighbour, at least one shared
reference, or a text score at or above `--min-text-score` (default 8.0, confirmed by
the calibration recorded in the plan's progress log). Then:

- Excluded: pairs already linked in any valid mapping file (by rule id, either direction,
  any relation), and pairs listed in any review or candidate file under `docs/mappings/`
  (any file with an `items` list; an item's pairs are each id in `from` or `mscp` with `to`
  or `ism`), except the output file itself. `--no-exclude-reviewed` turns the second
  exclusion off.
- Ranked per from-rule by, in order: more shared neighbours, more shared references, higher
  text score, then to-rule id. The first `--per-rule` (default 5) are kept.
- `--from-section` and `--to-section` (repeatable, case-insensitive exact match on
  `section_path[0]`) narrow either side, the way the first ISM pass worked one guideline
  area at a time. IDF is computed after narrowing.

### 4.3 From pairs to review items

Like the existing queue, one item per to-rule, listing every from-rule kept for it. Items
are ordered by their best pair's rank key (the same tuple as 4.2, compared across all
pairs), then to-rule id, and numbered `c001`, `c002`, ... in that order (three digits,
widening if there are more than 999).

## 5. Output file

`docs/mappings/<from>-to-<to>-candidates.json`, source names with `_` turned into `-`
(`mscp-to-asd-ism-candidates.json`), or `--output`. Written with `tools.json_output.write_json`.
The tool refuses to overwrite an existing file (exit 1, message naming `--force`).

```json
{
  "description": "Candidate mSCP to ASD ISM pairs proposed by tools/mapping_candidates.py for review. ...",
  "generated_by": "python tools/mapping_candidates.py mscp asd_ism",
  "settings": {"relation": "supports", "per_rule": 5, "min_text_score": 8.0, "from_sections": [], "to_sections": []},
  "statuses": { "...": "copied verbatim from the existing review queue's five statuses" },
  "from_source": "mscp",
  "to_source": "asd_ism",
  "from_release": "release_27.1",
  "to_release": "v2026.09.4",
  "relation": "supports",
  "cross_cutting_questions": [],
  "items": [
    {
      "id": "c001",
      "from": ["mscp.os_messages_app_disable"],
      "to": "asd_ism.ism-0240",
      "to_section": "Guidelines for enterprise mobility > Mobile device usage > ...",
      "to_text": "Paging, Multimedia Message Service, ...",
      "evidence": {
        "mscp.os_messages_app_disable": {
          "title": "Disable Messages App",
          "shared_neighbours": [],
          "shared_references": [],
          "shared_words": ["app", "messag"],
          "text_score": 9.41
        }
      },
      "proposed_note": "",
      "status": "open",
      "comments": []
    }
  ]
}
```

- `to_section` joins `section_path` with `" > "`, as the existing queue does.
- `text_score` is rounded to 2 decimals; `shared_words` and the other lists are sorted.
- `relation` is `--relation` (`supports` by default, or `related`); it says what the
  reviewer is judging and is written into the final mapping link.
- `description` names both sources' display names and says the pairs are machine-proposed
  and unreviewed.

## 6. Command line

```
python tools/mapping_candidates.py FROM_SOURCE TO_SOURCE
    [--relation supports|related] [--per-rule N] [--min-text-score X]
    [--from-section NAME ...] [--to-section NAME ...]
    [--no-exclude-reviewed] [--output PATH] [--force] [--calibrate]
```

- Unknown source name, or the same source twice: message listing the known sources, exit 2.
- Success: prints the item and pair counts and the output path, exit 0.
- `--calibrate` writes nothing. It runs selection with the "already mapped" exclusion turned
  off and prints, for the existing mapping pairs between the two sources: how many there
  are, how many the current settings propose, and that share as a percentage; then the
  total candidate pairs. This is how the default threshold is chosen and how a maintainer
  tunes a run.

## 7. Test strategy

Pytest in `tests/test_mapping_candidates.py`, on small libraries built in `tmp_path` with the
`write_release` pattern from `tests/test_mscp_nist_800_53_mapping.py`: tokenizer cases;
each signal alone makes a candidate; below-threshold text drops a pair; exclusion of mapped
pairs across releases and of reviewed pairs in both key shapes; the per-rule cap; grouping
and ids; deterministic bytes across two runs; refusal to overwrite; `--force`; calibration
output; argument errors. One test runs the tool against the committed library for
`asd_e4eit` to `mscp` into `tmp_path` and checks the file is well formed, without
asserting counts.

## 8. Decisions made without the maintainer

| Decision | Alternative |
|---|---|
| Generic item keys `from` (list) and `to`, `to_section`, `to_text`, plus `from_source`, `to_source`, `from_release`, `to_release`. | Source-named keys exactly like the mSCP to ISM queue (`mscp`, `ism`, `ism_release`), which do not generalise to other pairs. |
| One item per to-rule with several from-rules, as in the existing queue. | One item per pair, which is simpler but repeats the to-rule's long text. |
| Lexicographic ranking (neighbours, then references, then text). Every signal is explainable. | A weighted sum, which needs tuned weights nobody can explain. |
| Words from title and section path only. | Also the discussion text: more recall, far more noise, and mSCP discussions are long. |
| IDF-weighted word overlap with a tiny hand-written normaliser. | A stemming package (e.g. NLTK) or embeddings: new dependencies the maintainer avoids. |
| Default `--per-rule 5`, `--min-text-score 8.0`, the latter confirmed by calibration. | No cap; or a global top-N. |
| Pairs in any review or candidate file are excluded whatever their status, so a rejected pair is not proposed again. | Exclude only `mapped` and `rejected`, re-proposing `open` and `needs_maintainer`. |
| No merge into an existing file; refuse to overwrite without `--force`. | Append new items to an existing queue, which needs id and comment preservation logic. |
| No two-hop chains (A to X to Y to B). | Longer paths: noisy and slower, and section 3 shows one hop already gives real candidates. |
| The tool and its docs land without a committed candidate file; the first run is the maintainer's call. | Commit a first `mscp-to-asd-ism-candidates.json` with the tool. |

## Progress log
