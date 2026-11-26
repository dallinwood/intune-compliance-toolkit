# Check and remediation type filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter the rules view by check type and, separately, by remediation type.

**Architecture:** The index gains two derived list fields per rule, written by the Python pipeline and backfilled into every committed index from the committed rule files. The web UI carries them onto `RuleRow` and adds two facets built like Tags.

**Tech Stack:** Python (pytest, jsonschema), React, zustand, Vitest, Playwright.

**Spec:** `docs/plans/2026-11-26-script-type-filters-design.md`

## Global Constraints

- Index fields `check_types` and `remediation_types`: sorted, distinct, possibly empty string lists; required; index `schema_version` stays 7.
- Facet titles "Check", "Remediation" and "Organization values"; URL parameters `check`, `fix` and `odv` (`yes`/`no`, from the existing `hasOdv`).
- Options only from rows in view (existing `StableFacetGroup` behaviour).
- Labels from `logic/targetDisplay.ts`; an unknown payload kind shows as its code.
- No new dependencies. Per project CLAUDE.md: Playwright and screenshots for the UI change, progress log, commit and push per task.

## Review Focus

- An overlay adding a remediation to a manual ISM control (all five committed overlays): the rule must match its new type on the all-rules page.
- A framework with no checks at all (ASD ISM): no Check group shows.
- A rule with both a script step and a payload: listed under both remediation options.
- Older releases (Releases tab browsing an older index): the filters work there too.
- "Go to this rule" with a Check filter that hides the target: the filter is cleared.

---

### Task 1: Index fields in the pipeline and committed data

**Files:** `tools/library_output.py`, `tools/overlays.py`, `baselines/_index.schema.json`, `tests/test_library_output.py`, `tests/fixtures/overlays/cases.json`, every committed `baselines/*/releases/*/_index.json`.

**Interfaces:** Produces index entries with `check_types: list[str]` and `remediation_types: list[str]`.

- [x] Test: `index_entry` of a rule with two check items (powershell, registry) and a remediation with a bash step and a mobileconfig payload gives `["powershell", "registry"]` and `["bash", "mobileconfig"]`; a rule with no check and no remediation gives `[]` and `[]`. Run, see it fail.
- [x] Implement in `index_entry`; add both fields to the index schema (required, unique string arrays).
- [x] Overlay index cases in the shared fixture: a merged remediation adds its step languages and payload kinds; a top-level `$replace` of check sets the list exactly. Implement in `apply_overlay_to_index_entry` (remediation and check become index-level overlay fields that are consumed, like `odvs`).
- [x] Backfill every committed index by rebuilding each entry with `index_entry(rule, entry["file"])` (scratch script, not committed).
- [x] Run `pytest` (full). Expected: PASS, including `test_committed_release_matches_regeneration`.
- [x] Commit `feat: record check and remediation types in the rule index` and push.

### Task 2: Rows and overlays in the web UI

**Files:** `webui/src/types/library.ts`, `webui/src/types/rule-row.ts`, `webui/src/data/ruleRows.ts`, `webui/src/logic/overlays.ts` (+ shape check), tests and fixtures that build rows.

**Interfaces:** `RuleRow.checkTypes: string[]`, `RuleRow.remediationTypes: string[]`.

- [x] Shared fixture cases run by `overlays.test.ts` fail; implement the TS overlay recompute and index shape check; carry the fields onto rows.
- [x] Run `bunx tsc -b`, `bun run lint`, `bun run test`. Expected: clean, PASS.
- [x] Commit with Task 3 if Task 2 alone leaves no user-visible change.

### Task 3: Check and Remediation facets

**Files:** `webui/src/state/filterStore.ts`, `webui/src/state/urlState.ts`, `webui/src/logic/ruleFilters.ts`, `webui/src/logic/ruleNavigation.ts`, `webui/src/components/filters/FilterSidebar.tsx`, tests, `webui/e2e/`.

**Interfaces:** `FilterState.checks`, `FilterState.remediations`, `FilterState.odvs` (`Set<string>`, odv values `yes`/`no`), toggles `toggleCheck`, `toggleRemediation`, `toggleOdv`; `FilterDimension` gains `'checks' | 'remediations' | 'odvs'`.

- [x] Unit tests: `matchesFilters` keeps a row whose `checkTypes` meet a selected check (OR within the facet, AND across facets); URL round-trips `check` and `fix`; `filtersShowingRule` clears a check filter that hides the target.
- [x] Implement; add the three `StableFacetGroup`s after Automation.
- [x] e2e: on the CIS Windows framework page the Check group offers PowerShell and Registry only; ticking PowerShell narrows the count; the ASD ISM page has no Check group.
- [x] Run `bun run test`, `bun run test:e2e` for the filter specs, screenshots at 375px and desktop.
- [x] Commit `feat: filter rules by check and remediation type` and push; log progress.

## Progress log

- 2026-11-26: Tasks 1 to 3 done in one commit, since the shared overlay fixture runs on both sides and the filter types touch the same test fixtures as the row fields. Index entries carry `check_types` and `remediation_types` (renamed from `check_languages` at the user's request, so both are "types"), backfilled into all 33 committed indexes from the committed rule files; overlays recompute them in Python and TypeScript, and the overlay index carries check and remediation reduced to the types they name. The sidebar gained Check, Remediation and Organization values (requested alongside; from `has_odv`, URL `odv=yes|no`). Python suite 1867 passed; e2e spec `script-type-filters.spec.ts` covers the CIS Windows options, URL round trip, the 35 mSCP rules with values, and the 5 ISM rules whose PowerShell remediation comes from overlays. Commit: feat: filter rules by check type, remediation type and organization values.
