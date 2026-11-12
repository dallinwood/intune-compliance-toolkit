# Design: supporting checks (pull automated checks through the supports chain)

Date: 2026-11-12
Status: Proposed. The maintainer answered the three open questions (section 1); section 12 lists
the calls made without the maintainer.

## 1. Intent

The maintainer, verbatim: "Say I select an ISM rule, it may not have any automated checks
itself, but it may have a list of rules that support this rule, so we can pull the automated
checks from those rules to help support this rule that has no checks. I'm not after an insane
exponential mapped rules field, and directly mapped rules are more important than indirect."

Two uses of the same idea:

- **(a) Coverage.** The Coverage view shows how much of a framework the selection supports
  directly, and how much more it supports only through supporting rules.
- **(b) Generate.** The Generate screen offers to add the automated checks of rules that
  support the selected controls, so an ISM selection produces an Intune script instead of only
  a manual attestation list.

Maintainer's answers (binding):

1. **Generate offers, it does not impose.** A main toggle to bundle in supporting rules, plus a
   way to see the list of pulled-in checks and turn each on or off.
2. **Coverage is two-tone** per framework and per section: solid for directly supported,
   lighter for covered only through supporting rules. Headline: "Supports N directly, +M
   through supporting rules, of T". Clicking a control shows its chain, for example
   "Through: os_gatekeeper_enable -> supports ISM-0843 -> supports ISM-1234".
3. **Organization values (ODVs) for pulled-in rules are set on the Generate screen**: open the
   rule's details without leaving the page (a dialog), set the value, close; plus a quick
   inline add (type a value or pick a recommended option) without opening the details.

## 2. Goals, non-goals, anti-goals

### Goals

- One pure function decides which rules are offered, nearest first, deduplicated, with the
  path back to every selected control each one supports.
- The Generate screen offers them behind one toggle, with per-rule choices, ODV editing in
  place, and traceability in the download.
- The Coverage view counts what the bundle will contain, in two tones, and shows each control's
  chain.
- Choices survive reloads and travel with settings export and import.

### Non-goals

- Changing the mapping format, the validator or the traversal rule. The supports chain is the
  one the mapped-rules rework confirmed (section 3).
- Counting `related` links as support. They stay "related only", as today.
- Adding pulled-in rules to the user's selection. They are a separate layer that can be turned
  off in one click.
- Partial versus full support. A `supports` link says "helps with", not "satisfies".

### Anti-goals (failure even if it technically works)

- Peers. A rule that supports the same control as a selected rule is not a supporting rule of
  that selected rule. Following peers is the "exponential mapped rules field" the maintainer
  rejected.
