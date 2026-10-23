# Rule Schema v4 and mSCP Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the rule library, the mSCP importer and the web UI to the source-agnostic schema v4, with no change a user can see and no change to any generated bundle.

**Architecture:** This is phase 1 of the ASD ISM design. The mSCP importer emits v4: applicability becomes a list of `{ target, version, benchmarks }`, `section_path`, `discussion_format`, `source.upstream_revision` and `source.upstream_updated` are added, and `platform` is removed. The web UI reads v4 through one new helper module, `logic/applicability.ts`, and identifies versions by a "version key" (`"macOS 27.0"`) so that versions belonging to different targets never merge. Facet titles, labels and table text stay exactly as they are today. Phase 3 renames them and adds "None".

**Tech Stack:** As before: Python importer and validator (pytest, jsonschema); React + TypeScript + zustand + Vitest + Playwright under Bun.

**Spec:** `docs/plans/2026-10-22-asd-ism-source-design.md`, sections 4, 5, 7, 8 and 11 (phase 1).

## Global Constraints

- **Schema version:** `schema_version` is `4` in rule, index and manifest files and their schemas. `SCHEMA_VERSION = 4` in `tools/import_mscp.py`.
- **Pattern convention:** keep the schemas' `(?![\s\S])` end anchor (not `$`).
- **Rule ids:**
  - `id` matches `^[a-z0-9_]+\.[a-z0-9_-]+(?![\s\S])`.
  - `source.name` matches `^[a-z0-9_]+(?![\s\S])`.
  - The index `id` uses the same pattern as the rule `id`.
- **Removed fields:** `platform` is removed from rule files and index entries. `additionalProperties: false` stays, so a leftover `platform` is a schema error.
- **New rule fields:**
  - `discussion_format`: enum `"asciidoc" | "markdown"`, required.
  - `section_path`: array of non-empty single-line strings, `minItems: 1`, required.
  - `source.upstream_revision` and `source.upstream_updated`: `string | null`, both required.
- **`remediation`:** `object | null`.
- **Applicability:**
  - `applicability` is an array of `{ target: string | null, version: string | null, benchmarks: [{ name, severity }] }`. Each item has `additionalProperties: false` and all three keys required.
  - `version` matches `^\S+(?![\s\S])` when non-null.
  - A non-null `version` requires a non-null `target` (schema `if`/`then`).
  - Entries are unique by `(target, version)`. JSON Schema can't express that, so `tools/validate_library.py` checks it.
- **Applicability order (byte stability):**
  - Sort by target, with `null` first, then by version, with `null` first and then numeric ascending as `15.0`, `26.0`, `27.0`.
  - This keeps mSCP's existing file order, because today's dict keys are written sorted.
  - Benchmark order within an entry is unchanged from upstream.
- **mSCP mapping:**
  - Each upstream `platforms.macOS.<version>` becomes `{ "target": "macOS", "version": "<version>", "benchmarks": [...] }`.
  - A rule with no upstream versions gets exactly `[{ "target": "macOS", "version": null, "benchmarks": [] }]`. Two rules today: `os_firewall_log_enable` and `os_gatekeeper_rearm`.
  - `section_path` is `[<folder>]`, taken from `rules/<folder>/<file>.yaml`. The same validation and error message as today's `section_of`.
  - `discussion_format` is `"asciidoc"`.
  - `upstream_revision` and `upstream_updated` are `null`.
  - The index `section` is `section_path[0]`, and its pattern loosens to any non-empty single line.
- **Values unchanged:** every mSCP value (title, discussion, check, ODV, references, tags, benchmark membership, severity) is identical before and after. Only the structure changes.
- **No visible change:**
  - Facet titles stay "Platform" and "macOS version".
  - Labels stay "macOS 27" and so on.
  - Table text stays the same, including "No macOS version listed".
  - The existing `webui/e2e/smoke.spec.ts` passes unmodified.
- **Generator unchanged:**
  - Bundle files are byte-identical for the same selection.
  - The two version-less rules are still blocked with the exact message `mSCP does not map this rule to any macOS version.`
- **Vocabulary:**
  - Rename the `platforms` vocabulary to `targets`, and `os_versions` to `versions`.
  - `versions` terms are version keys, e.g. `{ "label": "macOS 27", "terms": ["macOS 27.0"], "metadata": ["platform"] }`.
  - The vocabulary schema, `VOCABULARY_NAMES` and `_vocabulary.json` all change together.
