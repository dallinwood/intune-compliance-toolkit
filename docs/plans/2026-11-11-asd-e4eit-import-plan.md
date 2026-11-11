# ASD E4EIT Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import ASD's Essentials for enterprise IT (E4EIT) `v2026.10.15` OSCAL release as a third rule source, `asd_e4eit` (58 rules), with domains and priority phases as benchmarks, ASD's cross-framework ids as references, and ASD's E4EIT to ISM and E4EIT to Essential Eight maps as a generated rule mapping file against `asd_ism`.

**Architecture:**
- **Task 1, shared code (no output change):** move the ASD-generic pieces of the ISM importer into a shared module, add a pinned-file download helper and a post-import hook to the release importer, and widen the rule id pattern to allow dots.
- **Task 2, normalizer:** a pure module turning the vendored catalog, domain profiles and mapping collection into v5 rules plus the mapping file content.
- **Task 3, fetch, CLI and data:** fetcher, importer CLI, the imported release, the generated mapping file, NOTICE and README.
- **Task 4, web UI:** vocabulary labels, Markdown headings, e2e and screenshots.

**Tech Stack:** Python 3 standard library plus `jsonschema` (already used). React + TypeScript + Vitest + Playwright under Bun for Task 4. No new dependencies.

**Spec:** `docs/plans/2026-11-11-asd-e4eit-source-design.md`. Read sections 3 (upstream facts), 5 (naming), 6 (normalization), 7 (mapping) and 11 (decisions) before any task. The closest precedent is the ISM import: `docs/plans/2026-10-23-asd-ism-import-plan.md` and `tools/import_asd_ism.py`, `tools/asd_ism_fetch.py`, `tools/asd_ism_normalize.py`.

## Global Constraints

- **Source name** `asd_e4eit`; display name `ASD Essentials for enterprise IT`; importer format `asd-e4eit-oscal-1`; user agent `intune-compliance-toolkit-asd-e4eit-import`.
- **Upstream:** `https://github.com/AustralianCyberSecurityCentre/e4eit-oscal`, API path `AustralianCyberSecurityCentre/e4eit-oscal`, tag `v2026.10.15` (commit `1cd32b96310e2dd166b5d51ce64f414a4613025d`). Files are fetched from `https://raw.githubusercontent.com/<repository>/<commit sha>/<file>`.
- **Vendored files** per release, byte for byte, in `sources/asd_e4eit/releases/<tag>/upstream/`: `README.md`, `E4EIT_catalog.json`, `E4EIT_mapping-collection.json`, and every root file matching `^E4EIT_[a-z0-9-]+-domain_profile\.json$` at the commit (8 today).
- **Rule ids:** `asd_e4eit.` + lowercased OSCAL control id, dots kept (`IT.PRO-13.1` becomes `asd_e4eit.it.pro-13.1`, file `rules/it.pro-13.1.json`).
- **Benchmarks, order and names:** design section 5. **Rule fields and discussion text:** design section 6.1. **References:** design section 6.3. **Fail loudly:** design section 6.4.
- **Generated mapping file:** `baselines/_mappings/rules/asd-e4eit-to-asd-ism.json`, per design section 7. Never hand-edited.
- **Licence block** on every E4EIT rule and the manifest entry: identical to the ISM one (`CC BY 4.0`, `https://creativecommons.org/licenses/by/4.0/`, `Commonwealth of Australia (Australian Signals Directorate)`, `modified: true`).
- **Counts for this release:** 58 E4EIT rules; manifest total 1,553 (1,495 today plus 58); 87 mapping link entries, 325 expanded pairs.
- **Existing output is unchanged:** after every task, `python tools/import_mscp.py --offline` and `python tools/import_asd_ism.py --offline` leave `git status --short baselines sources` empty (apart from the new E4EIT files after Task 3).
- **Fixtures and line endings:** add `sources/asd_e4eit/releases/*/upstream/** -text`, `sources/asd_e4eit/releases/*/source.json text eol=lf` and `tests/fixtures/asd_e4eit/** -text` to `.gitattributes`, mirroring the ISM lines exactly as they are written there today.
- **Verification:**
  - Python, from the repo root: `python -m pytest -W error`.
  - Web, from `webui/`: `bun run test`, `bun run lint`, `bun run build` (which type-checks with `tsc -b`; there is no separate typecheck script), `bun run test:e2e` (dev server per `webui/playwright.config.ts`).
  - Per `.claude/CLAUDE.md`, any rendering change also gets Playwright screenshots at about 375px and about 1280px, read with the Read tool before the task is called done.