- A pulled-in check that looks like the user selected it: in the list, in the Coverage counts
  ("directly" must mean the user's own selection), or in the download.
- A control reported as needing no attestation because a supporting check exists. A
  supporting check is evidence, not a substitute for the control.
- Re-fetching every rule file when one checkbox changes.
- A layout at 375px that squeezes rule titles into one word per line (the Milestone 5 failure
  `.claude/CLAUDE.md` describes).

## 3. Facts that shape this design

- **Traversal** (`docs/plans/2026-11-12-mapped-rules-rework-design.md`, section 5.1, confirmed
  by the maintainer): `supports` hops in one direction only, no peers, depth cap 4
  (`INDIRECT_MAPPING_DEPTH_LIMIT`). `webui/src/logic/indirectMappings.ts` exports
  `supportChain(startRuleId, byRule, direction, depthLimit?)`: with `'supported-by'` it lists
  the rules that support the start rule, nearest first, each once by its shortest path (ties
  by rule ids), `related` links ignored. That is exactly the "supporting rules" walk.
- **Graph today.** mSCP rules only `support`; ISM and 800-53 controls are only supported; no
  control supports another control. So every supporting rule is one hop away today. The
  maintainer's example chain (`os_gatekeeper_enable -> ISM-0843 -> ISM-1234`) does not occur
  in the data yet; the design handles it for when a layer such as a Windows benchmark or a
  control-to-control mapping lands.
- **Classification.** `classifyRule(rule, selection, coveredVersions, index)` in
  `webui/src/logic/chunking.ts` returns `generatable`, `manual` or `blocked`. Every ISM, 800-53
  and E4EIT rule is `manual` (`no_check`). `blocked` (missing or invalid ODV) disables the
  download through the `organization-value` error check
  (`webui/src/logic/generateChecks.ts`).
- **ODV storage.** `SelectionEntry` (`webui/src/logic/selectionEntry.ts`) holds `enabled` and
  `odvValue` per rule, and the store keeps an entry whose `enabled` is false. So a value for a
  rule the user never selected can live in the same map, is read by `useStoredOdvValue`, and
  is already exported (`buildSettingsFile` writes every entry). `OrgDefinedValueInput`
  (`webui/src/components/rules/OrgDefinedValueInput.tsx`) already offers typed input and
  `odvQuickPicks` (Recommended, plus one pick per benchmark value). `effectiveOdvValue` falls
  back to the recommended value.
- **Bundle.** `buildBundleFiles` writes a discovery script and a `-rules.json` per chunk
  (chunks by source, release, section) plus `manual-attestation.md`. The rules JSON entries
  are Intune's custom compliance schema (`SettingName`, `Operator`, `DataType`, `Operand`,
  `MoreInfoUrl`, `RemediationStrings`).
- **Coverage.** `webui/src/logic/selectionCoverage.ts` counts a control as `covered` when a
  selected rule (not of the framework) has a `supports` link into it, one hop only, and shows a
  selected control as "selected directly" without counting it. `CoverageBar` already draws two
  segments (covered, related only).
- **Dialog.** `webui/src/components/ui/dialog.tsx` (Base UI) exists; `RuleDetailPanel nested`
  renders a rule's details without tabs and includes the ODV editor.

## 4. Measured on real data

Throwaway script (outside the repo): latest release of each source (mSCP release_27.1, ISM
v2026.09.4, 800-53 v1.6.0, E4EIT v2026.10.15), every committed mapping file, `supports` links
only, walking supporters of each selected control to depth 4, as `supportChain` does.

**Select every ISM control at PROTECTED** (1,028 of 1,143 ISM controls; none is automated):

| Measure | Value |
|---|---|
| Automated supporting rules offered (distinct) | **144** (all mSCP) |
| of which direct (1 hop) / through other rules (2+ hops) | **144 / 0** |
| Selected controls with at least one automated supporter | 56 of 1,028 |
| Selected controls left with none | 972 |
| Most automated supporters for one control | 56 |
| Offered rules supporting more than one selected control | 38 (at most 8 controls each) |
| Supporting rules that are manual (not offered) | 4 |
| Offered rules with an ODV | **16** |
| of which have no recommended value (would block the download) | **0** |

The 16 with an ODV: `audit_retention_configure`, `os_external_storage_access_defined`,
`os_install_log_retention_configure`, `os_policy_banner_loginwindow_enforce`,
`os_policy_banner_ssh_configure`, `os_sshd_login_grace_time_configure`,
`os_unlock_active_user_session_disable`, `pwpolicy_account_inactivity_enforce`,
`pwpolicy_account_lockout_enforce`, `pwpolicy_account_lockout_timeout_enforce`,
`pwpolicy_minimum_length_enforce`, `system_settings_loginwindow_loginwindowtext_enable`,
`system_settings_screensaver_ask_for_password_delay_enforce`,
`system_settings_screensaver_timeout_enforce`, `system_settings_softwareupdate_current`,
`system_settings_time_server_configure`.

For scale: every 800-53 control selected offers 228 automated rules (102 of 1,014 controls
gain any); ISM PROTECTED plus all of 800-53 offers 243, 33 with an ODV. Selecting all ISM
controls (not only PROTECTED) offers the same 144.

