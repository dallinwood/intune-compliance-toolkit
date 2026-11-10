# Release History and Framework Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every imported release of each framework, and show a rule's change history and a
framework-level comparison between any two releases.

**Architecture:** Importers write each release to `baselines/<source>/releases/<tag>/`, with the
pinned upstream copy in `sources/<source>/releases/<tag>/`. The manifest keeps its existing
top-level fields as the *current* (newest) release and adds a `releases` list. Everything that
reads the manifest today keeps working unchanged. At build time, `scripts/copy-baselines.mjs`
writes one history index per source: per rule and release, a fingerprint per kind of change. The
app compares fingerprints to list changes, and fetches a rule's release files only to draw a
field-level diff.

**Tech Stack:** Python 3 + pytest (importers, validator), Bun + Vite + React 19 + TypeScript +
Tailwind + Base UI (web UI), Vitest (logic), Playwright (e2e and screenshots).

**Spec:** `docs/plans/2026-11-10-release-history-design.md` (read it alongside this plan).

## Global Constraints

- Comparisons run on our normalised rule format only, never on raw upstream data.
- One global ignore list for diffs: `source`, `schema_version`, `id`, `file` (the last is loader
  bookkeeping, see `PROTECTED_FIELDS` in `webui/src/logic/overlays.ts`). Ignoring a field ignores
  everything under it.
- Change kinds: Behaviour = `check`, `remediation`, `odv`, `assessment`, `architecture`. Scope =
  `applicability`. Wording = `title`, `discussion`, `discussion_format`. References =
  `references`, `tags`, `section_path`. Every kind is shown by default, References included
  (maintainer decision, 2026-11-10); nothing selected also shows every kind.
- User-facing text never says "overlay". It says "custom changes".
- Browse, filters, counts, selection, mappings, overlays and Generate use the current release only.
- Adding or re-importing an older release never changes which release is current. Re-importing
  is idempotent.
- No em dash characters anywhere (code, copy, docs). Use a hyphen.
- No new npm or pip dependencies. Text and line diffing is implemented in-repo (Task 4).
- Commits: `type: summary` subject, no `Co-Authored-By` or other AI attribution. Push after each
  commit (branch `macos-compliance-framework-rebase`, not `main`).
- Every task that changes rendering: run `bun run test:e2e` against a running dev server and take
  Playwright screenshots at about 375px and 1440px width, then look at them with the Read tool
  before calling the task done (repo `CLAUDE.md`).
- After each task, add an entry to the `## Progress log` of **this plan** (date, what, commit
  hash + subject), per repo `CLAUDE.md`.

## Review Focus

1. **A change that is later reverted** (A in Dec, B in Mar, A again in Sep). Comparing Dec with
   Sep shows no change for that rule, while its history still shows two changes. Covered in
   Task 5 (`compareReleases` and `ruleTimeline` tests).
2. **A rule that is missing from some releases** (removed and later re-added, or only present in
   older releases). The timeline shows "Removed in" / "Added in" correctly. A rule opened from the
   Removed group of a comparison loads its history from the latest release that has it. Covered in
   Task 5 (timeline test) and Task 9 (e2e).
3. **A new top-level rule field added to the schema later and silently left out of every change
   kind.** A Vitest test fails when any property of `baselines/_rule.schema.json` is neither
   ignored nor assigned a kind. Covered in Task 4.
4. **Very large text or code** (a long discussion, a big payload) freezing the browser. The
   sequence diff falls back to whole-value replace above a size cap. Covered in Task 4.
5. **Re-importing an older release** or importing out of date order changes the current release
   or reorders releases wrongly. Covered in Task 1 (`merged_manifest` tests) and Task 2 (CLI test).

---

## Milestone 1: per-release storage (no visible change in the app)

### Task 1: Manifest v6 with a release list, release-aware publishing and validation

**Files:**
- Modify: `tools/library_output.py`, `tools/validate_library.py`, `tools/source_lock.py`
- Modify: `baselines/_manifest.schema.json`
- Test: `tests/test_library_output.py`, `tests/test_library_schema.py`

**Interfaces:**
- Produces (Python):
  - `SourceLock` gains `published_date: str` (YYYY-MM-DD) and `importer_format: str`.
  - `library_output.MANIFEST_SCHEMA_VERSION = 6`. `SCHEMA_VERSION` (rules and indexes) stays 5.
  - `library_output.release_dir(source_name: str, tag: str) -> str` returns
    `f"{source_name}/releases/{tag}"`.
  - `library_output.release_entry(source_name: str, lock: SourceLock, label: str, rule_count: int) -> dict`
    returns `{tag, label, published_date, commit_sha, retrieved_date, importer_format, index_path, rule_count}`,
    with `index_path = release_dir(...) + "/_index.json"`.
  - `library_output.merged_manifest(baselines_dir: Path, source_fields: dict, release: dict) -> dict`.
    `source_fields` is `{name, display_name, repository_url, license}`. It replaces any release
    with the same tag and sorts releases by `(published_date, tag)`, oldest first. The source's
    top-level `release_tag`, `commit_sha`, `retrieved_date`, `index_path`, `rule_count` copy the
    **last** (newest) release, and `releases` holds the list.
  - `library_output.publish_release(baselines_dir: Path, source_fields: dict, build_rule_tree: Callable[[Path], int], release_entry_for: Callable[[int], dict]) -> int`
    replaces `publish_source`. It builds into a temp dir, validates, then swaps in
    `baselines/<release_dir>` and the merged manifest. Other releases' folders are never touched.
- Manifest v6 source entry: the existing v5 fields (meaning "current release") plus
  `releases: [ {tag, label, published_date, commit_sha, retrieved_date, importer_format, index_path, rule_count} ]`.

- [ ] **Step 1: Write failing tests** in `tests/test_library_output.py`:
  - `test_merged_manifest_adds_release_and_current_is_newest`: existing release `B`
    (2026-09-03), merging release `A` (2025-12-09) gives releases `[A, B]`, and the top-level
    `release_tag == "B"`.
  - `test_merged_manifest_reimport_replaces_same_tag_without_changing_current`: re-merging `A`
    with a different `rule_count` replaces it in place and the top level is still `B`.
  - `test_merged_manifest_keeps_other_sources`.
  - `test_publish_release_leaves_other_release_folders_untouched`: publish `A`, then `B`, and
    `A`'s files are byte-identical before and after.
  - In `tests/test_library_schema.py`: a v6 manifest with a `releases` list validates, and a
    release missing `importer_format` does not.
- [ ] **Step 2: Run them and see them fail.** `python -m pytest tests/test_library_output.py tests/test_library_schema.py -q`
  Expected: failures on the missing names.
- [ ] **Step 3: Implement** the interfaces above. Update `_manifest.schema.json` to v6 (top-level
  `schema_version` const 6, required `releases`, release item schema with `index_path` using the
  existing path pattern).
- [ ] **Step 4: Validator.** In `validate_library.py`, `_validate_source` validates every release's
  index and rule files (the existing per-index checks, looped). It also adds errors for:
  - a rule whose `source.release_tag` is not its release's tag;
  - duplicate tags or labels within a source;
  - top-level fields that differ from the newest release;
  - a folder under `baselines/<source>/releases/` with no manifest entry.

  Add tests for each error to `tests/test_library_output.py` (or the existing validator test
  file, if there is one).
- [ ] **Step 5: Run tests.** `python -m pytest tests/test_library_output.py tests/test_library_schema.py -q`. Expected: PASS.
  (`test_committed_library.py` fails until Task 2 migrates the data. That's expected; don't
  commit yet.)
- [ ] **Step 6: Continue straight into Task 2.** Tasks 1 and 2 land as one commit, because the
  committed library is invalid between them.

### Task 2: Shared release importer, per-format registry, data migration

