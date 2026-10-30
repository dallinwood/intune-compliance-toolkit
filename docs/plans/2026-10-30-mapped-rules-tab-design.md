# Design: mapped rules in a tab, grouped by source

Date: 2026-10-30
Status: Implemented 2026-10-30

## 1. Intent

Rule mappings now hold real data: ISM-0380 alone is supported by 58 mSCP rules. The current
"Mapped rules" section in the rule details (`webui/src/components/rules/RuleMappings.tsx`) lists
every link as a plain list, always expanded, so one broad rule can fill the screen. That pushes
the rest of the details out of view and makes the list hard to scan.

The maintainer wants the mapped rules out of the way by default. A rule should show how many
mapped rules it has, and the reader decides whether to look at them. When they do, the list should
read like the main table (title, id, target, automation, benchmarks), be split by source, and be
easy to filter. Hovering a mapped rule should give a quick summary. Clicking it should show its
details in place, without navigating away from the parent rule.

This replaces the display described in section 6 of
`docs/plans/2026-10-27-rule-mappings-design.md`. The mapping data, its validation and the
generated index stay as they are.

## 2. Goals, non-goals, anti-goals

- **Goals:**
  - An open rule with mappings has two tabs: "Details" and "Mapped rules (N)". "Details" is
    selected by default.
  - Inside the tab, mapped rules are grouped by source. Each group shows its count and starts
    closed.
  - Rows show the same information as main table rows, plus the mapping note.
  - There is basic filtering inside the tab.
  - Hovering a row shows a summary. Clicking a row expands that rule's details in place.
- **Non-goals:**
  - Selection checkboxes or any Generate integration. The maintainer plans to rework Intune
    generation separately.
  - Changes to the mapping file format, the validator or the generated index.
  - Filters in the main table based on mappings, or link indicators on main table rows.
- **Anti-goals:**
  - A rule whose mapped rules are on screen by default as a long list.
  - Leaving the parent rule just to see a mapped rule's details.
  - Unbounded nesting, with a mapped rule's details showing its own mapped rules and so on.

## 3. Decided by the maintainer

- **Layout:** option C from the 2026-10-30 mockups. The open rule gets tabs, and the tab label
  carries the count, for example "Mapped rules (58)". The details and the mapped rules are not on
  screen together.
- **Groups:** one group per source of the mapped rules (for example "NIST mSCP"), each with a rule
  count. Every group starts closed, even when there is only one.
- **Rows:** title, upstream rule id, target icon(s), the Automated/Manual badge and the benchmark
  summary, as in the main table. The mapping note shows on every row, in smaller muted text under
  the title.
- **Hover:** a small summary of basic information:
  - the name and id
  - the targets
  - the automation status, including whether a check and a fix exist
  - the opening of the rule's description
- **Click:** the row expands in place to show that rule's details. The parent rule stays open.
- **No select checkboxes** in the tab.

## 4. Behaviour

### 4.1 Tabs

- The tabs appear only on rules that have at least one mapped rule present in the loaded library.
  Rules without mappings render exactly as today, with no tab strip.
- "Details" holds everything the panel shows today except the "Mapped rules" section, which moves
  into the second tab.
- The count in the tab label is the number of distinct mapped rules for this rule, in either
  direction. Links whose other rule is missing from the loaded library are already dropped when
  the index is loaded (`keptKnown` in `webui/src/logic/mappingIndex.ts`), so every count and row
  covers only rules that exist. No stub rows are shown.
- When the mapping index is missing or broken, rules show no tab strip, and the existing warning in
  the notice area stays as it is.
- Tab choice is per rule and is not kept in the URL. Re-opening a rule shows "Details". (My call:
  the URL already carries the open rule, and a remembered tab adds state for little value.)
- While a rule stays open, switching between its tabs keeps the filter text, the open groups and
  the expanded rows. Collapsing the rule resets them. (My call.)

### 4.2 Inside "Mapped rules"

- **Filter row:**
  - A text box that matches the mapped rule's upstream id or title (case-insensitive substring,
    like the main search).
  - An All / Automated / Manual choice.
  - Assessment status is only ever `automated` or `manual` (`AssessmentStatus` in
    `webui/src/types/library.ts`), so the choice splits the set cleanly.
  - While a filter is active:
    - each group's count shows "matching of total" (for example "3 of 58")
    - groups with no matches are hidden
    - groups that have matches open automatically, because the reader asked to see them
  - Clearing the filter returns the groups to the open or closed state they were in before
    filtering. When nothing matches, the tab shows "No mapped rules match these filters." (My
    call: closed groups would hide the matches the filter just found.)
- **Groups:**
  - One group per source of the mapped rules, keyed by the mapped rule's own `sourceName`.
  - Each group is labelled with the source's display name (`termLabel(index, 'sources', ...)`,
    already used by `RuleMappings.tsx`), its rule count, and the relation as worded from this rule's side ("Supported by" or "Supports").
  - If one source has links in both directions, it gets one group per relation. No data does this
    today.
  - Groups are ordered by source label.
- **Rows:**
  - Ordered by upstream id within a group.
  - Each row shows the stale-release note when it applies, as today.

### 4.3 Hover summary

- The summary opens on hover and on keyboard focus of the row's title, using the existing tooltip
  component (`webui/src/components/ui/tooltip.tsx`) or a popover built on the same primitive.
