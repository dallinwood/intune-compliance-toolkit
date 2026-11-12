# Supporting Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For selected controls with no automated check of their own (ISM, 800-53), the Generate screen offers the automated checks of the rules that support them (direct first, then through other rules), with a main toggle, per-rule choices and ODV editing in place; the download records why each was added; the Coverage view shows directly supported and supported-through-supporting-rules in two tones with each control's chain.

**Architecture:** Offer computation is one pure module (`webui/src/logic/supportingChecks.ts`) built on `supportChain` from `webui/src/logic/indirectMappings.ts`. Choices live in a persisted Zustand store and travel in the settings export. The Generate screen fetches offered rules once and re-runs only the pure classify and pack steps on each choice. Coverage extends `selectionCoverage.ts` with a second counted status.

**Tech Stack:** React 19, TypeScript, Tailwind, Base UI, Zustand, Vitest, Playwright. Run with Bun, except `test:e2e`, which needs real Node.

**Spec:** `docs/plans/2026-11-12-supporting-checks-design.md`

**Depends on:** nothing unlanded (`supportChain` and `MappingProvenance` landed with the mapped-rules rework).

## Global Constraints

- No new dependencies. Use `components/ui` (`checkbox`, `button`, `dialog`, `input`, `badge`) and Base UI.
- No change to mapping files, the validator, the generated index, the traversal rule or `INDIRECT_MAPPING_DEPTH_LIMIT`.
- Never follow peers or `related` links when finding supporting rules; use `supportChain` only.
- A pulled-in rule is never shown, counted or written as if the user selected it. "Directly" on the Coverage view means the user's own selection only.
- Selected manual controls always stay in `manual-attestation.md`; a supporting check never removes one.
- Choosing, excluding, toggling or editing an ODV never re-fetches rule files.
- The `organization-value` error check blocks the download for included supporting checks exactly as for selected rules.
- Settings `schemaVersion` stays 2; the new `supportingChecks` key is optional both ways.
- Never use the em dash character (U+2014) in code, copy, comments or commit messages.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why"; match the surrounding code's idioms.
- Verification before calling any task done: `bun run test`, `bun run lint`, `bunx tsc -b` in `webui/`; `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`); for any task that changes rendering, ad hoc Playwright screenshots at about 375px and 1280px wide, light and dark, opened with the Read tool and checked by eye (`.claude/CLAUDE.md`).
- E2e assertions never hard-code library totals; derive counts from a routed fixture mapping index (built with `buildMappingIndex` from real committed rule ids) or from named links.
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; other agents may have uncommitted changes, and `.superpowers/` is never staged. `type: summary` subject, a body saying why. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` in each task's commit.

## Review Focus

- **Peers.** No rule that only shares a control with a selected rule may be offered. (Task 1 tests.)
- **Direct first.** Through-other-rules offers are listed after direct ones and excluded by default. (Tasks 1 and 3.)
- **Honest attestation.** 1,028 ISM PROTECTED controls selected must still give 1,028 attestation entries, 56 of them noting automated support. (Task 3.)
- **No refetch on click.** A network log in the e2e test shows no rule fetch after a row checkbox changes. (Task 3.)
- **Narrow screens.** The 144-row list, the chain lines and the dialog at 375px wrap without sideways scroll. (Tasks 3, 4, 5 screenshots.)

---

### Task 1: Supporting check offers and choices (pure logic)

**Files:**
- Create: `webui/src/logic/supportingChecks.ts`, `webui/src/logic/supportingChecks.test.ts`

**Interfaces** (design 5.4):

```ts
import type { MappingHop } from './indirectMappings'
import type { MappedRule } from './mappingIndex'
import type { RuleRow } from '../types/rule-row'

export interface SupportedControlPath { controlId: string; path: MappingHop[] } // supporter up to control
export interface SupportingCheckOffer { ruleId: string; depth: number; supports: SupportedControlPath[] }
export interface SupportingCheckOffers {
  direct: SupportingCheckOffer[]
  throughOtherRules: SupportingCheckOffer[]
  alreadySelectedSupporterIds: string[]
  controlsWithSupportIds: string[]
}
export interface SupportingCheckChoices { includeSupporting: boolean; overrides: Record<string, 'include' | 'exclude'> }
export const DEFAULT_SUPPORTING_CHECK_CHOICES: SupportingCheckChoices // { includeSupporting: false, overrides: {} }

