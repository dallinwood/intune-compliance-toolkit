# Mapped Rules Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move a rule's mapped rules into a "Mapped rules (N)" tab with closed per-source groups, table-like rows with notes, filtering, a hover summary and in-place expansion.

**Architecture:** Pure grouping, filtering and excerpt logic goes in a new `webui/src/logic/mappedRuleView.ts` with Vitest tests. The main table's assessment and benchmark cells move to a shared component file so the tab's rows reuse them. `RuleDetailPanel` gains a `nested` mode. At the top level it renders a tab strip when the rule has mappings, and the tab content is a new `MappedRulesTab` component that replaces today's `RuleMappings` list.

**Tech Stack:** React 19, TypeScript, Tailwind, Base UI (`@base-ui/react`, already used for the tooltip), Vitest, Playwright. Run with Bun, except `test:e2e`, which needs real Node.

**Spec:** `docs/plans/2026-10-30-mapped-rules-tab-design.md`

## Global Constraints

- No new dependencies. Use Base UI primitives already in the project (`@base-ui/react/tooltip`; `@base-ui/react/tabs` comes from the same package) or plain markup.
- Never use the em dash character (U+2014) in code, copy or comments.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why" (from the user's global instructions); match the surrounding code's idioms.
- The tabs appear only when the rule has at least one mapped rule in the loaded library. Rules without mappings render exactly as today.
- "Details" is selected by default, and the tab choice is not stored in the URL.
- Every source group starts closed.
- Rows show the mapping note on every row, under the title, in muted smaller text.
- No selection checkboxes in the tab.
- Nested details never show tabs or mapped rules.
- Verification before calling any UI task done: `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`), plus screenshots at 375px and 1280px in light and dark mode, read with the Read tool (`.claude/CLAUDE.md`).
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path, because other agents may have uncommitted changes in `catalog/` and `tests/`. No `Co-Authored-By` or other AI attribution lines in commits.
- Add a progress log entry to `docs/plans/2026-10-30-mapped-rules-tab-design.md` in each task's commit.

## Review Focus

- **The same rule open twice.** A mapped rule that is also open in the main table renders two detail panels. Nested panels must not reuse the `rule-detail-<id>` element id, or any other DOM id, from the main table. (Test in Task 4.)
- **Filters that hide everything.** The tab shows "No mapped rules match these filters." and no group headers. (Test in Task 1 for the logic, Task 3 for the e2e.)
- **Long titles and notes at 375px.** No horizontal page scroll, and the tab strip and filter row wrap. (Screenshot check in Tasks 3 and 4.)
- **Keyboard only.** Arrow keys move between tabs, Enter or Space toggles a group or a row, and focusing a row title opens the hover summary. (Test in Task 4.)
- **A mapped rule whose file fails to load.** The hover summary keeps the index facts and shows "Details could not be loaded."; the expanded row shows the existing details error. (Test in Task 4, using `page.route` to 404 one rule file.)

---

### Task 1: Pure logic for grouping, filtering and excerpts

**Files:**
- Create: `webui/src/logic/mappedRuleView.ts`
- Test: `webui/src/logic/mappedRuleView.test.ts`

**Interfaces:**
- Consumes: `MappedRule`, `mappingGroupLabel` from `webui/src/logic/mappingIndex.ts`; `RuleRow` from `webui/src/types/rule-row.ts`; `upstreamRuleId` from `webui/src/logic/ruleDisplay.ts`; `compareText` from `webui/src/logic/catalogIndex.ts`.
- Produces:
  - `export type AssessmentChoice = 'all' | 'automated' | 'manual'`
  - `export interface MappedRuleFilter { text: string; assessment: AssessmentChoice }`
  - `export interface MappedRuleItem { link: MappedRule; row: RuleRow }`
  - `export interface MappedSourceGroup { key: string; sourceName: string; relationLabel: string; items: MappedRuleItem[]; total: number }`. `key` is `${sourceName}:${relationLabel}`, `items` are the ones matching the filter, and `total` is the group size before filtering.
  - `export function groupMappedRulesBySource(links: readonly MappedRule[], rowsById: ReadonlyMap<string, RuleRow>, sourceLabel: (sourceName: string) => string): MappedSourceGroup[]`. Links whose rule is missing from `rowsById` are dropped. Groups are ordered by `sourceLabel(sourceName)`, then relation label; items by upstream id.
  - `export function filterMappedRuleGroups(groups: readonly MappedSourceGroup[], filter: MappedRuleFilter): MappedSourceGroup[]`. It keeps `total`, narrows `items` and drops groups left with no items.
  - `export function isFilterActive(filter: MappedRuleFilter): boolean`. True when `text.trim() !== ''` or `assessment !== 'all'`.
  - `export function distinctMappedRuleCount(links: readonly MappedRule[], rowsById: ReadonlyMap<string, RuleRow>): number`
  - `export function discussionExcerpt(text: string, maximumCharacters: number): string`. It flattens Markdown and whitespace to plain text and cuts at a word boundary, adding "..." when cut.

