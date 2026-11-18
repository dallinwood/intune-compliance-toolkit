# Unified Frameworks Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Rules, Frameworks and Coverage tabs into one Frameworks tab: a card grid home, per-framework pages with Rules / Releases / Coverage sub-tabs, and per-pair coverage reports with a cap ("max N") line plus a combined report.

**Architecture:** One `frameworks` view; the framework and sub-tab live in the query string (`?framework=mscp&tab=coverage`). Legacy `/rules` and `/coverage` addresses are rewritten on load. Coverage reuses `frameworkCoverage` from `logic/selectionCoverage.ts`, run once for the cap (every rule of the covering framework counted as selected) and once for the user's selection.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Base UI, Zustand, Vitest, Playwright. **Bun for everything** (`bun run test`, `bun run lint`, `bunx tsc -b`, `bun run dev`, `bun run test:e2e`).

**Spec:** `docs/plans/2026-11-18-unified-frameworks-design.md` (read it before any task). Mockup: `.superpowers/brainstorm/frameworks-unify/mockups-v1.html`, layout B and coverage option 2.

## Global Constraints

- All commands run from `webui/` with Bun. No new dependencies.
- `bun run test:e2e` previously needed real Node (Bun 1.3.14 Windows bug, see `docs/plans/2026-08-17-web-ui-mvp-plan.md`). Node is not installed on this machine. Run it with Bun; if it fails with what looks like that bug, stop and report it, do not install Node or patch around it.
- Never use the em dash character in code, copy or docs. Use a hyphen.
- Comments only for a *why* the code cannot express. Full descriptive names, no single letters, including loop variables.
- Commit message style `type: summary`; no Co-Authored-By or AI attribution lines. Push after each commit (branch `macos-compliance-framework-rebase`, not `main`).
- Every task touching rendering: Vitest + lint + `bunx tsc -b` + e2e, plus ad hoc Playwright screenshots at 1280x800 and 375x800, light and dark, with scrollbars visible (`chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })`), read with the Read tool. Dev server: `bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`.
- Add a `## Progress log` entry to this plan (date, one or two sentences, short hash + subject) with each task's commit.
- Copy fixed by the spec: cap label `max N` (formatted with `formatCount`, e.g. `max 140`); within-reach heading `Within reach of {A} - {N} controls`; toggle labels `All rules` / `Your selection`; combined title `All mapped frameworks`; pair titles `{A} → {B}` on A's side and `Supported by {A}` on B's side; related pairs `Related to {X}` with `related only`; home link `Browse all rules`.

## Review Focus

1. A selection bar exceeding its cap line (selection from several frameworks, supporting checks on/off, Automated checks only on). Expected: never. Pinned in Task 1 (`selection never exceeds cap` property-style test).
2. Old bookmarks: `/rules?q=foo&source=mscp`, `/coverage`, `/frameworks?framework=mscp&from=a&to=b`. Expected: land on the matching new page with filters kept, one history entry, no back-button loop. Pinned in Task 2.
3. A framework with no mappings, or a library where mapping loading failed (empty `byRule`). Expected: no coverage block on its card, no Coverage sub-tab, no crash. Pinned in Tasks 1 and 5.
4. `?framework=nonsense` or `?framework=mscp&tab=nonsense` or `?framework=all&tab=coverage`. Expected: grid for an unknown framework; `rules` for a bad tab. Pinned in Task 2.
5. Related links are symmetric (`direction: 'related'` on both ends). Expected: one related pair per framework pair, shown as `Related to X` on both cards, never twice. Pinned in Task 1.

## Design calls made while planning (not in the spec)

