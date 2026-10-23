# ASD ISM Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import every ASD ISM control from the `v2026.09.4` OSCAL catalog as v4 rules under `baselines/asd_ism/`, listed in the manifest, so the ISM controls appear in the web UI next to the mSCP rules.

**Architecture:** This is phase 2 of the ASD ISM design.
- **Shared code:** the source-agnostic pieces of the mSCP importer move into shared modules (source lock, GitHub fetch helpers, library output). The mSCP output must stay byte-identical.
- **New ISM importer:** a normalizer turns the OSCAL catalog into v4 rules, and a fetcher pulls two files from the pinned GitHub tag. The CLI mirrors `import_mscp.py`.
- **Web UI:** gets only what it needs to load a second source cleanly: per-source test scoping, e2e expectations for 1,493 rules, and vocabulary labels. The phase 3 UI work (None facets, Markdown rendering, breadcrumb, revision display, attribution) is out of scope.

**Tech Stack:** Python 3 standard library plus `jsonschema` (already used). No new dependency, since the catalog is JSON. React + TypeScript + Vitest + Playwright under Bun for Task 4.

**Spec:** `docs/plans/2026-10-22-asd-ism-source-design.md`: sections 3, 6, 9, 10 and 11 (phase 2). Read section 11's phase 2 note too: the `asd_ism` manifest entry must not reach `main` before phase 3. GitHub Pages deploys from `main`, so pushing this feature branch is fine.

## Global Constraints

- **Source name:** `asd_ism`.
  - Rule ids are `asd_ism.<control id>`, where the control id is OSCAL's lowercase `id`, e.g. `asd_ism.ism-1667`.
  - Control ids must match `^[a-z0-9_-]+(?![\s\S])`. Anything else fails the import.
- **Upstream source:**
  - Repository `https://github.com/AustralianCyberSecurityCentre/ism-oscal`, API path `AustralianCyberSecurityCentre/ism-oscal`, tag `v2026.09.4`.
  - Vendor exactly two files, byte for byte, into `sources/asd_ism/upstream/`: `ISM_catalog.json` and `README.md`. Fetch them from `https://raw.githubusercontent.com/AustralianCyberSecurityCentre/ism-oscal/<commit sha>/<file>`.
  - The lock file is `sources/asd_ism/source.json`, with the same shape as `sources/mscp/source.json`.
  - User agent: `intune-compliance-toolkit-asd-ism-import`.
- **Line endings:** add `sources/asd_ism/upstream/** -text` and `sources/asd_ism/*.json text eol=lf` to `.gitattributes`, mirroring the mSCP lines.
- **Licence block** on every ISM rule and the manifest entry: `{ "name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/", "rights_holder": "Commonwealth of Australia (Australian Signals Directorate)", "modified": true }`.
- **Manifest entry:**
  - `display_name`: `ASD Information Security Manual`.
  - `repository_url`: the repository URL above.
  - `index_path`: `asd_ism/_index.json`.
  - All other fields as for mSCP.
- **Rule mapping** (design section 6.3, plus one ruling):
  - `title`: the **first paragraph** of the control's single `statement` prose, which is the text before the first `\n\n`, or the whole statement if it has no blank line. 40 statements in this release are a lead-in sentence followed by a Markdown list.
  - `discussion`: the full statement, `\n\n`, then the topic overview when the statement has more than one paragraph; otherwise just the topic overview. Either way, `(#<uuid>)` links are rewritten to `(<first rlinks href>)` of the matching `back-matter.resources` entry.
  - `discussion_format`: `"markdown"`.
  - `section_path`: the three ancestor group titles, outermost first.
  - `source.upstream_path`: `"ISM_catalog.json"`.
  - `source.upstream_url`: `https://github.com/AustralianCyberSecurityCentre/ism-oscal/blob/<sha>/ISM_catalog.json`.
  - `source.upstream_rule_id`: the OSCAL id.
  - `source.upstream_revision` / `source.upstream_updated`: the `revision` / `updated` prop values, verbatim.
  - `applicability`: exactly one entry, `{ "target": null, "version": null, "benchmarks": [...] }`.
    - The benchmarks come in this fixed order, each only if present: `ism_non_classified` (NC), `ism_official_sensitive` (OS), `ism_protected` (P), `ism_secret` (S), `ism_top_secret` (TS), `e8_ml1` (ML1), `e8_ml2` (ML2), `e8_ml3` (ML3).
    - Each has `severity: null`.
  - `assessment`: `{ "status": "manual", "manual_reason": "no_check" }`.
  - `architecture`, `check`, `odv` and `remediation` are `null`; `tags` is `[]`; `references` is `{}`; `schema_version` is `4`.
