# NIST SP 800-53 Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 1,014 current NIST SP 800-53 Rev. 5 controls and enhancements from NIST's OSCAL (oscal-content `v1.6.0`) as a third rule source, show them in the web UI, and generate a `supports` mapping from each mSCP rule to the 800-53 controls mSCP itself cites.

**Architecture:**
- **Importer:** a new normalizer and fetcher plug into the existing per-release framework (`tools/release_import.py`), like `tools/import_asd_ism.py`. Two small framework changes: `release_label` also receives the upstream directory, and an optional `after_import` hook runs after a successful import.
- **Schema:** the rule id pattern widens to allow a dot after the source prefix (`nist_800_53.ac-20.1`). No `schema_version` change.
- **Web UI:** driven by the manifest and vocabulary; only the Markdown reader (headings, nested lists) and one attribution sentence change.
- **Mapping:** a generator reads the normalized library and writes a normal mapping file plus an unresolved-citation report. Both importers that feed it call it.

**Tech Stack:** Python 3 standard library plus `jsonschema` (already used). React + TypeScript + Vitest + Playwright under Bun. No new dependencies.

**Spec:** `docs/plans/2026-11-11-nist-800-53-source-design.md`. Read sections 3 to 9 before any task; section 13 lists decisions the maintainer has not yet reviewed, so follow them as written and do not re-open them.

## Global Constraints

- **Source name** `nist_800_53`; display name `NIST SP 800-53 Rev. 5`; vocabulary label `NIST SP 800-53`.
- **Rule ids** `nist_800_53.<OSCAL id>` (`nist_800_53.ac-20`, `nist_800_53.ac-20.1`). OSCAL ids must match `^[a-z]{2}-\d+(\.\d+)?$`; rule files are `rules/<OSCAL id>.json`.
- **Upstream:** repository `https://github.com/usnistgov/oscal-content`, API path `usnistgov/oscal-content`, tag `v1.6.0` (annotated; commit `f0de6d8d8c059d374f15e0ae07508d82e370fc1d`), published 2026-10-22. User agent `intune-compliance-toolkit-nist-800-53-import`. Importer format `nist-800-53-rev5-oscal-1`.
- **Vendored files**, byte for byte, at their repository paths under `sources/nist_800_53/releases/<tag>/upstream/`: `LICENSE.md`, `nist.gov/SP800-53/README.md`, `nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json`, and `nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_{LOW,MODERATE,HIGH,PRIVACY}-baseline_profile.json`. Catalog SHA-256 `64ca6b4161de51ab6af098a7d101d326f14c95e1abf721396cd8a049e8115eeb`.
- **Licence block** on every rule and the manifest entry: `{ "name": "CC0 1.0 (public domain)", "url": "https://creativecommons.org/publicdomain/zero/1.0/", "rights_holder": "National Institute of Standards and Technology", "modified": true }`.
- **Counts for `v1.6.0`:** 1,014 rules (300 controls, 714 enhancements; 182 withdrawn entries skipped). Benchmarks: `nist_800_53_low` 149, `nist_800_53_moderate` 287, `nist_800_53_high` 370, `nist_800_53_privacy` 96. Current library total 2,509 (352 mSCP + 1,143 ISM + 1,014 800-53).
- **Generated mapping for `release_27.1` x `v1.6.0`:** 290 links, 678 pairs, 0 unresolved citations.
- **Untouched:** every mSCP and ISM rule file, index and vendored file, and every hand-written mapping file. `python tools/import_mscp.py --offline` and `python tools/import_asd_ism.py --offline` must leave `git status` clean after Task 1.
- **Sequencing:** the `nist_800_53` manifest entry must not reach `main` before Task 2 lands. Pushing this branch is fine.
- **Verification:** Python `python -m pytest -W error` from the repo root. Web, from `webui/`: `bun run test`, `bun run lint`, `bun run build` (runs `tsc -b`), and `bun run test:e2e` with `bun run dev` running. Visual changes also need Playwright screenshots at about 375px and about 1280px, read with the Read tool (`.claude/CLAUDE.md`).
- **Commits:** `type: summary` subject, a why-body, no `Co-Authored-By` or AI attribution line, no em dash anywhere. Commit and push after each task; add this plan's progress log entry in the same commit when practical. If the branch is `main`, ask before pushing.