What this says: the list is bounded by the number of mSCP rules (352), not by the number of
controls; it is a list of about 150 rows, not thousands. The ODV step is a short review
(16 rules), not a wall, and nothing blocks by default. The chain part is empty today, so the
"direct first" ordering costs nothing now and matters only when a second layer lands. The
attestation report still carries 972 controls with no automated support, which is the honest
answer for an ISM selection on macOS.

## 5. Which rules are offered

### 5.1 Supporting rules of a selected rule

For each **selected rule whose own assessment is manual** (an ISM control, an 800-53 control,
a manual mSCP rule), the supporting rules are
`supportChain(selectedRuleId, byRule, 'supported-by')`: rules that support it, then rules that
support those, up to 4 hops, each once by its shortest path. Peers and `related` links are never
followed (section 3).

A supporting rule is **offered** when:

1. its row's `assessment.status` is `automated` (manual supporting rules are walked through,
   since an automated rule may support a manual one that supports the control, but are never
   offered), and
2. it is not itself selected (a selected rule is already in the bundle; section 5.3).

Selected rules that are automated pull nothing in. They already have a check, and pulling for
them would only add peers' cousins.

### 5.2 Direct before indirect

Each offered rule has a **depth**: the shortest path length from any selected control it
supports. Depth 1 is a **direct supporting check** ("supports ISM-1234"); depth 2 or more is
**through other rules** ("supports ISM-0843, which supports ISM-1234").

- The list shows direct supporting checks first, then "Through other rules" as a separate
  group.
- When the main toggle is on, direct supporting checks are **included by default**; checks
  through other rules are **listed but not included by default**. The user turns them on one
  by one or with the group's "Include all".

### 5.3 Deduplication

- **A rule offered for several selected controls** is listed once, at its smallest depth, and
  names every selected control it supports: "Supports ISM-0843, ISM-1234 and 3 more". Its
  on/off choice is per rule, not per control: a check is in the bundle or not.
- **For each of those controls** the shortest path is kept (for the chain display and the
  download), ties by rule ids, as `supportChain` breaks them.
- **A rule that is both selected and a supporter** is not offered. It still counts as
  automated support for the controls it supports (section 7), and the panel says so in one
  muted line: "3 supporting rules are already in your selection."
- **A rule offered for one control and also reachable at a greater depth for another** keeps
  its smallest depth for grouping and default; both controls are listed on its row.

### 5.4 Interfaces (pure logic)

`webui/src/logic/supportingChecks.ts` (new):

```ts
export interface SupportedControlPath {
  controlId: string
  // From the supporting rule up to controlId; every step is 'supports'. Length >= 1.
  path: MappingHop[]
}

export interface SupportingCheckOffer {
  ruleId: string
  // Smallest path length to any selected control: 1 = direct.
  depth: number
  // Every selected control it supports, by upstream id, each with its shortest path.
  supports: SupportedControlPath[]
}

export interface SupportingCheckOffers {
  direct: SupportingCheckOffer[] // depth 1, sorted by upstream id
  throughOtherRules: SupportingCheckOffer[] // depth >= 2, sorted by depth then upstream id
  // Selected rules that also support another selected control; not offered.
  alreadySelectedSupporterIds: string[]
  // Selected manual rules with at least one automated supporter, offered or already selected.
  controlsWithSupportIds: string[]
}

export interface SupportingCheckChoices {
  includeSupporting: boolean
  // Only choices that differ from the default for that rule's depth are stored.
  overrides: Record<string, 'include' | 'exclude'>
}

export const DEFAULT_SUPPORTING_CHECK_CHOICES: SupportingCheckChoices

export function supportingCheckOffers(
  rowsById: ReadonlyMap<string, RuleRow>,
  byRule: ReadonlyMap<string, MappedRule[]>,
  selectedRuleIds: ReadonlySet<string>,
): SupportingCheckOffers

export function isSupportingCheckIncluded(offer: SupportingCheckOffer, choices: SupportingCheckChoices): boolean

// Rule ids that go into the bundle on top of the selection. Empty when the toggle is off.
export function includedSupportingRuleIds(offers: SupportingCheckOffers, choices: SupportingCheckChoices): string[]

// Drops overrides for rules no longer offered, so stored choices do not grow forever.
export function pruneSupportingCheckChoices(
  choices: SupportingCheckChoices,
  offers: SupportingCheckOffers,
): SupportingCheckChoices
```