- **Skipped entries:** catalog entries with `class: ISM-principle` are skipped. Groups with no controls (the terminology group) produce nothing.
- **Fail loudly** (design 6.4): the import exits non-zero and writes no partial output on any of these:
  - an unknown `class`;
  - a control without exactly one `statement` part;
  - a prop name outside `sort-id`, `revision`, `updated`, `applicability` and `essential-eight-applicability`;
  - an applicability value outside `NC/OS/P/S/TS` or `ML1/ML2/ML3`;
  - a missing `revision` or `updated`;
  - a `(#uuid)` link with no matching resource, or a resource with no `rlinks`;
  - a control whose topic group has no `overview` part;
  - a control not exactly three groups deep;
  - a duplicate id;
  - a schema violation.
- **Byte stability:** output goes through `tools/json_output.write_json`. Index entries are sorted by upstream id. A second `--offline` run changes nothing.
- **Counts for this release:** 1,143 ISM rules; manifest total 1,493 (350 mSCP + 1,143 ISM).
- **mSCP output is unchanged:** after Task 1, `python tools/import_mscp.py --offline` produces no diff.
- **No new dependencies.**
- **Verification:**
  - Python: `python -m pytest -W error` from the repo root.
  - Web, from `webui/`: `bun run test`, `bun run lint`, `bun run build`, `bun run test:e2e` (dev server running; see `webui/playwright.config.ts`).
- **Commits:** subject is `type: summary`, with a why-body. No `Co-Authored-By` or AI attribution line. No em dash (U+2014) in code, comments, commits or reports. Implementers commit only; the controller pushes.

## Review Focus

- **A multi-paragraph statement** (e.g. the cyber security incident register control) must produce a one-paragraph title and a discussion that starts with the full statement, list included. Pinned by a normalizer test (Task 2) and a committed-data test (Task 3).
- **No unresolved `(#uuid)` link** may survive in any committed ISM discussion. Pinned by a committed-data test (Task 3).
- **The full table with 1,493 rows** must load: e2e waits for `1493 of 1493 rules` within the existing 10s timeout (Task 4).
- **An ISM rule in Review & generate** must land in `manual-attestation.md` with its id and title, and generation must not crash on `check: null` / `remediation: null`. Pinned by an e2e test (Task 4).
- **Searching `ism-1667`** must find exactly that control. Pinned by an e2e test (Task 4).

---

### Task 1: Shared importer modules (refactor, no output change)

**Files:**
- Rename: `tools/mscp_source_lock.py` to `tools/source_lock.py` (with `git mv`); update every import (`tools/import_mscp.py`, `tools/mscp_fetch.py`, `tools/mscp_normalize.py`, `tests/test_committed_library.py`, `tests/test_import_mscp.py`, `tests/test_mscp_fetch.py`, `tests/test_mscp_normalize.py`)
- Create: `tools/github_fetch.py`, `tools/library_output.py`, `tests/test_library_output.py`
- Modify: `tools/mscp_fetch.py`, `tools/import_mscp.py`, `tools/mscp_normalize.py`

**Interfaces:**
- Produces, in `tools/github_fetch.py`:
  - `NETWORK_TIMEOUT_SECONDS = 60`
  - `COMMIT_SHA_PATTERN`
  - `default_opener(request)`
  - `validate_tag(tag: str) -> None`
  - `validate_commit_sha(commit_sha: str) -> None`
  - `build_request(url: str, user_agent: str, accept: str | None = None) -> urllib.request.Request`
  - `get_json(url: str, user_agent: str, opener) -> dict`
  - `resolve_tag_commit(repository: str, tag: str, user_agent: str, opener=default_opener) -> str` dereferences annotated tags, as today.