---

### Task 1: Fetch, normalize and import NIST SP 800-53 `v1.6.0`

**Files:**
- Create: `tools/nist_800_53_normalize.py`, `tools/nist_800_53_fetch.py`, `tools/import_nist_800_53.py`
- Create: `tests/test_nist_800_53_normalize.py`, `tests/test_nist_800_53_fetch.py`, `tests/test_import_nist_800_53.py`
- Create: `tests/fixtures/nist_800_53/` holding a small hand-written catalog and four profiles at the same relative paths as upstream (see Step 1)
- Modify: `tools/release_import.py` (`release_label` signature), `tools/import_mscp.py` and `tools/import_asd_ism.py` (adapt their `release_label` to the new signature, output unchanged)
- Modify: `baselines/_rule.schema.json` and `baselines/_index.schema.json` (`id` pattern), `webui/src/logic/ruleDisplay.ts` (the comment on `upstreamRuleId` only)
- Modify: `tests/test_committed_library.py` (add the importer to `IMPORTERS_BY_NAME`, plus the committed-data tests below), `tests/test_release_import.py`, `.gitattributes`
- Modify: `NOTICE`, `README.md` (Licensing paragraph; new "Updating the NIST SP 800-53 rules" section after "Updating the ASD ISM rules")
- Generate and commit: `sources/nist_800_53/releases/v1.6.0/**`, `baselines/nist_800_53/releases/v1.6.0/**`, `baselines/_manifest.json`

**Behaviour** (design sections 4, 5 and 6):
- `tools/nist_800_53_normalize.py` exports `SOURCE_NAME`, `REPOSITORY_URL`, `CATALOG_PATH` (the repository path), `PROFILE_PATHS` (benchmark name to repository path, in the fixed order low, moderate, high, privacy), `LICENSE`, `label_for_control_id(control_id: str) -> str`, `control_id_for_label(label: str) -> str | None`, and `normalize_catalog(catalog_document: dict, profile_documents: dict[str, dict], lock: SourceLock) -> list[dict]`, which returns v5 rules sorted by OSCAL `sort-id` and raises `UnsupportedUpstreamData` for every case in design 5.6.
  - Field mapping exactly as the table in design 5.1, statement rendering as 5.2, guidance link handling as 5.3, benchmarks as 5.4, withdrawn entries skipped as 5.5.
  - `discussion` is `"## Control\n\n<statement>\n\n## Discussion\n\n<guidance>"`. Nested statement items are indented two spaces per level: `- a. ...`, then `  - 1. ...`.
- `tools/nist_800_53_fetch.py` mirrors `tools/asd_ism_fetch.py`: resolve the tag, fetch the published date, download each vendored file from `https://raw.githubusercontent.com/usnistgov/oscal-content/<commit sha>/<repository path>` into `upstream/<repository path>` (create parent folders), swap the staged directory in, and write `source.json` with `importer_format` `nist-800-53-rev5-oscal-1`.
- `tools/import_nist_800_53.py` mirrors `tools/import_asd_ism.py`. It reads JSON with duplicate keys rejected, writes `rules/<OSCAL id>.json` and `_index.json` (entries in `sort-id` order), and defines `IMPORTER`. Its release label is the catalog `metadata.version`, read from the vendored catalog, giving `5.2.0`.
- `SourceImporter.release_label` becomes `Callable[[str, Path], str]` (tag, upstream directory); `generate_release` passes the upstream directory. mSCP and ISM ignore the second argument.
- Id pattern in both schemas: `^[a-z0-9_]+\.[a-z0-9_-][a-z0-9_.-]*(?![\s\S])`. Do not change `schema_version`.
- `.gitattributes`: add `sources/nist_800_53/releases/*/upstream/** -text`, `sources/nist_800_53/releases/*/source.json text eol=lf` and `tests/fixtures/nist_800_53/** -text`, next to the existing source lines.
- NOTICE and README text: design section 7. Say that the content is a work of the US government in the public domain in the US and dedicated worldwide under CC0 1.0, that `sources/nist_800_53/releases/<tag>/upstream/` is an unmodified copy, what this project changed, that the vendored licence is `upstream/LICENSE.md`, and that NIST does not endorse this project.