**Files:**
- Create: `tools/release_import.py`
- Modify: `tools/import_mscp.py`, `tools/import_asd_ism.py`, `tools/github_fetch.py`,
  `tools/mscp_fetch.py`, `tools/asd_ism_fetch.py`
- Move (git mv): `baselines/mscp/{_index.json,rules}` to `baselines/mscp/releases/release_27.0/`,
  `baselines/asd_ism/{_index.json,rules}` to `baselines/asd_ism/releases/v2026.09.4/`,
  `sources/mscp/{source.json,upstream}` to `sources/mscp/releases/release_27.0/`, and
  `sources/asd_ism/{source.json,upstream}` to `sources/asd_ism/releases/v2026.09.4/`
- Modify: `webui/src/types/library.ts` (`Manifest.schema_version: 6`, `ManifestRelease`,
  `ManifestSource.releases`), plus any test fixture or e2e path that hard-codes the old folders
  (`grep -rn "baselines/mscp\|baselines/asd_ism\|sources/mscp\|sources/asd_ism"`, excluding `docs/plans`)
- Modify: `README.md` (import commands)
- Test: `tests/test_import_mscp.py`, `tests/test_import_asd_ism.py`, `tests/test_committed_library.py`,
  new `tests/test_release_import.py`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `github_fetch.fetch_release_published_date(repository: str, tag: str, user_agent: str, opener=default_opener) -> str`.
    It reads `GET /repos/{repository}/releases/tags/{tag}` and returns `published_at[:10]`.
  - Both `fetch(...)` functions fill in `published_date` and `importer_format` on the lock.
  - `release_import.SourceImporter` (frozen dataclass): `name: str`, `display_name: str`,
    `repository_url: str`, `license: dict`,
    `fetch: Callable[[str, Path, str], SourceLock]` (tag, release sources dir, today),
    `build_rule_tree_by_format: Mapping[str, Callable[[Path, SourceLock, Path], int]]`
    (upstream dir, lock, tree dir), `release_label: Callable[[str], str]`.
  - `release_import.generate_release(importer: SourceImporter, upstream_dir: Path, lock: SourceLock, baselines_dir: Path) -> int`
    raises `ValueError(f"no importer for format {lock.importer_format!r}")` for an unknown format.
  - `release_import.import_stored_release(importer, sources_dir: Path, baselines_dir: Path, tag: str) -> tuple[SourceLock, int]`,
    `import_stored_releases(importer, sources_dir, baselines_dir) -> list[tuple[SourceLock, int]]`,
    `import_tag(importer, tag, sources_dir, baselines_dir, today) -> tuple[SourceLock, int]`.
    Here `sources_dir` is `sources/<source>`, and each release lives in `sources_dir / "releases" / tag`.
  - `release_import.release_change_summary(baselines_dir: Path, source_name: str, tag: str) -> tuple[list[str], list[str]] | None`:
    the added and removed rule ids of `tag` against the release just before it by date, or
    `None` for the first release.
  - `release_import.run_cli(importer: SourceImporter, argv: list[str] | None) -> int` handles
    `--tag TAG`, `--offline` (all stored releases), and `--offline --release TAG`. It prints the
    count and the change summary per release.
  - `import_mscp.IMPORTER` with format `"mscp-2"`, and labels `release_27.1` to `"27.1"`.
  - `import_asd_ism.IMPORTER` with format `"asd-ism-oscal-1"`, and labels `v2026.09.4` to
    `"Sep 2026"` (from the year and month in the tag).
  - Each module keeps its existing `build_rule_tree` as the format-specific function in the
    registry. Remove `publish_source`, the old `generate_library`, `import_offline`,
    `read_index_summary` and `print_change_summary` once nothing uses them.

- [ ] **Step 1: Write failing tests** in `tests/test_release_import.py`, using a stub
  `SourceImporter` whose `build_rule_tree` writes two tiny rules:
  - `test_unknown_importer_format_is_rejected`
  - `test_import_stored_releases_is_idempotent`: running it twice gives byte-identical `baselines/`
  - `test_importing_an_older_release_does_not_change_current` (Review Focus 5)
  - `test_release_change_summary_lists_added_and_removed_ids`
  - `test_release_labels`: `import_mscp.IMPORTER.release_label("release_27.1") == "27.1"` and
    `import_asd_ism.IMPORTER.release_label("v2025.12.9") == "Dec 2025"`
- [ ] **Step 2: Run them and see them fail.** `python -m pytest tests/test_release_import.py -q`
- [ ] **Step 3: Implement** `release_import.py`, the published-date fetch, and the two
  `IMPORTER` definitions, and make both importers' `main` call `run_cli`. Update the existing
  importer and fetch tests for the new lock fields and folder layout.
- [ ] **Step 4: Migrate the committed data.** Do the `git mv`s listed above. Add
  `"published_date"` and `"importer_format"` to both moved `source.json` files: mSCP
  `release_27.0` is `2026-09-11` / `mscp-2`, and ISM `v2026.09.4` is `2026-09-03` /
  `asd-ism-oscal-1`. Then run `python tools/import_mscp.py --offline` and
  `python tools/import_asd_ism.py --offline`.
  Expected: `git diff --stat -M` shows renames with no content change under `rules/`, and only
  the manifest changing otherwise.
- [ ] **Step 5: Committed-library test.** Make `tests/test_committed_library.py` parametrise
  over every `(source, release)` in the committed manifest and regenerate each one through
  `generate_release`. `test_every_manifest_source_is_regenerated_by_this_suite` checks every
  release, not only every source.
- [ ] **Step 6: Run the full Python suite.** `python -m pytest -q` (expected: PASS). Also run
  `python tools/validate_library.py` (expected: no errors) and the overlays and mappings checks
  the README documents (expected: same output as before the change).
- [ ] **Step 7: The web app still works.** In `webui/`: `bun run test`, `bunx tsc -b`,
  `bun run lint` (all clean). Start `bun run dev`, then run `bun run test:e2e` (all pass, and the
  smoke test still counts 1493 rules). Take one desktop screenshot of the Rules view and read it.
- [ ] **Step 8: Commit and push.** `feat: store each imported release in its own folder`. The
  body says the manifest's top-level fields stay the current release, which is why overlays,
  mappings and the app need no changes. Add the progress-log entry to this plan in the same commit.

---

## Milestone 2: import the new releases

### Task 3: Import mSCP 27.1 and three older ISM editions

**Files:** generated files only (`baselines/`, `sources/`), plus this plan's progress log.

- [ ] **Step 1: ISM editions, one at a time, oldest first.** Run
  `python tools/import_asd_ism.py --tag v2025.12.9`, then `v2026.03.24`, then `v2026.06.18`.
  After each one, check:
  - the command succeeds;
  - `python tools/validate_library.py` is clean;
  - the manifest's top-level ISM `release_tag` is still `v2026.09.4`;
  - the printed added/removed summary is believable (tens of rules, not hundreds).

  **If any edition fails or looks wrong, stop and ask the maintainer** (spec section 3). Don't
  write a second importer and don't drop the edition.
- [ ] **Step 2: mSCP 27.1.** Run `python tools/import_mscp.py --tag release_27.1`. Expected:
  validation is clean, and the top-level mSCP `release_tag` is now `release_27.1`.
- [ ] **Step 3: Downstream checks.** Run the full Python suite. Run the mappings and overlays
  checks. Mapping endpoints written against `release_27.0` may now warn that "the library is at
  release_27.1". **Record those warnings in the progress log and do not edit mapping files.**
  They are the maintainer's to review.
- [ ] **Step 4: The web app loads the new data.** Run `bun run test` and `bun run test:e2e`.
  Update the smoke test's total rule count to the new current total, and say so in the commit
  body.
- [ ] **Step 5: Commit and push.** `feat: import mSCP 27.1 and ISM editions from Dec 2025 to Jun 2026`.
  The progress-log entry lists, per release pair, the added/removed counts from the importer
  output (spec section 3: this is the rename-noise evidence).

