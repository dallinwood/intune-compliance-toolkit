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

### Task 7: Rules table tweaks - icon key dialog and select-all checkbox

#### Part A: Icon key button and dialog

Requested by the user mid-plan (2026-11-18): replace the inline status key above the rules table with a **Key** button that opens a dialog, like the footer's "Sources & licences" dialog, listing every status icon actually present in the rules, grouped under headings by meaning.

**Files:**
- Create: `webui/src/logic/ruleStatusKey.ts`, `webui/src/logic/ruleStatusKey.test.ts`, `webui/src/components/rules/RuleStatusKeyDialog.tsx`
- Modify: `webui/src/components/rules/RuleTable.tsx` (the `trailing={<RuleStatusLegend />}` slot), `webui/e2e/rule-status-icons.spec.ts`
- Delete: `webui/src/components/rules/RuleStatusLegend.tsx` (and its `data-testid="rule-status-legend"` uses in e2e)

**Interfaces:**
- Consumes: `targetIconsOf`, `targetIconFor`, `NO_TARGET_ICON`, `LINK_ICON` (`logic/targetIcons.ts`); `linkStatusCounts`, `CheckStatus` (`logic/ruleStatusIcons.ts`); `StatusGlyph` (`components/rules/StatusGlyph.tsx`); the `Dialog` components used by `components/layout/AttributionFooter.tsx`.
- Produces:
  ```ts
  export interface StatusKeyEntry { kind: 'target' | 'no-target' | 'link'; targetName?: string; status: CheckStatus; text: string }
  export interface StatusKeyGroup { heading: 'Automated check' | 'Manual check' | 'Linked rules'; entries: StatusKeyEntry[] }
  export function statusKeyGroups(rows: readonly RuleRow[], byRule: ReadonlyMap<string, MappedRule[]>, rowsById: ReadonlyMap<string, RuleRow>): StatusKeyGroup[]
  ```

Behaviour:
- Groups, in this order, each only when it has entries: **Automated check** (one entry per platform that has at least one automated rule, text = the platform's display label, e.g. "macOS", "Microsoft Windows"; plus "No platform" when an automated rule has no target), **Manual check** (same for manual), **Linked rules** ("Linked to automated rules", "Linked to manual rules", each only if some row has such a link).
- Platform entries sorted by display label; "No platform" last in its group.
- Rows used: the rules in the current page's scope (all rules on `framework=all`, that framework's rules on a framework page), **not** narrowed by the other filters, so the key does not change while filtering.
- Button: `Key` with a small icon, outline `xs` button, in the slot the inline legend used; accessible name `Icon key`. Dialog title `Icon key`; each group an `h3`-level heading with its glyphs (`StatusGlyph`) and texts in a list.

- [ ] **Step 1: Write failing tests** in `ruleStatusKey.test.ts`: automated macOS + manual Windows rows -> groups `Automated check: [macOS]`, `Manual check: [Microsoft Windows]` (use the real display label from `targetIconFor`), no `Linked rules` group; a manual row with no targets -> `Manual check` ends with `No platform`; a row linked to an automated rule -> `Linked rules: [Linked to automated rules]`; empty rows -> `[]`.
- [ ] **Step 2: Run** `bun run test src/logic/ruleStatusKey.test.ts` -> FAIL.
- [ ] **Step 3: Implement** the function and the dialog; replace the legend.
- [ ] **Step 4: Verify** full suite, `bunx tsc -b`, `bun run lint`; update `e2e/rule-status-icons.spec.ts` (open the Key dialog, see the `Automated check` heading and a `macOS` entry); `bun run test:e2e`; screenshots of the button and open dialog at 1280x800 and 375x800, light and dark, read with the Read tool.
- [ ] **Step 5: Commit** `feat: replace the inline status key with an icon key dialog`; push.

#### Part B: Select-all checkbox for the filtered rules

Requested by the user (2026-11-18). A checkbox at the top of the rules table's checkbox column (header position, standard select-all pattern) that ticks every rule in the current filtered view.

**Files:**
- Create: `webui/src/logic/selectAll.ts`, `webui/src/logic/selectAll.test.ts`
- Modify: `webui/src/state/selectionStore.ts` (bulk action), `webui/src/components/rules/RuleTable.tsx`, `webui/e2e/` (add `select-all.spec.ts` or extend the closest existing spec)

**Interfaces:**
- Produces:
  ```ts
  export type SelectAllState = 'checked' | 'unchecked' | 'indeterminate'
  export function selectAllState(visibleRefs: readonly RuleRef[], selections: SelectionMap): SelectAllState
  // selectionStore gains: setEnabledMany(refs: readonly RuleRef[], enabled: boolean) => void  (one store update)
  ```