- [ ] **Step 1: Write the failing tests** in `mappedRuleView.test.ts`. Build `RuleRow` fixtures with a small helper.
  - `groups by the mapped rule's source and relation, ordered by source label then upstream id`: links to `mscp.os_b`, `mscp.os_a` (incoming supports) and `asd_ism.ism-0001` (outgoing supports) give the keys `['asd_ism:Supports', 'mscp:Supported by']`, the mscp items are in the order `os_a, os_b`, and `total` equals `items.length`.
  - `drops links whose rule is not in the loaded rows`.
  - `text filter matches upstream id or title, case-insensitively, and keeps total`: filter `{ text: 'AIRDROP', assessment: 'all' }` over a group of 3 with one "Disable AirDrop" row gives one item and `total` 3.
  - `assessment filter keeps only automated or manual rows`.
  - `a filter that matches nothing returns no groups`: the result is `[]`.
  - `isFilterActive is false for blank text and all`: `{ text: '  ', assessment: 'all' }` gives false.
  - `counts distinct mapped rules once even if linked twice`: the same rule in two links counts 1.
  - `discussionExcerpt flattens markdown and cuts at a word`: `discussionExcerpt('**Bold** text with `code` and [a link](https://x)\n\nNext para', 30)` gives `'Bold text with code and a...'`. A short input is returned unchanged with no "...".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd webui && bunx vitest run src/logic/mappedRuleView.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement the functions in `webui/src/logic/mappedRuleView.ts`.** Use `mappingGroupLabel(link.relation, link.direction)` for `relationLabel`, `upstreamRuleId(row.ref.id)` for id matching and sorting, and `compareText` for ordering.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd webui && bunx vitest run src/logic/mappedRuleView.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**: `feat: add grouping and filtering logic for the mapped rules tab`

### Task 2: Share the main table's assessment and benchmark cells

**Files:**
- Create: `webui/src/components/rules/RuleRowCells.tsx`
- Modify: `webui/src/components/rules/RuleTable.tsx`. Move `AssessmentCell`, `AssessmentBadge`, `BenchmarkText` and `SingleLineText` (about lines 490 to the end of `SingleLineText`) out of this file.

**Interfaces:**
- Produces: `export function AssessmentCell({ row }: { row: RuleRow })`, `export function AssessmentBadge({ row }: { row: RuleRow })` and `export function BenchmarkText({ row }: { row: RuleRow })` from `RuleRowCells.tsx`.

- [ ] **Step 1: Move the four components unchanged into `RuleRowCells.tsx`, export the three above, and import them in `RuleTable.tsx`.** This is a pure move with no behaviour change.
- [ ] **Step 2: Verify.** Run: `cd webui && bun run test && bun run lint && bunx tsc -b`. Expected: all pass, with no new lint warnings. Then run `bun run test:e2e` against the dev server. Expected: same pass count as before the move.
- [ ] **Step 3: Commit**: `refactor: share the rule table's assessment and benchmark cells`

### Task 3: Tabs, the mapped rules tab, groups, filters and rows

**Files:**
- Create: `webui/src/components/rules/MappedRulesTab.tsx`
- Modify: `webui/src/components/rules/RuleDetailPanel.tsx`. Add the `nested` prop, the tab strip, and remove `<RuleMappings />` from the details body.
- Delete: `webui/src/components/rules/RuleMappings.tsx`. Its `hrefShowing`, `isPlainClick`, stale-note markup and navigation move into `MappedRulesTab.tsx`.
- Modify: `webui/e2e/smoke.spec.ts`, the `rule mappings` describe block (starting at about line 1761).