- [ ] **Step 1: Write the fixture and the failing tests**
  - Fixture catalog with two families: one base control with a three-level statement, a label param, a `one-or-more` select whose choice inserts another param, a param whose label starts with "organization-defined", and guidance linking to a back-matter uuid, a control, a statement part and a family; one enhancement of it; one withdrawn enhancement; one control in no profile; `related` and `reference` links. Four tiny profiles.
  - `test_nist_800_53_normalize.py`:
    - `test_entries_become_v5_rules`: count excludes the withdrawn entry; every rule passes `tools.validate_library.schema_errors`.
    - `test_base_control_fields` and `test_enhancement_fields`: exact `id`, `title` (enhancement is `"<base> | <enhancement>"`), `section_path` (zero-padded label), `source`, `applicability`, `references`, and `None` for `check`, `odv`, `remediation`, `architecture`.
    - `test_statement_rendering`: the exact Markdown for the three-level statement, including both Assignment forms and the Selection with a nested insert.
    - `test_guidance_links`: uuid link rewritten to its href; control, part and family links reduced to their text; no `](#` left.
    - `test_benchmarks_follow_profiles`: fixed order; control in no profile has `[]`.
    - `test_label_round_trip`: `ac-20.1` <-> `AC-20(1)`, `ac-2` <-> `AC-2`; malformed labels give `None`.
    - Fail-loudly tests, one per case in design 5.6, parametrised where natural.
  - `test_nist_800_53_fetch.py`: fake opener as in `tests/test_asd_ism_fetch.py`; files land at their repository paths, byte-identical; URLs contain the resolved sha; invalid tag makes no request.
  - `test_import_nist_800_53.py`: library, index and manifest written; other sources' manifest entries kept; offline import byte-stable; failed normalization leaves the library untouched; release label equal to the fixture's version.
  - `test_release_import.py`: the new `release_label` signature receives the upstream directory.
  - `test_committed_library.py`: importer added to `IMPORTERS_BY_NAME`; `test_nist_800_53_vendored_catalog_hash`; `test_nist_800_53_rule_and_benchmark_counts` (the Global Constraints numbers); `test_nist_800_53_discussions_have_no_raw_links_or_inserts` (no `](#`, no `{{`); `test_nist_800_53_vendored_license_mentions_cc0`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `python -m pytest -W error tests/test_nist_800_53_normalize.py tests/test_nist_800_53_fetch.py tests/test_import_nist_800_53.py`
  Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the normalizer, fetcher, CLI, framework and schema changes**

- [ ] **Step 4: Run the real import**
  Run: `python tools/import_nist_800_53.py --tag v1.6.0`
  Expected: `Imported 1014 NIST SP 800-53 Rev. 5 rules from v1.6.0 (f0de6d8)`. Then check the catalog SHA-256, that the manifest lists three sources, and that `python tools/import_nist_800_53.py --offline`, `python tools/import_mscp.py --offline` and `python tools/import_asd_ism.py --offline` leave `git status` clean apart from this task's new files.

- [ ] **Step 5: Run the full Python suite**
  Run: `python -m pytest -W error`
  Expected: PASS. Vitest and e2e count pins fail until Task 2; do not merge to `main` before it.

- [ ] **Step 6: Commit and push**
  `feat: import NIST SP 800-53 Rev. 5 (oscal-content v1.6.0) as a rule source`. The body names the release, commit sha, the 1,014 count, the skipped withdrawn entries and the id pattern change.

### Task 2: Show 800-53 rules in the web UI

**Files:**
- Modify: `baselines/_vocabulary.json` (source label and the four benchmark labels in design 5.4)
- Modify: `webui/src/logic/discussionMarkup.ts` and `webui/src/logic/discussionMarkup.test.ts` (Markdown `## ` headings and nested lists); whatever renders `list` blocks (`webui/src/components/rules/DiscussionText.tsx`) for nesting
- Modify: `webui/src/components/layout/AttributionFooter.tsx` ("licensed" to "under")
- Modify: every Vitest and e2e assertion pinned to the old total of 1,495 rules, and any other assertion that breaks only because 800-53 rows now exist (`webui/e2e/smoke.spec.ts` and others; `grep -rn 1495 webui/e2e webui/src`)
- Create: `webui/e2e/nist-800-53.spec.ts`