Behaviour:
- "Current filtered view" = every row the table currently shows after search and filters (and after the Task 3 framework scope), across all pages and collapsed groups, not just the visible page.
- State: `checked` when every row in the view is enabled; `unchecked` when none is; `indeterminate` (Base UI checkbox's indeterminate state) when some are. It is derived, never stored, so it updates automatically when rows are ticked by hand or filters change. Empty view -> `unchecked` and disabled.
- Ticking it (from unchecked or indeterminate) enables every row in the view; unticking it (from checked) disables every row in the view. Rows outside the view are never touched. Disabling uses the same path as unticking a row (`enabled: false`), so organisation-defined values the user typed are kept.
- Example the user gave: filter down, tick select-all, clear the filter -> the box shows indeterminate (not all selected), and exactly the rows from the filtered view stay ticked.
- Accessible name `Select all rules in this view`; with `aria-checked="mixed"` when indeterminate.

- [ ] **Step 6: Write failing tests** in `selectAll.test.ts`: all enabled -> `checked`; none -> `unchecked`; one of two -> `indeterminate`; an entry present but `enabled: false` counts as not selected; empty refs -> `unchecked`. And a store test: `setEnabledMany` on two refs enables both and keeps an existing `odvValue`.
- [ ] **Step 7: Run** -> FAIL. **Step 8: Implement** and wire the header checkbox.
- [ ] **Step 9: Verify** full suite, tsc, lint; e2e: search to narrow the table, tick select-all, clear search -> header checkbox is `mixed`, ticked count equals the narrowed count; tick every row of a small filtered view by hand -> header checkbox becomes checked. Screenshots of the header checkbox in all three states at 1280x800 and 375x800.
- [ ] **Step 10: Commit** `feat: add a select-all checkbox for the filtered rules`; push.

### Task 8: Finish

- [ ] Fix the Task 3 loose ends, each with a test:
  - The all-rules page's filter sidebar overflows by about 86px at 1280x800 with the stacked header. Make it fit again (tighten the header/sidebar spacing) and move the "filter list fits" e2e test back to 1280x800.
  - Old bare-base Rules links (`/?q=..`, `/?rule=..`, or any Rules filter parameter on the bare base path) land on the card grid. In `migrateLegacyView`, send a bare-base address carrying Rules parameters (`q`, `rule`, `source`, `target`, `version`, `benchmark`, `section`, `tag`, `automation`, `page`, `size`) to `framework: 'all', frameworkTab: 'rules'`.
  - "Clear filters" on a framework page empties the hidden `sources` set. Spec: sources is left untouched while scoped. Keep `sources` when clearing on a framework page.
  - The Generate review's back button says "Back to rules". Make it name where it returns (e.g. "Back to {framework}" or "Back to all rules").
  - The "All mapped frameworks" combined report (cards and Coverage sub-tab) appears only when TWO OR MORE frameworks have a *supports* pair into the covered framework. Related-only partners no longer count toward that threshold (ISM today has mSCP supports + E4EIT related, so its combined bar duplicated the mSCP bar). Related partners still get their own "Related to X" line. Add a unit/e2e test: ISM shows no combined report with today's data; a fixture with two supporting frameworks shows it. Update the spec's "Combined report" section and the "Data today" note to match.
  - Covering-side pair titles change from "→ {B}" to "Supports {B}" (cards and Coverage sub-tab); covered side stays "Supported by {A}". Update e2e assertions and the spec's copy.
  - "Related to {X}" lines get a short secondary note: "linked as related, not counted as coverage".

- [ ] Search the repo for leftover references to the old tabs (`'coverage'` view id, `DEFAULT_VIEW_ID` assumptions, copy saying "Rules view" or "Coverage view", README screenshots/text) and update them.
- [ ] Update the spec status to `Implemented` and add the final progress log entry.
- [ ] Commit `docs: log the unified Frameworks tab and close the plan`; push.

### Task 9: Section breakdown follows the cap, and a section drill-down

Requested by the user (2026-11-18) after seeing the Coverage sub-tab.

Behaviour:
- Section breakdown of a pair report (and the combined report) lists only sections of the covered framework B that the covering framework(s) have at least one mapping into, computed in the current mode: with "Automated checks only" on, sections reachable only through manual rules drop out. Sections ordered by their cap, largest first (ties by section order).
- Each section row's bar gets its own cap line (the section's max: controls in that section reachable with current mappings, honouring Automated checks only). The number is not printed; it shows on hover/focus (tooltip) and is in the bar's aria-label.
- Opening a section (replaces "Show x uncovered"):
  - On the covering framework's page (title "Supports {B}"), for every pair report shown there (e.g. on mSCP's page both "Supports ASD ISM" and "Supports NIST SP 800-53"): list only the covering framework's own rules that map into this section. Selected (enabled) rules first, unselected below greyed out. Each row: checkbox (enables/disables the rule in the selection, same store path as the rules table, ODV values kept), rule id + title as a button opening a rule dialog, and a secondary line "Supports {control ids}" listing the B controls in this section it maps to.
  - On the covered framework's page (title "Supported by {A}") and in the combined report: list all of this section's B controls, selected first, unselected greyed below, same checkbox and rule dialog; secondary line shows coverage status (covered directly / through supporting checks / related only / not covered).