- **Related pairs are unordered.** Related links carry no direction, so a related-only pair is stored once with both frameworks and shown as `Related to {other}` on each side. A related pair still counts as a covering framework for B's combined report (so ISM gets a combined bar from mSCP + E4EIT).
- **Pair discovery for supports pairs** uses `supportChain(ruleId, byRule, 'supports')` from every rule of A and records each reached rule's `sourceName` (excluding A).
- **Supporting checks in the cap:** cap input selects every rule of A (or every rule of every covering framework for combined) and includes every offered supporting check (`includedSupportingRuleIds` = `supportingRuleIdsIfAdded` = all offers from `supportingCheckOffers` with includeSupporting on, no overrides). Selection input computes offers from the restricted selected set with the user's real choices.

---

### Task 1: Pair discovery and cap/selection coverage logic

**Files:**
- Create: `webui/src/logic/frameworkPairs.ts`
- Test: `webui/src/logic/frameworkPairs.test.ts` (reuse fixtures in `logic/testRuleFixtures.ts` and the mapping fixture style of `selectionCoverage.test.ts`)

**Interfaces:**
- Consumes: `frameworkCoverage`, `CoverageInput`, `FrameworkCoverage`, `ALL_CONTROLS_SCOPE` (`logic/selectionCoverage.ts`); `supportChain` (`logic/indirectMappings.ts`); `supportingCheckOffers`, `includedSupportingRuleIds`, `wouldIncludeSupportingRuleIds`, `SupportingCheckChoices` (`logic/supportingChecks.ts`).
- Produces:
  ```ts
  export interface SupportsPair { kind: 'supports'; coveringSource: string; coveredSource: string }
  export interface RelatedPair { kind: 'related'; sources: [string, string] } // sorted with compareText
  export type FrameworkPair = SupportsPair | RelatedPair
  export function frameworkPairs(rows: readonly RuleRow[], byRule: ReadonlyMap<string, MappedRule[]>): FrameworkPair[]
  // A related pair is dropped when the same two frameworks already form a supports pair (either direction).
  export function coveringSourcesOf(pairs: readonly FrameworkPair[], coveredSource: string): string[]
  export function supportsPairsCovering(pairs: readonly FrameworkPair[], coveringSource: string): SupportsPair[]
  export interface SelectionSettings { selectedRuleIds: ReadonlySet<string>; automatedOnly: boolean; choices: SupportingCheckChoices }
  export interface CappedCoverage { cap: FrameworkCoverage; selection: FrameworkCoverage }
  export function pairCoverage(rows: readonly RuleRow[], byRule: ReadonlyMap<string, MappedRule[]>, pair: SupportsPair, settings: SelectionSettings, scope: string): CappedCoverage
  export function combinedCoverage(rows: readonly RuleRow[], byRule: ReadonlyMap<string, MappedRule[]>, coveredSource: string, coveringSources: readonly string[], settings: SelectionSettings, scope: string): CappedCoverage
  export function capCount(coverage: FrameworkCoverage): number // covered + coveredThroughSupporting
  ```

- [ ] **Step 1: Write failing tests** in `frameworkPairs.test.ts`:
  - `frameworkPairs finds a direct supports pair`: rule `a.r1` supports `b.c1` → `[{ kind: 'supports', coveringSource: 'a', coveredSource: 'b' }]`.
  - `frameworkPairs finds a transitive supports pair`: `a.r1` supports `c.x1`, `c.x1` supports `b.c1` → pairs contain a→c, c→b and a→b.
  - `frameworkPairs records a related link once`: `e.r1` related `b.c1` (entries on both rules, `direction: 'related'`) → exactly one `{ kind: 'related', sources: ['b', 'e'] }`.
  - `frameworkPairs returns nothing for empty mappings`: `new Map()` → `[]`.
  - `coveringSourcesOf includes supports and related partners`: pairs a→b supports, related [b,e] → `coveringSourcesOf(pairs, 'b')` equals `['a', 'e']`.
  - `pairCoverage cap counts every rule of the covering framework`: two `a` rules each supporting a distinct `b` control, nothing selected → `capCount(cap) === 2`, `selection.covered === 0`, `cap.total` equals the number of `b` rows.
  - `pairCoverage selection counts only the covering framework's rules`: select `a.r1` and `d.r9` (d also supports a b control) → `selection.covered === 1`.
  - `selection never exceeds cap`: for every subset of a 4-rule fixture (a rules, a d rule, a manual b-adjacent control with an automated supporter), with automatedOnly true and false, and includeSupporting true and false: `capCount(selection) <= capCount(cap)` for both `pairCoverage` and `combinedCoverage`.
  - `combinedCoverage selection uses the whole selection`: select `a.r1` and `e`'s rule linked by supports into b → covered counts both.
  - `scope narrows total, cap and selection`: with a benchmark on one `b` control, scope = that benchmark → `cap.total === 1`.

