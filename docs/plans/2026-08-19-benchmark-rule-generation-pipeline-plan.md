# Benchmark → rule-JSON generation pipeline (Phase 1: deterministic pipeline)

## Context

Rule JSON files under `baselines/` are authored by hand, one at a time,
following the `compliance-benchmark-json` skill. That skill already encodes
the schema and the fidelity rules, but nothing automates pulling the
mechanical, source-verbatim majority of each rule (title, description,
rationale, impact, default value, references, CIS Controls mapping, profile
applicability) out of the converted markdown. The goal is a repeatable
script/workflow that:

- Does the deterministic extraction itself (no AI) wherever the source text
  is unambiguous.
- Uses AI only for the two things that genuinely require judgment:
  engineering `check_command`/`output_check`, and an independent adversarial
  check that what got written is faithful to the source.
- Always marks AI-authored commands `check_command_verified: false` (the
  schema already has this field) until confirmed by hand outside this
  pipeline.
- Additionally captures section-level metadata (heading IDs → titles/
  descriptions) per benchmark version, which existed nowhere before this -
  the web UI needs it to show "Windows Logon Options" instead of "Section
  4.11.49".

This work is explicitly phased. **Phase 1** (this plan, built in the
2026-08-19 session) is the deterministic, zero-AI pipeline: markdown
parsing, `_metadata.json` + its schema, and a rule-body field extractor
verified against every rule file that existed before this work started.
**Phase 2** (AI-assisted authoring of `check_command`/`output_check` plus
independent adversarial validation, invoked as a Claude Code slash command/
workflow) is designed but not yet built - see "Phase 2 design" below.

## Research findings

- `tools/pdf_to_markdown.py`'s `main()` looked for PDFs under `references/`,
  but they live in `baseline-references/cis-benchmarks/` - it found nothing
  when actually run. Fixed, with `--source-dir`/`--output-dir` args added so
  the pipeline can invoke it programmatically later.
- The existing `baselines/<family>/<product>/<version>/` layout already had
  room for a per-version `_metadata.json` sitting next to `_index.json` - no
  folder/naming convention change was needed.
- `_rule.schema.json` is `additionalProperties: false` everywhere, so a
  parser can't stash "needs AI" scratch fields inside a real rule file - any
  future draft representation has to live outside `baselines/`.
- Heading structure, verified directly against the source markdown, not
  assumed: bold headings are section/grouping headings, italic headings are
  individual rules, and the numeric ID's segment count - not heading `#`
  depth - is the reliable discriminator. Critically, **most rule headings
  wrap across two or more physical lines** (only 26 of 404 in the Windows 11
  benchmark are single-line), and the `(Automated)`/`(Manual)` tag is
  frequently its own italic fragment separated from the title by a blank
  line. The parser rejoins these before extracting title/tag.
- Release date is deterministically extractable from the document's own
  front page (`vX.Y.Z - MM-DD-YYYY`), cross-checked against the "Appendix:
  Change History" table. Both agreed exactly on the two live source
  documents checked.
- Blank-line-to-paragraph-break mapping in prose fields is **not always
  derivable from the source alone** - the existing hand-authored rule corpus
  itself disagrees rule-to-rule on whether a given blank line becomes
  `\n\n` or collapses to a space. This is a documented, known limitation of
  `tools/verify_extraction.py`'s acceptance test, not a bug to keep chasing.

## What was built

- `tools/pdf_to_markdown.py` - fixed `main()`, added `--source-dir`/
  `--output-dir`.
- `tools/benchmark_markdown.py` - deterministic heading/front-page parsing
  (`iter_section_headings`, `iter_rule_headings`, `parse_front_page`,
  `find_change_history_date`, `iter_heading_start_indices`).
- `baselines/_metadata.schema.json` + `tools/generate_metadata.py` +
  `tools/validate_metadata.py` - generates and validates a per-version
  `_metadata.json` (benchmark name/version/release date, section ID → title/
  description hierarchy). Wired into the existing `PostToolUse` validation
  hook (`tools/hooks/validate_edited_rule.py`).
- `tools/rule_extraction.py` - deterministic extraction of a rule's
  source-verbatim body fields (profile applicability, description,
  rationale, impact, default value, references, minimum OS CSP, GRID ID,
  CIS Controls table). Audit/remediation method-splitting and
  `check_command` engineering are deliberately out of scope - that's Phase
  2's job.
- `tools/verify_extraction.py` - acceptance test: diffs the parser's output
  against every rule file that existed under `baselines/` before this work,
  by locating each rule's section in its source markdown. Not a pytest
  suite; read its docstring for the two known, non-bug mismatch categories.
- `tools/generate_manifest.py` - added a `metadataPath` field per baseline
  entry (null when no `_metadata.json` exists yet for that folder).
- Generated real `_metadata.json` files for the two benchmark versions that
  have rule files (`cis/windows_11/v5.0.0`, `cis/macos_26_tahoe/v1.1.0`) and
  regenerated `_index.json`/`_manifest.json` to match.
- Tests: `tests/test_benchmark_markdown.py`, `tests/test_generate_metadata.py`,
  `tests/test_metadata_schema.py`, `tests/test_rule_extraction.py`; fixed
  `tests/test_generate_manifest.py` and `tests/test_generate_index.py` for
  the new `metadataPath` field and `_metadata.json`'s presence in rule
  folders respectively.

## Phase 2 design (not yet built)

- Drafts live outside `baselines/` (e.g. a gitignored
  `.cache/rule-extraction/...`), since the final schema can't hold scratch
  fields.
- On regeneration, read the existing committed rule file first. Any
  `audit.methods[].steps[]` entry with `check_command_verified: true` is
  copied through verbatim and that rule is skipped in the AI stage entirely.
- Skip AI entirely for templated cases (a literal source command plus an
  unambiguous title-derived `recommended_state` plus no manual/scripted
  ambiguity) - fill mechanically instead, still `check_command_verified:
  false`. Log how many rules were skipped this way vs. sent to AI.
- Authoring stage: one agent call per remaining rule, forced to
  `_rule.schema.json`'s shape via structured output.
- Validation stage: a second, independent agent call per newly-authored
  rule, blind to the authoring agent's reasoning.
- Model: a config value, decided empirically by running the authoring stage
  against the known-good rules with Haiku 4.5 and Sonnet 5 and diffing
  against the hand-authored `check_command`/`output_check`.
- Invocation: a Claude Code slash command/workflow only - no `anthropic` SDK
  dependency, no API key management.

## Progress log

- **2026-08-19** - Fixed the `pdf_to_markdown.py` source-directory bug
  (`4e1af7f` fix: point pdf_to_markdown.py at the actual PDF source
  directory), then built the full Phase 1 deterministic pipeline described
  above: markdown parsing module, `_metadata.json` schema/generator/
  validator, rule-body field extractor, and the acceptance test against all
  12 rule files that existed before this session. Generated `_metadata.json`
  for both existing benchmark versions and regenerated `_index.json`/
  `_manifest.json`. All 90+ tests pass. (`8bb4af5` feat: deterministic
  benchmark markdown parser + per-version metadata (Phase 1))
