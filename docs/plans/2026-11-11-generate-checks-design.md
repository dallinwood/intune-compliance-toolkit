# Design: structured pre-generation checks on the Generate screen

Date: 2026-11-11
Status: Draft, written without the maintainer (see section 9 for the calls made)

## 1. Intent

The Review & generate screen (`webui/src/components/generate/GenerateReviewScreen.tsx`) warns
about problems in two unrelated ways today:

- an `overlay-issues-note` paragraph: "Custom content for N rule(s) could not be applied; they
  are shown as imported: ...";
- a "Fix these before generating:" alert listing rules blocked on a missing or invalid
  organization value, which disables the download.

Other things a user should know before deploying are not on the screen at all. A rule whose
custom changes were written for an older release, and which has since changed in a field
those changes touch, shows a warning only in that rule's detail panel
(`webui/src/hooks/useCustomChangeNotice.ts`). A selected rule that changed in the newest
release is visible only in its History tab.

This design replaces both notes with one **Checks** list, modelled on CISO Assistant's
"x-rays" (idea 2 in `docs/2026-11-11-ciso-assistant-analysis.md`, section 3). Each check has a
stable id, a severity (error, warning or info), one message, and the affected rules
("occurrences"). Errors block the download, as blocked rules do now. The list is built by one
pure function, so each check is unit-tested.

## 2. Goals, non-goals, anti-goals

### Goals

- One Checks panel at the top of the Generate screen, replacing the overlay-issue note and the
  blocked alert, with no loss of what they say today.
- A fixed, documented catalogue of checks (section 4), each with a stable id.
- Bring the custom-changes comparison and the newest-release change onto the Generate screen
  for the selected rules.
- Pure logic for building the list, with Vitest tests per check.
- Works with every source the library has: mSCP, ISM, and later 800-53 and E4EIT (every rule
  of the two new sources is manual, so they add no new check, only occurrences of existing
  ones).

### Non-goals (for now)

- Checks the user can dismiss or silence. The list is recomputed every visit.
- Checks on the bundle's generated files (script size, chunk limits). Packing already enforces
  limits.
- Exporting the check list into the bundle.
- New checks about mappings (see section 4.3).

### Anti-goals (failure even if it technically works)

- The same problem reported twice on one screen (a check and an old note, or two checks).
- A warning that blocks the download. Only errors block, and only the organization-value
  check is an error.
- A check failing to load (history fetch error) hiding the download or the other checks.
- Copy that says "overlay". User-facing text says "custom changes", as elsewhere.

## 3. Facts that shape this design

- `fetchOverlaidRule(ref)` returns `{ rule, applied, skipped }`. `skipped` (overlay id and
  message) is today's overlay-issue note. `applied` entries carry `stale: true` when the custom
  changes were written for a release other than the rule's current one.
- `classifyRule` returns `generatable`, `manual` or `blocked`. `blocked` entries have a reason
  string ("Needs an organization value" or "Organization value is invalid: ...").
- The custom-changes comparison already exists: `customChangeBaseline`, `overlayFieldPaths`,
  `customChangeStatus` (`touched`, `untouched`, `unchanged`) in
  `webui/src/logic/customChangeNotice.ts`, driven by `useCustomChangeNotice`, which fetches the
  history index, the overlay and the rule at two releases.
- The history index (`webui/src/logic/historyIndex.ts`, fetched per source by
  `fetchHistoryIndex`) holds per-rule fingerprints per release for each change kind
  (`behaviour`, `scope`, `wording`, `references`), oldest release first. Comparing the last two
  releases needs no rule file. `KIND_LABELS` in `webui/src/logic/changeLabels.ts` names the
  kinds.
- The manual attestation report already lists every selected rule with no automated check,
  with its reason, and the summary line counts them.
- Saved selections whose rule is no longer in the library are listed by
  `StaleSelectionsNotice` on the browse screen and never reach the Generate screen.
- `webui/e2e/smoke.spec.ts` finds the blocked list with
  `getByRole('alert').filter({ hasText: 'Fix these before generating' })` and expects
  "Bundles are packed once nothing is blocked" while blocked.

## 4. The checks

### 4.1 Catalogue