The walk inverts `supportChain`'s output: for each selected manual rule, walk its supporters,
record `(supporter, control, path reversed)`, then group by supporter. `supportChain` returns
the path from the start rule (the control) down to the supporter; the offer stores it the other
way round, supporter up to control, because that is how every display reads ("X supports Y").

## 6. Generate screen

### 6.1 Placement and the main toggle

A **Supporting checks** section sits between the Checks panel and the bundle groups. It is shown
only when the selection has at least one selected manual rule with an offered supporter.

- A checkbox (the main toggle), off by default: "Add automated checks from rules that support
  your selected controls". Under it, one muted line with the measured shape: "144 checks
  available for 56 of 1,028 selected controls; 16 need an organization value."
- When on, the summary line becomes "Adding 144 of 144 supporting checks", and the review's
  scripted count and chunks include them.
- A **"Review supporting checks (144)"** disclosure (closed by default) opens the list.

### 6.2 The list

Two groups, each a heading with a count and "Include all" / "Exclude all" buttons:

1. **Direct (N)**: rules that support a selected control themselves.
2. **Through other rules (M)**: shown only when M > 0, with a caption: "These support a rule
   that supports your selected control. Not included unless you turn them on."

Each row:

- a checkbox (name: "Include <upstream id>"), disabled while the main toggle is off;
- upstream id (mono) and title, the title wrapping freely;
- "Supports ISM-0843, ISM-1234 and 3 more" (the "and N more" is a button that expands the full
  list in place);
- for a through-other-rules row, the shortest chain on one wrapped line:
  "os_gatekeeper_enable -> supports ISM-0843 -> supports ISM-1234";
- when the rule has an ODV: the ODV line (section 6.3);
- a "Details" button that opens the rule in a dialog (section 6.3).

A filter above the list: a text box (matches upstream id, title and supported control ids) and
a "Needs an organization value (16)" toggle, so the ODV review is one click. No pagination; 144
rows of plain markup is cheap, and the groups start collapsed except Direct.

### 6.3 Organization values

Every pulled-in rule with an ODV shows a compact line on its row: "Value: 15 minutes
(recommended)" or "Value: 900 (set by you)", and a "Change" button.

- **Quick add.** "Change" expands, inline under the row, the existing `OrgDefinedValueInput`
  for that rule (typed value plus the quick picks: Recommended and the per-benchmark values).
  It commits to the selection store with `setOdvValue`, which creates an entry with
  `enabled: false` for a rule the user never selected. Nothing new to validate: the input
  already runs `prepareOdvValue`.
- **Full details.** "Details" opens a `Dialog` holding `RuleDetailPanel nested` for the rule:
  discussion, check, the same ODV editor. Closing the dialog returns focus to the "Details"
  button. The Generate screen behind it keeps its scroll position and state.
- **Validation blocks as today.** A pulled-in rule that is included and classifies `blocked`
  adds an occurrence to the `organization-value` error check, so the download is disabled
  exactly as for a selected rule. The occurrence detail adds "supporting check" so the user
  knows where to fix it, and the check's message gains a second sentence when any occurrence
  is a supporting check: "For supporting checks, set the value under Supporting checks below."
  Excluding the rule, or turning the main toggle off, also clears the block.
- An excluded or not-yet-included rule's ODV is never validated for the download; it is not in
  the bundle.

### 6.4 Loading and performance