---

## Milestone 3: change engine and history index

### Task 4: Sequence diff and rule change classification

**Files:**
- Create: `webui/src/logic/sequenceDiff.ts`, `webui/src/logic/ruleChanges.ts`
- Test: `webui/src/logic/sequenceDiff.test.ts`, `webui/src/logic/ruleChanges.test.ts`

**Interfaces:**
- Produces:
  - `sequenceDiff.ts`:
    - `type DiffOperation<T> = { type: 'same' | 'removed' | 'added'; items: T[] }`
    - `diffSequences<T>(before: T[], after: T[], equals?: (a: T, b: T) => boolean): DiffOperation<T>[]`.
      This is an LCS diff. When `before.length * after.length > 4_000_000`, it returns one
      `removed` operation and one `added` operation instead (Review Focus 4).
    - `diffWords(before: string, after: string): DiffOperation<string>[]` tokenises on
      whitespace and keeps the whitespace tokens, so joining every item gives back the original
      text.
    - `diffLines(before: string, after: string): DiffOperation<string>[]`.
  - `ruleChanges.ts`:
    - `type ChangeKind = 'behaviour' | 'scope' | 'wording' | 'references'`
    - `CHANGE_KINDS: readonly ChangeKind[]` (in that order), and `effectiveKinds(selected)` (an empty
      selection means every kind; this replaced `DEFAULT_SHOWN_KINDS` on 2026-11-10)
    - `IGNORED_FIELDS: ReadonlySet<string>` and `FIELD_CHANGE_KIND: Readonly<Record<string, ChangeKind>>`
      (exact values in Global Constraints)
    - `type KindFingerprints = Record<ChangeKind, string>`
    - `kindFingerprints(rule: Rule): KindFingerprints`. For each kind, hash the canonical JSON
      (object keys sorted recursively) of that kind's fields, using cyrb53 (53-bit) written out
      in this module, as a base-36 string.
    - `interface FieldChange { kind: ChangeKind; path: string[]; display: 'text' | 'code' | 'list' | 'value'; before: unknown; after: unknown }`.
      `before` is `undefined` when the value was added, and `after` is `undefined` when it was
      removed.
    - `fieldChanges(before: Rule, after: Rule): FieldChange[]`, ordered by `CHANGE_KINDS` and
      then by path.

- [ ] **Step 1: Write failing tests.**
  - `sequenceDiff.test.ts`:
    - `diffWords('a b c', 'a x c')` gives same `a `, removed `b`, added `x`, same ` c`;
    - `diffLines` on a two-line change;
    - identical input gives a single `same` operation;
    - inputs of 3,000 x 3,000 items return the removed+added fallback in under 50 ms.
  - `ruleChanges.test.ts`:
    - **every property in `baselines/_rule.schema.json`** (import the JSON) is in exactly one of
      `IGNORED_FIELDS` or `FIELD_CHANGE_KIND` (Review Focus 3);
    - two rules differing only in `source.commit_sha` and `source.release_tag` give `fieldChanges` = `[]` and equal fingerprints;
    - changing `check.macOS.default.shell` gives one change with kind `behaviour`, display `code`, path `['check','macOS','default','shell']`;
    - changing `discussion` gives display `text`, kind `wording`;
    - adding a benchmark to one applicability entry gives display `list`, kind `scope`, with a path that names that entry's target and version;
    - changing only `references` changes only the `references` fingerprint.

    Build the rules with `webui/src/logic/testRuleFixtures.ts`.
- [ ] **Step 2: Run them and see them fail.** `bun run test -- sequenceDiff ruleChanges`
- [ ] **Step 3: Implement.** How `fieldChanges` walks a rule:
  - Plain objects recurse by key.
  - Arrays of primitives are `list`.
  - Arrays of objects are matched by an identity key, then recursed. The keys: `applicability`
    items by `target` + `version`, and `benchmarks` items by `name`. `steps` items and `payloads`
    items match by position, and their recursion produces `code`/`value` leaves.
  - A string leaf is `code` when its key is `shell`, `script`, or anything under a `payloads`
    `data` value (render `data` as pretty JSON and line-diff it), and `text` otherwise.
  - Anything else is `value`.
- [ ] **Step 4: Run the tests** (PASS), then `bunx tsc -b` and `bun run lint` (clean).
- [ ] **Step 5: Commit and push.** `feat: classify and diff rule changes between releases`, with
  the progress-log entry.

### Task 5: History index, comparison and timeline logic, build step, fetchers

**Files:**
- Create: `webui/src/logic/historyIndex.ts`, `webui/src/data/history.ts`
- Modify: `scripts/copy-baselines.mjs`
- Test: `webui/src/logic/historyIndex.test.ts`, `webui/src/data/history.test.ts`

**Interfaces:**
- Consumes: `kindFingerprints`, `ChangeKind`, `CHANGE_KINDS` (Task 4), and `ManifestSource.releases` (Task 2).
- Produces (`historyIndex.ts`):
  - `HISTORY_INDEX_SCHEMA_VERSION = 1`
  - `interface HistoryRelease { tag: string; label: string; published_date: string; index_path: string }`
  - `interface HistoryRuleEntry { title: string; file: string; section: string; benchmarks: string[]; versions: (KindFingerprints | null)[] }`.
    `versions` is aligned with `releases` (oldest first), and `null` means the rule is absent from
    that release. `title`, `file`, `section` and `benchmarks` come from the latest release that
    has the rule.
  - `interface HistoryIndex { schema_version: 1; source: string; releases: HistoryRelease[]; rules: Record<string, HistoryRuleEntry> }`
  - `buildHistoryIndex(source: ManifestSource, rulesByTag: ReadonlyMap<string, Rule[]>): HistoryIndex`
  - `parseHistoryIndex(value: unknown): HistoryIndex | { error: string }`, a structural check in
    the same style as `parseOverlayIndex` in `overlayIndex.ts`
  - `interface RuleComparison { id: string; title: string; section: string; benchmarks: string[]; kinds: ChangeKind[] }`
  - `interface ReleaseComparison { added: RuleComparison[]; removed: RuleComparison[]; changed: RuleComparison[]; unchangedCount: number }`
  - `compareReleases(index: HistoryIndex, fromTag: string, toTag: string): ReleaseComparison`,
    with each group sorted by id
  - `type TimelineState = 'earliest' | 'added' | 'changed' | 'unchanged' | 'removed' | 'absent'`
  - `interface TimelineEntry { tag: string; label: string; state: TimelineState; kinds: ChangeKind[] }`
  - `ruleTimeline(index: HistoryIndex, ruleId: string): TimelineEntry[]`, newest first
  - `type TimelineItem = { type: 'entry'; entry: TimelineEntry } | { type: 'quiet'; entries: TimelineEntry[] }`
  - `foldQuietRuns(entries: TimelineEntry[]): TimelineItem[]` folds consecutive `unchanged` (and
    consecutive `absent`) entries into one `quiet` item
  - `changeCount(entries: TimelineEntry[]): number` counts entries in `added`, `changed` or
    `removed` state
- Produces (`data/history.ts`):
  - `fetchHistoryIndex(sourceName: string): Promise<HistoryIndex>`, cached per source, from
    `${BASE_URL}baselines/_history/${sourceName}.json`
  - `fetchRuleAtRelease(index: HistoryIndex, ruleId: string, tag: string): Promise<Rule>`,
    resolving `file` against the directory of that release's `index_path`
- **Design refinement (log it in the progress log):** spec 5.3 suggested a generated history
  file per rule. Every release's rule files are already published (`copy-baselines.mjs` copies
  all of `baselines/`), so the app fetches a rule's version straight from
  `releases/<tag>/rules/<file>` instead. That's one less generated artifact, with the same
  properties: nothing is fetched until a diff is drawn.