**Interfaces:**
- Consumes: everything from Task 1; `AssessmentCell` and `BenchmarkText` from Task 2; `useRuleMappings()` from `webui/src/state/mappingsContext.ts`; `staleEndpoints` from `mappingIndex.ts`; `termLabel` from `webui/src/logic/vocabulary.ts`.
- Produces:
  - `RuleDetailPanel({ ruleRef, nested = false }: { ruleRef: RuleRef; nested?: boolean })`
  - `export function MappedRulesTab({ ruleId }: { ruleId: string })`
  - `export function MappedRuleRow({ item, self }: { item: MappedRuleItem; self: RuleRow })`, which Task 4 extends.
  - Accessible names, which the e2e tests rely on:
    - tabs `Details` and `Mapped rules (N)`
    - the tab panel labelled by its tab
    - each group header is a button named `<source label> <relation label> (<count>)`, or `(<matching> of <total>)` while filtering, with `aria-expanded`
    - each group's rows form a list labelled `<source label> <relation label>`
    - the filter text box is labelled `Filter mapped rules`
    - the assessment choice is a radio group labelled `Assessment`, with options `All`, `Automated` and `Manual`

- [ ] **Step 1: Rewrite the e2e tests in the `rule mappings` block to the new structure (failing first).** Keep the existing fixtures (`supportsIsm1622` and `staleRelated`) and the `serveMappings` helper. Tests:
  - `a rule with mappings shows Details first and a Mapped rules tab with its count`: the ISM-1622 details have the tab `Mapped rules (2)`, and `Details` is selected.
  - `groups start closed and open to show rows like the main table, with the note`: open the tab. The `NIST mSCP Supported by (2)` button has `aria-expanded="false"`. Click it, and the list has 2 items with `/os_dictation_disable/` and `/os_gatekeeper_enable/`; the first item contains `Covers the PowerShell part only.` and an `Automated` or `Manual` badge.
  - `the mSCP side shows the ISM rule it supports`: the gatekeeper rule's tab has a group `ASD Information Security Manual Supports (1)`, use the actual source label from the vocabulary.
  - `filtering opens matching groups, shows matching of total, and clearing restores them`: type `gatekeeper` and the group shows `(1 of 2)` and is expanded. Clear it, and it is collapsed again.
  - `a filter matching nothing says so`: type `zzz` to see `No mapped rules match these filters.`
  - Keep the existing stale-note, broken-index and no-mappings tests, with their assertions changed to: the stale note is visible inside an opened group, a broken index shows no tab strip and the existing warning, and no mappings shows no tab strip.
  - Move the existing "each link opens the other rule" navigation assertions to Task 4, which adds the "Go to this rule" link.
- [ ] **Step 2: Run them to verify they fail.** Run: `cd webui && PLAYWRIGHT_BASE_URL=http://localhost:5199 node node_modules/@playwright/test/cli.js test -g "rule mappings"`. Expected: FAIL.
- [ ] **Step 3: Implement `MappedRulesTab` and the tab strip in `RuleDetailPanel`.**
  - Use Base UI `Tabs` (`@base-ui/react/tabs`) for `tablist`/`tab`/`tabpanel` semantics and arrow keys.
  - Group open state: a `Set<string>` of group keys. While `isFilterActive`, render every group in the filtered result as open without changing the stored set, so clearing the filter restores the previous state.
  - Hold the filter, the open groups and (in Task 4) the expanded rows in `RuleDetailPanel`'s top-level component state, so they survive tab switches and reset when the rule collapses.
  - Rows use `AssessmentCell` and `BenchmarkText`, and on phones stack like `RuleTable` rows (`md:` breakpoints).
- [ ] **Step 4: Run e2e, Vitest, lint and tsc.** Expected: all pass. Take screenshots of ISM-0380 with real mappings (58 rules) at 375px and 1280px, light and dark, with a group open and with a filter active, and read them.
- [ ] **Step 5: Commit**: `feat: show mapped rules in a tab grouped by source`

### Task 4: Hover summary and in-place expansion

**Files:**
- Create: `webui/src/components/rules/MappedRuleSummary.tsx`
- Modify: `webui/src/components/rules/MappedRulesTab.tsx`, `webui/src/components/rules/RuleDetailPanel.tsx` (nested rendering: no tabs, no mapped rules, unique DOM ids)
- Modify: `webui/e2e/smoke.spec.ts`, the `rule mappings` block

