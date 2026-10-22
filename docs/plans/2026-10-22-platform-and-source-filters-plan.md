# Platform and Source Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Platform filter and a Source filter to the web UI's filter sidebar. Both are populated entirely from the loaded data, so new platforms and new rule sources appear automatically.

**Architecture:**
- Platform: each rule already records `platform` (e.g. `"macOS"`), but the index the table loads does not. The importer adds `platform` to every index entry (the same pattern as `section`), and the UI exposes it on `RuleRow`.
- Source: each `RuleRow` already carries `sourceName` from the manifest (e.g. `mscp`).
- Both facets reuse the existing facet machinery (group keys, stable fade-out, zero-row narrowing). Labels come from two new vocabularies in `baselines/_vocabulary.json`, `platforms` and `sources`, falling back to the raw value.

**Tech Stack:** As before: Python importer and validator; React + TypeScript + zustand + Vitest + Playwright under Bun.

**Spec (maintainer's request, 2026-10-22):**
- A filter for platform, listing every platform found in the rules (only macOS today).
- A filter near the bottom for rule sources, listing every source (only mscp today).

## Global Constraints

- **Nothing hard-coded.** No platform or source names in TypeScript. Facet values come from the data; labels come from the `platforms` and `sources` vocabularies, or the raw value.
- **Vocabulary schema:** `baselines/_vocabulary.schema.json` gains the optional keys `platforms` and `sources`. Add them to the UI vocabulary name list. Seed both as empty lists in `_vocabulary.json`, since `macOS` and `mscp` display fine raw.
- **Index:**
  - `baselines/_index.schema.json` requires `platform` on each entry (non-empty string, `(?![\s\S])` pattern convention).
  - `tools/mscp_normalize.py` `index_entry` copies the rule's `platform`.
  - Regenerate with `python tools/import_mscp.py --offline`. Only `baselines/mscp/_index.json` may change among generated files.
- **Placement:**
  - Platform facet: directly after Automation, before macOS version.
  - Source facet: last, after Tags.
  - Facet titles "Platform" and "Source" are UI chrome.
- **Filtering:** same semantics as the other facets (any selected value matches; narrowed by every other applied filter; never offers a zero-row option; stable fade-out behaviour). Filter state is in memory only, as now.
- **Generation unaffected:** bundle output is byte-identical for a fixed selection.
- **Verification:**
  - Python: pytest `-W error`.
  - Web: Vitest, lint, build, and `bun run test:e2e` with a dev server.
  - Playwright screenshots of the sidebar top and bottom at about 375 and about 1280, looked at, per `.claude/CLAUDE.md`.
- **Commits:** `type: summary`, no `Co-Authored-By` or AI attribution line. Implementers commit only; the controller pushes after review. No em dash characters (U+2014).

## Review Focus

- **A second source or platform** (synthetic rows in unit tests) appears as its own option, and selecting it narrows the other facets correctly.
- **Re-import stability:** the importer drift test still passes after regeneration, and a re-import produces no diff.

---

### Task 1: Platform and Source facets

**Files:**
- Modify: `tools/mscp_normalize.py`, `baselines/_index.schema.json`, `baselines/_vocabulary.schema.json`, `baselines/_vocabulary.json`, Python tests
- Regenerate: `baselines/mscp/_index.json`
- Modify: `webui/src/types/library.ts` (IndexEntry), `webui/src/types/rule-row.ts`, `webui/src/data/ruleRows.ts`, `webui/src/types/vocabulary.ts`, `webui/src/state/filterStore.ts`, `webui/src/logic/ruleFilters.ts`, `webui/src/components/filters/FilterSidebar.tsx`, and the related tests and `webui/e2e/smoke.spec.ts`

- [ ] **Step 1: Write failing tests.**
  - Python: the index entry includes `platform`, and the schema requires it.
  - Vitest:
    - rows carry the platform and source name;
    - facet options come from the data, with two synthetic sources and two platforms;
    - matching, narrowing and labels via the vocabulary with raw fallback.
  - e2e:
    - the Platform facet shows `macOS` after Automation;
    - the Source facet shows `mscp` last;
    - ticking either leaves 350 rows.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement and regenerate the index.**
- [ ] **Step 4: Verify:**
  - all suites;
  - bundle output byte-identical for a fixed selection;
  - screenshots.
- [ ] **Step 5: Commit** `feat: filter rules by platform and source`.

## Progress log

- 2026-10-22: Task 1 done. The index entry now carries `platform` (required by the index schema), and the sidebar has a Platform facet after Automation and a Source facet last, both populated from the data and labelled through new optional `platforms` and `sources` vocabularies (seeded empty, so raw values show). Unit tests cover a second synthetic platform and source, narrowing, labels and grouped terms; the e2e suite covers placement and that ticking either leaves 350 rows. Bundle output is byte-identical for a fixed 20-rule selection. Commit: d3c76a7 feat: filter rules by platform and source.
- 2026-10-22: Review fix. The sidebar scroll e2e test now finds the Tags facet by its heading instead of assuming Source has exactly one option, so it survives a second rule source. Commit: ddb4990 test: target the Tags facet explicitly in the sidebar scroll test.