- The screen already fetches every selected rule's file. When the toggle is on, it also fetches
  the **offered** rules (all of them, not only the included ones), once per change of the
  offered set, through the same `fetchOverlaidRule` + `resolveGeneratedCheckFiles` path.
- Fetched rules are kept in state. Toggling a rule on or off, flipping the main toggle after
  the first fetch, or changing an ODV re-runs only the pure steps (`classifyRule` for the
  affected rules, then `packChunks`), never the fetches. `classifyRule` and `packChunks` on
  about 500 rules are well under a frame's budget; the plan's tests measure it.
- `supportingCheckOffers` for 1,028 selected controls is 1,028 `supportChain` calls on a
  graph whose largest fan-in is 77; it runs in `useMemo` keyed on the selection and the
  mapping index.

## 7. The download

### 7.1 Scripts and rules JSON

Pulled-in rules are generated exactly like selected ones: same classification, same chunks
(by their own source, release and section), same script and rules JSON entries. **The rules
JSON is not marked**: its entries follow Intune's custom compliance schema, and an unknown key
risks Intune rejecting the file (an assumption, not tested against Intune; section 12). Each
pulled-in rule's `RemediationStrings` stays the rule's own text, because that is what a device
user sees.

### 7.2 Traceability: `supporting-checks.md`

A new bundle file, written only when at least one supporting check is included:

```markdown
# Supporting checks

These checks were added because they support controls you selected. They were not selected
themselves. Each is listed with the selected controls it supports and how.

## Direct

- **os_gatekeeper_enable** - Enable Gatekeeper
  - Supports ISM-0843 (mapping mscp-to-asd-ism-system-hardening)
  - Supports ISM-1234 (mapping mscp-to-asd-ism-system-hardening)

## Through other rules

- **os_example** - Example
  - os_example -> supports ISM-0843 -> supports ISM-1234

## Excluded by you

- **pwpolicy_minimum_length_enforce** - ...
```

The "Excluded by you" part lists offered checks the user turned off, so an auditor sees that
they were considered. Each line names the mapping file id of the hop, which is the provenance
the Coverage view and Mapped rules tab show.

### 7.3 Manual attestation report

Selected manual controls stay in `manual-attestation.md`: a `supports` link is evidence, not a
substitute. The report splits them:

1. **"No automated support" (972 in the measured case)**, first, with today's reason.
2. **"Supported by automated checks in this bundle" (56)**, each with one extra line:
   "Automated support: os_gatekeeper_enable, os_sip_enable (see supporting-checks.md)". A
   control supported only by selected rules (not pulled in) is listed here too.

With the toggle off, only selected automated rules count as automated support, so group 2 may
still be non-empty. The on-screen `ManualAttestationReport` shows the same two groups, group 1
open, group 2 collapsed, with counts in the headings.

## 8. Coverage view

### 8.1 What the two tones mean

The Coverage view counts what the bundle will check. The **effective rules** are the selection
plus the included supporting checks (toggle on, per-rule choices applied). For a control C of
framework F in scope:

- **Directly supported (solid):** a **selected** rule not of F has a one-hop `supports` link
  into C. This is today's `covered`, unchanged.
- **Through supporting rules (lighter):** not directly supported, and an effective rule not of F
  reaches C by a `supports` chain (`supportChain(ruleId, byRule, 'supports')`, depth cap 4)
  that either starts at an included supporting check or is two or more hops long. The second
  case covers the maintainer's example: a selected `os_gatekeeper_enable` that supports
  ISM-0843, which supports ISM-1234.
- **Related only** and **uncovered**: as today. Related only is never counted.

So "through supporting rules" means **what is included now**, not what is possible. When the
main toggle is off, the card adds one muted line with the potential and a button:
"+14 more through supporting checks you have not added. [Add supporting checks]". The button
flips the same stored toggle the Generate screen uses, and its accessible name says so:
"Add supporting checks to the bundle".