- **The generator's target is defined once:** `export const GENERATED_TARGET = 'macOS'` in `webui/src/logic/checkPlan.ts`. No other TypeScript file names a target.
- **Verification:**
  - Python: `python -m pytest -W error` from the repo root.
  - Web, from `webui/`: `bun run test`, `bun run lint`, `bun run build`, `bun run test:e2e`.
  - Playwright screenshots of the browse screen and a rule detail panel at about 375px and about 1280px, before and after, looked at with Read.
- **Commits:** subject is `type: summary`. No `Co-Authored-By` or other AI attribution line. No em dash characters (U+2014) anywhere. Implementers commit only; the controller pushes after Task 2 is reviewed.

## Review Focus

- **A rule with no versions** (`os_firewall_log_enable`) still appears under the macOS Platform option, still shows "No macOS version listed", and the generator still blocks it with the same message. Pinned by the bundle snapshot (Task 1 Step 1 and Task 2 Step 7) and a `checkPlan` unit test (Task 2).
- **Two targets sharing a version string** (`macOS 27.0` and `Windows 27.0`) must be two separate version options, and each benchmark must stay scoped to its own target. Pinned by `applicability.test.ts` and `ruleFilters.test.ts` (Task 2).
- **A target name containing a space** (`Microsoft 365`) must survive `parseVersionKey`. Pinned in `applicability.test.ts` (Task 2).
- **A version the vocabulary doesn't label** (a future `28.0`) falls back to the raw version key (`macOS 28.0`). Pinned in `applicability.test.ts` (Task 2).
- **Re-import stability:** `tests/test_committed_library.py::test_committed_library_matches_regeneration` still passes, and a second `--offline` run produces no diff (Task 1).

---

### Task 1: Schema v4 and the mSCP importer

**Files:**
- Modify: `baselines/_rule.schema.json`, `baselines/_index.schema.json`, `baselines/_manifest.schema.json`
- Modify: `tools/mscp_normalize.py`, `tools/import_mscp.py`, `tools/validate_library.py`
- Modify tests: `tests/test_mscp_normalize.py`, `tests/test_library_schema.py`, `tests/test_import_mscp.py`
- Regenerate: `baselines/mscp/**`, `baselines/_manifest.json`

**Interfaces:**
- Produces:
  - `normalize_rule(upstream, upstream_path, lock) -> dict | None` returns a v4 rule.
  - `section_path_of(upstream_path: str, rule_id: str) -> list[str]` replaces `section_of(rule)`. It raises `UnsupportedUpstreamData` with today's message.
  - `index_entry(rule, file) -> dict` has no `platform` and has `section = rule["section_path"][0]`.
  - `applicability_errors(rule: dict) -> list[str]` in `tools/validate_library.py` reports duplicate `(target, version)` pairs. `_validate_source` calls it for every rule.

- [ ] **Step 1: Take the "before" bundle snapshot (one-off, not committed)**

  Create `webui/src/logic/bundleSnapshot.tmp.test.ts`. Never commit it; delete it after Task 2 Step 7. It must work unchanged against both the v3 data now and the v4 data after Task 2:
  - Read `_manifest.json`, then each index, then each rule, from `../baselines` with `fs`, as `libraryData.test.ts` does.
  - Compute `coveredVersions` directly from the raw rule files: the bare macOS versions in v3 dict keys, or in v4 entries with `target === 'macOS'` and a non-null version. Don't call `coveredVersionsOf`.
  - For every rule, build a selection entry with the ODV value set to `odv.recommended` (see `logic/selectionEntry.ts`), then call `classifyRule(rule, entry, coveredVersions, index)` with the vocabulary index built from `baselines/_vocabulary.json`.
  - Then call `packChunks(generatable, index)` and `buildBundleFiles(chunks, manual)`.
  - Write `{ files: { <path>: <sha256 of content> }, blocked: [{ id, message }] }`, sorted, to `process.env.BUNDLE_SNAPSHOT_OUT`.

  Run: `BUNDLE_SNAPSHOT_OUT=<scratchpad>/bundle-before.json bun run test src/logic/bundleSnapshot.tmp.test.ts` from `webui/`.
  Expected: the file is written, and `blocked` lists `mscp.os_firewall_log_enable` and `mscp.os_gatekeeper_rearm` with `mSCP does not map this rule to any macOS version.`

  Also copy `baselines/` to `<scratchpad>/baselines-v3/` for Step 7.