| Id | Severity | When | Message | Occurrence detail |
|---|---|---|---|---|
| `organization-value` | error | `classifyRule` returned `blocked` | "Fix these before generating: set a valid organization value in each rule's details on the browse screen." | the blocked reason |
| `custom-changes-not-applied` | warning | `skipped` is non-empty | "Custom changes could not be applied to these rules; they are shown and generated as imported." | "<custom change id>: <message>", one line per skipped entry |
| `custom-changes-outdated` | warning | a stale application whose status is `touched`, or whose comparison could not be made | "Custom changes were written for an older release, and the rule has since changed in a field they touch. Review them before deploying." | `touched`: "Written for <release label>; changed: <labels>". Unknown: "Written for <release>; could not compare with the release history." |
| `custom-changes-older-release` | info | a stale application whose status is `untouched` or `unchanged` | "Custom changes were written for an older release; the rule has not changed in any field they touch." | "Written for <release label>" |
| `changed-in-newest-release` | info | the rule's source has two or more releases and the rule's `behaviour` or `scope` fingerprint differs between the previous and the current release, or the rule is new in the current release | "Changed in the newest release of its framework. What it checks or where it applies may differ from earlier bundles." | "<kind labels> since <previous release label>", or "New in <current release label>" |
| `history-unavailable` | info | a history index needed for the two checks above failed to load | "Release history could not be loaded for <source labels>, so release checks were skipped for their rules." | none (no occurrences) |

### 4.2 Folded in and left out

- **Blocked rules** become `organization-value`. Its message starts with "Fix these before
  generating" and the panel renders error checks inside `role="alert"`, so the existing e2e
  assertions still match. The download stays disabled while any error check exists, and the
  "Bundles are packed once nothing is blocked" line stays.
- **The overlay-issue note** becomes `custom-changes-not-applied`, now with the reason per rule
  instead of only the ids.
- **Selected rule with no automated check:** left out. The manual attestation report and the
  summary line already say it, with the reason; a check would duplicate them.
- **Selected rule removed in the newest release:** left out. A removed rule is not in the
  loaded library, so it never reaches this screen; `StaleSelectionsNotice` already reports it.
- **Selected rule with no mapping:** left out here. It is a fact about framework coverage, not
  a problem with the bundle, and the selection coverage design
  (`docs/plans/2026-11-11-selection-coverage-design.md`) lists "selected rules that support no
  control" in the Coverage view.
- **Wording or references change only** in the newest release does not raise
  `changed-in-newest-release`; it does not change what the bundle checks.

### 4.3 Order and shape

- Checks are ordered by severity (error, warning, info), then by the catalogue order above.
- A check with no occurrences is not shown (except `history-unavailable`, which has none by
  nature and is shown when it applies).
- Occurrences are sorted by upstream rule id; one rule can appear in several checks.
- The ids are stable: tests, `data-check-id` attributes and future docs refer to them.

## 5. Behaviour

### 5.1 Loading

The screen keeps its current flow and adds two loads in parallel with the rule fetches:

- **History:** `fetchHistoryIndex(sourceName)` once for each distinct source among the
  selected rules whose manifest entry lists two or more releases (the same test
  `useSourceReleaseCount` uses). A rejected fetch adds that source to `history-unavailable`
  and skips the release checks for its rules; it never fails the review.
- **Custom changes:** for every `applied` entry with `stale: true`, run the same comparison
  `useCustomChangeNotice` runs. That comparison moves out of the hook into
  `loadCustomChangeStatus(rule, application, vocabularyIndex)` in
  `webui/src/data/customChanges.ts`; the hook calls it and behaves exactly as before. A
  rejected comparison is an "unknown" result, reported under `custom-changes-outdated`.

The download does not wait for these loads: while they are pending the panel shows "Running
checks..." under any error checks, which are known as soon as the rules are classified. Error
checks come only from classification, so gating is unchanged.

### 5.2 Panel