- Build: `copy-baselines.mjs` writes `webui/public/baselines/_history/<source>.json` for every
  manifest source. It only writes to the published copy, like the other generated indexes, and
  extends the header comment to say so.

- [ ] **Step 1: Write failing tests** in `historyIndex.test.ts`, on a hand-built three-release
  fixture:
  - `compareReleases`: added, removed and changed groups with the right kinds, and
    `unchangedCount` correct;
  - **reverted change** (Review Focus 1): fingerprints A, B, A across three releases. Comparing
    the first and last releases leaves the rule out of `changed`; the timeline shows two
    `changed` entries;
  - **gap** (Review Focus 2): present, absent, present gives states `changed`/`added` (newest),
    `removed`, `earliest` (oldest), with no `unchanged` entry for the gap;
  - a rule only in the oldest release appears in `removed` with the title from that release;
  - `foldQuietRuns` folds two consecutive unchanged releases into one quiet item;
  - `parseHistoryIndex` rejects a wrong `schema_version`, and accepts `buildHistoryIndex`
    output.

  In `history.test.ts`: `fetchRuleAtRelease` builds
  `.../baselines/asd_ism/releases/v2025.12.9/rules/ism-0359.json` (stub `fetch`).
- [ ] **Step 2: Run them and see them fail.** `bun run test -- historyIndex history`
- [ ] **Step 3: Implement** the logic, the fetchers and the build step.
- [ ] **Step 4: Verify.** Run `bun run test`, `bunx tsc -b` and `bun run lint` (clean). Run
  `bun run copy-baselines`, then confirm `webui/public/baselines/_history/asd_ism.json` lists 4
  releases and `mscp.json` lists 2. Note each file's size in the progress log.
- [ ] **Step 5: Commit and push.** `feat: build release history indexes for each framework`.

### Task 5b: Warn about a mapping only when a mapped rule really changed

Added 2026-11-10 at the maintainer's request. The mSCP 27.1 import produced 222 "mapped against
release_27.0" warnings, for links whose rules mostly did not change. The decision was made at
build time (not at runtime), so the app does no extra fetching and the cost doesn't grow with
the number of releases.

**Files:**
- Create: `baselines/_change_ignore.json`, holding `{ "schema_version": 1, "ignored_fields": ["source", "schema_version", "id", "file"] }`.
  This is the single source of truth for the ignore list.
- Modify: `webui/src/logic/ruleChanges.ts` (read `IGNORED_FIELDS` from that file), `tools/mappings.py`,
  `webui/src/logic/mappingIndex.ts`, `scripts/copy-baselines.mjs`, `webui/src/components/rules/MappedRulesTab.tsx`
- Test: `tests/test_mappings.py`, `webui/src/logic/mappingIndex.test.ts`, `webui/src/logic/ruleChanges.test.ts`

**Interfaces:**
- Consumes: `kindFingerprints`, `CHANGE_KINDS` (Task 4), and `HistoryIndex` (Task 5).
- Produces:
  - Python: `mappings.changed_since(baselines_dir: Path, rule_id: str, mapped_release: str) -> list[str] | None`.
    It returns `None` when `mapped_release` is not a stored release of the rule's source (keep
    warning, as before). It returns `[]` when the rule's content, minus the ignored fields, is
    equal in the mapped release and the current release. Otherwise it returns the changed
    top-level field names. It compares the two releases' rule JSON directly, so no fingerprints
    are needed in Python. A rule absent from the mapped release counts as changed (`["added"]`).
  - In `_check_pairs`, a release mismatch warns only when `changed_since` is `None` or non-empty.
    The warning names what changed: `... was mapped against <source> <mapped release>, and has
    changed since (<fields>); review the link for accuracy`. An unchanged rule produces no
    warning.
  - TS: `StaleEndpoint` gains `changedKinds: ChangeKind[] | null` (`null` means the mapped release
    is not in history). `staleEndpoints(...)` takes an extra
    `changedKindsFor: (ruleId: string, mappedRelease: string) => ChangeKind[] | null`, and drops
    endpoints whose result is `[]`. `copy-baselines.mjs` precomputes this from the history
    fingerprints into the mapping index. Each link endpoint whose release is not current gets
    `changed_kinds`, so the app needs no history fetch to draw the note.
  - The note in `MappedRulesTab` reads "Mapped against <release>; this rule has changed since
    (<kind labels>). Review the link." When `changedKinds` is `null`, it keeps the existing wording.
- [ ] **Step 1: Write failing tests.**
  - Python: an unchanged rule across two releases gives no warning; a changed `check` gives one
    warning naming `check`; an unknown mapped release still warns; a rule differing only in
    `source.*` gives no warning.
  - Vitest: `staleEndpoints` drops `[]` endpoints and keeps `null` ones; the ignore list loaded
    from `_change_ignore.json` equals the Global Constraints list.

  Run them and see them fail.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.**
  - `python tools/mappings.py`: record the new warning count against the previous 222 in the
    progress log.
  - Run the Python tests touched (not the whole 18-minute suite unless the shared library code
    changed), plus Vitest, tsc, lint and e2e.
  - Take a screenshot of a mapped rule with a changed-since note and read it.
- [ ] **Step 4: Commit and push.** `feat: warn about mappings only when a mapped rule changed`

---

## Milestone 4: rule History tab

### Task 6: Kind tags and the field change list

**Files:**
- Modify: `webui/src/index.css` (tokens)
- Create: `webui/src/components/history/KindTag.tsx`, `webui/src/components/history/FieldChangeList.tsx`,
  `webui/src/logic/changeLabels.ts`
- Test: `webui/src/logic/changeLabels.test.ts`

**Interfaces:**
- Consumes: `FieldChange`, `ChangeKind`, `diffWords`, `diffLines` (Task 4), and the vocabulary
  helpers (`termLabel`, `useVocabularyIndex`).
- Produces:
  - Tokens `--kind-behaviour(-foreground)`, `--kind-scope(-foreground)`,
    `--kind-wording(-foreground)`, `--kind-references(-foreground)`, `--diff-added(-foreground)`,
    `--diff-removed(-foreground)`, each with light and dark values that meet WCAG AA (4.5:1)
    against their own background and `--panel`. Register them in the `@theme` block like the
    existing app tokens.
  - `KIND_LABELS: Record<ChangeKind, string>` = Behaviour, Scope, Wording, References.
  - `<KindTag kind={ChangeKind} />`.
  - `changeLabel(path: string[], vocabularyIndex: VocabularyIndex): string` turns a path into
    plain words joined with ` · `. Examples: `['check','macOS','default','shell']` gives
    `Check · macOS`, and an applicability entry's benchmarks give `Benchmarks · macOS 27`.
    Top-level names: Title, Discussion, Discussion format, Check, Fix (remediation), Organization-defined value,
    Assessment, Architecture, Benchmarks (applicability), References, Tags, Section.
  - `<FieldChangeList changes={FieldChange[]} kinds?={ReadonlySet<ChangeKind>} focusPaths?={string[][]} />`.
    It renders one row per change: label on the left, change on the right, stacked below about
    640px. Display `text` gets an inline word diff (removed: struck through, `--diff-removed`;
    added: `--diff-added`). `code` gets a line diff inside the existing `CodeBlock` look, with
    `-`/`+` gutters and tinted lines. `list` gets added `+` pills and removed struck-through pills.
    `value` gets before and after. Changes under any `focusPaths` come first.
- [ ] **Step 1: Write failing `changeLabels` tests** for the examples above, then run them.
- [ ] **Step 2: Implement** the tokens, `KindTag`, `changeLabels` and `FieldChangeList`. Run them.
- [ ] **Step 3: Commit and push** together with Task 7 (nothing renders `FieldChangeList` until
  then). Run the screenshots in Task 7.

### Task 7: History tab in the rule detail panel

