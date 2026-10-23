# Browse UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browsing 1,493 rules responsive and navigable:
- filter clicks never freeze the page;
- filter state is shareable through the URL;
- sections are collapsible and nested;
- the table is paged (or scrolls infinitely);
- rows have a consistent height.

This closes the design's last `main` gate (table render cost) and adds the ASD credit to `NOTICE` and the README.

**Architecture:**
- **Phase A** keeps today's table and makes the UI responsive. The table renders from a `useDeferredValue` copy of the filters, so checkbox clicks commit instantly while the table re-renders in an interruptible background render, with a fade and spinner while stale. Filter state syncs to the URL with `URLSearchParams` and `history.replaceState`, with no router dependency.
- **Phase B** replaces the per-section flat tables with a section tree built from `section_path`. Collapse state lives in memory. Visible rule rows are paged, or revealed in chunks for infinite scroll, so the DOM only ever holds about one page of rows.

**Tech Stack:** React 19 + TypeScript + zustand + Base UI (`@base-ui/react`, which already includes Tooltip) + Tailwind; Vitest; Playwright; Bun. No new dependencies.

**Spec:** the maintainer's requests of 2026-10-23 (items 1-7 and the table speed answers), plus `docs/plans/2026-10-22-asd-ism-source-design.md` section 11 (the table render cost gate) and section 9 (attribution). Item 8 (custom overlay rules) is Phase C, designed with the maintainer before any plan is written.

**Maintainer decisions (2026-10-23):**
- A page counts **rules**. A section can span pages, and its header (with its parent headers) repeats at the top of the next page.
- Sections start **all collapsed** when there is no URL state.
- The URL carries filters, search, **page and page size**. It does not carry expanded sections.
- The index is **not split**. It is 70 KB gzipped and about 3 ms to parse, so the cost is DOM, not data. Revisit if indexes grow about 10x; recorded in the design's section 13.
- Infinite scroll is offered as a choice alongside paging.

## Global Constraints

- **No new dependencies.**
- **Rules data is unchanged.** `baselines/_vocabulary.json` may change.
- **Filter order:** Automation, Target, Version, **Source**, Benchmark, Section, Tags. Source moves from last to between Version and Benchmark.
- **"None" options** use `text-slate-500 italic` with the same label text `None`, so they read as system-generated. Their accessible name stays `None`.
- **Responsiveness:** a filter checkbox, radio or search keystroke updates its own control in the same frame. The table re-renders from deferred state (`useDeferredValue`).
- **Stale indicator:** while the deferred state differs from the current state, the table area gets `opacity-50` with `pointer-events-none`, and a centred spinner shows with `role="status"` and accessible name `Updating rules`. Both disappear when the table catches up.
- **URL format.** Query parameters on the existing page URL; repeated keys for multiple values; values are the same group keys the filter store holds:
  - `q` (search)
  - `automation` (only when not the default)
  - `target`, `version`, `source`, `benchmark`, `section`, `tag`
  - `page` (only when greater than 1)
  - `size` (only when not the default; `all` means infinite scroll)
- **URL behaviour:**
  - The URL updates with `history.replaceState`, so filter clicks don't create history entries.
  - A key with no value is removed. With nothing set, the URL has no query string at all.
  - On load, the URL state is applied. Unknown keys and values are ignored. A value that matches no current option is dropped from the URL on the next write.
  - Any filter or search change resets `page` to 1.
- **Section tree:**
  - Each rule sits at the end of its `section_path`, so mSCP rules are one level deep and ISM rules three.
  - The root header label comes from the `sections` vocabulary, with the raw value as fallback. Deeper levels use the raw titles.
  - Each header shows the number of matching rules beneath it.
  - Deeper levels are visibly distinct: indentation of `pl-4` per level, plus decreasing header weight and background (level 1 `bg-slate-100 font-semibold`, level 2 `bg-slate-50 font-medium`, level 3 `bg-white font-medium`).
  - A section with no matching rules is not shown.