- Heading "Checks" with a count per severity ("1 error, 2 warnings, 3 notes").
- One row per check: a severity tag (Error, Warning, Note) using existing tokens (the blocked
  box's warning styles for errors and warnings, muted for info), the message, the occurrence
  count, and a toggle for the occurrence list. Errors and warnings start open; notes start
  closed.
- Each occurrence: upstream rule id in mono, title, detail in smaller text.
- Error checks render inside `role="alert"`. The panel has `data-testid="generate-checks"`, and
  each row `data-check-id="<id>"`.
- No checks: one muted line, "No issues found with this selection."
- At about 375px rows wrap: tag and message on one line, count and toggle below; long rule ids
  break (`break-all`), as today.

## 6. Interfaces (pure logic)

`webui/src/logic/generateChecks.ts`:

```ts
export type CheckSeverity = 'error' | 'warning' | 'info'
export const GENERATE_CHECK_IDS = [
  'organization-value',
  'custom-changes-not-applied',
  'custom-changes-outdated',
  'custom-changes-older-release',
  'changed-in-newest-release',
  'history-unavailable',
] as const
export type GenerateCheckId = (typeof GENERATE_CHECK_IDS)[number]

export interface CheckOccurrence { ruleId: string; title: string; detail: string | null }
export interface GenerateCheck { id: GenerateCheckId; severity: CheckSeverity; message: string; occurrences: CheckOccurrence[] }

export type CustomChangeResult =
  | { kind: 'compared'; status: CustomChangeStatus; releaseLabel: string }
  | { kind: 'unknown'; release: string }

export interface GenerateCheckInput {
  blocked: readonly BlockedEntry[]
  skippedCustomChanges: readonly { ruleId: string; title: string; skipped: readonly SkippedOverlay[] }[]
  customChanges: readonly { ruleId: string; title: string; result: CustomChangeResult }[]
  newestReleaseChanges: readonly { ruleId: string; title: string; change: NewestReleaseChange }[]
  historyUnavailableSourceLabels: readonly string[]
}

export type NewestReleaseChange =
  | { kind: 'changed'; kinds: ChangeKind[]; previousLabel: string }
  | { kind: 'added'; currentLabel: string }

// null when the source has fewer than two releases, the rule is absent from the
// current release, or only wording or references changed.
export function newestReleaseChange(history: HistoryIndex, ruleId: string): NewestReleaseChange | null

export function buildGenerateChecks(input: GenerateCheckInput): GenerateCheck[]
export function hasBlockingCheck(checks: readonly GenerateCheck[]): boolean
export function severityCounts(checks: readonly GenerateCheck[]): Record<CheckSeverity, number>
```

## 7. Test strategy

- **Vitest** (`webui/src/logic/generateChecks.test.ts`): one test per catalogue row, the
  left-out cases (a manual rule raises nothing; wording-only change raises nothing), ordering,
  empty checks omitted, occurrence sorting, `newestReleaseChange` for changed, added, unchanged,
  single-release and absent rules, `hasBlockingCheck` and `severityCounts`. The existing
  `customChangeNotice.test.ts` stays green; a small test for `loadCustomChangeStatus` with fake
  fetchers is optional if the extraction is a pure move.
- **Playwright**: the existing smoke tests for blocked selections and manual-only download keep
  passing unchanged. New tests in `webui/e2e/generate-checks.spec.ts`: a blocked rule shows the
  `organization-value` row inside an alert; a selection with a rule changed between the last two
  mSCP releases shows `changed-in-newest-release` (closed, opens on click); a 404 on one
  source's history index shows `history-unavailable` and the download still works; a clean
  selection shows "No issues found with this selection."
- **Screenshots** at about 375px and 1280px, light and dark, with every severity visible,
  read with the Read tool (`.claude/CLAUDE.md`).

## 8. Delivery

Plan: `docs/plans/2026-11-11-generate-checks-plan.md`. It does not depend on the NIST 800-53 or
E4EIT imports. Their rules are all manual, so they only ever appear as occurrences of
`changed-in-newest-release` (once they have two releases) or of the custom-changes checks.

## 9. Decisions made without the maintainer

| Decision | Alternative |
|---|---|
| Only `organization-value` is an error; nothing new blocks the download. | Make `custom-changes-outdated` an error until the maintainer marks the custom changes up to date. |
| "No automated check" is not a check; the manual attestation report covers it. | An info check listing manual rules, duplicating the report. |
| "Removed in the newest release" is not a check; `StaleSelectionsNotice` covers it. | Pass stale selections into the Generate screen and report them there too. |
| "No mapping" is not a Generate check; it lives in the Coverage view. | An info check `no-mapping`, which before the 800-53 mapping lands would list most mSCP rules. |
| `changed-in-newest-release` counts only `behaviour` and `scope` changes, plus newly added rules. | Any change kind, including wording and references. |
| "Newest release" means the last two releases of the rule's source, not the release the user last generated against (the app does not record that). | Store the release of each selection at selection time and compare against it. |
| Custom changes whose rule did not change in a touched field are an info note, not hidden. | Hide them, as nothing needs doing. |
| A failed history or comparison load is an info check (`history-unavailable`) or an unknown result under the warning, never a blocker. | Block until history loads, or drop the checks silently. |
| The custom-changes comparison moves from the hook into `webui/src/data/customChanges.ts` so the screen and the detail panel share it. | Duplicate the fetch sequence in the Generate screen. |
| Errors and warnings start open, notes closed. | All closed, with counts only. |
| Error checks keep the "Fix these before generating" wording and `role="alert"`, so existing e2e tests keep passing. | New wording, updating the e2e tests. |

## Progress log