This deliberately reverses two earlier non-goals: the selection coverage design's "no chained
coverage" and the mapped-rules rework's "indirect rules are not counted on the Coverage view".
The guard they wanted stays: chained support is a separate figure, a separate tone, and never
added to "directly".

### 8.2 Layout

- Headline: "Supports 61 directly, +14 through supporting rules, of 1,143" (plus "at ISM
  PROTECTED" when scoped), then the related-only and selected-directly figures as today. With
  zero through, the "+0" part is left out and the headline reads as today.
- `CoverageBar` gains a middle segment: solid `bg-primary` (direct), `bg-primary/50` (through
  supporting rules), then related only, which moves to a neutral `bg-muted-foreground/30` so
  the counted tones are the two blues. The bar's `aria-label`: "61 supported directly, 14
  through supporting rules, 4 related only, of 1,143".
- Section rows: "Guidelines for system hardening  9 + 4 of 88" and the same three-segment bar.
- A control covered through supporting rules gets the tag "Through supporting rules". Expanded,
  its provenance lists, under "Through", one line per chain, nearest first:
  "os_gatekeeper_enable -> supports ISM-0843 -> supports ISM-1234", each hop's mapping id and
  origin through the existing `MappingProvenance`, and "(supporting check)" after a rule that
  was pulled in. Direct links stay under the existing list, first.

### 8.3 Interfaces

`webui/src/logic/selectionCoverage.ts` (changed):

```ts
export type ControlStatus = 'covered' | 'covered-through-supporting' | 'related-only' | 'uncovered'

export interface CoverageChain {
  // From the effective rule up to the control; every step is 'supports'. Length >= 1.
  path: MappingHop[]
  startsAtSupportingCheck: boolean
}

export interface ControlCoverage {
  // ...existing fields...
  throughChains: CoverageChain[] // empty unless status is 'covered-through-supporting'
}

export interface SectionCoverage {
  // ...existing fields...
  coveredThroughSupporting: number
}

export interface FrameworkCoverage {
  // ...existing fields...
  coveredThroughSupporting: number
  // Controls that would become 'covered-through-supporting' if every offered check were included.
  potentialThroughSupporting: number
}

export interface CoverageInput {
  // ...existing fields...
  includedSupportingRuleIds: ReadonlySet<string>
  // Every offered supporting rule, for potentialThroughSupporting.
  offeredSupportingRuleIds: ReadonlySet<string>
}
```

Existing callers pass empty sets and get today's numbers.

## 9. Persistence

- **Store:** `webui/src/state/supportingChecksStore.ts`, Zustand `persist` under
  `intune-toolkit:supporting-checks`, holding `SupportingCheckChoices`. Same pattern as the
  selection store.
- **Not in the URL.** The selection is not in the URL either; a URL holding choices without the
  selection would mean nothing.
- **ODVs** for pulled-in rules live in the selection store as `enabled: false` entries
  (section 3), so they persist and export with no new mechanism.
- **Export/import:** `SettingsFileV2` gains an optional `supportingChecks:
  SupportingCheckChoices`. `schemaVersion` stays 2: today's validator rebuilds the file from
  known keys, so an older build importing a new file drops the field instead of failing, and a
  new build importing an old file uses the defaults. A malformed `supportingChecks` is dropped
  with a warning in the import result, not a rejection, because the selection is the important
  part.
- **Pruning:** overrides for rules no longer offered are pruned when the offers change (for
  example after the selection changes), so the stored map stays the size of the current offer.

## 10. Accessibility and layout

- The main toggle and every row are real `Checkbox`es with visible labels; row checkboxes are
  `disabled` (not hidden) while the toggle is off, with the reason in the group caption.
- Disclosures ("Review supporting checks", groups, "and N more", "Change") are buttons with
  `aria-expanded` and `aria-controls`; focus stays on the button.
- The dialog uses the existing Base UI `Dialog`: focus moves into it, Escape closes, focus
  returns to the "Details" button. Its title is the rule's upstream id and title.
- Chains are text, not arrows drawn in CSS: "->" is read as text and the line also has an
  `aria-label` in words ("os_gatekeeper_enable supports ISM-0843, which supports ISM-1234").
- The two bar tones are never the only signal: the headline, section figures and control tags
  carry the numbers in words.
- **375px:** rows stack (checkbox and id on the first line, title below, wrapping freely,
  supports list and ODV line below that); chains wrap at hop boundaries; group buttons wrap
  under the heading; the dialog is the existing full-width capped popup; nothing scrolls
  sideways. **1280px:** each row is one line of id, title and supports, ODV line under it.

## 11. Test strategy

- **Vitest:** `supportingChecks.test.ts` with hand-built maps (direct, two-hop through a manual
  rule, peer not followed, `related` ignored, manual supporter walked through but not offered,
  selected supporter not offered, a rule supporting several controls listed once at its
  smallest depth, defaults by depth, overrides, pruning, toggle off gives nothing) plus one
  test over the committed data pinning section 4's numbers (144 offered, 0 through, 56 of
  1,028 controls, 16 with ODV). `selectionCoverage.test.ts` for the new status and counts.
  `exportImport.test.ts` for the optional field. Tests for `supporting-checks.md` and the split
  attestation report.