- `tools/mscp_fetch.py` keeps its public names and signatures (`resolve_tag_commit(tag, opener=default_opener)`, `download_tarball`, `fetch`, `validate_tag`, `default_opener`) as thin delegations, so `tests/test_mscp_fetch.py` passes unchanged apart from the lock import.
- Produces, in `tools/library_output.py`:
  - `SCHEMA_VERSION = 4`
  - `MANIFEST_FILE_NAME = "_manifest.json"`
  - `class UnsupportedUpstreamData(Exception)`, moved here; `mscp_normalize` imports and re-exports it, so `from tools.mscp_normalize import UnsupportedUpstreamData` keeps working.
  - `index_entry(rule: dict, file: str) -> dict`, moved from `mscp_normalize`, unchanged.
  - `merged_manifest(baselines_dir: Path, entry: dict) -> dict`: today's logic, keyed by `entry["name"]`.
  - `publish_source(baselines_dir: Path, source_name: str, build_rule_tree: Callable[[Path], int], manifest_entry_for: Callable[[int], dict]) -> int`: the body of today's `import_mscp.generate_library`. That covers validating in a temp dir, schema-checking the merged manifest, the atomic directory swap and manifest replace, and cleanup on failure. It returns the rule count.
- `import_mscp.generate_library(upstream_dir, lock, baselines_dir) -> int` keeps its signature and calls `publish_source`.
- `mscp_normalize.normalize_rule` uses `SCHEMA_VERSION` from `library_output` instead of the literal `4`. This is the deferred phase 1 minor.

- [ ] **Step 1: Write the failing tests** in `tests/test_library_output.py`:
  - `test_merged_manifest_keeps_other_sources_sorted`: an existing manifest with `mscp`, merged with an `asd_ism` entry, gives sources `[asd_ism, mscp]`, with `mscp` unchanged.
  - `test_merged_manifest_replaces_same_source`
  - `test_publish_source_leaves_library_untouched_on_validation_failure`: a `build_rule_tree` that writes a schema-invalid rule raises `ValueError`, and `baselines_dir` is byte-identical afterwards.
  - `test_publish_source_writes_tree_and_manifest`: a valid one-rule tree for source `example` appears at `baselines_dir/example/`, and the manifest lists it.

- [ ] **Step 2: Run them to verify they fail**
  Run: `python -m pytest -W error tests/test_library_output.py`
  Expected: FAIL with `ModuleNotFoundError: tools.library_output`.

- [ ] **Step 3: Do the rename and extraction, and repoint `import_mscp`, `mscp_fetch` and `mscp_normalize`**

- [ ] **Step 4: Verify everything still passes and the output is unchanged**
  Run: `python -m pytest -W error`, then `python tools/import_mscp.py --offline`, then `git status --short baselines`
  Expected: all tests pass, and `git status` shows nothing under `baselines/`.

- [ ] **Step 5: Commit**
  `refactor: share source lock, GitHub fetch and library output between importers`

### Task 2: ISM catalog normalizer

**Files:**
- Create: `tools/asd_ism_normalize.py`, `tests/test_asd_ism_normalize.py`
- Create: `tests/fixtures/asd_ism/catalog.json`, a small hand-written OSCAL catalog. Add `tests/fixtures/asd_ism/** -text` to `.gitattributes`. Contents:
  - two guidelines, each with section > topic groups;
  - a topic overview containing a `[text](#<uuid>)` link to a back-matter resource;
  - one control with a two-paragraph statement (lead-in plus a `- item` list);
  - one control with NC/OS/P/S/TS plus ML2/ML3;
  - one control with NC only;
  - one `ISM-principle` (to be skipped);
  - an empty terminology group.

**Interfaces:**
- Consumes: `UnsupportedUpstreamData` and `SCHEMA_VERSION` from `tools/library_output.py`; `SourceLock` from `tools/source_lock.py` (Task 1).
- Produces, in `tools/asd_ism_normalize.py`:
  - `SOURCE_NAME = "asd_ism"`
  - `REPOSITORY_URL = "https://github.com/AustralianCyberSecurityCentre/ism-oscal"`
  - `CATALOG_FILE_NAME = "ISM_catalog.json"`
  - `LICENSE` (the dict from Global Constraints)
  - `normalize_catalog(document: dict, lock: SourceLock) -> list[dict]` returns v4 rules sorted by id and raises `UnsupportedUpstreamData` for every fail-loudly case.
  - `rewrite_resource_links(prose: str, resource_hrefs: dict[str, str], where: str) -> str`
  - `split_statement(statement: str) -> tuple[str, bool]` returns `(title, has_more_paragraphs)`.