- [ ] **Step 2: Run** `bun run test src/logic/frameworkPairs.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `frameworkPairs.ts` per the Interfaces block and the "Design calls" section. Build each `CoverageInput` from `SelectionSettings`: restricted selected ids, offers via `supportingCheckOffers(rowsById, byRule, restrictedIds)`, `includedSupportingRuleIds` and `wouldIncludeSupportingRuleIds` from the user's choices for the selection run, all offer ids for the cap run.

- [ ] **Step 4: Run** `bun run test` and `bunx tsc -b` → all pass.

- [ ] **Step 5: Commit** `feat: compute framework pairs and capped coverage`; push.

### Task 2: URL state for framework pages and legacy redirects

**Files:**
- Modify: `webui/src/state/urlState.ts`, `webui/src/state/filterStore.ts`
- Test: `webui/src/state/urlState.test.ts` (extend; create if absent), `webui/src/state/filterStore.test.ts` if it exists

**Interfaces:**
- Produces:
  ```ts
  export type FrameworkTab = 'rules' | 'releases' | 'coverage'
  export const ALL_FRAMEWORKS = 'all'
  export const DEFAULT_VIEW_ID = 'frameworks'
  // UrlState gains: frameworkTab: FrameworkTab | null  (query param `tab`; null when absent or invalid)
  export function migrateLegacyView(state: UrlState): UrlState
  // FilterState gains: frameworkTab, setFrameworkPage(framework: string | null, tab: FrameworkTab | null)
  // showComparison(framework, from, to) now also sets frameworkTab: 'releases'
  // closeComparison() keeps working: clears framework, tab and comparison
  ```
- `migrateLegacyView`: view `rules` → `{ view: 'frameworks', framework: 'all', frameworkTab: 'rules' }`, other fields kept; view `coverage` → `{ view: 'frameworks', framework: null, frameworkTab: null }`; view `frameworks` with `framework` set, `from`/`to` set and no `tab` → `frameworkTab: 'releases'`. Anything else unchanged.
- Resolution of unknown framework and bad tab happens in the view (Task 4), not here, because the store does not know the sources.

- [ ] **Step 1: Write failing tests:** parse `?framework=mscp&tab=coverage` → `frameworkTab: 'coverage'`; `tab=nonsense` → `null`; serialize round-trips `tab`; `migrateLegacyView` for `/rules?q=foo&source=mscp` keeps `search: 'foo'`, `sources: ['mscp']` and gives framework `all`, tab `rules`; `/coverage` → grid; `/frameworks?framework=mscp&from=a&to=b` → tab `releases`; a bare base path parses to view `frameworks`; `startsHistoryEntry` is true when `framework` or `frameworkTab` changes between two non-null values.
- [ ] **Step 2: Run** tests → FAIL.
- [ ] **Step 3: Implement.** Apply `migrateLegacyView` inside `stateFromLocation` in `filterStore.ts` so the first write (already `replaceState` at startup) rewrites the address in place.
- [ ] **Step 4: Run** `bun run test`, `bunx tsc -b`, `bun run lint` → pass. (The app will still render the old tabs until Task 3; that is fine.)
- [ ] **Step 5: Commit** `feat: add framework sub-tab to the URL and rewrite legacy view addresses`; push.

**Review checkpoint A (full review):** after Task 2, one reviewer covers Tasks 1 and 2 together against the spec.

### Task 3: One Frameworks tab with framework pages and sub-tabs

**Files:**
- Modify: `webui/src/views/viewRegistry.tsx`, `webui/src/views/viewRegistry.test.tsx`, `webui/src/views/FrameworksView.tsx`, `webui/src/views/RulesView.tsx`, `webui/src/components/layout/AppShell.tsx`, `webui/src/components/filters/FilterSidebar.tsx`, `webui/src/components/frameworks/ReleaseComparisonView.tsx` (default range only), `scripts/route-pages.mjs`
- Create: `webui/src/components/frameworks/FrameworkPage.tsx`
- Delete: `webui/src/views/CoverageView.tsx` after its content moves (Task 5 owns the move; in this task the Coverage sub-tab renders the existing `CoverageView` body unchanged)

**Interfaces:**
- Consumes: `FrameworkTab`, `ALL_FRAMEWORKS`, `setFrameworkPage` (Task 2).
- Produces: `FrameworkPage({ source, context }: { source: ManifestSource | 'all'; context: ViewContext })` with sub-tabs; `FilterSidebar` gains `hideSourceFacet?: boolean`; `ViewContext` unchanged.

Behaviour:
- `VIEWS` = Frameworks (default, first), Licences, Products. `route-pages.mjs` `VIEW_IDS` = `['frameworks', 'licences', 'products', 'rules', 'coverage']` (legacy pages kept so old links load); update the registry test to expect the registry ids followed by `LEGACY_VIEW_IDS = ['rules', 'coverage']`, exported from `viewRegistry.tsx`.
- `FrameworksView`: `framework === null` or unknown → grid (`FrameworkCards`, unchanged until Task 6). Otherwise `FrameworkPage`. A tab not allowed for the page (`all` only allows `rules`; a framework with no pairs has no `coverage`) or `null` → `rules`.
- Sub-tabs as links (`<a>` with the page's href, plain left click calls `setFrameworkPage`), so they open in a new tab too. Use the same tab styling as `ViewTabs`.
- Rules sub-tab: today's `RulesView` content. When scoped to a framework, AppShell filters rows with `sources` replaced by the empty set and then `row.sourceName === framework`; the `sources` set in the store is untouched; `FilterSidebar hideSourceFacet`. Header shows the rule count, `SkipToRulesLink`, and the Filters toggle only on the Rules sub-tab (and the Releases sub-tab, which has its own sidebar).
- `SelectionToolbar` shows on every Frameworks page; Generate opens the review screen in place of the current Frameworks page content and Back returns to it.
- Releases sub-tab: `ReleaseComparisonView`; with `compareFrom`/`compareTo` null it shows the current release against the previous one.
- Page header: framework display name, current release label, rule count, and a link back to the grid.

- [ ] **Step 1: Update** `viewRegistry.test.tsx` and add a render-free test for the tab-resolution helper: `resolveFrameworkTab(tab: FrameworkTab | null, isAll: boolean, hasCoverage: boolean): FrameworkTab` (export from `FrameworkPage.tsx` or a small `logic/frameworkTabs.ts`) covering `all`+`coverage` → `rules`, no-coverage+`coverage` → `rules`, `null` → `rules`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the behaviour above.
- [ ] **Step 4: Verify:** `bun run test`, `bunx tsc -b`, `bun run lint`; update `e2e/smoke.spec.ts`, `e2e/frameworks.spec.ts`, `e2e/filter-sidebar.spec.ts` and any spec that navigates to `/rules` or clicks the Rules/Coverage tabs, then `bun run test:e2e`; screenshots per Global Constraints of the grid, `?framework=all&tab=rules`, `?framework=mscp&tab=rules`, `?framework=mscp&tab=releases`.
- [ ] **Step 5: Commit** `feat: merge Rules and Coverage into the Frameworks tab`; push.

### Task 4: Coverage bar with cap line

**Files:**
- Modify: `webui/src/components/selectionCoverage/CoverageBar.tsx`, `webui/src/logic/selectionCoverage.ts` (label helper)
- Test: `webui/src/logic/selectionCoverage.test.ts`

**Interfaces:**
- Produces: `CoverageBar` gains optional `capCount?: number` and `capLabel?: string`; when set, renders an absolutely positioned 2px vertical line at `capCount / total` with `capLabel` (e.g. `max 140`) above it, visible in both themes (add a `--meter-cap` token next to the existing meter tokens in `index.css`). `export function cappedBarLabel(counts: { covered: number; coveredThroughSupporting: number; relatedOnly: number; total: number }, capCount: number): string` = `coverageBarLabel(counts)` + `, max ${formatCount(capCount)} with current mappings`.

- [ ] **Step 1: Test** `cappedBarLabel({ covered: 82, coveredThroughSupporting: 9, relatedOnly: 30, total: 1014 }, 140)` equals `'82 supported directly, 9 through supporting rules, 30 related only, of 1,014, max 140 with current mappings'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** The bar needs vertical room for the label: add top padding only when `capLabel` is set, and keep the label inside the bar's box at narrow widths (flip it to the left of the line when the line is past 80%).
- [ ] **Step 4: Run** unit tests, tsc, lint. **Step 5: Commit** `feat: show the mapping cap on coverage bars`; push.

