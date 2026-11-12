# Design: selection coverage roll-up

Date: 2026-11-11
Status: Implemented 2026-11-12 (the calls in section 9 were made without the maintainer and still await review)

## 1. Intent

A user picks rules (mostly mSCP rules with checks) and generates an Intune bundle. Today the
app cannot answer the next question an auditor asks: "what does this selection do for ISM, or
for 800-53?" The rule mappings already hold the answer one rule at a time (the Mapped rules
tab), but nothing adds it up.

This design adds a **Coverage** view: for the current selection, how many controls of each
control framework the selected rules support through mappings, for example "Supports 41 of 312
ISM controls at ISM PROTECTED", broken down by section (ISM guideline, 800-53 family, E4EIT
function) with small progress bars, and for every control, which selected rules support it,
through which mapping file, with the mapping note. It is idea 1 (and part of idea 3, mapping
provenance) in `docs/2026-11-11-ciso-assistant-analysis.md`, section 3.

It is pure logic over data the app already loads at startup: the rule rows, the mapping index
(`webui/src/logic/mappingIndex.ts`, loaded by `webui/src/data/mappings.ts` and narrowed to the
loaded library by `linksWithinLibrary`), and the selection store. No new fetch, no new
generated file, no change to the mapping format.

## 2. Goals, non-goals, anti-goals

### Goals

- A Coverage view listing every control framework the library can be covered against, each
  with "supports N of M controls", a scope picker for the denominator, and a section breakdown
  with progress bars.
- Expanding a section lists its controls in scope with their status; expanding a control shows
  its provenance: the supporting selected rules, the mapping file id, the note, and a marker
  when the link was checked against an older release of either rule and that rule has changed.
- `supports` links count as coverage. `related` links are shown and never counted (section 4.3).
- Works with whatever sources and mapping files are loaded: today mSCP to ISM (62 hand-written
  links), later the generated mSCP to 800-53 mapping
  (`docs/plans/2026-11-11-nist-800-53-source-design.md`, section 9) and the generated E4EIT to
  ISM `related` mapping (`docs/plans/2026-11-11-asd-e4eit-source-design.md`, section 7), with
  no code change when they land.
- Lists the selected rules that support no control in any framework, so the user sees what
  their selection does not map to.
- All counting in one pure module with Vitest tests.

### Non-goals (for now)

- Chained or inferred coverage (mSCP to 800-53 to ISM, or mSCP to ISM to E4EIT). The analysis
  defers chaining until there are three or more sources and a weakest-hop rule is agreed.
- Partial versus full coverage. The mapping format has no such field; the note carries the
  nuance and is shown in provenance.
- Exporting the roll-up (CSV, Markdown in the bundle). Possible later from the same logic.
- Changing the selection from the Coverage view (no checkboxes).
- Coverage of the browse filters' result set. Coverage is about the selection only.

### Anti-goals (failure even if it technically works)

- A number that counts a `related` link, a chained link, or a link to a rule outside the loaded
  library as coverage.
- A percentage shown without its "N of M" and scope next to it. "13%" alone invites the reading
  "13% compliant", which mappings cannot claim.
- Copy that says "compliant", "meets" or "satisfies". The view says "supports", the mapping
  relation's own word.
- A denominator that silently changes with the browse filters.

## 3. Facts that shape this design

- **Mapping index shape.** `MappingsContext` (`webui/src/state/mappingsContext.ts`) gives
  `byRule: Map<ruleId, MappedRule[]>` with both ends already in the loaded library, and
  `rowsById`. For a `supports` link the source rule has an `outgoing` entry and the target rule
  an `incoming` one; a `related` link gives a `related` entry on both. Each entry carries
  `mapping` (the file id), `note`, `release`, `self_release` and, when an end is not on its
  current release, `changedKinds` / `selfChangedKinds`.
- **Direction in today's data.** Every hand-written link is mSCP rule `supports` ISM control.
  The NIST design adds mSCP rule `supports` 800-53 control. The E4EIT design adds E4EIT action
  `related` ISM control. So the frameworks that can be covered are the ones on the `to` side
  of some `supports` link: ISM now, ISM and 800-53 later. Nothing ever `supports` an E4EIT
  action.