- [ ] **Step 1: Write the failing tests** against the fixture:
  - `test_controls_become_v4_rules`: the count is the fixture's control count, with no principle; each rule validates with `tools.validate_library.schema_errors(rule) == []`.
  - `test_rule_fields_follow_the_mapping`: for the full-applicability control, check the exact `id`, `section_path`, `source.upstream_revision`, `source.upstream_updated`, `upstream_url`, `applicability` (benchmark list in the fixed order, `severity: None`), `assessment`, and that `check`, `odv`, `remediation` and `architecture` are `None`.
  - `test_multi_paragraph_statement`: the title equals the lead-in sentence, and the discussion starts with the full statement (including the `- item` lines), followed by `\n\n` and the topic overview.
  - `test_single_paragraph_statement_discussion_is_the_overview`
  - `test_resource_links_are_rewritten`: the discussion contains `(https://...)` and no `(#`.
  - Fail-loudly tests, one each and parametrised where natural:
    - unknown class;
    - two statement parts;
    - unknown prop name;
    - unknown applicability value;
    - missing `revision`;
    - a link to an unknown uuid;
    - a resource without `rlinks`;
    - a topic without an overview;
    - a control two groups deep;
    - a duplicate id;
    - an unsafe id (`ism/../x`).

- [ ] **Step 2: Run them to verify they fail**
  Run: `python -m pytest -W error tests/test_asd_ism_normalize.py`
  Expected: FAIL with `ModuleNotFoundError: tools.asd_ism_normalize`.

- [ ] **Step 3: Implement `tools/asd_ism_normalize.py`**
  Walk `catalog.groups` recursively, carrying the path of group titles. For each topic group, keep its `overview` prose. Build the `uuid` to href map from `back-matter.resources`.

- [ ] **Step 4: Run them to verify they pass**
  Run: `python -m pytest -W error tests/test_asd_ism_normalize.py`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `feat: normalize the ASD ISM OSCAL catalog into v4 rules`

### Task 3: ISM fetcher, importer CLI and the imported data

**Files:**
- Create: `tools/asd_ism_fetch.py`, `tools/import_asd_ism.py`, `tests/test_asd_ism_fetch.py`, `tests/test_import_asd_ism.py`
- Modify: `tests/test_committed_library.py`, so it regenerates and compares **every** source (mSCP and ISM) and checks the ISM README licence text. Also modify `.gitattributes`.
- Generate and commit: `sources/asd_ism/upstream/ISM_catalog.json`, `sources/asd_ism/upstream/README.md`, `sources/asd_ism/source.json`, `baselines/asd_ism/**`, `baselines/_manifest.json`

**Interfaces:**
- Consumes: `tools/github_fetch.py` and `tools/library_output.publish_source` / `merged_manifest` / `index_entry` (Task 1); `normalize_catalog` and the constants (Task 2).
- Produces:
  - `asd_ism_fetch.fetch(tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock` writes the two upstream files and `source.json`.
  - `import_asd_ism.generate_library(upstream_dir: Path, lock: SourceLock, baselines_dir: Path) -> int`
  - `import_asd_ism.main(argv) -> int` takes `--tag` / `--offline`, which are mutually exclusive, plus `--sources-dir` and `--baselines-dir`, mirroring `import_mscp`. It prints `Imported <n> ASD ISM controls from <tag> (<sha7>)` and the same added/removed summary.
  - Rule files go to `rules/<control id>.json`.

- [ ] **Step 1: Write the failing tests**
  - `test_asd_ism_fetch.py`, with a fake opener as in `test_mscp_fetch.py`:
    - `test_fetch_downloads_both_files_pinned_to_the_commit`: the raw URLs contain the resolved sha; the files are written byte-identical; the lock is written.
    - `test_fetch_rejects_invalid_tag_without_requests`
  - `test_import_asd_ism.py`, using the Task 2 fixture as the upstream catalog:
    - `test_generate_library_writes_rules_index_and_manifest`
    - `test_generate_library_keeps_the_mscp_manifest_entry`
    - `test_offline_import_is_byte_stable`: two runs give the same bytes.
    - `test_failed_normalization_leaves_library_untouched`
  - In `test_committed_library.py`:
    - generalize `test_committed_library_matches_regeneration` across both sources;
    - `test_asd_ism_vendored_license_present`: the README contains `Creative Commons Attribution 4.0`;
    - `test_asd_ism_discussions_have_no_unresolved_links`: no `](#` in any committed ISM discussion;
    - `test_asd_ism_titles_are_single_paragraphs`: no `\n\n` in any ISM title.

- [ ] **Step 2: Run them to verify they fail**
  Run: `python -m pytest -W error tests/test_asd_ism_fetch.py tests/test_import_asd_ism.py`
  Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement the fetcher and the CLI**

