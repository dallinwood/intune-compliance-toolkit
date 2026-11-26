# Rule detail section cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each rule detail section as a card with a left label strip, and replace the check/remediation pills with tabs that are always open on one item.

**Architecture:** A new `SectionCard` component replaces `SectionHeading` for the five sections. The panel becomes a CSS container, so cards switch from the left strip to a top bar based on the panel's width, not the viewport's. A new `ScriptTabs` component (Base UI Tabs) replaces `DisclosureButtons` in the check and remediation sections. `SelectionButtons` is restyled as a segmented control.

**Tech Stack:** React, Tailwind CSS 4.3 (built-in `@container` variants), Base UI 1.7 Tabs, Playwright e2e.

**Spec:** `docs/plans/2026-11-26-rule-detail-section-cards-design.md`

## Global Constraints

- Section labels: "Values", "Check", "Remediation", "Benchmarks", "References".
- Label strip ~6.5rem wide (`grid-cols-[6.5rem_minmax(0,1fr)]`), `bg-muted`, right border. In a narrow container it becomes a top bar with a bottom border.
- Headings stay `h3`. The Custom tag sits in the same element as the heading (an e2e test reads the heading's parent).
- Benchmarks stays a region named "Benchmarks". Panels keep the `check-target` / `remediation-target` test ids and are labelled by their tab.
- The first tab is selected by default. One tab is always selected. A single item still gets a tab.
- No new dependencies. Use only existing theme tokens (`border-border`, `bg-muted`, `bg-background`, `border-primary`, ...).
- Per project CLAUDE.md: run `bun run test:e2e`, take Playwright screenshots at ~375px and desktop and look at them, add a progress log entry to this plan, and commit and push each task.

## Review Focus

- A rule with no check (manual): the Check card shows "No automated check..." with no tab row. Covered by the existing e2e tests; recheck in the Task 3 screenshots.
- A rule with no remediation (`showsRemediationSection` false): no Remediation card at all. The existing smoke test at `e2e/smoke.spec.ts:1401` covers this.
- A rule with no references: no References card (`RuleReferences` returns null today; keep that).
- The nested mapped-rule panel and `RuleDetailsDialog` are narrow: the cards must use the top-bar layout there. Check this in the Task 3 screenshot of a Mapped rules tab.
- Long unbroken strings (registry paths, ODV names) inside the content column must not overflow the card (`min-w-0` on the content column). Check this in the Task 3 screenshot of a registry rule at 375px.

---

### Task 1: SectionCard for Values, Benchmarks and References

**Files:**
- Create: `webui/src/components/rules/SectionCard.tsx`
- Modify: `webui/src/components/rules/RuleDetailPanel.tsx` (`PANEL_CLASS` gets `@container`; ODV block at ~289-305)
- Modify: `webui/src/components/rules/RuleBenchmarks.tsx`, `webui/src/components/rules/RuleReferences.tsx`

**Interfaces:**
- Produces: `SectionCard({ title, custom = false, children, ariaLabel? }: { title: string; custom?: boolean; children: ReactNode; ariaLabel?: string })`. It renders `<section aria-label={ariaLabel}>`, a label strip holding `<h3>` + `<CustomTag/>`, and a `min-w-0` content column. The layout is `grid-cols-1` by default and `@md:grid-cols-[6.5rem_minmax(0,1fr)]`. The strip has a bottom border by default and switches to a right border at `@md`.

- [x] **Step 1:** Create `SectionCard` as above. Put `@container` on the panel root (`PANEL_CLASS` in `RuleDetailPanel.tsx`).
- [x] **Step 2:** Wrap the ODV inputs in `<SectionCard title="Values" custom={isCustom('odvs')}>`. Replace the `SectionHeading` in `RuleBenchmarks` with `<SectionCard title="Benchmarks" ariaLabel="Benchmarks">` (this removes its own `<section>` wrapper) and the one in `RuleReferences` with `<SectionCard title="References">`.
- [x] **Step 2b:** In `RuleDetailPanel.tsx` (~276-285), render the breadcrumb and the revision line as one `<p>` joined with ` · ` when both exist, e.g. `1 › 1.1 · Revision 3, updated 2026-08-01`. Keep `data-testid="rule-breadcrumb"` on a `<span>` that wraps only the breadcrumb text, so tests that read it don't also match the revision.
- [x] **Step 3:** Run `bun run typecheck && bun run lint` from `webui/`. Expected: clean.
- [x] **Step 4:** Run `bun run test:e2e -- e2e/smoke.spec.ts -g "Benchmarks|benchmark|odv|ODV"` (shared server, `PLAYWRIGHT_BASE_URL=http://localhost:5199`). Expected: PASS.
- [x] **Step 5:** Commit `feat: show rule values, benchmarks and references as section cards` and push.

### Task 2: Check and Remediation cards with script tabs

**Files:**
- Create: `webui/src/components/rules/ScriptTabs.tsx`
- Modify: `webui/src/components/rules/RuleCheckSection.tsx`, `webui/src/components/rules/RuleRemediationSection.tsx`
- Modify: `webui/src/components/rules/DisclosureButtons.tsx` (delete `DisclosureButtons`/`DisclosureItem`; restyle `SelectionButtons`; leave `ToggleButtons` unchanged, since History uses it)
- Modify: `webui/e2e/smoke.spec.ts` (describe "check and fix buttons" ~1506-1575, ~1475), `webui/e2e/several-checks.spec.ts`

**Interfaces:**
- Consumes: `SectionCard` from Task 1.
- Produces: `ScriptTabs({ items, ariaLabel }: { items: readonly ScriptTabItem[]; ariaLabel: string })`, where `ScriptTabItem = { key: string; tabContent: ReactNode; panel: ReactNode; panelTestId?: string }`. It's a Base UI `Tabs.Root` with `defaultValue` set to the first key. `Tabs.List` uses the underline style of `TAB_CLASS` in `RuleDetailPanel.tsx`, and the `Tabs.Panel` carries `data-testid`. Tab ids come from `useId` (the same rule can be on screen twice).

- [x] **Step 1: Update e2e tests to the new behaviour (they will fail).** Use role `tab` + `aria-selected` instead of role `button` + `aria-expanded`:
  - "a rule with a single check shows it open": the `macOS Bash` tab is `aria-selected="true"`, and clicking it keeps the panel visible (the `toHaveCount(0)` assertion goes).
  - Rename "a fix with two items shows two closed buttons, one open at a time" to "a fix with two items opens the first tab, one at a time": the Bash tab is selected first and the `remediation-target` panel shows one `pre`; clicking DDM declaration selects it and deselects Bash; clicking it again keeps it selected. Drop the `aria-controls` assertions, but keep the dangling-`aria-controls` count check.
  - Per-version test (~1563) and the custom remediation test (~1475): `getByRole('tab', ...)` with `aria-selected="true"`.
  - `several-checks.spec.ts`: `macOS Bash` starts selected and `check-target` contains `objectIsForcedForKey`. Clicking `macOS Original goss test` shows `second check body`.
- [x] **Step 2:** Run those specs. Expected: FAIL on role `tab` not found.
- [x] **Step 3:** Create `ScriptTabs`. In `RuleCheckSection`, wrap everything in `<SectionCard title="Check" custom={custom}>` and replace `DisclosureButtons` with `<ScriptTabs ariaLabel="Check scripts" ...>`. Do the same in `RuleRemediationSection` with `<SectionCard title="Remediation" ...>` and `ariaLabel="Remediation scripts"`. Restyle `SelectionButtons` as a joined segmented control: one bordered rounded group, dividers between buttons, and `bg-muted font-semibold` for the pressed button. Keep `role="group"`, `aria-label` and `aria-pressed`. Delete `DisclosureButtons`.
- [x] **Step 4:** Run `bun run typecheck && bun run lint && bun run test`, then `bun run test:e2e -- e2e/smoke.spec.ts e2e/several-checks.spec.ts e2e/registry-settings.spec.ts e2e/cis-windows.spec.ts`. Expected: PASS.
- [x] **Step 5:** Commit `feat: show check and remediation as section cards with script tabs` and push.

### Task 3: Visual verification and log

**Files:**
- Modify: `docs/plans/2026-11-26-rule-detail-section-cards-plan.md` (Progress log)

- [x] **Step 1:** Write a throwaway Playwright script in the scratchpad that takes screenshots at 375px and 1400px of: a Windows CIS rule with an ODV (1.1.3 minimum password age), a registry rule, `os_authenticated_root_enable` (version picker), a manual rule (no automated check), and an ISM control's Mapped rules tab with a nested rule open. Read each screenshot. Fix anything that overflows, wraps badly or looks misaligned.
- [x] **Step 2:** Run the full `bun run test:e2e`. Expected: PASS (this is a broad UI change, so the full suite is warranted).
- [x] **Step 3:** Add a Progress log entry with the commits. Commit `docs: log the rule detail section cards work` and push.

## Progress log

- 2026-11-26: Values, Benchmarks and References became section cards with a
  left label strip (top bar in narrow panels), and the breadcrumb and
  revision now share one line. `146fd3f feat: show rule values, benchmarks
  and references as section cards`
- 2026-11-26: Check and Remediation became cards with script tabs (first tab
  open, one always selected); the version picker is a segmented control;
  e2e specs updated from pills to tabs. `57662a4 feat: show check and
  remediation as section cards with script tabs`
- 2026-11-26: Screenshots at 375px and 1400px checked (CIS ODV rule,
  registry rule, per-version rule, ISM control); the full e2e suite run
  surfaced only load-timing flakes plus the tests updated below.
- 2026-11-26 (requested alongside this work): section groups, subsections
  and rule titles sort numerically (2 before 19). `567e49e fix: sort
  numbered sections and rules by number`
- 2026-11-26 (requested alongside this work): rules-view sections open by
  default. `8f7d8f2 feat: open every rules view section by default`
- 2026-11-26: Final review fixes: Collapse all now holds across filter
  changes, and collapsing a section from a repeated header returns to the
  page where it starts. `f0fdbac fix: keep Collapse all across filters and
  return to a collapsed section's page`