- **Commits:** subject `type: summary`, body explaining why. No `Co-Authored-By` or other AI attribution line. No em dash (U+2014) in code, comments, commits or docs. Commit each task on its own and push to the current branch (confirm with the maintainer first if the branch is `main`). Add a Progress log entry below for each task, in the same commit where practical.
- **Do not merge to `main` between Task 3 and Task 4.** GitHub Pages deploys from `main`; without Task 4, E4EIT benchmarks show raw names and discussions show `#` lines as text.

## Review Focus

- **Byte-identical ISM and mSCP output** after the Task 1 refactor. Pinned by `test_committed_release_matches_regeneration`.
- **A dotted rule id** validates in both schemas and is found by search (`IT.PRO-13.1`). Pinned in Task 1 (schema) and Task 4 (e2e).
- **The discussion text** of an action matches design section 6.1 exactly, including the colon-introduced indicator lists. Pinned in Task 2.
- **Phase benchmarks** are derived from the profiles, not constants: a fixture that moves a domain to another phase changes the rules' phase benchmarks. Pinned in Task 2.
- **The generated mapping file** equals its regeneration from the current release, and an older-release `--offline` re-import never writes it from that older release. Pinned in Task 3.
- **No mapping endpoint is missing:** every ISM id exists in the ISM release the mapping names. Pinned in Task 3.

---

### Task 1: Shared ASD OSCAL helpers, post-import hook and dotted rule ids (no output change)

**Files:**
- Create: `tools/asd_oscal.py`, `tests/test_asd_oscal.py`
- Modify: `tools/asd_ism_normalize.py`, `tools/import_asd_ism.py`, `tools/asd_ism_fetch.py`, `tools/nist_800_53_fetch.py`, `tools/github_fetch.py`

