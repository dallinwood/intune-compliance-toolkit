# UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the maintainer-reported Rules view problems (cramped icon key, double scrollbar, one-level buttons, lingering status tooltips) and the two maintainer-noted items (heavy supporting checks list, inconsistent Coverage numbers), then bring the views onto one set of components, tokens and formats.

**Spec:** `docs/plans/2026-11-13-ui-polish-design.md` (finding ids P1-1 ... P3-9 below refer to it). Conventions: `docs/ui-style-guide.md`.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Base UI, lucide-react, Vitest, Playwright. Run with Bun, except `test:e2e`, which needs real Node.

**Depends on:** nothing unlanded.

## Global Constraints

- No new dependencies. (`@axe-core/playwright` is recommended in the design, section 5, but needs the maintainer's go-ahead; do not add it under this plan.)
- Tokens only (style guide section 1). New tokens go in `:root`, `.dark` and `@theme inline`, with their contrast noted.
- Keep `data-testid`s and accessible names that e2e use unless a task says to change them; when pinned text changes, update the specs in the same commit.
- Never use the em dash character (U+2014) in code, copy or comments.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why"; match the surrounding code's idioms.
- Verification before calling a task done: `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`), plus ad hoc Playwright screenshots at 1280x800 and 375x800, light and dark, of every view the task touches, read with the Read tool (`.claude/CLAUDE.md`). Run Playwright with scrollbars visible (`chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })`) whenever a task touches layout, so a second scrollbar shows up in the screenshot.
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; never stage `.superpowers/`. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` in each task's commit.

---

### Task 1: Rules table chrome and tooltips (P1-1, P1-3, P1-4)

**Files:**
- Modify: `webui/src/components/rules/SectionToolbar.tsx`, `webui/src/components/rules/RuleTable.tsx`, `webui/src/components/frameworks/ReleaseComparisonView.tsx`, `webui/src/components/rules/RuleStatusLegend.tsx`, `webui/src/components/rules/RuleStatusIcons.tsx`, `webui/src/logic/ruleStatusIcons.ts` (+ test), `webui/src/logic/sectionTree.ts` (+ test), `webui/src/components/ui/tooltip.tsx`, `webui/src/components/layout/AppShell.tsx`
- Modify e2e: `webui/e2e/smoke.spec.ts` (`:1027-1050`, `:1153`), `webui/e2e/rule-status-icons.spec.ts`, `webui/e2e/frameworks.spec.ts`

**Behaviour:**
- [ ] `SectionToolbar` renders only "Expand all" and "Collapse all" (still `role="group" aria-label="Sections"`) and takes an optional `trailing` node rendered `ml-auto`. Row classes: `flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-2`.
- [ ] Remove the one-level props at both call sites (`RuleTable.tsx:156-157`, `ReleaseComparisonView.tsx:339-340`); delete `expandOneLevel` / `collapseOneLevel` from `sectionTree.ts` and their tests.
- [ ] `RuleTable` passes `<RuleStatusLegend />` as the toolbar's `trailing` node and drops the separate legend wrapper (`RuleTable.tsx:161-163`). Legend: `gap-x-5 gap-y-1`, entries `gap-2`, a "Key" label in `font-medium text-foreground`, `data-testid` unchanged.
- [ ] Strip tooltip: extract `stripTooltipShouldOpen(isOpen, reason)` into `logic/ruleStatusIcons.ts` (true only for `isOpen && reason === 'trigger-focus'`) and use it in `RuleStatusIcons.tsx:44`.
- [ ] Move the one `TooltipProvider` from `RuleTable.tsx:170-178` to wrap the `AppShell` content; add `collisionPadding={8}` to the tooltip positioner in `components/ui/tooltip.tsx`.

**Verification:**
- [ ] Vitest: `stripTooltipShouldOpen` returns false for every `false` input whatever the reason, true only for `true` + `'trigger-focus'`, false for `true` + `'trigger-hover'`.
- [ ] E2e: delete the one-level test, switch `:1153` to "Expand all" with recomputed counts; assert neither one-level button exists on `/rules` or a comparison. In `rule-status-icons.spec.ts`: hover three strips in sequence, move away, `getByRole('tooltip')` count 0; focus a strip, its combined tooltip shows, Escape gives 0; focus then Tab away gives 0; hovering one icon shows exactly one tooltip. Legend still found by test id.
- [ ] Screenshots: Rules at 1280 light/dark (toolbar and key on one line, key entries clearly separated), 375 light/dark (key wraps under the buttons); hover several strips then screenshot (no tooltip left), comparison toolbar.

### Task 2: One scrollbar on the Rules view (P1-2, P2-5, P2-6)

**Files:**
- Create: `webui/src/components/ui/disclosure-chevron.tsx`
- Modify: `webui/src/components/filters/FilterSidebar.tsx`, `webui/src/components/frameworks/ComparisonSidebar.tsx`, `webui/src/views/RulesView.tsx`, `webui/src/components/frameworks/ReleaseComparisonView.tsx` (its `main`), `webui/src/state/filterStore.ts` only if group open state needs to survive view switches (prefer local state), `webui/src/components/layout/AppShell.tsx` (skip link)
- Modify e2e: every spec that ticks a Version, Benchmark, Section or Tags facet (`smoke.spec.ts:126`, `:168`, `:354` and others found by grepping `sidebar-scroll-area` and facet labels), `frameworks.spec.ts`

**Behaviour:**
- [ ] `DisclosureChevron`: lucide `ChevronRight`, `size-4 shrink-0 text-muted-foreground transition-transform`, `rotate-90` when open, `aria-hidden`.
- [ ] `FacetGroup` becomes a disclosure: heading element keeps its level and text; inside it a `button` with `aria-expanded`, `aria-controls`, `DisclosureChevron`, the title, and when closed with selections "(N selected)". Options render in the controlled region; the labelled `role="group"` stays so "None" options remain distinguishable.
- [ ] Default open: Automation, Target, Source. Default closed: Version, Benchmark, Section, Tags. A group with any selected value (including values restored from the URL) starts open, and opens again whenever its selection goes from empty to non-empty; the person may still close it, and the heading then shows "(N selected)".
- [ ] Same for `ComparisonSidebar` (Releases and Kind of change open, Only rules that... open, Section and Benchmark closed).
- [ ] `aside aria-label="Filters"` on both sidebars. Add a visually hidden, focus-visible "Skip to rules" link as the first focusable element of the Rules view, targeting the table.
- [ ] `main` in `RulesView.tsx:175` and the comparison's `main` get `[scrollbar-gutter:stable]`.
- [ ] Replace the rule rows' text glyphs (`RuleTable.tsx:384-396`) and the `ChevronRight` in `SectionHeader` with `DisclosureChevron`; add it to the unmarked toggles in `FrameworkCoverageCard.tsx:111,137` and `ReleaseComparisonView.tsx:112`.

**Verification:**
- [ ] E2e helper `openFacetGroup(page, title)`; existing facet specs call it before ticking. New e2e at 1280x800 on the full library: sidebar scroll area `scrollHeight <= clientHeight`; `/rules?section=audit` starts with Section open and its option checked; closed group heading reads "Section (1 selected)" after collapsing it.
- [ ] E2e: the skip link is the first Tab stop on `/rules` and moves focus into the table.
- [ ] Screenshots with scrollbars visible: Rules at 1280x800 and 1366x768 light/dark (one scrollbar, at the window's right edge), Rules with Section and Tags opened (sidebar scrollbar appears, acceptable), a comparison, 375 light/dark with Filters open.

### Task 3: Generate and Coverage (P1-5, P1-6, P2-1, P2-2, P2-7, P2-10, P2-14)

**Files:**
- Create: `webui/src/lib/format.ts` (+ `format.test.ts`), `webui/src/components/ui/status-message.tsx`, `webui/src/components/ui/back-link.tsx`
- Modify: `webui/src/components/generate/SupportingCheckRow.tsx`, `SupportingChecksPanel.tsx`, `GenerateChecksPanel.tsx`, `GenerateReviewScreen.tsx`, `BundleGroupCard.tsx`, `webui/src/logic/selectionCoverage.ts` (+ test), `webui/src/components/selectionCoverage/CoverageBar.tsx`, `FrameworkCoverageCard.tsx`, `webui/src/views/CoverageView.tsx`, `webui/src/components/selection/ExportImportControls.tsx`, `webui/src/components/layout/AppShell.tsx` (rule count), `webui/src/components/frameworks/FrameworkCards.tsx`, `ReleaseComparisonView.tsx` (tiles, Message, back link), `webui/src/views/LicencesView.tsx`, `ProductsView.tsx`, `webui/src/components/rules/RuleTable.tsx` (empty text), `webui/src/components/filters/FilterSidebar.tsx` (facet counts), `webui/src/index.css` (meter tokens)
- Modify e2e: specs pinning "2567 of 2567 rules", "(s)" strings, "Back to browse", coverage headline numbers (about 49 lines; grep `of 2567\|(s)\|Back to browse\|Supports .* of`), `supporting-checks.spec.ts`, `coverage.spec.ts`, `generate-checks.spec.ts`

**Behaviour:**
- [ ] `lib/format.ts`: `formatCount(count)` (`Intl.NumberFormat('en-US')`) and `pluralize(count, singular, plural)` returning e.g. "1 rule" / "1,143 controls". Replace `COUNT_FORMAT` (`selectionCoverage.ts:269`) and `NUMBER_FORMAT` (`SupportingChecksPanel.tsx:24`).
- [ ] `coverageHeadline` and `coverageBarLabel` format every number in both branches.
- [ ] Every user-facing count uses `formatCount`; every "(s)" becomes `pluralize` ("3 bundles", "1 scripted rule", "3 rules need manual attestation", "1 rule, 0.5 KB of rules JSON", "Imported 2 rule selections.").
- [ ] Supporting checks list: one `divide-y` bordered list (`rounded-lg border border-border bg-card`), rows `flex items-start gap-3 px-3 py-2`, Change and Details as `Button variant="ghost" size="xs"` at the right of the first line; names, `data-rule-id` and `aria-label`s unchanged.
- [ ] "Note" severity chip uses `Badge variant="secondary"`; "Error" uses destructive tokens (P3-3).
- [ ] Meter tokens (`--meter-track`, `--meter-fill`, `--meter-fill-secondary`) per design P2-2; `CoverageBar` uses them with a 1px gap between segments. Confirm 3:1 for fill on track and track edge on `panel` in both themes with a contrast script (the design's section 3 method).
- [ ] Text actions (`TOGGLE_CLASS` copies, "Show 2 rules", "Review supporting checks", "N more") become `Button variant="link" size="xs"`; "Back to browse" becomes `BackLink` "Back to rules"; "All frameworks" uses `BackLink`.
- [ ] `StatusMessage` replaces the three local `Message` components and the ad hoc empty and loading paragraphs; wording per style guide section 8.

**Verification:**
- [ ] Vitest: `format.test.ts` (0, 1, 999, 1000, 1143, plural forms); `selectionCoverage.test.ts:397-398` expect "1,143"; existing headline tests still pass.
- [ ] E2e: update pinned strings; supporting-checks specs still find rows by `data-rule-id` and buttons by name; add one check that a supporting row's height is under 70px at 1280 (bounding box) so the list cannot regress to cards.
- [ ] Screenshots: Generate with 63 supporting checks (light/dark 1280, 375), Coverage before and after "Add supporting checks" (both numbers formatted), Coverage bars visible in dark, Frameworks cards, an empty filter result.

### Task 4: Consistency sweep (P2-3, P2-4, P2-8, P2-9, P2-11, P2-12, P2-13, P2-15, P3)

**Files:**
- Create: `webui/src/components/ui/page-title.tsx`, `webui/src/components/ui/native-select.tsx`, `webui/src/components/ui/card.tsx` (a `Card` wrapper with the style guide's classes)
- Modify: `webui/src/views/CoverageView.tsx`, `GenerateReviewScreen.tsx`, `ReleaseComparisonView.tsx`, `LicenceDetail.tsx`, `LicenceCompare.tsx`, `ProductDetail.tsx` (titles); `CodeBlock.tsx`, `IndirectMappedRules.tsx`, `RuleDetailPanel.tsx` (heading levels); `ProductList.tsx`, `LicenceList.tsx`, `LicencesView.tsx`, `ProductsView.tsx` (hidden `h2`, group row style, needs-review legend); `ComparisonSidebar.tsx`, `RuleHistoryTab.tsx`, `FrameworkCoverageCard.tsx`, `PagingBar.tsx`, `OrgDefinedValueInput.tsx` (selects); `FrameworkCards.tsx`, `LicenceDetail.tsx`, `LicenceList.tsx`, `AppShell.tsx`, `CommandPalette.tsx`, `FieldChangeList.tsx` (pills to Button/Badge); card and panel radii across `generate/`, `history/`, `selectionCoverage/`, `frameworks/`; gutters (`RuleTable.tsx` cells, `CoverageView.tsx:56`); `index.css` and `CodeBlock.tsx`, `CopyButton.tsx`, `FieldChangeList.tsx` (code tokens, P3-4); `components/ui/input.tsx` (P3-5); `RuleTable.tsx` (render the strip once, P3-6); `ReleaseComparisonView.tsx` (id on its own line, tile affordance, P3-1, P3-2)
- Modify e2e only where a heading level or role changes (`getByRole('heading', { level })` queries in `smoke.spec.ts`, `history.spec.ts`, `catalog.spec.ts`).

**Behaviour:**
- [ ] `PageTitle` (`h2 text-lg font-semibold`, optional subtitle and actions) on Coverage (no more second `h1`), Review & generate, comparison, licence, product and licence comparison.
- [ ] Headings never skip (design P2-4); Licences and Products get a visually hidden `h2`.
- [ ] `NativeSelect` replaces all five select stylings.
- [ ] Pills and chips per style guide section 5; cards per section 6 (`rounded-lg border bg-panel p-4`), controls `rounded-md`.
- [ ] One `px-4` gutter; Coverage full width like Frameworks; filter sidebars `w-64` at `md`, catalog trees `w-80`.
- [ ] Catalog group rows `text-sm font-medium text-foreground` with `DisclosureChevron`; a "● needs review" legend above the licence list.
- [ ] P3 items as listed in the design; skip P3-8 (phone header) unless it is free.

**Verification:**
- [ ] Vitest unchanged except where a helper moved.
- [ ] E2e: full suite green; adjust heading-level queries.
- [ ] A DOM check script (like the audit's) over every view: exactly one `h1`, no skipped heading levels, every `aside` named.
- [ ] Screenshots of every view at 1280 and 375, light and dark; compare against the audit's set for regressions (title sizes match, card corners match, gutters line up on 16px).

## Progress log


- 2026-11-13: Task 1 done. The icon key moved into the Rules toolbar row, "Expand one level" and "Collapse one level" removed everywhere with their logic, the strip tooltip now opens for keyboard focus only (it used to open on every close request, so tooltips piled up), and one TooltipProvider at the app shell keeps one tooltip open at a time. Commit: 7b5c826 fix: tidy the Rules toolbar and stop status tooltips piling up
- 2026-11-13: Mid-plan fix from the maintainer (P2-8, pulled forward). The organization-value select was transparent, so its option list was white in dark mode; all native selects now use `NativeSelect`, and `:root` declares `color-scheme: light` beside `.dark`'s dark. Commit: 88c445d fix: make native select option lists readable in dark mode
- 2026-11-13: Task 2 done. Facet groups are disclosures (Automation, Target and Source open, the rest closed unless they hold a selection), so the Rules sidebar no longer scrolls at 1280x800 and the page shows one scrollbar; both sidebars are named, `main` reserves a scrollbar gutter, "Skip to rules" is the first Tab stop, and `DisclosureChevron` replaces the text glyphs and unmarked toggles. Commit: e4e8607 fix: give the Rules view one scrollbar by collapsing long filter groups
- 2026-11-13: Task 3 done. `formatCount` and `pluralize` used for every count, supporting checks as one divided list (about 56px per row), Note and Error chips fixed, coverage bars on new meter tokens with striped through-supporting segments, text actions as link buttons, `BackLink` ("Back to rules") and `StatusMessage`. Commit: 9296c10 feat: format counts one way, list supporting checks compactly, make coverage bars visible
- 2026-11-13: Task 4 done. `PageTitle`, `Card`, `NativeSelect` and code tokens, heading levels that no longer skip, named asides, pills from `buttonVariants` and `Badge`, one 16px gutter, full-width Coverage, catalog group rows with the shared chevron and a "Needs review" legend, the status strip rendered once per row, a reason for a disabled Generate. Deferred: P3-8 (phone header), which cannot be done without changing the desktop header. Commit: d5fe5eb refactor: bring every view onto the same titles, cards, pills and tokens
- 2026-11-13: Plan closed; the design is marked Implemented. Verification at the end: Vitest, typecheck, lint and the full Playwright suite (262 tests) pass, and screenshots of every view at 1280 and 375, light and dark, were read.