export function supportingCheckOffers(
  rowsById: ReadonlyMap<string, RuleRow>,
  byRule: ReadonlyMap<string, MappedRule[]>,
  selectedRuleIds: ReadonlySet<string>,
): SupportingCheckOffers
export function isSupportingCheckIncluded(offer: SupportingCheckOffer, choices: SupportingCheckChoices): boolean
export function includedSupportingRuleIds(offers: SupportingCheckOffers, choices: SupportingCheckChoices): string[]
export function pruneSupportingCheckChoices(choices: SupportingCheckChoices, offers: SupportingCheckOffers): SupportingCheckChoices
export function chainText(path: readonly MappingHop[], ruleLabel: (ruleId: string) => string): string // "a -> supports b -> supports c"
export function chainAccessibleText(path: readonly MappingHop[], ruleLabel: (ruleId: string) => string): string // "a supports b, which supports c"
```

**Behaviour** (design 5.1 to 5.3):
- Walk `supportChain(id, byRule, 'supported-by')` for each selected rule whose row's `assessment.status` is `manual`. Offer a reached rule only when it is automated and not selected. Reverse each path so it runs supporter to control.
- Group by supporter: depth is its smallest path length; `supports` lists every selected control, shortest path each, sorted by upstream id.
- `direct` = depth 1, sorted by upstream id; `throughOtherRules` = depth >= 2, sorted by depth then upstream id.
- `isSupportingCheckIncluded`: false when `includeSupporting` is false; else the override if present; else `depth === 1`.
- `pruneSupportingCheckChoices` drops overrides whose rule id is not offered; returns the same object when nothing changes (so the store does not re-render).

**Steps:**
- [ ] Write failing Vitest cases on hand-built rows and `byRule`: direct supporter offered; two-hop supporter through a manual rule offered at depth 2 with its path; peer (supports the same control) not offered; `related` ignored; manual supporter walked through but not offered; selected supporter listed in `alreadySelectedSupporterIds`, not offered; automated selected rule pulls nothing; one rule supporting two controls listed once at its smallest depth with both paths; defaults by depth; overrides both ways; toggle off gives `[]`; pruning; `chainText` and `chainAccessibleText`.
- [ ] Add one test over the committed data (load rows and mappings the way `indirectMappings.test.ts` does): select every ISM control with benchmark `ism_protected`, expect 144 direct, 0 through, 56 controls with support, 16 offered rules with an ODV. If the data has moved, update the numbers and the design's section 4 in the same commit, and say so in the log.
- [ ] Implement until green; time `supportingCheckOffers` on that selection in the test and assert it is under 200 ms.
- [ ] Verify (Global Constraints), commit `feat: find automated checks that support selected controls`, log, push.

---

### Task 2: Persisted choices and settings export/import

**Files:**
- Create: `webui/src/state/supportingChecksStore.ts`
- Modify: `webui/src/logic/exportImport.ts`, `webui/src/logic/exportImport.test.ts`
- Modify: the settings export/import component that calls `buildSettingsFile` and `validateSettingsFile` (find with `grep -rn buildSettingsFile webui/src`), and wherever the import result's warnings are shown

**Interfaces:**

```ts
// supportingChecksStore.ts, persisted as 'intune-toolkit:supporting-checks', version 1
export interface SupportingChecksState extends SupportingCheckChoices {
  setIncludeSupporting: (include: boolean) => void
  setRuleChoice: (ruleId: string, choice: 'include' | 'exclude' | 'default') => void
  setGroupChoice: (ruleIds: readonly string[], choice: 'include' | 'exclude') => void
  prune: (offers: SupportingCheckOffers) => void
  replaceAll: (choices: SupportingCheckChoices) => void
}