**Interfaces:**
- Consumes: `discussionExcerpt` (Task 1); `useRule(ruleRef)` from `webui/src/hooks/useRule.ts`, whose fetches are already cached per rule id in `webui/src/data/ruleDetail.ts`, so add no new cache; `TargetIcons` and `AssessmentBadge`; `RuleDetailPanel` with `nested`.
- Produces: `export function MappedRuleSummary({ row }: { row: RuleRow })`, the tooltip content. It shows:
  - the source label, upstream id and title
  - `TargetIcons` and `AssessmentBadge`
  - `Check: yes|no` and `Fix: yes|no` (from `rule.check !== null` and `rule.remediation !== null`, once loaded)
  - `discussionExcerpt(rule.discussion, 240)`
  - `Loading…` while loading
  - `Details could not be loaded.` on error

- [ ] **Step 1: Write the failing e2e tests:**
  - `hovering a mapped rule shows a summary with targets, automation, check and fix, and the start of its description`: open the group, hover the title of `os_gatekeeper_enable`, and the tooltip contains `os_gatekeeper_enable`, `Check: yes`, `Fix: yes` and the first words of its discussion.
  - `focusing a mapped rule title by keyboard shows the same summary`.
  - `clicking a mapped rule expands its details in place, with no nested tabs`: the expanded area contains the rule's discussion heading and check section, no `tablist`, and the parent ISM-1622 details are still visible.
  - `Go to this rule opens it in the main table, from either side`: carry over the assertions from the old navigation test, including the shared-URL case.
  - `a mapped rule open in the main table and expanded in a tab has no duplicate element ids`: expand `os_gatekeeper_enable` inside ISM-1622's tab and also open it in the main table, then assert `document.querySelectorAll('[id="rule-detail-mscp.os_gatekeeper_enable"]').length === 1`, and that no `id` in the page is duplicated.
  - `a mapped rule whose file fails to load still shows its summary facts`: use `page.route` to 404 `**/mscp/rules/os_gatekeeper_enable.json`. Hovering shows the title and `Details could not be loaded.`
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
  - The row title is a button that toggles expansion (`aria-expanded`, `aria-controls`) and is the tooltip trigger.
  - The expanded area renders `<RuleDetailPanel ruleRef={row.ref} nested />` plus a "Go to this rule" link that keeps the old `hrefShowing` and `showRule` behaviour.
  - In nested mode, derive DOM ids from `useId()`, not from the rule id.
  - The summary calls `useRule` only while open (pass `null` otherwise).
- [ ] **Step 4: Run e2e, Vitest, lint and tsc.** Expected: all pass. Take screenshots at 375px and 1280px, light and dark, with a summary open and a row expanded, and read them.
- [ ] **Step 5: Commit**: `feat: add hover summaries and in-place details to mapped rules`

### Task 5: Docs

**Files:**
- Modify: `README.md`, the "Mapping rules" section paragraph that describes the "Mapped rules" section
- Modify: `docs/plans/2026-10-27-rule-mappings-design.md`. Add a note at the top of section 6 that `docs/plans/2026-10-30-mapped-rules-tab-design.md` replaces it, and a progress log entry.
- Modify: `docs/plans/2026-10-30-mapped-rules-tab-design.md`. Set the status to Implemented and add a final progress log entry with the commit hashes.

- [ ] **Step 1: Update the three documents** to describe the tab, the closed groups, the filters, the hover summary and "Go to this rule".
- [ ] **Step 2: Commit and push**: `docs: describe the mapped rules tab`

## Progress log

- 2026-10-30: Task 1 - 1828867 `feat: add grouping and filtering logic for the mapped rules tab`
- 2026-10-30: Task 2 - 0a5205f `refactor: share the rule table's assessment and benchmark cells`
- 2026-10-30: Task 3 - 36f5f90 `feat: show mapped rules in a tab grouped by source`; c229ff2 `test: exercise the mapped rules assessment filter`
- 2026-10-30: Task 4 - 1ec3f71 `feat: add hover summaries and in-place details to mapped rules`
- 2026-10-30: Task 5 - 45e3eea `docs: describe the mapped rules tab`
- 2026-10-30: Final review fixes - `fix: address final review of the mapped rules tab`
