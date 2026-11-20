# Framework Provenance Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every framework carries an Official or Community label in the manifest, shown as a badge next to its title, with official frameworks listed first on the Frameworks home and community ones after a separator.

**Spec:** `docs/plans/2026-11-20-framework-provenance-design.md` (read it).

**Architecture:** `SourceImporter` (`tools/release_import.py`) gains a `provenance` field that `generate_release` passes with the other source fields, so `merged_manifest` (`tools/library_output.py`) writes it on the source entry. The web UI reads `ManifestSource.provenance`.

## Global Constraints

- Values exactly `"official"` and `"community"`. Official: `mscp`, `nist_800_53`, `asd_ism`, `asd_e4eit`. Community: `cis_rhel9`, `cis_ubuntu2404` (set on `BenchmarkSpec` in `tools/cac_benchmarks.py` so future CaC benchmarks declare it too).
- Source level only, not per release. Required by `baselines/_manifest.schema.json`. The manifest `schema_version` stays 6 (the field is additive; the web UI ignores unknown fields, so each commit stays green).
- No hand edits to `baselines/_manifest.json`: regenerate each source's current release offline (`.venv/Scripts/python.exe tools/import_<source>.py --offline --release <current tag>`; CIS: `tools/import_cis_cac.py --benchmark <source> --offline --release v0.1.82`). The controller stops the dev server before this (on Windows it holds handles that break in-place regeneration).
- Python `.venv/Scripts/python.exe -m pytest -W error -n auto` (3 known failures in `tests/test_github_fetch.py`). Web UI from `webui/`: `bun run test`, `bun run lint`, `bunx tsc -b`; e2e with `PLAYWRIGHT_BASE_URL=http://localhost:5199` against the controller's dev server.
- Visual changes: screenshots at about 375px and 1440px, looked at with the Read tool.
- Commits: `type: summary`, body says why, no Co-Authored-By or AI attribution, explicit paths only, push; progress log entry in the design doc. Never use the em dash character.

---

### Task 1: Provenance in the importers and manifest

**Files:** `tools/release_import.py` (`SourceImporter.provenance: str`, passed in `source_fields`), the five `tools/import_*.py` importers and `tools/cac_benchmarks.py` (`BenchmarkSpec.provenance`), `baselines/_manifest.schema.json` (required `provenance` enum on source entries), `tests/test_release_import.py`, `tests/test_library_schema.py` (or wherever the manifest schema is tested), `tests/test_committed_library.py`; regenerated `baselines/_manifest.json` (and whatever the offline runs rewrite, which should be nothing else).

- [ ] **Step 1: Failing tests:** a published release's manifest source entry has the importer's `provenance`; the manifest schema rejects a source without `provenance` or with another value; `test_committed_library`: every manifest source's provenance matches the Global Constraints list.
- [ ] **Step 2: Implement; regenerate each source's current release offline; confirm `git diff --stat` shows only `baselines/_manifest.json` among data files (report anything else).**
- [ ] **Step 3: Run the Python suite; commit** `feat: record whether each framework is official or community`.

### Task 2: Badges and grouping in the web UI

**Files:** `webui/src/types/library.ts` (`ManifestSource.provenance: 'official' | 'community'`), a pure grouping function in `webui/src/logic/` (official first, then community, each keeping its current order) with a Vitest test, `webui/src/components/frameworks/FrameworkCards.tsx` (two groups; between them a separator with a "Community" heading; the official group needs no heading unless the layout reads better with one, decide from the screenshots), a small badge component beside the title on each card and on `FrameworkPage.tsx`'s `PageTitle` (not on the "All rules" view), an e2e spec.

- [ ] **Step 1: Failing tests:** grouping function; e2e: the Frameworks home shows every official card before the "Community" separator and both CIS cards after it; a CIS framework page shows a "Community" badge by its title and NIST SP 800-53 shows "Official".
- [ ] **Step 2: Implement; run unit, lint, type checks and the new e2e spec.**
- [ ] **Step 3: Screenshots** of the Frameworks home and one framework page of each kind at both widths; look at them.
- [ ] **Step 4: Commit** `feat: label frameworks official or community and list official ones first`; mark the design `Status: Implemented`.
