# Generate Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Generate screen's overlay-issue note and blocked alert with one Checks panel: a fixed catalogue of checks, each with a stable id, a severity and the affected rules, adding the custom-changes comparison and newest-release changes for the selected rules.

**Architecture:** A pure module `webui/src/logic/generateChecks.ts` builds the check list from plain inputs and is tested with Vitest. The custom-changes comparison moves out of `useCustomChangeNotice` into a shared data function. `GenerateReviewScreen` gathers the inputs (classification, skipped and stale custom changes, history indexes) and renders a new `GenerateChecksPanel`.

**Tech Stack:** React 19, TypeScript, Tailwind, Vitest, Playwright. Run with Bun, except `test:e2e`, which needs real Node.

**Spec:** `docs/plans/2026-11-11-generate-checks-design.md`

**Depends on:** nothing unlanded. It works with today's mSCP and ISM data. The NIST 800-53 and E4EIT imports need no change here; their rules simply become occurrences of existing checks.

## Global Constraints

- No new dependencies.
- Never use the em dash character (U+2014) in code, copy or comments.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why"; match the surrounding code's idioms.
- User-facing text says "custom changes", never "overlay".
- Only error checks block the download, and the only error check is `organization-value`. Gating must behave exactly as `blocked.length > 0` does today.
- A failed history or comparison load never fails the review or blocks the download.
- Check ids are exactly those in design section 4.1.
- The existing smoke e2e tests for the Generate screen must pass unchanged.
- Verification before calling any UI task done: `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`), plus ad hoc screenshots at 375px and 1280px in light and dark mode, read with the Read tool (`.claude/CLAUDE.md`).
- E2e assertions never hard-code the library's rule total.
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; other agents may have uncommitted changes. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` in each task's commit.

## Review Focus

- **Duplicate reporting.** The old `overlay-issues-note` and the old blocked alert must be gone, not shown beside the panel. (Task 2.)
- **Gating.** Download disabled exactly when an `organization-value` check exists. (Task 1 `hasBlockingCheck`, Task 2 e2e.)
- **The detail panel's custom-changes notice** behaves as before after the extraction. (`history.spec.ts` and the smoke stale-note tests, Task 2.)
- **375px.** Long rule ids and details wrap without horizontal scroll. (Task 2 screenshots.)

---

### Task 1: Pure check logic

**Files:**
- Create: `webui/src/logic/generateChecks.ts`
- Test: `webui/src/logic/generateChecks.test.ts`

**Interfaces:**
- Consumes: `BlockedEntry` from `webui/src/logic/chunking.ts`; `SkippedOverlay` from `webui/src/logic/overlays.ts`; `CustomChangeStatus` from `webui/src/logic/customChangeNotice.ts`; `HistoryIndex` from `webui/src/logic/historyIndex.ts`; `ChangeKind` from `webui/src/logic/ruleChanges.ts`; `KIND_LABELS` from `webui/src/logic/changeLabels.ts`; `upstreamRuleId` from `webui/src/logic/ruleDisplay.ts`.
- Produces (exact types in design section 6): `CheckSeverity`, `GENERATE_CHECK_IDS`, `GenerateCheckId`, `CheckOccurrence`, `GenerateCheck`, `CustomChangeResult`, `NewestReleaseChange`, `GenerateCheckInput`, and
  - `export function newestReleaseChange(history: HistoryIndex, ruleId: string): NewestReleaseChange | null`
  - `export function buildGenerateChecks(input: GenerateCheckInput): GenerateCheck[]`
  - `export function hasBlockingCheck(checks: readonly GenerateCheck[]): boolean`
  - `export function severityCounts(checks: readonly GenerateCheck[]): Record<CheckSeverity, number>`

**Exact behaviour:**
- `newestReleaseChange`: `null` when `history.releases.length < 2` or the rule is missing from `history.rules` or its last `versions` entry is `null`. `{ kind: 'added', currentLabel }` when the second-to-last entry is `null`. Otherwise the kinds among `behaviour` and `scope` whose fingerprints differ; `null` when none, else `{ kind: 'changed', kinds, previousLabel }` with kinds in `CHANGE_KINDS` order.
- `buildGenerateChecks`: messages and details exactly as the design's section 4.1 table; one check per id with all its occurrences; `custom-changes-outdated` for `touched` and `unknown` results, `custom-changes-older-release` for `untouched` and `unchanged`; detail for `touched` is "Written for <releaseLabel>; changed: <labels joined by ', '>"; kind labels via `KIND_LABELS` joined by ", "; occurrences sorted by `upstreamRuleId`, then detail; checks with no occurrences dropped except `history-unavailable`, which appears only when `historyUnavailableSourceLabels` is non-empty, with the labels joined by ", " in its message; checks ordered by severity then `GENERATE_CHECK_IDS` order.
- `hasBlockingCheck`: true when any check has severity `error`.

- [ ] **Step 1: Write the failing tests:**
  - `blocked entries become one organization-value error with the reason as detail`
  - `skipped custom changes become a warning naming the custom change and message`
  - `a touched comparison is custom-changes-outdated with the changed labels`
  - `an unknown comparison is custom-changes-outdated saying it could not compare`
  - `untouched and unchanged comparisons are custom-changes-older-release notes`
  - `newestReleaseChange reports behaviour and scope changes with the previous label`
  - `newestReleaseChange ignores wording-only and references-only changes`
  - `newestReleaseChange reports a rule new in the current release`
  - `newestReleaseChange is null for a single-release source or an absent rule`
  - `history-unavailable appears with source labels and no occurrences`
  - `checks with no occurrences are omitted; an empty input gives []`
  - `orders errors, then warnings, then notes, then catalogue order; occurrences by upstream id`
  - `hasBlockingCheck is true only with an error check`; `severityCounts` counts per severity
- [ ] **Step 2: Run to verify failure.** `cd webui && bunx vitest run src/logic/generateChecks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `webui/src/logic/generateChecks.ts`.
- [ ] **Step 4: Run to verify pass**, then `bun run test`, `bun run lint`, `bunx tsc -b`.
- [ ] **Step 5: Commit**: `feat: add structured pre-generation check logic`