- [ ] **Step 2: Write the failing Python tests**

  In `tests/test_mscp_normalize.py`:
  - `test_applicability_is_a_target_scoped_list`: an upstream rule with versions `26.0` and `15.0` (in that YAML order) gives `[{"target": "macOS", "version": "15.0", "benchmarks": [...]}, {"target": "macOS", "version": "26.0", "benchmarks": [...]}]`, with benchmarks in upstream order.
  - `test_rule_without_versions_keeps_macos_target`: gives `[{"target": "macOS", "version": None, "benchmarks": []}]`.
  - `test_section_path_is_the_upstream_folder`: `rules/audit/x.yaml` gives `["audit"]`; `rules/x.yaml` raises `UnsupportedUpstreamData`.
  - `test_v4_source_and_format_fields`: `discussion_format == "asciidoc"`, `source["upstream_revision"] is None`, `source["upstream_updated"] is None`, `schema_version == 4`, `"platform" not in rule`.
  - `test_index_entry_section_comes_from_section_path`: `index_entry` has `section == rule["section_path"][0]` and no `platform`.

  In `tests/test_library_schema.py`:
  - `test_accepts_unversioned_untargeted_rule`: a rule with `id` `asd_ism.ism-1667`, `applicability` `[{"target": None, "version": None, "benchmarks": []}]` and `remediation: None` is valid.
  - `test_rejects_version_without_target`
  - `test_rejects_platform_key`
  - `test_rejects_version_with_whitespace`
  - `test_duplicate_target_version_is_reported`: `applicability_errors` on two `macOS`/`15.0` entries returns one error naming the rule id.

  Update the existing fixtures in these files and in `tests/test_import_mscp.py` to the v4 shape.

- [ ] **Step 3: Run the tests to verify they fail**

  Run: `python -m pytest -W error tests/test_mscp_normalize.py tests/test_library_schema.py tests/test_import_mscp.py`
  Expected: the new tests FAIL. Applicability is still a dict, `platform` is still present, and `applicability_errors` doesn't exist.

- [ ] **Step 4: Implement the v4 schemas, normalizer, importer and validator changes**

  Follow Global Constraints exactly. In `tools/mscp_normalize.py`:
  - `normalize_rule` gets `section_path` from `section_path_of(upstream_path, rule_id)`, so a bad path fails during normalization.
  - Sort applicability by the order given in Global Constraints.
  - Update the module docstring from v3 to v4.

- [ ] **Step 5: Run the Python tests to verify they pass**

  Run: `python -m pytest -W error tests/test_mscp_normalize.py tests/test_library_schema.py tests/test_import_mscp.py`
  Expected: PASS.

- [ ] **Step 6: Regenerate the library and check it is stable**

  Run: `python tools/import_mscp.py --offline`, then run it again. (`--tag` and `--offline` are mutually exclusive.)
  Expected: the first run rewrites `baselines/mscp/**` and `baselines/_manifest.json`, and the second run changes nothing (`git status` is the same after both).

- [ ] **Step 7: Prove that no values changed (one-off, not committed)**

  Write a throwaway script in the scratchpad that converts every file in `<scratchpad>/baselines-v3/` to v4 by these rules:
  - Drop `platform`.
  - Convert the applicability dict to a list using the order rules, or `[{macOS, null, []}]` when it is empty.
  - Add `section_path: [<folder of upstream_path>]`, `discussion_format: "asciidoc"`, `upstream_revision: null` and `upstream_updated: null`.
  - Set `schema_version: 4`.
  - Do the same for index entries (drop `platform`, convert applicability) and the manifest (`schema_version`).

  Compare the parsed JSON of each converted file to the regenerated file.
  Run: `python -I <scratchpad>/v3_to_v4_check.py <scratchpad>/baselines-v3 baselines`
  Expected: `0 differences across 352 files` (350 rules, the index and the manifest).

- [ ] **Step 8: Run the full Python suite**

  Run: `python -m pytest -W error`
  Expected: PASS, including `tests/test_committed_library.py`. Vitest's `libraryData.test.ts` fails until Task 2. That's expected, so don't push yet.

- [ ] **Step 9: Commit**

  ```bash
  git add baselines tools tests
  git commit -m "feat: move the rule library and mSCP importer to schema v4"
  ```
  Commit body: why the restructure was made (source-agnostic applicability, the ISM source), and that the values are unchanged (Step 7).

### Task 2: Web UI reads schema v4, with no visible change