**Behaviour:**
- `tools/asd_oscal.py` holds what the ISM and E4EIT importers share, moved (not copied) from the ISM modules, which then import from it:
  - `ASD_LICENSE` (today's `asd_ism_normalize.LICENSE`; keep `LICENSE` as an alias there so existing imports work);
  - no JSON reader: the duplicate-key-rejecting reader already lives in `tools/json_output.py` (`read_json_rejecting_duplicates`, used by the ISM and NIST importers); the E4EIT importer reuses it and nothing is created or moved for it;
  - `release_label(tag: str) -> str` (today's ISM function: `v2026.10.15` gives `Oct 2026`);
  - `resource_hrefs(catalog: dict) -> dict[str, str]` and `rewrite_resource_links(prose, hrefs, where)` (today's `_resource_hrefs` and `rewrite_resource_links`; keep the ISM names importable from `asd_ism_normalize`).
- `tools/github_fetch.py` gains:
  - `download_pinned_files(repository: str, commit_sha: str, file_names: Iterable[str], destination_dir: Path, user_agent: str, opener=default_opener) -> None`, the download loop that now exists in two copies, `asd_ism_fetch.fetch` and `nist_800_53_fetch.fetch` (`nist_800_53_fetch.py` lines 31-49); both delegate to it, and the E4EIT fetcher in Task 4 is the third user rather than a third copy;
  - `list_root_file_names(repository: str, commit_sha: str, user_agent: str, opener=default_opener) -> list[str]`, from `GET https://api.github.com/repos/<repository>/contents?ref=<sha>`, returning the `name` of each `type: file` entry, sorted. Raise `ValueError` on a response that is not a list of objects.
- Post-import hook: no new hook field. `tools/release_import.SourceImporter.after_import: Callable[[Path, Path], None] | None` already exists, is called by `run_cli` as `after_import(arguments.sources_dir, arguments.baselines_dir)` once after every requested release was imported and its change summary printed, and a failure there prints and exits 1 while the releases stay published. The E4EIT importer sets `after_import=write_ism_mapping` (it needs `sources_dir`, which the widened signature passes). The mSCP and NIST importers keep `regenerate_after_import`; ISM keeps `None`. If one importer ever needs two generators, set `after_import` to a plain function that calls them in turn; do not add a list field. `generate_release` and `import_stored_release` do not call the hook, so `tests/test_committed_library.py` regeneration is unaffected.
- Rule id pattern: already landed with the NIST plan's final-review fix, in `baselines/_rule.schema.json` and `baselines/_index.schema.json`, as `^[a-z0-9_]+\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)*(?![\s\S])`. It accepts `asd_e4eit.it.pro-13.1`, `nist_800_53.ac-2.1`, mSCP and ISM ids, and rejects empty dot segments (`..`, a trailing dot). Nothing to change here; the schema tests for it are in `tests/test_library_schema.py` already. The grep for code that takes the text after the **last** dot as the upstream id was also done in that review and found none.

**Tests:**
- `tests/test_asd_oscal.py`: `release_label` for `v2026.10.15` and a bad tag; `rewrite_resource_links` rewrites and rejects an unknown uuid; `resource_hrefs` rejects a resource with no `rlinks`.
- No new hook tests: `tests/test_release_import.py` already covers `after_import` (called once with `(sources_dir, baselines_dir)` after success, not after a failed import, a raising hook exits 1 with the releases kept). Only extend `test_importers_register_their_formats` style assertions if useful; the E4EIT importer's own hook is tested in Task 4.
- A `github_fetch` test with a fake opener for `list_root_file_names` (filters out `type: dir`, sorts) and `download_pinned_files` (URLs contain the sha; bytes written unchanged).
- No schema test changes: `tests/test_library_schema.py` already accepts `asd_e4eit.it.pro-13.1` and rejects `asd_e4eit.it..pro` and a trailing dot.
- Existing ISM tests pass unchanged apart from import paths.

**Verification:**
- `python -m pytest -W error`
- `python tools/import_mscp.py --offline`, `python tools/import_asd_ism.py --offline`, then `git status --short baselines sources` is empty.

**Commit:** `refactor: share ASD OSCAL helpers and the pinned-file download loop`

### Task 2: E4EIT normalizer

**Files:**
- Create: `tools/asd_e4eit_normalize.py`, `tests/test_asd_e4eit_normalize.py`
- Create: `tests/fixtures/asd_e4eit/` with a hand-written `E4EIT_catalog.json`, two or three `E4EIT_<domain>-domain_profile.json` files and an `E4EIT_mapping-collection.json`. Contents: two function groups; three principle groups, each with a one-sentence overview; four actions: one with one domain, one with domains in two different phases, one with two `mitigated-technique` links to back-matter resources with `attack.mitre.org/versions/v19/techniques/...` hrefs, and every action with all three indicator groups; profiles whose control lists agree with the catalog; a mapping collection with one map for each of the five known `mapping-description` values, with ISM targets under a target resource whose rlink is `https://www.cyber.gov.au/ism/oscal/v2026.09.4/artifacts/ISM_catalog.xml`.

**Behaviour** (pure; no file or network access; inputs are already-parsed JSON):
- Constants: `SOURCE_NAME = "asd_e4eit"`, `REPOSITORY_URL`, `CATALOG_FILE_NAME = "E4EIT_catalog.json"`, `MAPPING_COLLECTION_FILE_NAME = "E4EIT_mapping-collection.json"`, `PROFILE_FILE_PATTERN` (the regex from Global Constraints), `BENCHMARK_BY_DOMAIN` and `BENCHMARK_BY_PHASE` in design section 5 order, `MAPPING_FILE_ID = "asd-e4eit-to-asd-ism"`.
- `phases_by_domain(profiles: list[dict]) -> dict[str, str]` and the control-list cross-check against the catalog (design section 6.4).
- `normalize_release(catalog: dict, profiles: list[dict], mapping_collection: dict, lock: SourceLock) -> list[dict]` returns v5 rules sorted by id, with every field per design section 6.1, the discussion exactly as shown there, benchmarks per section 5 and references per section 6.3. It raises `UnsupportedUpstreamData` for every case in section 6.4.
- `ism_mapping(mapping_collection: dict, action_ids: set[str], e4eit_tag: str) -> tuple[dict, str]` returns the mapping file content per design section 7.1 (87 entries for the real data) and the ISM release tag it names. It does not check ISM ids against the library; Task 3 does.

**Tests** (against the fixture):
- every rule validates with `tools.validate_library.schema_errors`;
- exact field values for one full action: `id`, `title`, `section_path`, `source` fields, `applicability` (benchmarks in the fixed order), `assessment`, `references`, and the null fields;
- the discussion string, compared in full;
- the two-phase action gets both phase benchmarks; editing a profile's phase in the test changes them;
- MITRE ids land under `mitre.attack_v19`; a rule with no references has `{}`;
- the mapping content: relation `related`, ISM-before-E8 order, sorted `to` lists, notes, releases, `description`;
- one test per fail-loudly case in design section 6.4, parametrised where natural (include a `\r` in prose, an unknown domain, a profile list mismatch, a `relationship` of `subset-of`, and a lowercase-colliding id pair).

**Verification:** `python -m pytest -W error tests/test_asd_e4eit_normalize.py`, then `python -m pytest -W error`. Optionally run the normalizer against the real upstream files (fetched to a scratch directory, not the repo) and confirm 58 rules, 0 schema errors and 87 mapping entries.

**Commit:** `feat: normalize the ASD E4EIT OSCAL catalog into v5 rules`

### Task 3: E4EIT fetcher, importer CLI, imported data and generated ISM mapping

**Files:**
- Create: `tools/asd_e4eit_fetch.py`, `tools/import_asd_e4eit.py`, `tests/test_asd_e4eit_fetch.py`, `tests/test_import_asd_e4eit.py`
- Modify: `tests/test_committed_library.py` (add the E4EIT importer to `IMPORTERS_BY_NAME`, plus the tests below), `.gitattributes`, `NOTICE`, `README.md`
- Generate and commit: `sources/asd_e4eit/releases/v2026.10.15/**`, `baselines/asd_e4eit/releases/v2026.10.15/**`, `baselines/_manifest.json`, `baselines/_mappings/rules/asd-e4eit-to-asd-ism.json`

**Behaviour:**
- `asd_e4eit_fetch.fetch(tag, sources_dir, today, opener=default_opener) -> SourceLock`, shaped like `asd_ism_fetch.fetch`: resolve the tag, read the release's published date, list the root files, download `README.md`, the catalog, the mapping collection and every profile matching the pattern via `download_pinned_files`, swap the staging folder into place, write the lock with `importer_format: "asd-e4eit-oscal-1"`. No profiles found fails.
- `import_asd_e4eit.build_rule_tree(upstream_dir, lock, tree_dir) -> int` reads every vendored JSON with `json_output.read_json_rejecting_duplicates` and calls `normalize_release`; writes `rules/<lowercased id>.json` and `_index.json` like the ISM importer.
- `IMPORTER = SourceImporter(...)` with `release_label=asd_oscal.release_label` and `after_import=write_ism_mapping`.
- `write_ism_mapping(sources_dir, baselines_dir) -> None`: reads the manifest, takes the **current** `asd_e4eit` release, reads that release's vendored mapping collection and catalog, calls `ism_mapping`, then checks that the named ISM release is in the manifest's `asd_ism` releases and that every ISM target id is in that release's index (fail with the missing ids listed). Writes the file with `tools/json_output.write_json`. Does nothing to any other mapping file.
- `NOTICE` gains an E4EIT entry mirroring the ISM entry (design section 9.1); `README.md` gains the attribution paragraph and an "Updating the ASD E4EIT rules" section (design section 10), and mentions the generated mapping file in the mappings section.

**Tests:**
- Fetcher, with a fake opener: raw URLs carry the resolved sha; only matching profile names are downloaded; files are byte-identical; the lock is written; an invalid tag makes no request; a listing with no profiles fails.
- CLI, using the Task 2 fixture as upstream: library, index and manifest written; the ISM and mSCP manifest entries are kept; a second `--offline` run is byte-stable; a failed normalization leaves the library untouched; `write_ism_mapping` fails when an ISM id is missing from a tmp ISM release and when the named ISM release is not imported; `--offline --release <older tag>` writes the mapping from the current release, not the older one (two fixture releases).
- `tests/test_committed_library.py`: every stored E4EIT release regenerates byte-identically (through the existing parametrised test); the vendored README contains `Creative Commons Attribution 4.0`; 58 rules; every rule has at least one `e4eit_phase_*` and one domain benchmark; the committed mapping file equals `write_ism_mapping` output into a tmp copy; `tools/mappings.py` reports no errors for the committed mappings.

**Verification:**
- `python tools/import_asd_e4eit.py --tag v2026.10.15` prints `Imported 58 ASD Essentials for enterprise IT rules from v2026.10.15 (1cd32b9)`.
- `sha256sum sources/asd_e4eit/releases/v2026.10.15/upstream/E4EIT_catalog.json` is `29b602fbbce89d83f9dffd6e6f99d32d1929b563a967f62b2c1cb52891fdb7d2` and the mapping collection is `34fe6d00e88b2352cf70f8c88e63c01ceb70a8f614d27aef0c2fa4d740ce7ae8`.
- `python tools/import_asd_e4eit.py --offline` then `git status --short` shows no change.
- `python -m pytest -W error` passes. Vitest and e2e may fail on counts until Task 4; that is expected, so do not merge yet.

**Commit:** `feat: import ASD E4EIT v2026.10.15 as a rule source` (body: release, commit sha, 58 rules, 87 mapping entries, and that the mapping file is generated).

### Task 4: Web UI for E4EIT

**Files:**
- Modify: `baselines/_vocabulary.json` (source label `ASD E4EIT`; the 11 benchmark labels from design section 5, phases first, each with `metadata: ["benchmark"]`)
- Modify: `webui/src/logic/discussionMarkup.ts` and its test (a line matching `^#+ ` in `parseMarkdownDiscussion` becomes a `heading` block with the text after the hashes and space)
- Modify: `webui/e2e/smoke.spec.ts` (and any other spec pinned to 1,495 rules)

**Behaviour:**
- Only the two changes above in production code. If anything else renders wrong for E4EIT (credit line, footer, attestation attribution, Frameworks card, references tree, Mapped rules tab), make the smallest fix and describe it in the commit body.

**Tests:**
- Vitest: `# Principle` and `## X` become headings; a `#` with no space stays text; existing Markdown tests unchanged.
- e2e:
  - totals `1553 of 1553 rules`; Source `ASD E4EIT` gives `58 of 1553 rules`;
  - searching `IT.PRO-13.1` shows exactly one row, titled with that action's statement;
  - Benchmark `E4EIT priority phase 1` gives 37 rules; `E4EIT User devices` gives 20;
  - with the **real** mapping index (the spec stubs `**/baselines/_mappings/_index.json` to empty at the top of `smoke.spec.ts`; this test must not use that stub), `asd_e4eit.it.gov-01.1`'s Mapped rules tab lists `ism-1997`, and `ism-1997`'s tab lists `it.gov-01.1`;
  - selecting an E4EIT rule and downloading the bundle puts it in `manual-attestation.md` with an attribution line naming `ASD Essentials for enterprise IT`.

**Verification:**
- From `webui/`: `bun run test && bun run lint && bun run build && bun run test:e2e`; then `python -m pytest -W error` from the repo root (the vocabulary is validated in Python).
- Screenshots at about 375px and about 1280px of: the rules list filtered to ASD E4EIT; the detail panel of `asd_e4eit.it.pro-13.1` (headings, indicator lists, references); its Mapped rules tab; `asd_ism.ism-1997`'s Mapped rules tab; the Frameworks landing card. Read each one. Look for: readable headings and lists, the long section names in the section tree and breadcrumb wrapping sensibly at 375px, the benchmark cell with up to 9 E4EIT benchmarks, and the single-release card. List the screenshot paths and anything that looks wrong in the report.

**Commit:** `feat: show ASD E4EIT rules in the web UI`

## Progress log

- 2026-11-11 - Task 1: moved the ISM/E4EIT shared helpers into `tools/asd_oscal.py` and the pinned-file download loop (plus `list_root_file_names`) into `tools/github_fetch.py`; no output change. The post-import hook and dotted rule id pattern already existed from the NIST work, so nothing was added for them. Commit: e36737b refactor: share ASD OSCAL helpers and the pinned-file download loop
- 2026-11-11 - Task 2: added `tools/asd_e4eit_normalize.py` (OSCAL catalog, domain profiles and mapping collection to v5 rules, plus the ISM and Essential Eight mapping content) with fixtures and tests. Run against the real v2026.10.15 files it gives 58 rules, 0 schema errors and 87 mapping entries (325 pairs). Upstream quirk: the governance-and-culture and visibility-and-response profiles list all three priority phases, not phase-3 only, so a domain can span several phases and those actions get all three phase benchmarks (phase 1 and 2 are on all 58 rules, not 37). Commit: see the git log entry `feat: normalize the ASD E4EIT OSCAL catalog into v5 rules`.