### Task 2: Shared custom-changes loader, Checks panel, Generate screen wiring

**Files:**
- Create: `webui/src/data/customChanges.ts`, `webui/src/components/generate/GenerateChecksPanel.tsx`, `webui/e2e/generate-checks.spec.ts`
- Modify: `webui/src/hooks/useCustomChangeNotice.ts` (call the new loader; behaviour unchanged), `webui/src/components/generate/GenerateReviewScreen.tsx`

**Interfaces:**
- Produces:
  - `export async function loadCustomChangeStatus(rule: Rule, application: OverlayApplication, vocabularyIndex: VocabularyIndex): Promise<{ status: CustomChangeStatus; notice: CustomChangeNotice; fromTag: string; toTag: string; focusPaths: string[][]; releaseLabel: string }>` holding exactly the body of today's `work()` in the hook. The hook maps it to its `ready` state and a rejection to `unknown`, as now.
  - `export function GenerateChecksPanel({ checks, pending }: { checks: GenerateCheck[]; pending: boolean })`
- Consumes: Task 1's exports; `fetchHistoryIndex` from `webui/src/data/history.ts`; the screen's existing `sources: ManifestSource[]` prop (`source.releases.length`, as `useSourceReleaseCount` reads it) to skip single-release sources; `termLabel(vocabularyIndex, 'sources', name)` for `history-unavailable`.