**Files:**
- Create: `webui/src/components/history/RuleHistoryTab.tsx`, `webui/src/hooks/useRuleHistory.ts`
- Modify: `webui/src/components/rules/RuleDetailPanel.tsx`
- Test: `webui/e2e/history.spec.ts`

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces:
  - `useRuleHistory(rule: Rule): { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; index: HistoryIndex; timeline: TimelineEntry[] }`
  - `<RuleHistoryTab ruleId={string} index={HistoryIndex} timeline={TimelineEntry[]} initialCompare?={{ from: string; to: string; focusPaths?: string[][] }} />`
  - `RuleDetailPanel`'s tab value becomes controlled (`'details' | 'mapped-rules' | 'history'`).
    Task 10 opens History in compare mode through it.
- Behaviour, from spec section 6.2:
  - The History tab shows when `index.releases.length > 1` and `mappedView` is present (the main
    panel, not nested mapped-rule details). Its label is `History (N changes)`, with
    `N = changeCount(timeline)` (`1 change` singular).
  - Tabs appear when Mapped rules or History applies, and the existing no-tabs layout stays when
    neither does.
  - Cards come newest first. A card's header shows label, tag and `KindTag`s. The newest card
    with changes starts open. Opening a card fetches the rule at that release and at the
    previous release that has it, then renders `FieldChangeList`.
  - A `quiet` item renders the dashed bar `── N release(s) with no changes (labels) ── show`.
    Clicking "show" expands it into muted "No changes" rows.
  - State texts: `earliest` is "earliest release in history", `added` is "Added in <label>",
    `removed` is "Removed in <label>".
  - At the top: the "Compare any two" From/To selects (To options are only releases after From),
    and the "Show: All changes / Behaviour only" toggle.
- [ ] **Step 1: Write the failing e2e test** `history.spec.ts`. Open ISM rule `ism-0359` (or
  another rule with a real change; pick one from the Task 5 index and name it in the test) and
  check:
  - the `History (` tab is present;
  - clicking it shows a card with at least one `KindTag`;
  - an mSCP rule with no change between 27.0 and 27.1 shows `History (0 changes)` and an
    "earliest release in history" entry.

  Run it and see it fail.
- [ ] **Step 2: Implement** `useRuleHistory`, `RuleHistoryTab`, and the panel changes.
- [ ] **Step 3: Verify.** `bun run test`, `bunx tsc -b`, `bun run lint`, `bun run test:e2e` (all
  pass).
- [ ] **Step 4: Screenshots.** Take them at 375px and 1440px of: History open on a rule with
  changes, a quiet bar expanded, and a code diff. Repeat in dark mode at 1440px. Read every image.
  Check that labels don't squeeze into single-word wrapping and that tags and diff colours are
  readable in both themes.
- [ ] **Step 5: Commit and push** (Tasks 6 and 7). `feat: show a rule's history across releases`.

---

## Milestone 5: Frameworks tab

### Task 8: Frameworks view, URL state and landing cards

**Files:**
- Create: `webui/src/views/FrameworksView.tsx`, `webui/src/components/frameworks/FrameworkCards.tsx`
- Modify: `webui/src/views/viewRegistry.tsx` (insert `{ id: 'frameworks', label: 'Frameworks' }`
  after Rules), `scripts/route-pages.mjs` (`VIEW_IDS`), `webui/src/state/urlState.ts`,
  `webui/src/state/filterStore.ts`
- Test: `webui/src/state/urlState.test.ts`, `webui/src/views/viewRegistry.test.tsx`, `webui/e2e/frameworks.spec.ts`

**Interfaces:**
- Produces: `UrlState` gains the fields below. Each is serialised only when set or non-default.
  `changeKinds` is a list; empty (no `kind` parameter) shows every kind.

  | Field | Type | URL parameter |
  |---|---|---|
  | `framework` | `string \| null` | `framework` |
  | `compareFrom` | `string \| null` | `from` |
  | `compareTo` | `string \| null` | `to` |
  | `changeKinds` | `ChangeKind[] \| null` | repeated `kind` |
  | `compareSearch` | `string` | `cq` |
  | `compareSections` | `string[]` | repeated `csection` |
  | `compareBenchmarks` | `string[]` | repeated `cbenchmark` |
  | `compareOnly` | `('custom' \| 'selected')[]` | repeated `only` |

  `startsHistoryEntry` treats a change of `framework` (null vs set) as navigation. Matching
  setters go on `filterStore`.
- Landing view (`framework === null`): one card per manifest source showing:
  - `display_name`;
  - "Current: <label> (<tag>) · <rule_count> rules";
  - a pill per release, with the current one highlighted and suffixed "· current";
  - a **Compare releases** button. It sets `framework`, with `from` = previous release and `to` =
    current release. When a framework has only one release, the button is disabled with the
    title "Only one release imported".
- [ ] **Step 1: Write failing tests.**
  - `urlState.test.ts`: the new parameters round-trip, and defaults serialise to `''`.
  - `viewRegistry.test.tsx`: the existing test keeping `VIEW_IDS` in step with `VIEWS` passes
    with the new id.
  - `frameworks.spec.ts`: `/frameworks` shows two cards, ISM lists four release pills, and
    clicking Compare releases on ISM puts `framework=asd_ism&from=v2026.06.18&to=v2026.09.4` in
    the URL.

  Run them and see them fail.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify, then take screenshots at 375px and 1440px and read them.**
- [ ] **Step 4: Commit and push.** `feat: add a Frameworks tab listing each framework's releases`

### Task 9: Release comparison view

**Files:**
- Create: `webui/src/components/frameworks/ReleaseComparisonView.tsx`,
  `webui/src/components/frameworks/ComparisonSidebar.tsx`, `webui/src/logic/comparisonFilters.ts`
- Test: `webui/src/logic/comparisonFilters.test.ts`, `webui/e2e/frameworks.spec.ts`

**Interfaces:**
- Consumes: `compareReleases` and `fetchHistoryIndex` (Task 5), `FieldChangeList` and `KindTag`
  (Task 6), the overlay index `by_rule` (existing), and the selection store (existing).
- Produces: `filterComparison(comparison: ReleaseComparison, filters: { kinds: ReadonlySet<ChangeKind>; search: string; sections: string[]; benchmarks: string[]; onlyRuleIds: ReadonlySet<string> | null }): ReleaseComparison`.
  - Changed rules are kept when they have any selected kind. Added and removed rules ignore the
    kind filter.
  - Search matches id and title, case-insensitively.
  - Section and benchmark filters use the entry's `section` and `benchmarks`.
- Layout, from spec section 6.3. It reuses the Rules view's sidebar-plus-main shell and its
  section-header styles.
  - Sidebar:
    - Framework select, plus From and To selects. To only offers releases after From.
    - "Kind of change" checkboxes with counts.
    - "Only rules that…": "have my custom changes" and "are in my selection".
    - Section and Benchmark checkbox lists with counts. Benchmark labels go through the
      vocabulary.
  - Main area:
    - Four summary tiles: added, removed, changed, and "unchanged (hidden)".
    - The search box, plus Expand all / Collapse all.
    - The Added, Removed and Changed groups, with rows showing title, id and `KindTag`s. Removed
      titles are struck through.
  - Expanding a changed row fetches both releases' rule files and shows `FieldChangeList`, then
    the links **Open rule** (to the Rules view with `rule=<id>`) and **Full history** (the same,
    with the History tab open). Expanding an added or removed row shows that rule's details as of
    the release it exists in, using the existing read-only detail rendering.
- [ ] **Step 1: Write failing tests.**
  - `comparisonFilters.test.ts`: one test per filter rule above.
  - e2e:
    - comparing ISM `v2025.12.9` to `v2026.09.4` shows summary tiles whose numbers match the
      group counts;
    - unticking Wording reduces the Changed count;
    - expanding a changed row shows a diff;
    - opening a Removed rule (if the data has one, otherwise an Added rule) loads without error
      (Review Focus 2).

  Run them and see them fail.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.** Run all suites. Take screenshots at 375px and 1440px, in light and dark
  mode, of the compare view with one row expanded, and read them. At 375px, the sidebar must
  collapse the way the Rules view's sidebar does.