- [ ] **Step 4: Run the real import**
  Run: `python tools/import_asd_ism.py --tag v2026.09.4`
  Expected: `Imported 1143 ASD ISM controls from v2026.09.4 (<sha7>)`.
  Then check:
  - `sha256sum sources/asd_ism/upstream/ISM_catalog.json` equals `237ea09362b8449ed5c5ee85de4725a0468ee73d13af7cf61c26d4e6ac47f12d`;
  - the manifest has 2 sources with rule counts 1143 and 350;
  - a second `python tools/import_asd_ism.py --offline` leaves `git status` unchanged.

- [ ] **Step 5: Run the full Python suite**
  Run: `python -m pytest -W error`
  Expected: PASS. Vitest/e2e may fail until Task 4, so don't push yet.

- [ ] **Step 6: Commit**
  `feat: import ASD ISM v2026.09.4 as a rule source`. The body names the release, the commit sha and the 1,143 count.

### Task 4: Web UI loads the second source

**Files:**
- Modify: `webui/src/logic/libraryData.test.ts` (its mSCP-specific pins become scoped to `source.name === 'mscp'`; the generic checks still run for every source)
- Modify: `webui/e2e/smoke.spec.ts` (minimal changes for a 1,493-rule library; see Step 1)
- Modify: `baselines/_vocabulary.json`:
  - `sources`: `{ "label": "ASD ISM", "terms": ["asd_ism"] }`
  - `benchmarks`, each with `metadata: ["benchmark"]`:
    - `ISM Non-classified` (`ism_non_classified`)
    - `ISM OFFICIAL: Sensitive` (`ism_official_sensitive`)
    - `ISM PROTECTED` (`ism_protected`)
    - `ISM SECRET` (`ism_secret`)
    - `ISM TOP SECRET` (`ism_top_secret`)
    - `Essential Eight ML1` (`e8_ml1`)
    - `Essential Eight ML2` (`e8_ml2`)
    - `Essential Eight ML3` (`e8_ml3`)
  - `manual_reasons`: reword the `no_check` description to `The source provides no automated check.`
  - Also update any Vitest/e2e assertion that pins the old `no_check` description text.

**Interfaces:**
- Consumes: the committed `baselines/asd_ism/**` and the manifest (Task 3). No production TypeScript changes are expected. If one turns out to be needed to load or render an ISM rule without an error, make the smallest change, describe it in the report, and return DONE_WITH_CONCERNS.

- [ ] **Step 1: Update and add tests**
  - `smoke.spec.ts`:
    - `350 of 350 rules` becomes `1493 of 1493 rules`;
    - selecting the `macOS` Platform option or the `mscp` Source option gives `350 of 1493 rules`;
    - selecting the `ASD ISM` Source option gives `1143 of 1493 rules`.
    - Any other test that breaks only because ISM rows now exist gets the smallest change that keeps its intent; list each one in the report.
  - New e2e tests:
    - `searching an ISM control id finds exactly that control`: search `ism-1667` shows one row titled `Microsoft Office is blocked from creating child processes.`
    - `an ISM control flows to the manual attestation report`: select `asd_ism.ism-1667`, go to Review & generate, download the zip, and `manual-attestation.md` contains `ism-1667` and the title.

- [ ] **Step 2: Run them to verify the new tests' state**
  Run: `bun run test:e2e`
  Expected: the updated count assertions pass now (the data is already committed). Fix anything that fails for a reason other than a deliberate expectation change.

- [ ] **Step 3: Run the full web and Python suites**
  Run: `bun run test && bun run lint && bun run build && bun run test:e2e` (from `webui/`), then `python -m pytest -W error`
  Expected: all pass.

- [ ] **Step 4: Take screenshots for the maintainer**
  Following `.claude/CLAUDE.md`, take screenshots at about 375px and about 1280px:
  - the browse screen filtered to Source `ASD ISM`;
  - the expanded detail panel for `asd_ism.ism-1667`;
  - the expanded detail panel for the cyber security incident register control (a multi-paragraph statement).

  Look at each with Read. Save them under the plan workspace's `scratch/` and list their absolute paths in the report. Describe what renders badly. Markdown shown raw, the "No macOS version listed" text, and missing benchmarks are expected until phase 3; note them, don't fix them.

- [ ] **Step 5: Commit**
  `feat: show ASD ISM controls in the web UI`. The body names the known phase 3 gaps.

## Progress log

- 2026-10-23: Plan written (no code yet).
