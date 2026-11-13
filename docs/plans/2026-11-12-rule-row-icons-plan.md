# Rule Row Status Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Automated / Manual pill in rule rows with a compact strip of status icons: platform icons (or a clipboard when a rule has no platform) coloured by automation status, then up to two link icons coloured by the status of the directly linked rules, each with a check or dash mark as a non-colour cue, plus a one-line legend above the rule table.

**Architecture:** A pure module `webui/src/logic/ruleStatusIcons.ts` turns a `RuleRow` plus its link counts into an ordered list of icons with labels. `webui/src/logic/targetIcons.ts` gains the extra Bootstrap Icons glyphs. A `RuleStatusIcons` component renders the strip (one tab stop, per-icon hover tooltips, a combined focus tooltip) and replaces `AssessmentCell`'s body; a `RuleStatusLegend` sits above the rule table.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Base UI tooltip (installed), bootstrap-icons 1.13.2 (installed), Vitest, Playwright. Run with Bun, except `test:e2e`, which needs real Node.

**Spec:** `docs/plans/2026-11-12-rule-row-icons-design.md` (Option B; the option choice awaits maintainer confirmation, so confirm before starting Task 2).

**Depends on:** nothing unlanded.

## Global Constraints

- No new dependencies. Glyphs come from the installed `bootstrap-icons` package via `bootstrap-icons/icons/<name>.svg?raw` imports in `targetIcons.ts`, exactly as the platform glyphs do. Do not inline SVG copies. No licence entry is added: the package is already bundled, so the licence plugin already lists it.
- Glyphs: `link`, `clipboard`, `check-circle-fill`, `dash-circle-fill`, plus the existing platform glyphs.
- Colours: add `--status-automated` and `--status-manual` (and `--color-status-automated` / `--color-status-manual` in the `@theme` block) with exactly the light and dark values in design section 6.1. Do not change `--success-*` or `--warning-*`.
- Colour is never the only cue: every status icon carries its check or dash mark.
- Per-target status is the rule's assessment status (design section 4). Do not change the index schema or any file under `baselines/` or `tools/`.
- Links: direct links only, counted as distinct linked rule ids present in `rowsById`. Indirect chains stay on the Mapped rules tab.
- Never use the em dash character (U+2014) in code, copy or comments.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why"; match the surrounding code's idioms.
- E2e assertions never hard-code rule totals; pick rule ids and link counts from the release indexes and `baselines/_mappings/rules/*.json` with `readFileSync`, as `frameworks.spec.ts` does.
- Verification before calling a UI task done: `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`), plus ad hoc screenshots at about 375px and 1280px in light and dark mode, read with the Read tool (`.claude/CLAUDE.md`).
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; other agents may have uncommitted changes; never stage `.superpowers/`. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` in each task's commit.

## Review Focus

- **Second cue.** Check and dash marks are visible at 1x and 2x, in both themes, on normal, hover and expanded rows.
- **Keyboard.** One tab stop per strip; its focus tooltip lists every icon; its accessible name matches.
- **Width.** At 1280px the title column gains the space the pill used; at 375px the strip and benchmark text still fold under the title without sideways scroll.

---

### Task 1: Status icon logic, glyphs and tokens

**Files:**
- Create: `webui/src/logic/ruleStatusIcons.ts`, `webui/src/logic/ruleStatusIcons.test.ts`
- Modify: `webui/src/logic/targetIcons.ts` (add `NO_TARGET_ICON`, `LINK_ICON`, `STATUS_MARK_ICONS`), `webui/src/logic/targetIcons.test.ts`, `webui/src/index.css` (the two tokens per theme and their `@theme` entries)

**Interfaces:** exactly design section 7.

**Exact behaviour:**
- `targetStatus(row, targetName)`: `row.assessment.status`.
- `linkStatusCounts(ruleId, byRule, rowsById)`: the distinct `rule` values of `byRule.get(ruleId)` (any relation and direction), excluding `ruleId` itself and ids not in `rowsById`, counted by their row's `assessment.status`. Missing entry gives `{ automated: 0, manual: 0 }`.
- `rowStatusIcons(row, linkCounts, index)`: first, for each `targetIconsOf(row.targetKeys)` entry, a `target` icon with label `"<target label>: automated check"` or `"<target label>: manual check"` plus `" - <reason label>"` when `manual_reason` is set (reason label via `termLabel(index, 'manual_reasons', reason)`, as `assessmentLabel` does); when there is no target, one `no-target` icon labelled `"No platform: automated"` or `"No platform: manual"` plus the same reason suffix. Then a `link` icon with status `automated` when `linkCounts.automated > 0`, labelled `"Linked to <n> automated rule"` / `"rules"`, then the same for `manual`.
- `stripAccessibleName(icons)`: the labels joined with `". "`.
- `STATUS_MARK_ICONS`: `automated` is `check-circle-fill`, `manual` is `dash-circle-fill`.

- [ ] **Step 1: Write the failing tests** in `ruleStatusIcons.test.ts`:
  - `a single-target automated rule gives one green target icon`
  - `every target takes the rule's status, in targetIconsOf order`
  - `a manual rule's labels carry the manual reason label`
  - `a rule with no target gives one no-target icon`
  - `link counts use distinct linked ids of every relation and direction`
  - `linked ids missing from the library and the rule itself are ignored`
  - `mixed links give an automated then a manual link icon with counts`
  - `singular and plural link labels`
  - `no links give no link icons`
  - `the accessible name joins the labels`
  - and in `targetIcons.test.ts`: `the extra glyphs are svg markup painted with currentColor`