- [ ] **Step 4: Commit and push.** `feat: compare two releases of a framework`

---

## Milestone 6: custom-changes notice

### Task 10: Notice that a customised rule changed upstream

**Files:**
- Create: `webui/src/logic/customChangeNotice.ts`
- Modify: `webui/src/components/rules/RuleDetailPanel.tsx` (replace the stale branch of `OverlayNotes`)
- Test: `webui/src/logic/customChangeNotice.test.ts`, `webui/e2e/history.spec.ts`

**Interfaces:**
- Consumes: `fieldChanges` (Task 4), `fetchHistoryIndex` and `fetchRuleAtRelease` (Task 5),
  `RuleDetailPanel`'s controlled tab and `RuleHistoryTab`'s `initialCompare` (Task 7),
  `OverlaidRule.applied`, and the overlay's `fields`.
- Produces:
  - `overlayFieldPaths(fields: Record<string, unknown>): string[][]` recurses into plain objects
    and stops at arrays or primitives.
  - `isTouched(changePath: string[], overlayPaths: string[][]): boolean` is true when either path
    is a prefix of the other.
  - `customChangeBaseline(index: HistoryIndex, overlayRelease: string): { fromTag: string; inHistory: boolean }`.
    It returns the release itself when it's in the index, and otherwise the earliest stored
    release with `inHistory: false`.
  - `type CustomChangeStatus = { kind: 'touched'; labels: string[] } | { kind: 'untouched' } | { kind: 'unchanged' }`
- Copy (exact, from spec section 6.4):
  - touched (warning style): "**Your custom changes to this rule were written for <label>.** The rule has since been updated in a field your custom changes touch (<labels joined with ', '>). See what changed →"
  - untouched (muted): "Your custom changes to this rule were written for <label>. The rule has since been updated, but not in any field your custom changes touch. See what changed →"
  - unchanged (muted): "Your custom changes to this rule were written for <label>. The rule hasn't changed since, so they can be marked as up to date."
  - not in history: the opening becomes "Your custom changes to this rule were written for <release>, which isn't one of the releases kept here." The rest is computed from the earliest stored release, and the diff states "Compared from <earliest label>, the earliest release kept."
- **Design refinement (log it in the progress log):** spec 6.4 treats "older than history" and
  "missing for another reason" separately. Tags from different eras can't be ordered reliably
  (`tahoe_rev3` vs `release_27.0`), so both cases share the "isn't one of the releases kept here"
  wording above. It stays honest without guessing which case applies.
- "See what changed →" switches the panel to History with
  `initialCompare = { from: fromTag, to: current tag, focusPaths: overlay paths }`.
- [ ] **Step 1: Write failing unit tests:**
  - `overlayFieldPaths` on the `asd-blueprint-remove-powershell-v2.json` fields gives
    `[['applicability'], ['references','asd_blueprint'], ['remediation','Windows','steps'], ['remediation','Windows','payloads']]`;
  - `isTouched(['remediation','Windows','steps'], [['remediation']])` is true;
  - `customChangeBaseline` with `tahoe_rev3` returns the earliest release and `inHistory: false`;
  - the three statuses from fixture changes.

  Add e2e: an overlaid ISM rule written for `v2026.09.4` (current) shows no notice. For a
  notice e2e, add a test-only overlay fixture if the e2e setup supports one. Otherwise cover it
  with unit tests and a manual screenshot (say which in the progress log).

  Run them and see them fail.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.** Run all suites and take screenshots (temporarily point an overlay's
  `release` at `v2026.03.24` in a scratch copy, never committed). Read them.
- [ ] **Step 4: Commit and push.** `feat: flag custom changes whose rule changed upstream`

### Task 11: Wrap-up

- [ ] **Step 1:** Update `README.md`: the release folder layout, how to import a new release
  (`--tag`), how to re-import all releases after a schema change (`--offline`), and the Frameworks
  tab.
- [ ] **Step 2:** Add a final entry to the design doc's progress log pointing to this plan's log.
  Set the design's `Status` to `Implemented <date>`.
- [ ] **Step 3:** Full verification from a clean state:
  - `python -m pytest -q`;
  - `python tools/validate_library.py`;
  - in `webui/`: `bun run build`, `bun run test`, `bun run lint`, `bun run test:e2e`.
- [ ] **Step 4: Commit and push.** `docs: document release history and framework comparison`

## Progress log

Kept up to date per `CLAUDE.md` - every session touching this plan adds an
entry here, not just the session that wrote it.

- **2026-11-10** - Tasks 1 and 2 (Milestone 1). Manifest v6 with a `releases`
  list, `publish_release`, release-aware validation, the shared
  `tools/release_import.py` with a per-format registry, the published-date
  fetch, and the data migration (`git mv` of mSCP `release_27.0` and ISM
  `v2026.09.4` into `releases/<tag>/`, rules unchanged). Python suite 851
  passed, `validate_library.py`, `overlays.py` and `mappings.py` clean,
  Vitest 914 passed, `tsc -b` and lint clean, e2e 152 passed (smoke test still
  counts 1493 rules), desktop Rules screenshot read. (`66251f0` feat: store
  each imported release in its own folder)
  - Deviation: `.gitattributes` patterns, `NOTICE` and `README.md` paths were
    updated for the new folders, and `webui/e2e/smoke.spec.ts` (index lookup
    and one route glob) and `overlayShape.test.ts` (now covers every release)
    were adapted; the plan did not list these explicitly.
  - Deviation: the importer's printed change summary now lists only added and
    removed rule ids (with counts), as the plan's `release_change_summary`
    returns; the old mSCP tag added/removed lines were dropped.
  - Deviation: the migration deleted the v5 `_manifest.json` before the two
    `--offline` runs, because the importers (correctly) refuse a manifest
    source that has no `releases` list. The regenerated manifest is the v6
    form of the same data.
- **2026-11-10** - Task 3 (Milestone 2), part 1: the three older ISM editions
  imported one at a time, oldest first. Each import succeeded, the library
  validated, and the current ISM release stayed `v2026.09.4`. Task 3 is split
  into several commits, by agreement. (`fadf5ef` feat: import ISM editions from
  Dec 2025 to Jun 2026)
  - Added and removed rule counts per release pair: Dec 2025 (1073 rules) to
    Mar 2026 (1081): 9 added, 1 removed; Mar 2026 to Jun 2026 (1101): 20 added,
    0 removed; Jun 2026 to Sep 2026 (1143): 44 added, 2 removed. Removed ids:
    `ism-1837` (Mar), `ism-0521` and `ism-1448` (Sep). No rename noise.
- **2026-11-10** - mSCP `release_27.1` first failed to import: upstream
  `os_allow_prerelease_disable` nests its fix inside the platform-level
  default `check`. The normalizer already accepted the same slip inside a
  version's check, so the default entry now gets the same tolerance (nested
  plus sibling fix still raises). TDD: the new tests failed first, and
  `release_27.0` regenerates byte-identically (full Python suite, 856 passed).
  (`e6d457c` fix: accept a fix misindented inside the default mSCP check)