- **Playwright:** toggle, list, per-row exclude, quick ODV pick, dialog open and close with
  focus return, a blocked supporting check disabling the download, `supporting-checks.md` in
  the zip, Coverage two-tone headline and a control's chain.
- **Screenshots** at about 375px and 1280px, light and dark, read with the Read tool.

## 12. Decisions made without the maintainer

| Decision | Alternatives |
|---|---|
| Supporting rules are pulled only for selected rules whose own assessment is manual. | Pull for every selected rule, including automated ones. |
| Only automated supporting rules are offered; manual ones are walked through but never listed. | List manual supporters too, as attestation hints. |
| Main toggle off by default (the maintainer said "offer"). | On by default. |
| With the toggle on, direct supporting checks are included by default and checks through other rules are not. | Include both by default; or exclude both and make the user pick. |
| A rule is listed once, at its smallest depth, naming every selected control it supports; one on/off choice per rule. | List it per control with a choice per control-rule pair. |
| A selected rule that supports another selected control is not offered again; it still counts as automated support. | List it, marked "already selected". |
| Pulled-in rules are not marked in the rules JSON (Intune schema; assumed strict, not tested). Traceability is a new `supporting-checks.md`. | A marker key in the rules JSON; comments in the discovery script; a section inside `manual-attestation.md`. |
| `supporting-checks.md` also lists checks the user excluded. | List only included checks. |
| Selected manual controls stay in `manual-attestation.md`, split into "No automated support" and "Supported by automated checks in this bundle". | Drop supported controls from the report; or keep one flat list. |
| Coverage's lighter tone counts what is included now; the potential appears as a muted line with a button that flips the shared toggle. | Count the potential; or give Coverage its own independent toggle. |
| "Through supporting rules" also covers chains of two or more hops from selected rules, not only pulled-in rules. | Only pulled-in rules count as through. |
| Related only moves to a neutral tone so the two counted tones are both primary. | Three shades of primary. |
| Choices persist in localStorage and in the settings export (optional field, schema version unchanged); not in the URL. | URL state; a schema version bump to 3. |
| ODVs for pulled-in rules are stored as `enabled: false` selection entries. | A separate ODV map in the supporting-checks store. |
| The details dialog renders `RuleDetailPanel nested` (no tabs). | The full panel with tabs inside the dialog; a side drawer. |
| All offered rules are fetched once when the toggle is on, so choices never trigger fetches. | Fetch only included rules, re-fetching on each change. |
| No pagination for the list; a text filter and a "Needs an organization value" filter instead. | Paginate at 50 rows. |