**Behaviour:**
- Markdown reader: a line starting with `## ` is a heading block. A `- ` line indented by `2 x n` spaces is a list item at depth `n` (0 to 2); deeper indentation fails safe to depth 2. The `list` block carries the depth per item (change the type as needed) and renders as nested lists with the existing list styling. Everything else, including every ISM discussion, renders exactly as before.
- Attribution dialog sentence per source: `Rules from the <display name> (<release tag>), under <licence name>, modified for this tool.`
- No other production change is expected. If one is needed to load or show an 800-53 rule, make the smallest change and record it in the progress log.

- [ ] **Step 1: Write the failing tests**
  - Vitest: heading block; nested list at three depths; a real ISM discussion (read from the committed library, for example `asd_ism.ism-1667`) parses to the same blocks as before the change.
  - `nist-800-53.spec.ts`:
    - Ticking the `NIST SP 800-53` source shows `1014 of 2509 rules`.
    - Ticking the `800-53 Moderate` benchmark shows 287 rules.
    - Searching `ac-20.1` shows one row titled `Use of External Systems | Limits on Authorized Use`.
    - Opening `nist_800_53.ac-7` shows the "Control" and "Discussion" headings, a nested list item `a.`, the text `[Assignment: organization-defined number]`, and the credit line `From NIST SP 800-53 v1.6.0 (ac-7)` (match the existing ISM credit assertion's format in `smoke.spec.ts`).
    - The Sources & licences dialog lists `NIST SP 800-53 Rev. 5` with `CC0 1.0 (public domain)`.
  - Update the old totals (1,495 to 2,509) and anything else that breaks only because of the new source; list each change in the progress log entry.

- [ ] **Step 2: Implement, then run everything**
  Run, from `webui/`: `bun run test && bun run lint && bun run build && bun run test:e2e`, then `python -m pytest -W error` from the repo root.
  Expected: all pass.

- [ ] **Step 3: Screenshots**
  With Playwright at about 375px and about 1280px, in light and dark: the Rules view filtered to `NIST SP 800-53`; the expanded details of `nist_800_53.ac-2` (long nested statement) and `nist_800_53.ac-20.1`; the Sources & licences dialog; the Frameworks landing card. Read each one. Check that nested lists indent, headings are distinct from body text, the section tree orders `AC-02` before `AC-10`, and nothing overflows at 375px. Save under the session scratchpad and record what you looked at in the progress log.

- [ ] **Step 4: Commit and push**
  `feat: show NIST SP 800-53 controls in the web UI`.

### Task 3: Generate the mSCP to 800-53 mapping from mSCP's citations

**Files:**
- Create: `tools/generate_mscp_nist_800_53_mapping.py`, `tests/test_mscp_nist_800_53_mapping.py`
- Modify: `tools/release_import.py` (`after_import` hook), `tools/import_mscp.py` and `tools/import_nist_800_53.py` (set the hook), `tests/test_release_import.py`
- Modify: `tests/test_committed_library.py` (the `_mappings` "never generated" comment; see design 9.2)
- Modify: `README.md` ("Mapping rules": the generated file, the exception to the "without debate" rule, and that hand-written mSCP to 800-53 links are only for pairs mSCP does not cite; "Updating the mSCP rules" and "Updating the NIST SP 800-53 rules": the import regenerates the mapping, review its diff)
- Generate and commit: `baselines/_mappings/rules/mscp-to-nist-800-53.json`, `docs/mappings/mscp-to-nist-800-53-unresolved.json`

**Behaviour** (design section 9):
- `generate(baselines_dir: Path, report_path: Path) -> GenerationResult | None` reads the manifest; returns `None` (and the CLI prints why) when `mscp` or `nist_800_53` is missing. Otherwise it reads every rule of the current mSCP release, takes `references.nist["800-53r5"]` (absent key: no link), converts each citation with `control_id_for_label` from `tools/nist_800_53_normalize.py`, and checks the id against the current 800-53 release's index.
- Each citing rule with at least one resolved citation gives one link exactly as in design 9.1: relation `supports`, `from` the mSCP rule at the current mSCP release, `to` the resolved controls at the current 800-53 release in citation order without repeats, and the note `Generated from mSCP's own references: mSCP lists this 800-53 control for this rule. Not reviewed by this project.` Links are sorted by mSCP rule id.
- The mapping file has `schema_version` 1, id `mscp-to-nist-800-53`, and a `description` naming the generator command, both release tags, and "do not edit by hand". It is written with `tools/json_output.write_json` to `baselines_dir / "_mappings" / "rules" / "mscp-to-nist-800-53.json"`.
- Unresolved citations (`unrecognised_format`, `not_in_release`, `duplicate_citation`) are printed as warnings and written to the report in the shape in design 9.4, sorted by rule then citation. The CLI and the hook pass `report_path = baselines_dir.parent / "docs" / "mappings" / "mscp-to-nist-800-53-unresolved.json"`.
- `SourceImporter.after_import: Callable[[Path], None] | None = None`. `run_cli` calls it once with the baselines directory after all requested releases imported; a failure there is printed and makes the exit code 1, but the imported releases stay. Set it in `import_mscp` and `import_nist_800_53`, not in `import_asd_ism`.
- CLI: `python tools/generate_mscp_nist_800_53_mapping.py [--baselines-dir DIR]` prints `Wrote <links> links (<pairs> pairs) from mSCP <tag> to NIST SP 800-53 <tag>; <n> citations unresolved`.

- [ ] **Step 1: Write the failing tests**
  - `test_mscp_nist_800_53_mapping.py`, on small fixture libraries built in `tmp_path`:
    - resolved citations become one link per rule in citation order, with the exact note and current releases;
    - a rule without the key, and a rule whose citations all fail, produce no link;
    - each unresolved reason is reported and written to the report;
    - a repeated citation is kept once and reported;
    - nothing is written when a source is missing;
    - two runs give identical bytes.
  - Committed data: regenerating into a temporary copy gives the committed mapping file and report byte for byte; the committed mapping has 290 links and 678 pairs; `tools.mappings.validate_mappings` on the committed folder returns no errors and no warnings that name `mscp-to-nist-800-53.json`.
  - `test_release_import.py`: `after_import` runs once after success, never after a failed import, and its failure gives exit code 1 with the releases still published.

- [ ] **Step 2: Run them to verify they fail**
  Run: `python -m pytest -W error tests/test_mscp_nist_800_53_mapping.py tests/test_release_import.py`
  Expected: FAIL.

- [ ] **Step 3: Implement, then generate**
  Run: `python tools/generate_mscp_nist_800_53_mapping.py`
  Expected: `Wrote 290 links (678 pairs) from mSCP release_27.1 to NIST SP 800-53 v1.6.0; 0 citations unresolved`. Then `python tools/import_mscp.py --offline` and `python tools/import_nist_800_53.py --offline` must leave `git status` unchanged, and `python tools/mappings.py` must print no error.

- [ ] **Step 4: Run the full suites**
  Run: `python -m pytest -W error`; from `webui/`: `bun run test && bun run lint && bun run build && bun run test:e2e`.
  Expected: all pass (e2e starts every test from an empty mapping index, so the new file should not change existing specs).

- [ ] **Step 5: Commit and push**
  `feat: generate the mSCP to NIST SP 800-53 mapping from mSCP's own citations`. The body says the links are mSCP's claims, not reviewed, and how they are kept current.

### Task 4: Mapped rules end to end, and closing the docs

**Files:**
- Modify: `webui/e2e/nist-800-53.spec.ts` (mapped rules tests)
- Modify: this plan's and the design's progress logs; the design's `Status` line
- Modify: `README.md` "Known limitations" if anything found here belongs there

**Behaviour:** no production change is expected. If the mapped rules tab misbehaves with the generated data (for example the long "Supported by" groups), fix the smallest thing and record it.

- [ ] **Step 1: Write the e2e tests**
  Serve the committed generated mapping through the publish step's real index (or build the index from the committed file with `page.route`, following how `smoke.spec.ts` already routes mapping indexes):
  - `mscp.os_gatekeeper_enable` shows a `NIST SP 800-53 Supports` group with `cm-14`, `cm-5`, `si-7.1`, `si-7.15` and `si-3`, each with the generated note.
  - `nist_800_53.cm-7` shows a `NIST mSCP Supported by (77)` group, and its filter narrows the list.
  - "Go to this rule" from an 800-53 item opens that control, and from the 800-53 side back to an mSCP rule.

- [ ] **Step 2: Run everything**
  Run: `python -m pytest -W error`; from `webui/`: `bun run test && bun run lint && bun run build && bun run test:e2e`.
  Expected: all pass.

- [ ] **Step 3: Screenshots**
  At about 375px and about 1280px: the Mapped rules tab of `mscp.os_gatekeeper_enable` and of `nist_800_53.cm-7` with the group open. Read each, check the long list stays usable and the note wraps.

- [ ] **Step 4: Close the docs, commit and push**
  Set the design's `Status` to implemented with the date, add progress log entries to both documents (date, what was done, commit hashes and subjects), and commit `test: cover the generated mSCP to NIST SP 800-53 mappings end to end` (or `docs:` if no test changed). Push.

## Progress log

- 2026-11-11: Task 1 done. Added the NIST SP 800-53 Rev. 5 normalizer, fetcher and importer, widened the rule id pattern to allow dots, changed `release_label` to receive the upstream directory, and imported oscal-content `v1.6.0` (1,014 rules; manifest now lists three sources). Statement text is link-rewritten as well as guidance, because 4 statements link to statement parts. Landed in 7100ecb "feat: import NIST SP 800-53 Rev. 5 (oscal-content v1.6.0) as a rule source".
- 2026-11-11: Task 1 review fix. Moved the duplicate-key-rejecting JSON reader into `tools/json_output.py` for the ISM and NIST importers (and the coming ASD E4EIT one), restricted id and label patterns to ASCII digits, and stripped statement text like guidance. Landed in 59250ea "refactor: share the duplicate-rejecting JSON reader between importers".

- 2026-11-11: Task 2 done. Added the NIST SP 800-53 source and four benchmark labels to `baselines/_vocabulary.json`. The Markdown discussion reader now reads `## ` headings and `- ` items nested by two-space indentation (depth 0 to 2, deeper fails safe to 2; the `list` block carries `{ text, depth }` items and `nestListItems` builds the tree that `DiscussionText` renders as nested lists, ISM discussions unchanged). The Sources & licences sentence now reads "under <licence>". Updated pins that broke only because 800-53 rows exist: total 1495 to 2509; Version "None" 1145 to 2159; Target "None" 1143 to 2157 (800-53 rules have no target or version, like ISM); paging 30 to 51 pages at 50 per page (last page 9 rows), 8 to 13 pages at 200, 60 to 101 pages at 25, 15 to 26 pages at 100; root section headings 30 to 50 (20 control families added); the last Source option is now NIST SP 800-53 (1014, not 352). New `webui/e2e/nist-800-53.spec.ts` covers the source and Moderate filters, the `ac-20.1` title, the `ac-7` details (headings, `a.` item, assignment text, credit line), nested items in `ac-2`, and the dialog. Screenshots at 375px and 1280px, light and dark, were read for the filtered Rules view, expanded `ac-2` and `ac-20.1`, the section tree (AC-01 to AC-20 in order, AC-02 before AC-10), the Sources & licences dialog and the Frameworks cards: nested lists indent with a different marker, Control and Discussion headings are bold, nothing overflows at 375px. Known cosmetic issue left for review: the Frameworks card reads "5.2.0 (v1.6.0) (v1.6.0)" because the release label already contains the tag. Landed in 8db0acc "feat: show NIST SP 800-53 controls in the web UI".
- 2026-11-11: Task 2 pre-review fixes. (1) The 800-53 release label is now the catalog `metadata.version` (`5.2.0`), not `5.2.0 (v1.6.0)`: ISM and mSCP labels never contain the tag and the UI always shows it beside the label, so the tag appeared twice on the Frameworks card. Changed `tools/import_nist_800_53.py`, regenerated the manifest with `--offline`, and updated the tests, README and the design's release-label decision (6.3, 13). (2) The rule-detail credit line and the manual attestation report now say "under CC0 1.0 (public domain)" for a public-domain licence and still say "licensed" for CC BY (new `webui/src/logic/licenceWording.ts`). Added a Frameworks card e2e and an attestation-report Vitest case. Landed in the commit "fix: show the 800-53 release tag once and credit CC0 with under".