// exportImport.ts
export interface SettingsFileV2 { /* existing */ supportingChecks?: SupportingCheckChoices }
export function buildSettingsFile(selections: SelectionMap, generatedAt: string, libraryReleases: Record<string, string>, supportingChecks?: SupportingCheckChoices): SettingsFileV2
export function parseSupportingCheckChoices(raw: unknown): SupportingCheckChoices | null // null when malformed
```

**Behaviour** (design 9):
- `setRuleChoice(id, 'default')` removes the override. `setGroupChoice` writes overrides only where they differ from the default for that offer's depth (the caller passes the ids already filtered; keep the store dumb).
- `validateSettingsFile` keeps `supportingChecks` when `parseSupportingCheckChoices` accepts it; drops it and reports "Supporting check choices in this file were not readable and were ignored." when present but malformed; never rejects the file for it. Absent key: import applies `DEFAULT_SUPPORTING_CHECK_CHOICES`.
- ODVs for pulled-in rules need nothing new: they are `enabled: false` selection entries and already export. Add a test proving an `enabled: false` entry with an ODV round-trips through export, validate and `sanitizeImportedSelections`.

**Steps:**
- [ ] Failing Vitest cases: round trip with and without `supportingChecks`; malformed field dropped with the warning; non-boolean `includeSupporting` and unknown override values rejected by the parser; disabled-entry ODV round trip.
- [ ] Implement the parser, the optional field and the store; wire export and import.
- [ ] E2e (extend the existing settings export/import spec, or `smoke.spec.ts` if that is where it lives): export with the toggle on and one override, clear storage, import, the stored choices match.
- [ ] Verify, commit `feat: persist supporting check choices and carry them in settings export`, log, push.

---

### Task 3: Supporting checks on the Generate screen and in the download

**Files:**
- Create: `webui/src/components/generate/SupportingChecksPanel.tsx`, `webui/src/components/generate/SupportingCheckRow.tsx`
- Create: `webui/src/logic/supportingChecksReport.ts`, `webui/src/logic/supportingChecksReport.test.ts`
- Modify: `webui/src/components/generate/GenerateReviewScreen.tsx`, `webui/src/components/generate/ManualAttestationReport.tsx`
- Modify: `webui/src/logic/bundleFiles.ts` (+ test), `webui/src/logic/manualAttestationReport.ts` (+ test), `webui/src/logic/generateChecks.ts` (+ test)
- Modify: `webui/src/views/RulesView.tsx` if the screen needs rows or the mapping index passed in
- Create: `webui/e2e/supporting-checks.spec.ts`

**Interfaces:**

```ts
// supportingChecksReport.ts
export const SUPPORTING_CHECKS_FILE = 'supporting-checks.md'
export interface SupportingCheckReportEntry { ruleId: string; title: string; supports: SupportedControlPath[]; depth: number }
export function buildSupportingChecksMarkdown(
  included: readonly SupportingCheckReportEntry[],
  excluded: readonly SupportingCheckReportEntry[],
  ruleLabel: (ruleId: string) => string,
): string
// The selected manual controls' automated support, for the attestation report.
export function automatedSupportByControl(
  offers: SupportingCheckOffers,
  includedRuleIds: ReadonlySet<string>,
  selectedAutomatedRuleIds: ReadonlySet<string>,
  byRule: ReadonlyMap<string, MappedRule[]>,
): Map<string, string[]> // control id -> supporting rule ids, sorted

// chunking.ts ManualAttestationEntry gains:
automatedSupportRuleIds: string[] // empty = "No automated support"

// bundleFiles.ts
export function buildBundleFiles(chunks: Chunk[], manualEntries: ManualAttestationEntry[], sources: ManifestSource[], supportingChecksMarkdown: string | null): BundleFile[]