- **Section controls** sit in a toolbar above the table: **Expand one level**, **Collapse one level**, **Expand all**, **Collapse all**.
  - **Expand one level** opens every collapsed section at the shallowest depth that has a collapsed visible section.
  - **Collapse one level** closes every open section at the deepest depth that has an open section.
  - Collapse state is in memory and starts all collapsed.
- **Search auto-expand** (controller's call): while the search text is non-empty, every section containing a match renders open. Clearing the search returns to the stored collapse state. Facet filters do not auto-expand.
- **Paging:**
  - Page sizes are 25, 50, 100 and 200, plus **Infinite scroll**. The default is 50.
  - The paging bar sits below the table and shows: previous, next, `Page X of Y`, a page-number input that jumps on Enter or blur and clamps to `1..Y`, and the size select.
  - A page holds up to `size` visible rule rows. Rules inside collapsed sections are not visible and are not counted. Section headers don't count toward the size, and the ancestors of the first rule on a page repeat at the top of that page.
  - With nothing expanded, the table shows the root headers and there is one page.
  - Infinite scroll renders 100 visible rule rows at a time and appends the next 100 when a sentinel below the table enters the viewport (`IntersectionObserver`).
  - The selected size is also remembered in `localStorage`, wrapped in try/catch, for visits without a `size` in the URL.
- **Benchmark cell:**
  - Always a single line (`whitespace-nowrap overflow-hidden`), with a right-edge fade (CSS `mask-image` linear gradient) applied only when the text overflows.
  - Hovering or focusing the cell shows the full text in a Base UI Tooltip.
  - Row height must not depend on the benchmark text.
- **Detail panel:** a **Benchmarks** section directly above References lists every benchmark membership:
  - grouped by scope (version key label, or `None` for unversioned);
  - each item labelled from the vocabulary, with the severity in brackets where present.
- **Attribution:** `NOTICE` and `README.md` credit the ASD ISM next to mSCP: (c) Commonwealth of Australia, CC BY 4.0, link to the ISM OSCAL repository and cyber.gov.au, modified by this project, the disclaimer, and the vendored path `sources/asd_ism/upstream/`. This is spec section 9.
- **Verification:**
  - From `webui/`: `bun run test`, `bun run lint`, `bun run build`, `bun run test:e2e` with a dev server running.
  - `python -m pytest -W error` when `baselines/` changes.
  - Playwright screenshots at about 375px and about 1280px, looked at with Read, for every visual change.
- **Commits:** subject is `type: summary`, with a why-body. No `Co-Authored-By` or AI attribution. No em dash (U+2014). Implementers commit; the controller pushes.

## Review Focus

- **Rapid clicking:** ten facet checkboxes toggled in quick succession all register. The final table matches the final filter state, and the spinner ends hidden. (e2e, Task A1)
- **URL round trip:** set search, two sources, a benchmark with severity, Version None, page 3 and size 100, then reload. Everything is restored. Clearing everything leaves a URL with no `?`. A shared URL with an unknown benchmark value loads without error and drops that value. (e2e, Task A2)
- **Page boundary inside a section:** with size 25 and an expanded ISM guideline holding more than 25 matching rules, page 2 starts with that guideline's header (and sub-section headers) repeated, followed by rule 26. (unit test on the pagination function, Task B1)
- **Expand and collapse one level:** applied repeatedly on mixed mSCP (depth 1) and ISM (depth 3) data, this walks depth 1 to 2 to 3 and back, and never leaves a section open whose parent is closed. (unit, Task B1)
- **Fixed row height:** an ISM row with 7 benchmarks and an mSCP row with 1 have the same rendered height at 1280px. (e2e bounding boxes, Task B2)

---

## Phase A: responsiveness, URL state, small UI changes, attribution

### Task A1: Non-blocking filters, stale indicator, filter order, None styling

**Files:**
- Modify: `webui/src/components/rules/RuleTable.tsx` (render from deferred filters and search; stale overlay and spinner)
- Modify: `webui/src/components/filters/FilterSidebar.tsx` (Source facet position; None label styling)
- Modify: `webui/e2e/smoke.spec.ts`

**Interfaces:**
- Produces, in `webui/src/state/filterStore.ts` (or a new `webui/src/hooks/useDeferredFilters.ts`): `useDeferredFilters(): { filters: FilterValues; isStale: boolean }`.

- [ ] **Step 1: Write the failing e2e tests.**
  - The Source facet heading sits between Version and Benchmark.
  - The "None" option label has the italic class.
  - **Rapid toggle:** click 10 different facet options quickly without waiting, then assert every one is checked, the count matches a fresh calculation (toggle the same set in one go after a reload and compare counts), and `role=status` `Updating rules` is eventually hidden.
  - The spinner shows while stale. Assert it appears after a click that changes 1,000+ rows and then disappears.
- [ ] **Step 2: Implement.** In `RuleTable`, read filters through `useDeferredValue`, and compute matching rows with `useMemo` over the deferred values. In `FilterSidebar`, keep the current (non-deferred) state for checked state. Facet counts may use current state; measure that facet computation stays under one frame on the full library (the earlier profile put it under about 15 ms).
- [ ] **Step 3: Verify.** Run the full web suite and take screenshots (sidebar, mid-update overlay).
- [ ] **Step 4: Commit** `feat: keep filters responsive while the rule table updates`.

### Task A2: Filters, search and paging in the URL

**Files:**
- Create: `webui/src/state/urlState.ts`, `webui/src/state/urlState.test.ts`
- Modify: `webui/src/state/filterStore.ts` (initial state from the URL; subscribe and write back), the search input owner, and `webui/e2e/smoke.spec.ts`

**Interfaces:**
- Produces, in `urlState.ts`:
  - `parseUrlState(search: string): UrlState`
  - `serializeUrlState(state: UrlState, defaults: UrlDefaults): string`, which returns `''` when everything is at its default.
  - `UrlState = { search: string; automation: string; targets: string[]; versions: string[]; sources: string[]; benchmarks: string[]; sections: string[]; tags: string[]; page: number; size: number | 'all' }`
- Page and size are read and written here; Task B1 adds paging and wires them in.

- [ ] **Step 1: Write the failing tests.**
  - Unit: a parse/serialize round trip over every key, repeated keys, and URL encoding of `macOS 27.0` and of the benchmark severity separator value (it contains `\u001f`, so encode it).
  - Unit: defaults serialize to `''`, unknown keys are ignored, and a non-numeric page falls back to 1.
  - e2e: the Review Focus URL round trip; clearing the filters gives `page.url()` without `?`; reload after a search.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify** with the full web suite.
- [ ] **Step 4: Commit** `feat: keep filters and search in the URL`.

### Task A3: ASD credit in NOTICE and README

**Files:** `NOTICE`, `README.md`

- [ ] **Step 1:** Add the ASD ISM section to `NOTICE`, mirroring the mSCP section (unmodified vendored copy at `sources/asd_ism/upstream/`, CC BY 4.0, (c) Commonwealth of Australia, the Coat of Arms and ASD logo exclusion, the disclaimer, and no endorsement). Update `README.md`'s source and licensing text and add an "Updating the ASD ISM rules" section (`python tools/import_asd_ism.py --tag <tag>`, review the diff, run the tests, commit).
- [ ] **Step 2: Commit** `docs: credit the ASD ISM in NOTICE and README`.

**Phase A review:** one task review over all of Phase A, then fixes, then push.

## Phase B: section tree, paging, benchmark cell

### Task B1: Collapsible section tree with paging and infinite scroll

**Files:**
- Create: `webui/src/logic/sectionTree.ts`, `sectionTree.test.ts` (pure tree, depth and paging logic)
- Create: `webui/src/state/sectionStore.ts` (expanded node ids, in memory)
- Create: `webui/src/components/rules/SectionToolbar.tsx`, `webui/src/components/rules/PagingBar.tsx`
- Modify: `webui/src/components/rules/RuleTable.tsx` (render the flattened visible list for the current page instead of per-section tables), `webui/src/state/urlState.ts` wiring (page and size), and `webui/e2e/smoke.spec.ts` (tests that expect visible rows first click **Expand all**)

**Interfaces**, in `sectionTree.ts`:
- `SectionNode = { id: string; label: string; depth: number; ruleCount: number; children: SectionNode[]; rules: RuleRow[] }`. `id` is the `section_path` prefix joined with `\u001f`.
- `buildSectionTree(rows: RuleRow[], labelRoot: (code: string) => string): SectionNode[]`. Roots are sorted with the existing section ordering, deeper levels by title, and rules by title as today.
- `visibleItems(tree, expanded: ReadonlySet<string>): VisibleItem[]`, where `VisibleItem = { kind: 'section'; node } | { kind: 'rule'; row; depth }`.
- `paginate(items: VisibleItem[], size: number): Page[]`, where `Page = { items: VisibleItem[] }` and the ancestor headers are repeated per the Global Constraints.
- `expandOneLevel(tree, expanded): Set<string>`, `collapseOneLevel(tree, expanded): Set<string>`, `allNodeIds(tree): Set<string>`
- `searchExpanded(tree): Set<string>`: every node containing a rule. Used while search text is non-empty.

- [ ] **Step 1: Write the failing tests.**
  - Unit: tree building on mixed depth-1 and depth-3 rows.
  - Unit: the Review Focus page boundary case.
  - Unit: expand and collapse one level on mixed data.
  - Unit: a collapsed section contributes no rule items.
  - Unit: page count when everything is collapsed equals 1.
  - e2e: the initial view shows only root headers, all collapsed.
  - e2e: Expand one level, then rule rows of mSCP sections are visible and ISM level-2 headers are visible.
  - e2e: paging controls for size, next/previous, jump and `Page X of Y`.
  - e2e: Infinite scroll appends rows on scroll.
  - e2e: search auto-expands matches.
  - e2e: page and size persist in the URL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Measure.** Using a throwaway Node Playwright script, measure first load, a facet uncheck and a clear search, with everything expanded at size 50 and with Infinite scroll. Record the numbers.
- [ ] **Step 4: Restore parallel e2e.** Remove `workers: 1` and run `bun run test:e2e` five times. If all five pass, keep the default. Otherwise use the highest worker count that passes five in a row, with an honest comment.
- [ ] **Step 5: Verify.** Run the full web suite and take screenshots: the collapsed view, a nested ISM expansion, the paging bar at 375px and 1280px.
- [ ] **Step 6: Commit** `feat: collapsible section tree with paging and infinite scroll`.

### Task B2: Fixed-height benchmark cell and Benchmarks in the detail panel

**Files:**
- Modify: `webui/src/components/rules/RuleTable.tsx` (`BenchmarkText`)
- Create: `webui/src/components/ui/tooltip.tsx` (a thin Base UI Tooltip wrapper, matching the other `ui/` wrappers)
- Create: `webui/src/components/rules/RuleBenchmarks.tsx`; modify `RuleDetailPanel.tsx` (insert it above `RuleReferences`)
- Modify: `webui/e2e/smoke.spec.ts`

- [ ] **Step 1: Write the failing tests.**
  - e2e: the Review Focus equal row heights.
  - e2e: hovering an overflowing benchmark cell shows a tooltip with the full text.
  - e2e: the `asd_ism.ism-1667` details contain a `Benchmarks` heading above `References`, listing `ISM PROTECTED` and `Essential Eight ML3`.
  - e2e: an mSCP rule's details list `DISA STIG (medium)` under `macOS 15`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify.** Run the full web suite and take screenshots (a row with a fade, the tooltip, the details Benchmarks section) at 375px and 1280px.
- [ ] **Step 4: Commit** `feat: single-line benchmark cell with tooltip and benchmarks in rule details`.

**Phase B review:** one task review over all of Phase B, then a final whole-branch review on the most capable model across Phases A and B, then fixes, docs (design section 11 gate closed; section 13 index-split note), and push.

## Phase C: custom overlay rules (design first)

Not planned yet. After Phase B, brainstorm with the maintainer. Starting brief from 2026-10-23:
- maintainer-authored rule files that overlay checks or scripts (Windows and macOS) onto imported rules;
- one overlay can target many rules across sources by id;
- each targeted rule records the source release it was written against, and the UI shows a small "written for an older release, review for accuracy" warning on overlaid content when the release differs.

## Progress log

- 2026-10-23: Plan written (no code yet).
