# Sidebar Scrolling and Severity Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Make the filter sidebar scrollable, with a pinned search box and directional "more content" indicators.
- Split benchmark filter options by severity wherever the data carries a severity, with nothing about any benchmark or severity hard-coded.

**Architecture:**
- **Task 1** is layout only: the sidebar becomes its own scroll container inside the existing flex layout. The search box sits outside the scrolling area, and a small hook tracks whether content is hidden above or below to show fade indicators.
- **Task 2** changes the benchmark facet's values from benchmark group keys to (benchmark group key, severity or none) pairs taken from the rows' `applicability` data. The facet stays version-scoped. Severity display names and order come from a new `severities` vocabulary in `baselines/_vocabulary.json`.

**Tech Stack:** As before: React 19, TypeScript, Tailwind 4, zustand, Vitest, Playwright, Bun; Python validator for the vocabulary schema.

**Spec (maintainer's request, 2026-10-22):**
1. The left filter section is scrollable.
2. The search bar stays visible while scrolling.
3. When content is hidden above or below, show a small indicator in that direction:
   - a fade bar from the sidebar's background colour (outer edge) to transparent (inner edge);
   - a small chevron pointing in the scroll direction;
   - each indicator vanishes once that end is reached.
4. Benchmarks are filterable by severity, e.g. separate "DISA STIG (low)", "DISA STIG (medium)" and "DISA STIG (high)" options.
5. Severity filtering is agnostic: any benchmark that carries severities in the data automatically gets one option per severity. Nothing hard-codes DISA STIG or low/medium/high.

## Global Constraints

- **No hard-coded benchmark names, severity values or labels in TypeScript.**
  - Severity display labels and order come from a new `severities` vocabulary.
  - Unlisted severities show raw and sort alphabetically after listed ones.
  - Seed it with `low`, `medium` and `high`, in that order, label = the raw code, metadata `["severity"]`. Labels stay raw so the UI looks as it does today; the entries exist to give the order.
- **Vocabulary schema:** `baselines/_vocabulary.schema.json` allows the new optional key `severities`. Update the Python validator tests and the UI's vocabulary name list.
- **Benchmark facet options:**
  - Options are the distinct (benchmark group key, severity-or-null) pairs found in the data, scoped by the selected macOS versions exactly as the benchmark facet is today.
  - Label: `<benchmark group label>`, or `<benchmark group label> (<severity label>)` when a severity is present.
  - Order: benchmarks in vocabulary order. Within one benchmark, the no-severity option comes first, then severities in `severities` vocabulary order.
  - A selected option matches a row when, under the version scope, the row lists that benchmark group with that exact severity (or with no severity, for the no-severity option).
  - The zero-row-combination guarantee between the version and benchmark facets must still hold.
- **Row text and other displays** that show a severity (e.g. the benchmark summary in `ruleDisplay.ts`) use the severity vocabulary label.
- **Generation unaffected:** bundle output is byte-identical for the same selection.
- **Sidebar:**
  - The search input is pinned (not scrolled). Facets scroll inside the sidebar on desktop; the mobile collapsible panel also scrolls within its max height.
  - Indicators are purely visual: `aria-hidden`, `pointer-events: none`.
  - Colours use the sidebar's existing background, not a new hard-coded colour; respect the existing light and dark tokens if any.
  - Indicators update on scroll, on resize, and when facet content changes height (e.g. the facet fade-out). A `ResizeObserver` is acceptable.
- **Verification:** Vitest, lint, build, pytest, `bun run test:e2e` with a dev server, and Playwright screenshots at about 375 and about 1280 that are actually looked at, per `.claude/CLAUDE.md`.
- **Commits:** `type: summary`, no `Co-Authored-By` or AI attribution line. Implementers commit only; the controller pushes after review. No em dash characters (U+2014).

## Review Focus

- **Scroll indicators at the exact ends.** At the top only the bottom indicator shows; at the bottom only the top shows. When content fits, none show. Changes in content height (facet fade-out, window resize) must update them.
- **A benchmark that has severities on some rules and none on others** (synthetic test data) shows both a no-severity option and severity options, each matching only the right rows.
- **Grouped benchmarks** (vocabulary group of two codes) with severities still give one option per (group, severity).
- **Version and benchmark facet narrowing** never offers a zero-row combination after the split.

---

### Task 1: Scrollable filter sidebar with pinned search and scroll indicators

**Files:**
- Modify: `webui/src/components/filters/FilterSidebar.tsx`, `webui/src/components/layout/AppShell.tsx` (only as needed for height constraints)
- Create: `webui/src/hooks/useScrollEdges.ts` (+ test), returning `{ canScrollUp: boolean; canScrollDown: boolean }` for a ref'd scroll container
- Modify: `webui/e2e/smoke.spec.ts`

- [ ] **Step 1: Write failing tests.**
  - Vitest for the pure edge computation: `scrollEdges(scrollTop, clientHeight, scrollHeight)` with a 1px tolerance.
  - e2e at 1280x700:
    - the sidebar scrolls;
    - the search box stays visible after scrolling to the bottom;
    - the bottom indicator is visible at the top and hidden at the bottom;
    - the top indicator does the reverse;
    - the last tag checkbox is reachable and clickable.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** (all suites, screenshots of the top, middle and bottom scroll states at 1280, and the mobile panel at 375).
- [ ] **Step 5: Commit** `fix: make the filter sidebar scrollable with pinned search`.

### Task 2: Severity-aware benchmark filter

**Files:**
- Modify: `baselines/_vocabulary.json`, `baselines/_vocabulary.schema.json`, Python vocabulary tests
- Modify: `webui/src/logic/vocabulary.ts` (vocabulary name list), `webui/src/logic/ruleFilters.ts`, `webui/src/logic/ruleDisplay.ts`, `webui/src/components/filters/FilterSidebar.tsx`, `webui/src/state/filterStore.ts` if the stored value type changes, and the related tests and e2e

**Interfaces:**
- A benchmark facet value encodes a pair, using `benchmarkFacetValue(groupKey: string, severity: string | null): string` and `parseBenchmarkFacetValue(value: string): { groupKey: string; severity: string | null }`. Use a separator that cannot occur in codes (e.g. U+001F), and round-trip it in a test.

- [ ] **Step 1: Write failing tests.**
  - On real data: DISA STIG yields one option per severity present.
  - Synthetic data: a benchmark with mixed severity and no-severity entries.
  - A grouped benchmark with severities.
  - Ordering by the `severities` vocabulary, and unlisted severities appended.
  - The exhaustive zero-row check across version and benchmark selections (extend the existing one).
  - Labels.
  - An e2e test that selecting "DISA STIG (high)" narrows the table to rules whose STIG severity is high on the scoped versions.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** (all suites, bundle output byte-identical for a fixed selection, screenshots of the sidebar benchmark section at 375 and 1280).
- [ ] **Step 5: Commit** `feat: filter benchmarks by severity`.

## Progress log

- 2026-10-22: Task 2 done. The benchmark facet now offers one option per (benchmark group, severity group) found in the data, labelled and ordered by a new `severities` vocabulary. The version/benchmark zero-row guarantee is tested exhaustively on real data, on a synthetic benchmark that mixes severities with no severity, and on a grouped benchmark. Bundle output is byte-identical for a fixed 20-rule selection. Commit: 05a747f feat: filter benchmarks by severity.