// generateChecks.ts: BlockedEntry occurrences carry
supportingCheck: boolean
```

**Behaviour** (design 6.1, 6.2, 6.4, 7):
- Panel between the Checks panel and the bundle groups, shown only when offers are non-empty: main `Checkbox`, the summary line ("144 checks available for 56 of 1,028 selected controls; 16 need an organization value"), "Review supporting checks (N)" disclosure, Direct and Through other rules groups with Include all / Exclude all, text filter and "Needs an organization value" filter, "N supporting rules are already in your selection".
- Row: checkbox (disabled while the toggle is off), upstream id, title, "Supports X, Y and N more" (expandable), chain line for depth >= 2 with `chainAccessibleText` as its `aria-label`, an ODV summary line ("Value: 15 (recommended)") without the editor yet (Task 4 adds Change and Details).
- Loading: when the toggle is on, fetch every offered rule once per offered set (same fetch and resolve path as selected rules), keep them in state, and derive classification and chunks with `useMemo` from fetched rules + choices + the selection map. Pulled-in rules use the stored `enabled: false` entry for their ODV, or `createSelectionEntry(ref)`. A pulled-in rule that classifies `manual` (for example no check for the covered versions) is shown on its row as "Not scripted: <reason>" and is not added to the attestation report. A `blocked` one becomes an `organization-value` occurrence with `supportingCheck: true` and the detail suffix "(supporting check)"; the message adds "For supporting checks, set the value under Supporting checks below."
- Download: scripts and rules JSON unchanged in shape; `supporting-checks.md` when any check is included (Direct, Through other rules, Excluded by you, each hop's mapping id); `manual-attestation.md` splits selected manual controls into "No automated support" then "Supported by automated checks in this bundle" with an "Automated support: ..." line. The on-screen report shows the same two groups (first open, second collapsed, counts in headings).

**Steps:**
- [ ] Failing Vitest cases for `buildSupportingChecksMarkdown`, `automatedSupportByControl` (selected automated supporter counts; excluded check does not), the split attestation Markdown, `buildBundleFiles` with and without the new file, the occurrence suffix and message sentence.
- [ ] Implement logic, then the panel and screen wiring.
- [ ] E2e with a routed fixture index (two ISM controls, three mSCP supporters, one with an ODV, one two-hop chain through a manual rule): panel hidden with no manual selection; toggle adds the scripted count; Through group excluded by default; excluding a row removes it from the count; no rule fetch is issued after a row click (record `page.on('request')`); an invalid stored ODV on an included supporter disables the download and excluding it re-enables it; the zip holds `supporting-checks.md` and the split attestation report.
- [ ] Screenshots at 375px and 1280px, light and dark, of the panel open with the real committed data and every ISM PROTECTED control selected (seed `localStorage`), read with the Read tool.
- [ ] Verify, commit `feat: offer automated checks from supporting rules on the Generate screen`, log, push.

---

### Task 4: Organization values for supporting checks without leaving the Generate screen

**Files:**
- Modify: `webui/src/components/generate/SupportingCheckRow.tsx`
- Create: `webui/src/components/generate/SupportingCheckDetailsDialog.tsx`
- Modify: `webui/src/components/rules/OrgDefinedValueInput.tsx` only if it needs a `compact` prop for the inline layout
- Modify: `webui/e2e/supporting-checks.spec.ts`

**Interfaces:**

```ts
export function SupportingCheckDetailsDialog(props: {
  ruleRef: RuleRef
  title: string // "<upstream id> - <title>"
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element // DialogContent holding <RuleDetailPanel ruleRef={ruleRef} nested />
```

**Behaviour** (design 6.3, 10):
- "Change" (a button with `aria-expanded`/`aria-controls`) opens the existing `OrgDefinedValueInput` inline under the row, with its quick picks; commits through `setOdvValue` / `clearOdvValue` on the selection store (an `enabled: false` entry for an unselected rule). The row's summary updates to "(set by you)".
- "Details" opens the dialog; Escape and the close button close it; focus returns to "Details"; the screen keeps scroll position. The ODV editor inside the dialog writes to the same store, so the row updates live.
- Changing a value re-classifies only through the Task 3 `useMemo`; no fetch.

**Steps:**
- [ ] E2e: quick-pick "Recommended" and a typed value both update the row and the scripted count; an invalid typed value shows the input's error and is never committed; dialog opens with the rule's title, value set inside it shows on the row after close, focus is back on "Details"; no rule fetch after the value change.
- [ ] Implement.
- [ ] Screenshots at 375px and 1280px, light and dark: a row with "Change" open, and the dialog open, read with the Read tool.
- [ ] Verify, commit `feat: set organization values for supporting checks on the Generate screen`, log, push.

---

### Task 5: Two-tone Coverage with chains, and docs

**Files:**
- Modify: `webui/src/logic/selectionCoverage.ts`, `webui/src/logic/selectionCoverage.test.ts`
- Modify: `webui/src/components/selectionCoverage/CoverageBar.tsx`, `webui/src/components/selectionCoverage/FrameworkCoverageCard.tsx`, `webui/src/views/CoverageView.tsx`
- Modify: `webui/e2e/coverage.spec.ts`
- Modify: `README.md` (Generate and Coverage paragraphs), `docs/plans/2026-11-12-supporting-checks-design.md` (Status line)

**Interfaces** (design 8.3):

```ts
export type ControlStatus = 'covered' | 'covered-through-supporting' | 'related-only' | 'uncovered'
export interface CoverageChain { path: MappingHop[]; startsAtSupportingCheck: boolean }
// ControlCoverage += throughChains: CoverageChain[]
// SectionCoverage += coveredThroughSupporting: number
// FrameworkCoverage += coveredThroughSupporting: number; potentialThroughSupporting: number
// CoverageInput += includedSupportingRuleIds: ReadonlySet<string>; offeredSupportingRuleIds: ReadonlySet<string>

// CoverageBar props
interface CoverageBarProps { covered: number; coveredThroughSupporting: number; relatedOnly: number; total: number; label: string; className?: string }
export function coverageHeadline(coverage: FrameworkCoverage, scopeLabel: string | null): string
// "Supports 61 directly, +14 through supporting rules, of 1,143 at ISM PROTECTED"; without "+0 ..." when zero
```

**Behaviour** (design 8):
- Direct = today's `covered` (one hop from a selected rule). Through = not direct, reached by `supportChain(ruleId, byRule, 'supports')` from an effective rule (selected or included supporting) where the chain starts at a supporting check or is two or more hops. Chains listed nearest first, ties by rule ids.
- `potentialThroughSupporting` uses selected plus every offered rule.
- View reads the Task 2 store and computes offers with Task 1; when the toggle is off and the potential exceeds the current figure, a muted line "+K more through supporting checks you have not added." and a button "Add supporting checks" (accessible name "Add supporting checks to the bundle") that sets the shared toggle.
- Bar: direct `bg-primary`, through `bg-primary/50`, related only `bg-muted-foreground/30`; `aria-label` in words. Section rows "9 + 4 of 88". Control tag "Through supporting rules"; expanded provenance adds a "Through" list of `chainText` lines with `MappingProvenance` per hop and "(supporting check)" markers.
- Existing callers passing empty sets get identical numbers (a test pins this).

**Steps:**
- [ ] Failing Vitest cases: empty sets reproduce today's output; included supporting check makes a selected ISM control `covered-through-supporting`; two-hop chain from a selected rule counts as through; direct wins over through; related only never counts; automated-only filter applies to both; potential vs included; section counts; headline text with and without through.
- [ ] Implement logic, bar, card and view.
- [ ] E2e in `coverage.spec.ts` with the fixture index: headline, three-segment bar label, a control's chain text, the "Add supporting checks" button flipping the toggle and the numbers.
- [ ] Screenshots at 375px and 1280px, light and dark, of the ISM card with a section and a chained control expanded, read with the Read tool.
- [ ] Update README and the design's Status; verify, commit `feat: show coverage through supporting rules in a second tone`, log, push.

## Progress log

- 2026-11-12: Task 1 done. Added `supportingChecks.ts` (offers, choices, chain text) with Vitest tests including the real-data check of the design numbers (144 direct, 0 through, 56 controls, 16 with an ODV; numbers unchanged, design section 4 still correct). Commit: ab60763 feat: find automated checks that support selected controls
- 2026-11-12: Task 2 done (logic and state; the e2e step of the task is left for the e2e pass). Added `supportingChecksStore.ts` (persisted choices, storage access wrapped), the optional `supportingChecks` field in the settings file with `parseSupportingCheckChoices`, an import warning when the field is unreadable, and wired Export/Import. Old-format files import unchanged. Commit: see git log, subject "feat: persist supporting check choices and carry them in settings export"