- **Sections.** `RuleRow.sectionPath[0]` is the ISM guideline ("Guidelines for system
  hardening", 23 of them), and will be the 800-53 family ("Access Control", 20) and the E4EIT
  function ("Protect principles", 5).
- **Applicability scopes.** ISM controls carry benchmarks for classification
  (`ism_non_classified` ... `ism_top_secret`) and Essential Eight maturity (`e8_ml1` to
  `e8_ml3`) on one null-target entry; 800-53 controls will carry `nist_800_53_low`, `_moderate`,
  `_high`, `_privacy`; E4EIT actions will carry phase and domain benchmarks. `RuleRow.benchmarks`
  is the union across scopes. Benchmark display labels and order come from the vocabulary
  (`baselines/_vocabulary.json`, `termLabel` and `compareGroupKeys` in
  `webui/src/logic/vocabulary.ts`).
- **Selection.** `ViewContext.enabledSelections` holds the enabled selections whose rule is in
  the loaded library; any view can read it.
- **Views.** A view is one entry in `webui/src/views/viewRegistry.tsx` plus its id in
  `scripts/route-pages.mjs` (a test keeps them in step).

## 4. Behaviour

### 4.1 Which frameworks are listed

A **coverage framework** is a source with at least one rule that has an `incoming` `supports`
entry in the mapping index. Frameworks are ordered by their vocabulary source label.

A source that has only `related` links into or out of it (E4EIT, once imported) is not a
coverage framework. It is named in one muted line under the framework list: "ASD E4EIT links
to other frameworks only as related, so it has no coverage figure." This keeps the view honest
about why it is missing without inventing a number.

A source whose rules are only ever on the `from` side (mSCP) is never a coverage framework.

If no framework qualifies (an empty mapping index), the view says "No rules in this library
support another framework's controls yet." If nothing is selected, the view still lists the
frameworks with "Supports 0 of M" and a line pointing to the Rules view.

### 4.2 Counting

For framework F, scope S and the selected rule ids:

- **In scope:** F's rows, narrowed to rows whose `benchmarks` include S when S is a benchmark
  name, or all of F's rows when S is "All controls". M is the number of rows in scope.
- **Supporting links of a control C:** C's `incoming` `supports` entries whose `rule` is
  selected and is not itself a rule of F. With "Automated checks only" on, the supporting rule
  must also have `assessment.status === 'automated'`.
- **Status of C:** `covered` when it has at least one supporting link; otherwise
  `related-only` when a selected rule (not of F) has a `related` entry with C; otherwise
  `uncovered`.
- **N** is the number of covered controls in scope. Related-only controls are counted
  separately and never added to N.
- **Selected directly:** a control of F that is itself in the selection gets a "Selected" tag
  and is counted in a separate figure ("3 ISM controls are selected directly"). It does not
  count toward N unless a mapping also covers it.
- A link whose mapped release is older and whose rule has changed since (`changedKinds` or
  `selfChangedKinds` present and non-empty, or present and `null`) still counts; its provenance
  line gets the existing "checked against an older release" wording.

Sections: F's rows in scope grouped by `sectionPath[0]`, in first-seen order of the source's
index (which is upstream order), each with covered, related-only and total. A section with no
rows in scope is left out.

### 4.3 How `related` links are shown

`related` is the undirected relation ("these are about the same thing"); the E4EIT design
chose it because ASD's own relationship is `intersects-with` and ASD says its list is "not
intended to define the controls required". Counting it would overstate coverage. So:

- It never adds to N.
- A control reached only by `related` links from selected rules has status `related-only`,
  shown with a lighter bar segment and a "Related only" tag, with its own count ("+ 4 related
  only").
- In provenance, related links are listed under a separate "Related (not counted)" heading.

### 4.4 Scope picker

Each framework card has a select: "All controls" followed by every benchmark that appears on
F's rows, in vocabulary order, labelled from the vocabulary ("ISM PROTECTED", "Essential Eight
ML2", "800-53 Moderate", "E4EIT priority phase 1"). The default is "All controls". The choice
is per framework, kept in component state, not in the URL or storage.

### 4.5 Layout

- Header line: "Coverage of your selection (S rules)" and an "Automated checks only" checkbox,
  off by default.
- One card per framework: title (source label), the sentence "Supports N of M controls" plus
  "at <scope label>" when a benchmark scope is chosen, the related-only figure when non-zero,
  the selected-directly figure when non-zero, the scope select, and a stacked progress bar
  (covered, then related-only, then the rest).
- Under it, one row per section: section title, "N of M", and a small stacked bar. Rows are
  buttons that expand in place. Sections start closed.
- An expanded section lists its controls: upstream id, title, status tag. Covered and
  related-only controls first (by upstream id), then uncovered ones behind a "Show K
  uncovered" button, so a 161-control section does not open as a wall.
- Clicking a covered or related-only control expands its provenance: for each supporting
  selected rule, upstream id, title, the mapping file id in muted mono text, the note, and the
  older-release marker when it applies; then the "Related (not counted)" list the same way.
- "Selected rules that support no control" at the bottom: the count, expandable to the list of
  selected rules (upstream id, title) with no `supports` or `related` entry pointing into any
  coverage framework.
- Bars are plain `div`s with Tailwind widths and existing colour tokens, with an `aria-label`
  such as "41 of 312 supported, 4 related only". No chart library.
- At about 375px the cards stack, section rows wrap the title above the figures, and nothing
  scrolls horizontally.

## 5. Interfaces (pure logic)

`webui/src/logic/selectionCoverage.ts`:

```ts
export type ControlStatus = 'covered' | 'related-only' | 'uncovered'
export const ALL_CONTROLS_SCOPE = 'all'

export interface CoverageLink {
  rule: RuleRow
  mapping: string
  note: string | null
  // Either end was mapped against an older release and changed since (or the change is unknown).
  checkedAgainstOlderRelease: boolean
}

export interface ControlCoverage {
  control: RuleRow
  status: ControlStatus
  supportedBy: CoverageLink[]
  relatedTo: CoverageLink[]
  selectedDirectly: boolean
}

export interface SectionCoverage {
  section: string
  covered: number
  relatedOnly: number
  total: number
  controls: ControlCoverage[]
}

export interface FrameworkCoverage {
  sourceName: string
  scope: string
  covered: number
  relatedOnly: number
  selectedDirectly: number
  total: number
  sections: SectionCoverage[]
}

export interface CoverageInput {
  rows: readonly RuleRow[]
  mappingsByRule: ReadonlyMap<string, MappedRule[]>
  selectedRuleIds: ReadonlySet<string>
  automatedOnly: boolean
}

export function coverageFrameworks(rows: readonly RuleRow[], mappingsByRule: ReadonlyMap<string, MappedRule[]>): { counted: string[]; relatedOnly: string[] }
export function scopeOptions(rows: readonly RuleRow[], sourceName: string, compareBenchmarks: (left: string, right: string) => number): string[]
export function frameworkCoverage(input: CoverageInput, sourceName: string, scope: string): FrameworkCoverage
export function selectedRulesSupportingNothing(input: CoverageInput, frameworkSources: readonly string[]): RuleRow[]
```

The view supplies the vocabulary comparator and labels; the logic never reads the vocabulary.

## 6. Constraints

- No new dependency. Base UI and existing `components/ui` primitives only.
- No change to the mapping file format, the validator, the generated index or the publish step.
- The view reads selection and mappings from existing state; `ViewContext` gains nothing unless
  the implementer finds it needs `rows` only (it already has them).
- Copy follows section 2's anti-goals: "supports", never "compliant".

## 7. Test strategy

- **Vitest** (`webui/src/logic/selectionCoverage.test.ts`) with small hand-built rows and
  mapping entries: framework detection (supports target listed, related-only source named,
  from-only source left out); scope narrowing by benchmark; covered versus related-only versus
  uncovered; automated-only filter; selected-directly not counted; a rule of F supporting
  another rule of F not counted; older-release marker; section grouping and order; empty
  selection; rules supporting nothing.
- **Playwright** (`webui/e2e/coverage.spec.ts`): route a fixture mapping index built with
  `buildMappingIndex` from real committed rule ids (the smoke spec routes an empty one in
  `beforeEach`), seed a selection in `localStorage`, and check the framework sentence, a scope
  change, a section expand, a control's provenance with its note, the related-only tag, and the
  "support no control" list. Assertions use counts derived from the fixture, never the library
  total, so the NIST and E4EIT imports do not break them.
- **Screenshots** at about 375px and 1280px, light and dark, read with the Read tool
  (`.claude/CLAUDE.md`).

## 8. Delivery

Plan: `docs/plans/2026-11-11-selection-coverage-plan.md`. It does not depend on the NIST
800-53 or E4EIT imports; both show up in the view when they land, through the mapping index.

## 9. Decisions made without the maintainer

| Decision | Alternative |
|---|---|
| Coverage is its own top-level view ("Coverage"), not a panel on the Generate screen. | A section on the Generate screen, which is reached only after choosing to generate and is already long. |
| Frameworks are found from the data: any source on the `to` side of a `supports` link. | A fixed list of control frameworks (ISM, 800-53, E4EIT) in code or the manifest. |
| `related` links never count; they show as "related only" and in a "Related (not counted)" provenance list. | Counting `related` as partial coverage, or hiding it entirely. |
| E4EIT (only `related` links) gets no figure, just a one-line explanation. | Chained coverage through ISM, deferred with all chaining. |
| Every selected rule counts by default; an "Automated checks only" toggle narrows to rules with checks. | Count only automated rules, since only they end up in the Intune script. |
| A selected control of the framework itself is shown as "selected directly", not counted as covered. | Count it, since the user will attest it manually. |
| Default scope is "All controls"; benchmarks are offered in vocabulary order. | Default to the first benchmark (ISM Non-classified, 800-53 Low), or remember the choice in the URL. |
| Scope choice is component state only. | URL state, so a coverage view can be shared as a link. |
| The denominator ignores the browse filters. | Narrow M by the sidebar filters too. |
| Links checked against an older, since-changed release still count, with the existing marker. | Exclude them until the maintainer re-reviews. |
| Uncovered controls in an expanded section sit behind "Show K uncovered". | List every control at once. |
| "Selected rules that support no control" lives here, not as a Generate check. | A `no-mapping` info check on the Generate screen (see the generate checks design). |

## Progress log

- 2026-11-12: Implemented in three tasks, per `2026-11-11-selection-coverage-plan.md`: the pure logic (85a6cdf "feat: add selection coverage logic over the mapping index"), the Coverage view (f752130 "feat: add a Coverage view rolling the selection up against mapped frameworks") with review fixes 153dd1b "fix: align a coverage section's count and bar to its title's first line" and c4eac9f "test: run *.test.tsx files and resolve the @ alias in Vitest", and the docs ("docs: describe the Coverage view and close the selection coverage plan").