**Files:**
- Create: `webui/src/logic/applicability.ts`, `webui/src/logic/applicability.test.ts`
- Modify types: `webui/src/types/library.ts`, `webui/src/types/rule-row.ts`, `webui/src/types/vocabulary.ts`
- Modify data and logic: `webui/src/data/ruleRows.ts`, `webui/src/logic/ruleFilters.ts`, `webui/src/logic/ruleDisplay.ts`, `webui/src/logic/checkPlan.ts`, `webui/src/logic/chunking.ts` (`sectionOf`), `webui/src/state/filterStore.ts`
- Modify components: `webui/src/components/filters/FilterSidebar.tsx`, `webui/src/components/rules/RuleTable.tsx`, `webui/src/components/rules/RuleCheckSection.tsx`, `webui/src/components/rules/RuleRemediationSection.tsx`
- Modify the vocabulary: `baselines/_vocabulary.schema.json`, `baselines/_vocabulary.json`
- Modify tests: `webui/src/logic/testRuleFixtures.ts`, `webui/src/logic/testVocabularyFixtures.ts`, `webui/src/logic/libraryData.test.ts`, and every existing `*.test.ts` that builds rows or rules (`ruleRows.test.ts`, `ruleFilters.test.ts`, `ruleDisplay.test.ts`, `checkPlan.test.ts`, `chunking.test.ts`, ...)
- Unchanged: `webui/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the v4 JSON from Task 1.
- Produces, in `types/library.ts`:
  - `BenchmarkMembership { name: string; severity: string | null }`
  - `ApplicabilityEntry { target: string | null; version: string | null; benchmarks: BenchmarkMembership[] }`
  - `type Applicability = ApplicabilityEntry[]`
  - `Rule` gains `discussion_format: 'asciidoc' | 'markdown'`, `section_path: string[]`, `source.upstream_revision: string | null` and `source.upstream_updated: string | null`. It loses `platform`. `remediation` becomes `Remediation | null`. `RuleSource.name` becomes `string`. `schema_version` becomes `4`.
  - `IndexEntry` loses `platform`. `RuleIndex.schema_version` and `Manifest.schema_version` become `4`.
- Produces, in `logic/applicability.ts`:
  - `versionKey(target: string, version: string): string` returns `` `${target} ${version}` ``.
  - `parseVersionKey(key: string): { target: string; version: string }` splits at the last space.
  - `compareVersionKeys(left: string, right: string): number` orders by target (`localeCompare`), then by `compareVersionsDescending`.
  - `targetsOf(applicability: Applicability): (string | null)[]` returns unique targets in entry order.
  - `versionKeysOf(applicability: Applicability): string[]` returns the keys of entries with a non-null version, sorted with `compareVersionKeys`.
  - `benchmarksAt(applicability: Applicability, key: string): BenchmarkMembership[]` returns `[]` when the key is absent.
  - `versionsForTarget(applicability: Applicability, target: string): string[]` returns bare versions, unsorted.
- Produces, in `logic/checkPlan.ts`: `export const GENERATED_TARGET = 'macOS'`.
- Produces, in `types/rule-row.ts`: `RuleRow` replaces `platform` with `targets: (string | null)[]` and `osVersions` with `versionKeys: string[]`.
- Produces, in `data/ruleRows.ts`: `coveredVersionsOf(rows: RuleRow[], target: string): string[]` returns bare versions for that target, newest first. `loadLibrary` passes `GENERATED_TARGET`.
- Produces, in `state/filterStore.ts`: `platforms` becomes `targets` and `osVersions` becomes `versions`, with `toggleTarget` and `toggleVersion`. `FilterDimension` and `FilterValues` follow.
- Produces, in `logic/ruleFilters.ts`:
  - `targetGroupKeys(row, index): string[]` replaces `platformGroupKey`. It skips `null` targets; phase 3 adds "None".
  - `versionsUnder(row, versions, index)` returns version keys.
  - `benchmarkSummary(applicability, versionKeysInScope, index)` takes version keys and labels them through the `versions` vocabulary.

- [ ] **Step 1: Write the failing tests**

  In `applicability.test.ts`:
  - `separates versions of different targets`: entries `macOS 27.0` and `Windows 27.0` give two keys, and `benchmarksAt` returns each target's own benchmarks.
  - `parses a target containing a space`: `parseVersionKey('Microsoft 365 2026.1')` equals `{ target: 'Microsoft 365', version: '2026.1' }`.
  - `orders keys by target then newest version`: `['Windows 9.0', 'macOS 15.0', 'macOS 27.0']` sorts to `['macOS 27.0', 'macOS 15.0', 'Windows 9.0']`. Comparing targets uses `left.localeCompare(right, 'en')`, which puts `macOS` before `Windows`.
  - `skips null versions and keeps null targets`: `[{ target: null, version: null, benchmarks: [...] }]` gives `targetsOf` `[null]` and `versionKeysOf` `[]`.
  - `an unlabelled version falls back to its key`: `termLabel(index, 'versions', 'macOS 28.0')` equals `'macOS 28.0'`.

  In `checkPlan.test.ts`:
  - `blocks a macOS rule with no listed version`: applicability `[{ target: 'macOS', version: null, benchmarks: [] }]` gives `{ problem: 'mSCP does not map this rule to any macOS version.' }`.
  - `ignores entries for other targets`: adding a `Windows`/`27.0` entry doesn't add a branch.

  Migrate the existing tests mechanically. Version strings become version keys (`'27.0'` becomes `'macOS 27.0'`), the `os_versions` vocabulary becomes `versions`, `platform` becomes `targets`, and fixtures move to v4 shapes. Their assertions about behaviour stay the same.

  In `libraryData.test.ts`, replace `has a non-empty platform on every index entry` with `has a non-empty section_path on every rule`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `bun run test` (from `webui/`)
  Expected: FAIL, because `applicability.ts` doesn't exist yet and the types don't match.

- [ ] **Step 3: Implement `logic/applicability.ts` and the type changes**

- [ ] **Step 4: Move the data layer, filters, display, generator, chunking, store, components and vocabulary to the new interfaces**

  - `chunking.ts` `sectionOf(rule)` returns `rule.section_path[0]`.
  - `RuleCheckSection` and `RuleRemediationSection` label `by_version` keys with `termLabel(index, 'versions', versionKey(GENERATED_TARGET, version))`.
  - `RuleCheckSection`'s "No macOS version listed" condition becomes `versionsForTarget(rule.applicability, GENERATED_TARGET).length === 0`.
  - `RuleRemediationSection` renders nothing when `rule.remediation` is `null`.
  - In `_vocabulary.json`, rename the keys and rewrite the three `os_versions` terms to `macOS 27.0`, `macOS 26.0` and `macOS 15.0`, keeping their labels.

- [ ] **Step 5: Run the web suite**

  Run: `bun run test && bun run lint && bun run build` (from `webui/`)
  Expected: PASS.

- [ ] **Step 6: Run e2e and compare screenshots**

  Run: `bun run test:e2e`
  Expected: PASS, with `smoke.spec.ts` unmodified.

  Then take screenshots of the browse screen (filters open) and the detail panel for `mscp.os_firewall_log_enable` and `mscp.audit_acls_folders_configure`, at 375px and 1280px, before (from a worktree at the Task 1 base commit) and after. Look at each pair with Read.
  Expected: no visible difference.

- [ ] **Step 7: Take the "after" bundle snapshot and compare**

  Run: `BUNDLE_SNAPSHOT_OUT=<scratchpad>/bundle-after.json bun run test src/logic/bundleSnapshot.tmp.test.ts`, then `diff <scratchpad>/bundle-before.json <scratchpad>/bundle-after.json`
  Expected: no output (identical). Then delete `bundleSnapshot.tmp.test.ts`.

- [ ] **Step 8: Run the Python suite (the vocabulary schema changed)**

  Run: `python -m pytest -W error`
  Expected: PASS.

- [ ] **Step 9: Commit, log progress, push**

  ```bash
  git add baselines webui
  git commit -m "refactor: read schema v4 applicability in the web UI"
  ```
  Then add Progress log entries to this plan and to `docs/plans/2026-10-22-asd-ism-source-design.md`: the date, Tasks 1 and 2 with their short hashes, the Step 7 results of both tasks, and the screenshot check. Commit with `docs: record schema v4 progress`. The controller pushes the branch after review.

## Progress log

- 2026-10-23: Plan written (no code yet).
- 2026-10-23: Task 1 done. Schemas, mSCP importer and validator moved to v4 and `baselines/mscp/` regenerated (`8b1dabe` feat: move the rule library and mSCP importer to schema v4). A v3-to-v4 conversion check found 0 differences across 352 files, and a second `--offline` import changed nothing.
- 2026-10-23: Task 2 done. The web UI reads v4 through `logic/applicability.ts` and `"<target> <version>"` version keys (`6d8a9e5` refactor: read schema v4 applicability in the web UI). The plan said `smoke.spec.ts` would stay unmodified, but three test-side spots parsed v3 JSON or expected the old raw fallback label; they were updated (`1fc6660` test: read schema v4 applicability in the e2e smoke spec). The bundle snapshot was identical before and after for every mSCP rule, and all 8 before/after screenshot pairs (375px and 1280px) were identical.
- 2026-10-23: Final-review cleanups: bundle names use `GENERATED_TARGET`, the e2e lookup checks the target, and stale v3 wording was removed (`9bfe529` refactor: tidy target naming left over from the schema v4 move). Fixed the Step 6 command, since `--tag` and `--offline` are mutually exclusive.