(Light review only: small, isolated.)

### Task 5: Coverage sub-tab reports

**Files:**
- Create: `webui/src/components/selectionCoverage/PairCoverageReport.tsx`, `webui/src/components/selectionCoverage/RelatedPairNote.tsx`, `webui/src/components/frameworks/FrameworkCoverageTab.tsx`
- Modify: `webui/src/components/selectionCoverage/FrameworkCoverageCard.tsx` (extract `SectionRow` list and the supporting-checks notes so both use them), `webui/src/components/frameworks/FrameworkPage.tsx`
- Delete: `webui/src/views/CoverageView.tsx`
- Test: `webui/e2e/coverage.spec.ts` (rewrite), `webui/e2e/supporting-checks.spec.ts` (update navigation)

**Interfaces:**
- Consumes: Task 1 functions, Task 4 `CoverageBar` props.
- Produces: `PairCoverageReport({ title, coveringLabel, capped, mode, onModeChange, scope, onScopeChange, scopes })` where `capped: CappedCoverage`, `mode: 'all-rules' | 'selection'`.

Behaviour (spec, "Coverage reports"):
- Whole-framework bar: `CoverageBar` over `total` with `capCount = capCount(capped.cap)`, `capLabel = max N`, segments from the selected mode's coverage.
- Within-reach bar: `CoverageBar` with `total = capCount(cap)`, no related segment, heading `Within reach of {A} - {N} controls`, right side `{percent}% of the cap` (`Math.round`), footer `{direct} direct · {through} through supporting checks` and `{cap - covered} still to go`. When cap is 0, show `No controls within reach yet` instead of the bar.
- Toggle `All rules` / `Your selection` (default `Your selection`) as a two-button group with `aria-pressed`. `All rules` shows the cap coverage in both bars.
- Scope picker, Automated checks only checkbox, per-section breakdown, "Add supporting checks" offer and supporting-checks note all as in today's card, driven by the selected mode.
- `FrameworkCoverageTab` for framework X lists: every supports pair with X covering (`X → B`), every supports pair with X covered (`Supported by A`), related pairs as `RelatedPairNote` (`Related to {other}`, single grey bar of related controls over X's total, text `related only`, no cap), then, when `coveringSourcesOf(pairs, X).length >= 2`, a divider and the `All mapped frameworks` report via `combinedCoverage`. Then today's "selected rules that support no control" block.
- Automated checks only and the toggle are per tab (component state), not in the URL.

- [ ] **Step 1: Rewrite** `e2e/coverage.spec.ts` for `?framework=asd_ism&tab=coverage` (Supported by mSCP report with `max 61` text, Related to ASD E4EIT note, All mapped frameworks report) and `?framework=mscp&tab=coverage` (mSCP → NIST 800-53 with `max 140`, mSCP → ASD ISM with `max 61`, no combined report); selecting one mSCP rule raises its pair's selection; toggle `All rules` shows `100% of the cap`.
- [ ] **Step 2: Run** `bun run test:e2e` for that spec → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** full suite, tsc, lint, e2e; screenshots per Global Constraints of both coverage tabs.
- [ ] **Step 5: Commit** `feat: per-pair and combined coverage reports on framework pages`; push.

### Task 6: Home cards with compact coverage

**Files:**
- Modify: `webui/src/components/frameworks/FrameworkCards.tsx`, `webui/src/views/FrameworksView.tsx`
- Test: `webui/e2e/frameworks.spec.ts`

Behaviour (spec, "Home: framework cards"): `Browse all rules` link above the grid (`?framework=all&tab=rules`); each card keeps title, current release, rule count and the release buttons (now opening the Releases sub-tab); adds a compact coverage block: `→ {B}` lines for pairs X covers, `Supported by {A}` lines, `Related to {other}` lines, then `All mapped frameworks` under a divider when X has two or more covering frameworks. Each supports line is a compact `CoverageBar` (h-2) with the `max N` cap label and the user's selection; no toggle. Cards end with `Rules` and `Coverage` links (`Coverage` only when X has pairs). Cards use the all-controls scope and the user's real supporting-check choices, Automated checks only off. Memoise caps per pair at the view level.

- [ ] **Step 1: Extend** `e2e/frameworks.spec.ts`: mSCP card shows `max 140` and `max 61`; ASD ISM card shows `All mapped frameworks`; NIST card does not; `Browse all rules` lands on `?framework=all&tab=rules`; a release button lands on the Releases sub-tab.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.**
- [ ] **Step 4: Verify** full suite, tsc, lint, e2e; screenshots per Global Constraints of the grid (check the cap labels do not collide at 375px).
- [ ] **Step 5: Commit** `feat: show coverage summaries on framework cards`; push.

### Task 7: Finish

- [ ] Search the repo for leftover references to the old tabs (`'coverage'` view id, `DEFAULT_VIEW_ID` assumptions, copy saying "Rules view" or "Coverage view", README screenshots/text) and update them.
- [ ] Update the spec status to `Implemented` and add the final progress log entry.
- [ ] Commit `docs: log the unified Frameworks tab and close the plan`; push.

**Review checkpoint B (full review):** after Task 7, one whole-branch review covering Tasks 3-7 against the spec, including the Review Focus list.

## Progress log

- 2026-11-18: Design approved and plan written.
- 2026-11-18: Task 1 done: framework pair discovery plus capped (cap vs selection) coverage logic in logic/frameworkPairs.ts, with a subset-sweep test that the selection never exceeds the cap. Landed in "feat: compute framework pairs and capped coverage".
- 2026-11-18: Task 2 done: `tab` sub-tab in the URL state and filter store (`setFrameworkPage`, `showComparison` opens Releases), `migrateLegacyView` applied on load so /rules, /coverage and old comparison links rewrite in place. The default view is now `frameworks`; `RULES_VIEW_ID` keeps the old Rules callers working until Task 3. Landed in "feat: add framework sub-tab to the URL and rewrite legacy view addresses".
- 2026-11-18: Task 1 review fixes: the cap now honours Automated checks only, and the combined selection uses the user's whole selection instead of only the covering frameworks. Landed in "fix: honour Automated checks only in coverage caps and widen the combined selection".
- 2026-11-18: Review fix for Task 2: switching framework page now clears the release comparison range and filters (kept when only the tab changes). Landed in "fix: clear release comparison state when switching framework page".
