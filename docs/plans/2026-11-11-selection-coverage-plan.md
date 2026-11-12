# Selection Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Coverage view that shows, for the current selection, how many controls of each control framework the selected rules support through `supports` mappings, by section, with provenance.

**Architecture:** All counting lives in a new pure module `webui/src/logic/selectionCoverage.ts` with Vitest tests. A new `coverage` view, registered in `webui/src/views/viewRegistry.tsx`, reads rows and the selection from `ViewContext` and the mapping index from `MappingsContext`, and renders cards, section bars and provenance from the logic's output.

**Tech Stack:** React 19, TypeScript, Tailwind, Base UI, Vitest, Playwright. Run with Bun, except `test:e2e`, which needs real Node.

**Spec:** `docs/plans/2026-11-11-selection-coverage-design.md`

**Depends on:** nothing unlanded. It works with today's mSCP to ISM mappings. The NIST 800-53 and ASD E4EIT imports (`docs/plans/2026-11-11-nist-800-53-import-plan.md`, `docs/plans/2026-11-11-asd-e4eit-import-plan.md`) add a framework card and a related-only line through the mapping index when they land, with no change here. If they land first, nothing in this plan changes.

## Global Constraints

- No new dependencies. Bars are plain `div`s; use existing `components/ui` primitives and Base UI.
- Never use the em dash character (U+2014) in code, copy or comments.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why"; match the surrounding code's idioms.
- `supports` links count; `related` links never count (design 4.3). Copy says "supports", never "compliant", "meets" or "satisfies".
- Every percentage or bar has its "N of M" and scope beside it.
- The denominator ignores the browse filters.
- No change to mapping files, `tools/mappings.py`, the generated index or `scripts/copy-baselines.mjs`.
- Verification before calling any UI task done: `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`), plus ad hoc screenshots at 375px and 1280px in light and dark mode, read with the Read tool (`.claude/CLAUDE.md`).
- E2e assertions never hard-code the library's rule total; the NIST and E4EIT imports change it.
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; other agents may have uncommitted changes. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` in each task's commit.

## Review Focus

- **Related links counted by mistake.** A control reached only by `related` must never raise N. (Task 1 test.)
- **Self-support.** A rule of framework F linked to another rule of F must not count. (Task 1 test.)
- **Long section titles at 375px.** "Guidelines for communications infrastructure" plus figures must wrap, not scroll. (Task 2 screenshots.)
- **Empty states.** No mappings, nothing selected, a scope with no controls. (Tasks 1 and 2.)

---

### Task 1: Pure coverage logic

**Files:**
- Create: `webui/src/logic/selectionCoverage.ts`
- Test: `webui/src/logic/selectionCoverage.test.ts`

**Interfaces:**
- Consumes: `MappedRule` from `webui/src/logic/mappingIndex.ts`; `RuleRow` from `webui/src/types/rule-row.ts`; `upstreamRuleId` from `webui/src/logic/ruleDisplay.ts`; `compareText` from `webui/src/logic/catalogIndex.ts`.
- Produces (exact signatures in design section 5):
  - `export type ControlStatus = 'covered' | 'related-only' | 'uncovered'`
  - `export const ALL_CONTROLS_SCOPE = 'all'`
  - `export interface CoverageLink { rule: RuleRow; mapping: string; note: string | null; checkedAgainstOlderRelease: boolean }`
  - `export interface ControlCoverage { control: RuleRow; status: ControlStatus; supportedBy: CoverageLink[]; relatedTo: CoverageLink[]; selectedDirectly: boolean }`
  - `export interface SectionCoverage { section: string; covered: number; relatedOnly: number; total: number; controls: ControlCoverage[] }`
  - `export interface FrameworkCoverage { sourceName: string; scope: string; covered: number; relatedOnly: number; selectedDirectly: number; total: number; sections: SectionCoverage[] }`
  - `export interface CoverageInput { rows: readonly RuleRow[]; mappingsByRule: ReadonlyMap<string, MappedRule[]>; selectedRuleIds: ReadonlySet<string>; automatedOnly: boolean }`
  - `export function coverageFrameworks(rows: readonly RuleRow[], mappingsByRule: ReadonlyMap<string, MappedRule[]>): { counted: string[]; relatedOnly: string[] }`. `counted`: source names with at least one row holding an `incoming` `supports` entry. `relatedOnly`: source names with at least one `related` entry and no row in `counted`, excluding sources that only ever appear on the `from` side of `supports`. Both sorted by source name (the view re-sorts by label).
  - `export function scopeOptions(rows: readonly RuleRow[], sourceName: string, compareBenchmarks: (left: string, right: string) => number): string[]`. `[ALL_CONTROLS_SCOPE, ...distinct benchmarks on that source's rows sorted by compareBenchmarks]`.
  - `export function frameworkCoverage(input: CoverageInput, sourceName: string, scope: string): FrameworkCoverage`
  - `export function selectedRulesSupportingNothing(input: CoverageInput, frameworkSources: readonly string[]): RuleRow[]`. Selected rows not in `frameworkSources` with no `outgoing` `supports` and no `related` entry whose rule belongs to one of `frameworkSources`; sorted by upstream id.

**Exact behaviour** (design 4.2): rows in scope are the source's rows, narrowed by `row.benchmarks.includes(scope)` unless scope is `ALL_CONTROLS_SCOPE`. A supporting link is an `incoming` `supports` entry of the control whose `rule` is in `selectedRuleIds`, whose row exists in `rows`, whose row's `sourceName` differs from the framework's, and, with `automatedOnly`, whose row's `assessment.status === 'automated'`. Related links are `related` entries meeting the same selection and source conditions (`automatedOnly` applies too). `checkedAgainstOlderRelease` is true when `changedKinds` or `selfChangedKinds` is present and is `null` or a non-empty list. Sections follow first-seen order of `sectionPath[0]` in `rows`; empty sections are dropped. Controls within a section: covered, then related-only, then uncovered, each by upstream id. Links within a control by upstream id of the linked rule, then mapping id.

- [ ] **Step 1: Write the failing tests** with a small row and entry builder:
  - `lists a source on the to side of supports as a coverage framework and not the from side`
  - `names a source with only related links as related-only`
  - `counts a control once even when two selected rules support it`
  - `does not count a related link: the control is related-only and covered stays 0`
  - `ignores links from unselected rules`
  - `ignores support from a rule of the same framework`
  - `automatedOnly drops support from a manual rule`
  - `a selected control of the framework is selectedDirectly and not covered`
  - `scope narrows the denominator to rows carrying that benchmark`
  - `scopeOptions starts with all and orders benchmarks by the comparator`
  - `groups sections in first-seen order and drops empty sections`
  - `marks a link checked against an older release when changedKinds is non-empty or null, not when []`
  - `an empty selection gives covered 0 and the full total`
  - `selectedRulesSupportingNothing lists only selected rules with no link into a framework`
- [ ] **Step 2: Run to verify failure.** `cd webui && bunx vitest run src/logic/selectionCoverage.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** in `webui/src/logic/selectionCoverage.ts`. Index rows by id once per call.
- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS. Then `bun run test`, `bun run lint`, `bunx tsc -b`.
- [ ] **Step 5: Commit**: `feat: add selection coverage logic over the mapping index`

### Task 2: Coverage view

**Files:**
- Create: `webui/src/views/CoverageView.tsx`, `webui/src/components/selectionCoverage/FrameworkCoverageCard.tsx`, `webui/src/components/selectionCoverage/CoverageBar.tsx`, `webui/e2e/coverage.spec.ts`
- Modify: `webui/src/views/viewRegistry.tsx` (add `{ id: 'coverage', label: 'Coverage', render: (context) => <CoverageView {...context} /> }` after Frameworks), `scripts/route-pages.mjs` (add `'coverage'` to `VIEW_IDS` in the same position), and `webui/src/views/viewRegistry.test.tsx` if it lists ids.

**Interfaces:**
- Consumes: Task 1's exports; `ViewContext` (`rows`, `enabledSelections`); `useRuleMappings()` from `webui/src/state/mappingsContext.ts`; `useVocabularyIndex()`, `termLabel`, `compareGroupKeys` from `webui/src/logic/vocabulary.ts`; `upstreamRuleId`.
- Produces: `export function CoverageView(context: ViewContext)`; `export function CoverageBar({ covered, relatedOnly, total, label }: { covered: number; relatedOnly: number; total: number; label: string })`.

**Exact behaviour** (design 4.1, 4.4, 4.5):
- Header: "Coverage of your selection (S rules)" where S is `enabledSelections.length`, and an "Automated checks only" checkbox, off by default.
- Nothing selected: the cards still render ("Supports 0 of M controls") with the line "Select rules in the Rules view to see what they support."
- No coverage framework: "No rules in this library support another framework's controls yet." and nothing else but the header.
- One `FrameworkCoverageCard` per `counted` source, ordered by `termLabel(vocabularyIndex, 'sources', name)`. Card: heading = source label; sentence "Supports N of M controls" plus " at <benchmark label>" for a benchmark scope; "+ K related only" when K > 0; "D selected directly" when D > 0; a labelled select ("Scope") with "All controls" then each benchmark label; a `CoverageBar` with `aria-label` "N of M supported, K related only".
- Section rows: buttons with `aria-expanded`, section title, "N of M", small `CoverageBar`. Closed by default.
- Expanded section: covered and related-only controls (upstream id in mono, title, tag "Supported" or "Related only", "Selected" tag when selected directly); then a "Show U uncovered" button revealing uncovered controls.
- Control click (covered or related-only): provenance list. Each supporting link: upstream id, title, mapping id in muted mono text, note in muted smaller text, and "Mapped against an older release that has since changed" when `checkedAgainstOlderRelease`. Then "Related (not counted)" with the same layout when there are related links.
- For each `relatedOnly` source, one muted line: "<label> links to other frameworks only as related, so it has no coverage figure."
- Footer block: "R selected rules support no control", expandable to the list (upstream id, title).
- Bar colours: covered uses an existing strong token (for example `bg-primary`), related-only the same token at reduced opacity, rest `bg-muted`. Works in dark mode.
- 375px: cards full width, section title wraps above figures, no horizontal scroll.

**Tests (`webui/e2e/coverage.spec.ts`):** in `beforeEach`, route `**/baselines/_mappings/_index.json` to a fixture built with `buildMappingIndex` (import from `../src/logic/mappingIndex`, as `smoke.spec.ts` does) holding: two committed mSCP rules `supports` one ISM control, one of those mSCP rules `supports` a second ISM control in another guideline, and one mSCP rule `related` to a third ISM control. Pick real ids from `baselines/` and real releases. Seed the selection in `localStorage` (`intune-toolkit:selections`, version 2, see `smoke.spec.ts`) with the two mSCP rules plus one mSCP rule with no links.
  - `coverage shows supports N of M for ISM`: "Supports 2 of <M> controls" where M is read from the committed ISM index in the test with `readFileSync`, not hard-coded.
  - `scope narrows the denominator`: choose "ISM PROTECTED"; the sentence ends "at ISM PROTECTED" and M equals the count of ISM index rules carrying `ism_protected`.
  - `a section expands to controls and a control to its provenance`: the note text and mapping id are visible.
  - `related links show as related only and are not counted`.
  - `lists selected rules that support no control`.
  - `automated checks only drops a manual supporter` (if one of the chosen mSCP rules is manual; otherwise pick ids so one is).
  - `navigating to /coverage directly opens the view`.
- Ad hoc screenshots: a short Playwright script in the scratchpad at 375x800 and 1280x900, light and dark, with one section and one control expanded. Read each PNG.

- [ ] **Step 1:** Register the view and route id; run `bun run test` (the registry test must pass).
- [ ] **Step 2:** Write `coverage.spec.ts`; run it; expect failures.
- [ ] **Step 3:** Build `CoverageBar`, `FrameworkCoverageCard`, `CoverageView`.
- [ ] **Step 4:** Run `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e`. Expected: all pass.
- [ ] **Step 5:** Screenshots; read them; fix anything cramped or overflowing; repeat.
- [ ] **Step 6: Commit**: `feat: add a Coverage view rolling the selection up against mapped frameworks`

### Task 3: Documentation

**Files:**
- Modify: `README.md` (the web UI section: one paragraph on the Coverage view, what counts, that `related` does not, and that figures are about mappings, not compliance), `docs/2026-11-11-ciso-assistant-analysis.md` ("Suggested next steps", item 3: note it is built, with the commit hash).

- [ ] **Step 1:** Write the README paragraph. Plain prose, no em dashes.
- [ ] **Step 2:** Update the analysis doc's next step.
- [ ] **Step 3: Commit**: `docs: describe the Coverage view`

## Progress log

- 2026-11-12: Task 1 done, the pure coverage logic (`selectionCoverage.ts`) with 18 Vitest tests. Landed in 85a6cdf feat: add selection coverage logic over the mapping index.
- 2026-11-12: Task 2 done, the Coverage view (registry entry, `coverage` route id, framework cards, section bars, provenance lists, related-only lines, unsupported-rules list) with 7 Playwright tests. The components live in `webui/src/components/selectionCoverage/` because the repo's `.gitignore` ignores any `coverage/` directory (and Tailwind skips ignored paths). The tab bar now wraps whenever the tabs no longer fit (a fifth tab overflowed at 375px). Landed in f752130 feat: add a Coverage view rolling the selection up against mapped frameworks.
- 2026-11-12: Task 2 review fixes: a section's count and bar now align to the first line of a wrapped title (153dd1b fix: align a coverage section's count and bar to its title's first line), and Vitest now includes `*.test.tsx` and resolves the `@` alias, which brought `viewRegistry.test.tsx` (3 tests) into the run (c4eac9f test: run *.test.tsx files and resolve the @ alias in Vitest).
- 2026-11-12: Task 3 done, the README paragraph on the Coverage view and the analysis doc's next step 3 marked built. Plan closed and design marked implemented. Landed in 618e7fe docs: describe the Coverage view and close the selection coverage plan.
- 2026-11-12: Final review fixes. The README now names ASD ISM and NIST SP 800-53 as the frameworks with a "Supports N of M" figure and says ASD E4EIT, reached only through `related` links, gets a note instead; the "Show N uncovered" button is now a Show/Hide toggle with `aria-expanded` that stays in the DOM so keyboard focus is kept, with an e2e test; the entries above were corrected. Landed in 328bde5 fix: keep focus on the uncovered-controls toggle and correct the Coverage README.