- **2026-11-10** - Task 3 (Milestone 2), part 2: mSCP `release_27.1` imported
  (352 rules, now the current mSCP release). Against `release_27.0`: 5 added
  (`os_mcx_disable_disable`, `os_messages_summary_disable`, `os_ssh_pqc_configure`,
  `os_sshd_pqc_configure`, `system_settings_admin_group_membership_defined`),
  3 removed (`os_show_filename_extensions_enable`,
  `system_settings_bluetooth_menu_enable`, `system_settings_wifi_menu_enable`).
  The new admin group rule has a regex ODV. Text mode would reject the `|` its
  own example needs, so after a hand review (`$ODV` is only the double-quoted
  pattern of `grep -vE`) it was added to `ODV_VARIABLE_ALLOWLIST`, with a
  rule-specific pattern rejecting a leading hyphen (grep would read it as an
  option). (`3246f95` fix: run the mSCP admin group ODV rule in variable mode;
  `a4bbf19` feat: import mSCP 27.1)
  - Mapping warnings (recorded, no mapping file edited): 222 warnings for 148
    distinct mSCP rules, all of the form "was mapped against mscp release_27.0,
    but the library is at release_27.1; review the link for accuracy". Per
    file: system-hardening 86, system-access 42, security-assurance 30,
    cryptography 23, enterprise-mobility 20, system-management 11, media 10.
    No ISM-side warnings. They are the maintainer's to review.
  - Smoke and e2e updates for the new data: totals 1495 (352 mSCP), Operating
    system 203 (the infinite-scroll test now scrolls a third time), release
    text `release_27.1`, and the unreachable-facet test uses the ISM
    Non-classified benchmark because 27.1 lists the NLMAPGOV benchmarks under
    macOS 27. The pinned ODV mode list gained the new rule as `variable`.
  - Verification: Vitest 921 passed, `tsc -b` and lint clean, full e2e 152
    passed. The full Python suite (856 passed, `-W error`) ran on this exact
    data before the ODV and e2e changes. It now takes about 18 minutes because
    the committed-library test regenerates every release.
- **2026-11-10** - Task 4: `sequenceDiff.ts` (LCS diff with word and line
  helpers) and `ruleChanges.ts` (kinds, fingerprints, field changes), with
  tests written first. Fingerprints and `fieldChanges` agree by construction:
  applicability entries and benchmarks are put in a fixed order before either
  is computed. (`d55163b` feat: classify and diff rule changes between releases)
  - Design refinements: the size cap applies to the middle of the two
    sequences after the shared start and end are trimmed, so one changed line
    in a very large value still gets a real diff; and a field nobody has
    classified yet is treated as behaviour at runtime (shown by default),
    while the schema test fails until it is classified.
  - Done early, from Task 5b: `baselines/_change_ignore.json` holds the ignore
    list and `ruleChanges.ts` reads it (`resolveJsonModule` turned on in
    `tsconfig.app.json`), so the list is not changed twice.
- **2026-11-10** - Task 5: `historyIndex.ts` (build, parse, compare, timeline,
  folding, change count), `data/history.ts` (cached fetchers) and the
  `copy-baselines.mjs` step that writes `_history/<source>.json`. Tests first
  (the modules were missing, so they failed), covering the reverted change,
  the gap and the removed-only rule. Published sizes: `asd_ism.json` 837,625
  bytes (4 releases, 1146 rules), `mscp.json` 145,727 bytes (2 releases, 355
  rules). Per pair, the fingerprints agree with the importer's added/removed
  counts (for example ISM Jun to Sep 2026: 44 added, 2 removed, 403 changed;
  mSCP 27.0 to 27.1: 5 added, 3 removed, 153 changed). Vitest 978 passed,
  `tsc -b` and lint clean. (`9ac8808` feat: build release history indexes for each framework)
  - Design refinement from the plan: spec 5.3's per-rule history file is not
    generated; the app fetches `releases/<tag>/rules/<file>` directly.
  - Deviation: `buildHistoryIndex` takes `RuleWithFile` (a rule plus the file
    it was read from) instead of `Rule`, because a rule has no file name of
    its own and the index must record it.
- **2026-11-10** - Task 5b: mapping warnings only for rules that really
  changed. `tools/mappings.py` gained `changed_since` (compares a rule's
  release files directly, skipping the ignore list in
  `baselines/_change_ignore.json`) and `_check_pairs` warns only when it is
  `None` (release not stored, old wording) or non-empty (new wording naming the
  changed fields). `copy-baselines.mjs` now builds the history indexes first
  and `addChangedKinds` notes `changed_kinds` and `self_changed_kinds` on each
  mapping index entry whose end is not on its current release; the Mapped
  rules note reads "Mapped against <release>; <rule> has changed since
  (<kind labels>). Review the link.", and an unchanged end shows no note.
  Tests first for the Python and Vitest sides (the e2e tests came after the
  implementation). Result: `python tools/mappings.py` now gives 148 warnings
  (97 distinct mSCP rules), down from 222; the rest were links to rules
  unchanged in 27.1. Mapping files were not edited. Vitest 990 passed, `tsc -b`
  and lint clean, full e2e 154 passed, screenshots at 1440px and 375px read.
  The Python tests touched (`test_mappings*.py`) pass; the full 18-minute suite
  was not re-run. (`04593f5` feat: warn about mappings only when a mapped rule changed)
  - Deviations: the Python tests live in a new `tests/test_mappings_change_aware.py`
    rather than `test_mappings.py`; the note names the rule id (either end can
    be stale, so "this rule" was ambiguous); `KIND_LABELS` was created early in
    `changeLabels.ts` (Task 6 adds the rest); and `ruleChanges.ts` imports the
    JSON with `with { type: 'json' }`, which Playwright's Node needs.

### Review fixes (milestones 1-2)

- **2026-11-10** - Fixes from the code review of milestones 1 and 2.
  - A. The admin group ODV could silently disable its check: the shell runs
    `grep -vE "$ODV"` inside `found=$(...)`, so a pattern grep rejects, or an
    empty alternative, makes it report compliant. The rule's value check is now
    a function that accepts only a plain POSIX extended expression of account
    names (name characters, `^ $ | ( ) [ ] * + ?` and an escaped dot; no
    `(?`, no other backslash, no empty alternative, no leading hyphen, no
    unbalanced or operand-less repetition). Rule-specific checks became
    functions (`ODV_RULE_VALUE_CHECKS`). Tests first: every rejected example
    from the review plus the accepted ones. (`055659f` fix: accept only plain account patterns for the admin group ODV)
  - B. The validator now errors when a source's releases are not sorted by
    (published_date, tag), or a published_date or retrieved_date is not a real
    date; a test pins the same-day tie-break as ordering by tag.
    (`a9121f0` fix: validate release order and calendar dates in the manifest)
  - C. The committed-library test regenerates each release into an empty
    library and compares only that release's folder (byte for byte) and its
    manifest entry; the maintainer folders are one separate test. Full Python
    suite with `-W error`: 18:00 before, 5:27 after (877 tests). What remains
    is mostly Windows opening freshly written files (about 16 ms each under
    the virus scanner), not our code. (`260e7fb` test: regenerate each committed release into an empty library)
  - D. Tests that mean "the current release" read it from the manifest (the
    checkPlan tests stay pinned to release_27.0 on purpose, because 27.1
    changed rules they describe); a 404 from the Releases API names the tag
    and repository and says the tag may have no GitHub Release; the change
    summary is printed after a successful import, so a summary failure is a
    warning, not exit 1. (`214356c` fix: clearer missing-release error, safer import summary, tests follow the manifest; `49bf48a` fix: close the HTTP error response before raising a clearer one)