- It shows:
  - the source label, upstream id and title
  - the target icons and the assessment badge
  - "Check: yes/no" and "Fix: yes/no"
  - the first two or three lines of the discussion, as plain text
- Name, targets and automation come from the index row (`RuleRow`). Check, fix and discussion need
  the rule's own file, which is fetched when the summary opens, using the same per-rule loading as
  the details panel. While it loads, the summary shows what it already has and a short "Loading…"
  line.
- Fetches are de-duplicated and cached per rule id for the session, so moving across many rows,
  or hovering then expanding the same rule, loads each rule file once. The builder should check
  whether `webui/src/hooks/useRule.ts` and its loaders already cache, and add a small cache if
  they don't.
- Touch devices get no hover summary. Tapping a row expands its full details (4.4), which include
  everything in the summary. (My call.)

### 4.4 Click to expand

- Clicking a row (or pressing Enter or Space on it) toggles an inline detail area under that row.
  It shows that rule's full details using the existing details rendering (`RuleDetailPanel` and
  what it renders), so custom overlays, organisation-defined values and errors behave as they do
  in the main table. Organisation-defined values and custom overlays are stored per rule (for
  example `setOdvValue(ref, value)` in `webui/src/state/selectionStore.ts`), not per open rule, so
  two rules' details on screen at once is safe.
- The tab strip wraps the existing details content and is added only at the top level.
  `RuleDetailPanel` gets a way to render without the tabs and mapped rules (for example a
  `nested` prop), so nesting stops at one level. (My call.)
- The nested details include a "Go to this rule" link. It keeps today's behaviour of opening the
  rule in the main table, using the existing `showRule` and `hrefShowing` logic in
  `RuleMappings.tsx`, so the cross-rule navigation the e2e tests cover is kept.
- Several rows can be expanded at once. (My call.)

### 4.5 Responsive

- On narrow screens (about 375px), rows stack the same way main table rows do on phones: title,
  id and note first, then the target, badge and benchmarks on a wrapped line. The tab strip and
  the filter row wrap rather than scroll sideways.

## 5. Constraints

- Follow `.claude/CLAUDE.md`: Playwright e2e plus screenshots at about 375px and at desktop width,
  checked by eye with the Read tool, in light and dark mode.
- The existing e2e tests in `webui/e2e/smoke.spec.ts` ("rule mappings") rely on the current list
  markup, such as `getByRole('list', { name: 'Supported by' })` and the `mapped-rule` test id.
  They need updating to the new structure, and the builder may choose new roles and test ids.
  `RuleDetailPanel.tsx` is the only consumer of `RuleMappings.tsx`. They must still prove that links show from both sides,
  that navigation to the other rule works, and that stale notes and a broken index behave as they
  do now.
- Accessibility:
  - The tabs use proper tab semantics (`tablist`, `tab`, `tabpanel`, arrow-key movement).
  - Groups and rows that expand use `aria-expanded` and `aria-controls`.
  - The hover summary is reachable by keyboard.

## 6. Left to the builder

- Component split and file names, and whether grouping and filtering logic lives in
  `webui/src/logic/mappingIndex.ts` or a new logic module (pure functions with Vitest tests, as
  the project does elsewhere).
- Exact spacing, colours and typography, kept consistent with the main table and the existing
  details panel.
- How the discussion excerpt is trimmed (characters or lines) and how Markdown is flattened for it.
- Whether the hover summary is a tooltip or a hover card, as long as it works with mouse and
  keyboard.

## Progress log

- 2026-10-30: Design written from the maintainer's choices on the mapped rules mockups (no code
  yet).
- 2026-10-30: Builder check answered in the document, approved by the maintainer, and the implementation plan written (`docs/plans/2026-10-30-mapped-rules-tab-plan.md`).
- 2026-10-30: Task 1 - Added the pure grouping, filtering, count and excerpt logic for the mapped rules tab with unit tests (1828867 `feat: add grouping and filtering logic for the mapped rules tab`).
- 2026-10-30: Task 2 - moved the rule table's assessment and benchmark cells into RuleRowCells.tsx so the mapped rules tab can reuse them (0a5205f `refactor: share the rule table's assessment and benchmark cells`).
- 2026-10-30: Task 3 - Replaced the always-open mapped rules list with a Details / Mapped rules tab strip and a source-grouped, filterable tab whose rows reuse the rule table's cells (36f5f90 `feat: show mapped rules in a tab grouped by source`; c229ff2 `test: exercise the mapped rules assessment filter`).
- 2026-10-30: Task 4 - Added hover/focus summaries and click-to-expand details with a "Go to this rule" link to mapped rule rows, moved the view state to its own module, fixed snake_case in excerpts, and added tab lifetime tests (1ec3f71 `feat: add hover summaries and in-place details to mapped rules`).
- 2026-10-30: Task 5 - Described the tab in the README and marked this design implemented and the rule mappings design's display section as replaced (45e3eea `docs: describe the mapped rules tab`).
- 2026-10-30: Final review fixes - ODV substituted in hover summaries, a visible focus ring on the tab panels, AsciiDoc markup removed from the 140-character excerpt, the stale note tested from both sides, a click anywhere on a row toggles it, and the unused `groupMappedRules` removed (97d98c9 `fix: address final review of the mapped rules tab`).
- 2026-10-30: "Go to this rule" in an expanded mapped rule is now a small outline button with an arrow icon on its own bar, instead of an underlined link floating above the details (`fix: style Go to this rule as a small button`).