**Exact behaviour:**
- In `GenerateReviewScreen`, keep `overlaid` (not just `hasOverlayIssue`) per entry. From it collect `skipped` per rule and stale `applied` entries per rule. Replace `overlayIssueRuleIds` in the ready state with these inputs plus `blocked`.
- Compute error checks from classification immediately. In parallel, load history indexes (distinct sources with two or more releases) and run `loadCustomChangeStatus` for each stale application (`Promise.allSettled`). A rejected history becomes a `history-unavailable` source; a rejected comparison becomes `{ kind: 'unknown', release: application.release }`. Release labels come from the loaded history's `releases[].label`, falling back to the tag.
- While those loads are pending, pass `pending: true`; the panel shows "Running checks..." below any checks it already has.
- Remove the `overlay-issues-note` paragraph and the blocked `role="alert"` box. Keep the "Bundles are packed once nothing is blocked" line and the download `disabled` condition, now `hasBlockingCheck(checks) || (chunks.length === 0 && manual.length === 0)`.
- `GenerateChecksPanel` (design 5.2): `data-testid="generate-checks"`; heading "Checks" with counts ("1 error, 2 warnings, 3 notes", omitting zero counts); one row per check with `data-check-id`; severity tag text Error, Warning or Note; message; occurrence count; a button with `aria-expanded` toggling the occurrence list; errors and warnings open by default, notes closed; error rows inside a `role="alert"` container; occurrence = upstream id (mono, `break-all`), title, detail in smaller text; no checks and not pending: "No issues found with this selection."

**Tests:**
- Existing: `bun run test:e2e` with no edits to `smoke.spec.ts` or `history.spec.ts` (the blocked-alert and stale-note tests must still pass).
- New `webui/e2e/generate-checks.spec.ts` (reuse the empty mapping and catalog routes from `smoke.spec.ts`'s `beforeEach`; seed selections in `localStorage` as smoke does):
  - `a blocked rule shows the organization-value error and disables download`
  - `a rule changed between the last two mSCP releases shows a closed changed-in-newest-release note that opens`: pick an id from the committed mSCP history index whose `behaviour` or `scope` fingerprint differs between the last two releases; find it in the test with `readFileSync` rather than hard-coding a guess.
  - `a failing history index shows history-unavailable and the download still works`: `page.route` the mSCP history index to 404.
  - `a clean selection shows no issues found`: choose a rule with no ODV, no custom changes and no behaviour or scope change in the newest release, found the same way.
- Ad hoc screenshots: a short Playwright script in the scratchpad at 375x800 and 1280x900, light and dark, with an error, a warning and an open note visible (combine a blocked rule, a changed rule, and a 404 history if no warning occurs naturally). Read each PNG.

- [ ] **Step 1:** Extract `loadCustomChangeStatus`; run `bun run test` and the stale-note e2e tests. Expected: unchanged behaviour.
- [ ] **Step 2:** Write `generate-checks.spec.ts`; run it; expect failures.
- [ ] **Step 3:** Build `GenerateChecksPanel` and wire `GenerateReviewScreen`.
- [ ] **Step 4:** Run `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e`. Expected: all pass.
- [ ] **Step 5:** Screenshots; read them; fix and repeat.
- [ ] **Step 6: Commit**: `feat: show structured checks on the Generate screen`

### Task 3: Documentation

**Files:**
- Modify: `README.md` (the Generate section: the Checks list, its catalogue in one short table with ids and severities, and that only errors block the download), `docs/2026-11-11-ciso-assistant-analysis.md` (note idea 2 is built, with the commit hash).

- [ ] **Step 1:** Write the README text. Plain prose, no em dashes.
- [ ] **Step 2:** Update the analysis doc.
- [ ] **Step 3: Commit**: `docs: describe the Generate screen checks`

## Progress log

- 2026-11-12: Task 1 done. Added the pure check logic (`buildGenerateChecks`, `newestReleaseChange`, `hasBlockingCheck`, `severityCounts`) with Vitest coverage; no UI yet. Commit: ba8e53b feat: add structured pre-generation check logic
- 2026-11-12: Task 2 done. Extracted `loadCustomChangeStatus` into `webui/src/data/customChanges.ts`, added `GenerateChecksPanel`, and replaced the overlay-issue note and blocked alert on the Generate screen with it; new `generate-checks.spec.ts` covers error, newest-release note, history-unavailable and clean cases. Commit: c56f07b feat: show structured checks on the Generate screen
- 2026-11-12: Log entries for tasks 1 and 2 recorded. Commits: 5315dcc docs: log the generate checks logic commit in the plan; e03ca14 docs: log the Generate checks panel commit in the plan
- 2026-11-12: Task 3 done, the README now describes the Generate screen's Checks list (six checks with ids and severities, only errors block the download) and the analysis doc marks idea 2 built. Plan closed and design marked implemented. Landed in the commit logged below.