- Rule dialog: same Dialog pattern as "Sources & licences" and the Icon key; content reuses the existing rule detail panel (RuleDetailPanel) for that rule.
- Coverage bars update immediately when a checkbox in the drill-down changes.

- [ ] Write failing unit tests for the section cap/visibility/ordering logic (sections with cap 0 hidden; automatedOnly drops manual-only sections; ordered by cap desc) and an e2e for the drill-down on both sides (mSCP page lists mSCP rules with checkboxes; ticking one raises the pair's selection bar; clicking a rule opens the dialog; ISM page lists ISM controls).
- [ ] Implement; verify full suite, tsc, lint, e2e; screenshots of an opened section on both sides at 1280x800 and 375x800, light and dark, read with Read.
- [ ] Commit `feat: section caps and a rule drill-down in coverage reports`; push.

### Task 10: "Linked to" filter in the rules sidebar

Requested by the user (2026-11-18): filter a rule list to rules linked to a given framework (e.g. on mSCP's Rules page, all mSCP rules linked to ASD ISM).

Behaviour:
- New facet "Linked to" in the filter sidebar (follow the existing facet pattern in components/filters/FilterSidebar.tsx and logic/ruleFilters.ts: option counts, multi-select OR within the facet, AND with other facets, retainKnownValues drops unknown values from a shared URL).
- A rule is "linked to" framework F when any mapping path - direct (supports in either direction, or related) or indirect (the same indirect paths the rule details panel shows, logic/indirectMappings.ts) - reaches a rule whose sourceName is F, F != the rule's own sourceName.
- Options: frameworks present in the current rows' links, labelled with the sources vocabulary label; a framework is never offered on its own framework page for its own rules.
- URL parameter `linked` (repeatable), serialized/parsed in urlState.ts like `source`; included in the legacy-Rules-parameter list used by migrateLegacyView.
- Precompute each rule's linked-framework set once per (rows, byRule) (memoised), not per filter change.

- [ ] Failing unit tests: direct supports link, reverse (supported-by) link, related link, indirect two-hop link each produce the linked framework; own framework excluded; URL round-trip of `linked`.
- [ ] Implement; full suite, tsc, lint; e2e: `?framework=mscp&tab=rules`, tick "Linked to: ASD ISM" -> count equals the number of mSCP rules with a path to ISM (assert > 0 and < 352); screenshots of the sidebar at 1280x800 and 375x800, light and dark.
- [ ] Commit `feat: add a Linked to filter for rules`; push.

#### Part B: Framework card tweaks (user request 2026-11-18)

- Move each card's `Rules` and `Coverage` links from the bottom of the card to the right of the card title, in the same row (title left, links right; wrap under the title at narrow widths, e.g. 375px). Make them larger than today's `xs` pills (use the `sm` button size). Same hrefs and click behaviour as now.
- Release list: when a framework has more than 4 releases, show only the newest 4 as buttons and put an `Older releases` menu button at the very left of the row. Opening it shows a small list (menu/popover, existing UI primitives) of the older releases, each opening that release's comparison exactly as the buttons do (real links, same accessible names). With 4 or fewer releases, nothing changes (today every framework has 4 or fewer, so the menu does not appear with real data).
- Tests: a unit test for the split (`splitReleases(releases, visibleCount = 4): { older, visible }`, 5 releases -> 1 older + 4 visible newest, 4 -> 0 older); e2e for the moved links (card Rules/Coverage still navigate). Screenshots of the grid at 1280x800 and 375x800, light and dark; for the menu, a screenshot using a test fixture or a temporary dev-only override, reverted before committing.
- Commit `feat: put card links beside the title and fold older releases into a menu`; push.

**Review checkpoint B (full review):** after Task 10, one whole-branch review covering Tasks 3-10 against the spec, including the Review Focus list.

## Progress log

- 2026-11-18: Design approved and plan written.
- 2026-11-18: Task 1 done: framework pair discovery plus capped (cap vs selection) coverage logic in logic/frameworkPairs.ts, with a subset-sweep test that the selection never exceeds the cap. Landed in "feat: compute framework pairs and capped coverage".
- 2026-11-18: Task 2 done: `tab` sub-tab in the URL state and filter store (`setFrameworkPage`, `showComparison` opens Releases), `migrateLegacyView` applied on load so /rules, /coverage and old comparison links rewrite in place. The default view is now `frameworks`; `RULES_VIEW_ID` keeps the old Rules callers working until Task 3. Landed in "feat: add framework sub-tab to the URL and rewrite legacy view addresses".
- 2026-11-18: Task 1 review fixes: the cap now honours Automated checks only, and the combined selection uses the user's whole selection instead of only the covering frameworks. Landed in "fix: honour Automated checks only in coverage caps and widen the combined selection".
- 2026-11-18: Review fix for Task 2: switching framework page now clears the release comparison range and filters (kept when only the tab changes). Landed in "fix: clear release comparison state when switching framework page".
- 2026-11-18: Task 3 done: one Frameworks tab (Frameworks, Licences, Products); framework pages with Rules, Releases and Coverage sub-tabs (Coverage still the old view until Task 5), the all-rules page at `?framework=all&tab=rules`, rule links and the command palette repointed there, and `/rules` and `/coverage` pages kept for old links. Landed in "feat: merge Rules and Coverage into the Frameworks tab".
- 2026-11-18: Task 4 done: `CoverageBar` takes optional `capCount`/`capLabel` and draws a 2px cap line (new `--meter-cap` token, both themes) with its label flipping left past 80%; `cappedBarLabel` adds the cap to the accessible label. Not yet used anywhere, so the visual check lands with Task 5. Landed in "feat: show the mapping cap on coverage bars".
- 2026-11-18: Task 5 done: the Coverage sub-tab now shows one two-bar report per supports pair (`A → B` / `Supported by A`, whole framework with the `max N` cap line plus the within-reach bar, `All rules` / `Your selection` toggle, scope, sections), `Related to X` notes for related-only pairs and the `All mapped frameworks` report when two or more frameworks cover the page. CoverageView and FrameworkCoverageCard are gone; their section list and supporting-check notes live in `CoverageSections.tsx`. Landed in "feat: per-pair and combined coverage reports on framework pages".
- 2026-11-18: Task 6 done: the Frameworks home has a `Browse all rules` link and each card gains a compact coverage block (`→ B`, `Supported by A`, `Related to X`, and `All mapped frameworks` under a divider for two or more covering frameworks) built from per-pair caps memoised in FrameworksView, plus `Rules` and `Coverage` links. Landed in "feat: show coverage summaries on framework cards".
- 2026-11-18: Task 7 part A done: the inline status key above the rules table is now a `Key` button (accessible name `Icon key`) that opens a dialog listing the status icons present in the current page's rules (not narrowed by filters), grouped under Automated check, Manual check and Linked rules; `RuleStatusLegend` is gone. Landed in 1b76f10 "feat: replace the inline status key with an icon key dialog".
- 2026-11-18: Task 7 part B done: a select-all checkbox (`Select all rules in this view`, checked/mixed/unchecked derived from the selections) above the rules table ticks or unticks every rule in the filtered view across all pages and collapsed sections via the new one-update `setEnabledMany`; the shared Checkbox now draws a minus when indeterminate. Landed in "feat: add a select-all checkbox for the filtered rules".
- 2026-11-18: Task 8 loose ends fixed: the all-rules filter sidebar fits at 1280x800 again with the stacked header kept (tighter sidebar spacing, "filter list fits" test back at 1280x800), bare-base Rules links migrate to the all-rules page, Clear filters keeps the scoped `sources`, and the Generate review's back link names its destination. Landed in a726f69 "fix: close the Task 3 loose ends on the Frameworks tab".
- 2026-11-18: Task 8 coverage copy: the combined `All mapped frameworks` report needs two or more *supporting* frameworks (related-only partners no longer count; ISM shows none today), covering-side pair titles read `Supports B`, and `Related to X` lines carry a "linked as related, not counted as coverage" note. Spec and README updated to match. Landed in 6143422 "feat: count only supporting frameworks toward the combined report".
- 2026-11-18: Task 9 done: every report's section breakdown lists only sections within reach (cap above zero, honouring Automated checks only), ordered by section cap, each bar with its own cap line whose `max N` shows in a tooltip on hover or focus. Opening a section lists the covering framework's own rules (with clickable `Supports` control ids) on the covering side, or the section's controls with their status and provenance on the covered side and in the combined report; both lists put selected rules first, have selection checkboxes and open the rule in a detail dialog. Landed in "feat: section caps and a rule drill-down in coverage reports".