- [ ] **Step 2:** Run `bun run test`; the new tests fail.
- [ ] **Step 3:** Implement; add the tokens to `index.css`.
- [ ] **Step 4:** `bun run test`, `bun run lint`, `bunx tsc -b` pass.
- [ ] **Step 5:** Commit `feat: add rule status icon logic and status colour tokens` with the progress log entry; push.

### Task 2: Status strip in rule rows, legend and narrower column

**Files:**
- Create: `webui/src/components/rules/RuleStatusIcons.tsx`, `webui/src/components/rules/RuleStatusLegend.tsx`
- Modify: `webui/src/components/rules/RuleRowCells.tsx` (`AssessmentCell` renders `RuleStatusIcons`; `AssessmentBadge` stays for the summary), `webui/src/components/rules/TargetIcons.tsx` (optional `statusByTarget` prop colouring each icon and adding its mark; without it icons stay muted as today), `webui/src/components/rules/MappedRuleSummary.tsx` (coloured platform icons beside the existing pill), `webui/src/components/rules/RuleTable.tsx` (assessment column `md:w-60` to `md:w-32`, the column comment updated; legend above the first table), `webui/e2e/smoke.spec.ts` (update the "target platform icons" tests and any row assertion on pill text)
- Test: `webui/e2e/rule-status-icons.spec.ts`

**Exact behaviour:**
- Strip: `inline-flex items-center gap-2`, one element with `tabIndex={0}`, `role="group"`, `aria-label={stripAccessibleName(icons)}`, wrapped in a Base UI `Tooltip` that opens on focus and lists each label on its own line. Each icon: 16px glyph (`[&>svg]:size-4`) in `text-status-automated` or `text-status-manual`, `role="img"`, `aria-label` = its label, its own hover `Tooltip` with the same text, and the mark as a 9px absolutely positioned glyph at bottom-right (`-right-1 -bottom-0.5`) on a `bg-background` disc with a 1.5px ring of the background colour. A 1px `bg-border` divider, `aria-hidden`, between the platform part and the link part when there is a link icon.
- Link counts come from `useRuleMappings()` (`byRule`, `rowsById`), memoised per row id.
- Legend: `RuleStatusLegend` renders "Key:" and the five samples of design section 6.5 in `flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground`; sample icons `aria-hidden`.
- The Mapped rules tab group rows use `AssessmentCell`, so they get the strip too; `MappedRuleSummary` keeps `AssessmentBadge`.
- Product detail, check and remediation headings keep muted `TargetIcons` (no `statusByTarget`).

- [ ] **Step 1: Write the failing e2e tests** in `rule-status-icons.spec.ts` (ids read from data files, not hard-coded counts):
  - `an automated mSCP rule shows a macOS icon named "macOS: automated check" and no pill text`
  - `an ISM control with no platform shows a clipboard icon named "No platform: manual - <reason>"`
  - `a linked ISM control shows link icons whose names give the automated and manual counts from the mapping files`
  - `a rule with no links shows no link icon`
  - `hovering an icon shows its tooltip; focusing the strip shows every line`
  - `the legend lists the five meanings`
- [ ] **Step 2:** Run them against the dev server; they fail.
- [ ] **Step 3:** Implement the components and wire them in; update `smoke.spec.ts` assertions that read pill text in rows (the summary header still shows the pill).
- [ ] **Step 4:** `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e` pass.
- [ ] **Step 5:** Screenshots of the Rules page and the Mapped rules tab at 375px and 1280px, light and dark (rows including a hovered and an expanded row); read each and check marks, contrast, column width and wrapping.
- [ ] **Step 6:** Commit `feat: show rule status as coloured platform and link icons` with the progress log entry; push.

### Task 3: Documentation

**Files:**
- Modify: `webui/README.md` (or the user-facing help section that describes the rule table, if it mentions the Automated / Manual badge) to describe the icons and the key; the design doc's `## Progress log`.

- [ ] **Step 1:** Grep the docs for "Automated badge", "Manual -" and "pill" and update any description of the row badge.
- [ ] **Step 2:** Commit `docs: describe rule status icons and close the plan` with progress log entries in this plan and the design; push.

## Progress log
- 2026-11-13: Task 1 done. Added `ruleStatusIcons.ts` (strip icons, labels with manual reasons, distinct direct-link counts), the clipboard, link and check/dash mark glyphs in `targetIcons.ts`, and the `--status-automated` / `--status-manual` tokens per theme, with Vitest tests. Commit: 7855be2 feat: add rule status icon logic and status colour tokens