- **2026-11-10** - Tasks 6 and 7 (Milestone 4), one commit as the plan says:
  the six colour tokens pairs in `index.css` (light and dark; every foreground
  is 8:1 or better on its own background and on `--panel`, checked with a
  small OKLCH contrast script), `KindTag`, `FieldChangeList` (word diff for
  text, line diff with -/+ gutters inside the dark code-block look, + pills for
  lists, before and after for values), `changeLabels.ts` (kind labels, path
  labels, which changes to show, tab and card wording), `useRuleHistory`, the
  `RuleHistoryTab` (cards newest first, quiet bars, Compare any two, All
  changes or Behaviour only) and the controlled tabs in `RuleDetailPanel`
  (History appears once the history index has loaded and the source has more
  than one release). Unit tests first for every pure function; the e2e spec
  `history.spec.ts` (7 tests) came after the component. Vitest 1055 passed,
  `tsc -b` and lint clean, full e2e 161 passed (the smoke test "with no
  mappings" now expects a History tab and no Mapped rules tab).
  (`afb6c8a` feat: show a rule's history across releases)
  - Design refinements found while looking at the screenshots: a whole object
    that appears or disappears (a new check, a new payload) is spelled out
    part by part, so its shell is drawn as a code diff instead of one block of
    JSON; and a path label ends in the part when it is not the script
    ("Check · macOS · Result value", "Assessment · Status"), so rows are not
    all called "Check · macOS". "All changes" shows every kind, References
    included; "Behaviour only" shows just behaviour.
  - Screenshots (1440px and 375px, light and dark, all read): a rule with
    wording changes and an expanded quiet bar (ISM), and a rule with check,
    fix and payload changes drawn as code diffs (mSCP). At 375px the label and
    kind tag sit above the change, the code lines wrap inside the block and
    nothing needs sideways scrolling; the tinted lines, kind tags and struck
    or underlined words are readable in both themes.
- **2026-11-10** - History tab polish after the maintainer looked at it. A
  missing value and a null are now the same "no value" (no change, same
  fingerprints); the section is shown as one breadcrumb value joined with the
  shared `BREADCRUMB_SEPARATOR` instead of set-style pills; field rows no
  longer repeat a kind tag under the label (the card header lists the kinds);
  and the History tab appears from the first render once the manifest says the
  source has more than one release, labelled "History" until the index loads,
  then "History (N changes)". Logic parts tested first; Vitest 1058 passed,
  `tsc -b` and lint clean, history e2e 7 passed (full e2e runs with
  Milestone 5). (`5879acd` fix: tidy the History tab after review)
- **2026-11-10** - Task 8: the Frameworks tab. Eight new URL state fields
  (`framework`, `from`, `to`, repeated `kind`, `cq`, repeated `csection`,
  `cbenchmark`, `only`), their store setters (`showComparison` is one update, so
  one history entry), the Frameworks view in the registry and
  `route-pages.mjs`, and the landing cards (current release, a pill per
  release oldest first with the current one highlighted, Compare releases
  from the previous to the current release, disabled with "Only one release
  imported" when there is one). Selecting a framework currently shows a
  placeholder line; Task 9 replaces it. URL tests first (they failed), the
  e2e spec `frameworks.spec.ts` after. Vitest 1063 passed, `tsc -b` and lint
  clean, full e2e 164 passed (one existing smoke test now expects a History tab
  instead of no tab strip). Screenshots of the landing at 1440px and 375px,
  light and dark, read: cards sit two across at 1440px and stack at 375px, the
  current pill is clearly highlighted in both themes. (`ec62610` feat: add a Frameworks tab listing each framework's releases)
- **2026-11-10** - Task 9: the release comparison view. `comparisonFilters.ts`
  (`filterComparison`, plus `comparisonFacetCounts` so each facet count says
  how many rules ticking it would leave), two helpers in `historyIndex.ts`
  (`latestReleaseWithRule`, `ruleFilePathAtRelease`), the sidebar (framework,
  From, To, kinds with counts, only-rules filters, sections, benchmarks via the
  vocabulary), the main area (four summary tiles, search, Expand all and
  Collapse all, Added, Removed and Changed groups of 50 rows with "Show more",
  removed titles struck through) and the header Filters button for an open
  comparison, so the sidebar collapses below md like the Rules view's.
  Expanding a changed row draws its field changes and offers Open rule and
  Full history; expanding an added or removed row shows the rule's details as
  the newest release that has it stored them (Review Focus 2). Logic tests
  first (they failed on the missing module); 11 e2e tests came after the UI.
  Vitest 1077 passed, `tsc -b` and lint clean, full e2e 172 passed.
  (`85c54ac` feat: compare two releases of a framework)
  - Deviations and decisions: the last ticked kind cannot be unticked (an empty
    selection has no URL form and would show nothing); "Full history" needs the
    History tab open, which the plan's URL has no parameter for, so it is a
    transient store field (`openRuleTab`) read by the details panel, not part
    of the address; Open rule and Full history are offered for changed and added
    rules only, since a removed rule is not in the Rules view; "Expand all"
    expands the rows shown (at most 50 per group), because expanding every row
    would fetch thousands of rule files; benchmark options are the benchmark
    names (a renamed benchmark appears as two options with the same label).
  - Screenshots (1440px and 375px, light and dark, ISM Dec 2025 to Sep 2026 and
    mSCP 27.0 to 27.1, all read): at 1440px the sidebar sits left of the tiles
    and groups, a code change shows `-`/`+` lines in the dark block, wording
    changes show struck and underlined words; at 375px the sidebar is behind the
    Filters button and opens above the list as on the Rules view, tiles go two by
    two, titles wrap and nothing needs sideways scrolling; both themes read well.

### Maintainer feedback and review fixes (2026-11-10, after Milestone 5)

- **2026-11-10** - Review fixes R1 to R5 (`5c185e8` fix: close review gaps in
  the admin ODV check, null handling, history index and details panel). R1: the
  admin group pattern also rejects anything matching the empty string or a
  sentinel non-account name (`zz-not-an-account-9`), the lazy forms `*?`, `+?`,
  `??`, and a `]` straight after `[` or `[^`; the requirement text says it must
  not match every account (the new test inputs were added together with the
  guard, not red first). R2: the Python mapping check drops nulls like the web
  UI (test on both sides; still 148 warnings). R3: the history index build fails
  if a rule's file name differs between releases. R4: `compareReleases` throws
  unless from is before to. R5: the rule details are keyed by rule id.
- **2026-11-10** - Maintainer feedback M1 to M5, plus two maintainer decisions
  on kinds of change (all from the maintainer on 2026-11-10):
  - M1: the oldest release is an end marker in the quiet bar's style ("Dec 2025
    (v2025.12.9) · starting point: the oldest release kept here"), not a card.
  - M2: History kind controls are toggle pills (a new `ToggleButtons` in
    `DisclosureButtons.tsx`, the same pill look as the check and fix target
    buttons, `aria-pressed`); releases whose changes are all in hidden kinds
    fold into the quiet bar with unchanged releases ("3 releases with no changes
    shown"), and expanded say "No changes" or "Changes hidden: ..."; the tab
    count stays the unfiltered total.
  - M3: the comparison's groups use the Rules tab's `SectionHeader` (now its own
    file), `SectionToolbar` and `useExpandedGroups` (which gained collapse
    methods); groups start open.
  - M4: the summary tiles are single-select filters (`aria-pressed`, `group=`
    in the address); "unchanged (hidden)" became "unchanged" and selecting it
    lists those rules, opening to the rule at the To release; `compareReleases`
    now returns the unchanged rules, not just a count.
  - M5: the framework select shows the short source label.
  - Decision: nothing selected shows every kind (note "Showing all kinds"), and
    a subset offers a "Show all" button; this replaced "the last kind cannot be
    turned off" in both the History pills and the comparison. No `kind`
    parameter means nothing selected; a subset is repeated `kind` parameters.
  - Decision: every kind is shown by default, References included.
    `DEFAULT_SHOWN_KINDS` is gone (`effectiveKinds` replaces it); the design doc
    (sections 5.2 and 6.3) and the Global Constraints above were updated.
  - Verification: Vitest 1104 passed, `tsc -b` and lint clean, full e2e 176
    passed (one paging test timed out once under load and passed alone).
    Screenshots at 1440px and 375px, light and dark, read: pills and the end
    marker in History, tiles with a pressed one, the group header and toolbar and
    the sidebar note and "Show all" in the comparison; nothing overflows at 375px.
