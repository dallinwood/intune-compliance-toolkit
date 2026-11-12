# Design: mapped rules rework (relation-first headings, indirect mappings, provenance)

Date: 2026-11-12
Status: Implemented on 2026-11-12 (see the progress log at the end). Section 9 lists the calls
made without the maintainer; the traversal rule (section 5.1) was confirmed by the maintainer on
2026-11-12.

## 1. Intent

Three maintainer requests for the "Mapped rules" tab, designed together because they all
change the same group headings and rows:

1. **Heading wording.** A group heading reads "ASD ISM Supports", which reads as "ASD ISM
   supports this rule", the opposite of the truth: the open rule
   (`system_settings_gatekeeper_override_disallow`) supports the ISM controls. The relation
   must come first and look different from the source name.
2. **Nested (indirect) mappings.** When a mapped rule has its own mapped rules, show those on
   the open rule too, marked as indirect and grouped by the rule they came through, so a
   reader scrolling the tab sees "direct mapped rules", then "indirect, through rule A", and
   so on. A depth limit is acceptable (the maintainer suggested about 10).
3. **Mapping provenance** (rank 3 in `docs/2026-11-11-ciso-assistant-analysis.md`, section 3):
   show, compactly, which mapping file a link comes from, whether that file is generated or
   hand-written, and the note.

The Coverage view (`docs/plans/2026-11-11-selection-coverage-design.md`) already shows the
mapping file id and the note for each supporting link. This design moves that display into one
shared component used by both views instead of writing a second one.

## 2. Goals, non-goals, anti-goals

### Goals

- Group headings that say the relation first, as a badge: "[Supports] ASD ISM (2)",
  "[Supported by] NIST mSCP (3)", "[Related] ASD E4EIT (4)".
- An "Indirect mapped rules" part of the tab listing rules reached through a direct mapped
  rule, grouped by the path they came through, with the relation worded by its weakest hop.
- Each row shows its mapping file id, "Generated" or "Hand-written", and the note. An indirect
  row can expand to show every hop with its own provenance.
- All traversal, grouping and wording logic in pure functions with Vitest tests, memoized per
  rule.

### Non-goals

- Indirect coverage on the Coverage view. Coverage stays direct-only, as its design says.
- New relation types, coverage levels or strength values in the mapping format.
- A graph view of mappings.
- Changing what counts in the tab label "Mapped rules (N)" (it stays the direct count; 9).

### Anti-goals (failure even if it technically works)

- An indirect rule shown in a way that reads as a direct link, or with a stronger relation
  than its weakest hop ("Supports" for a chain that passes through a `related` link).
- A tab that, for a broad control, lists most of the mapping graph (section 4 measures this).
- Nesting that indents per level, so a phone at 375px squeezes deep rows into one word per
  line (the Milestone 5 table failure `.claude/CLAUDE.md` describes).
- A second provenance component that drifts from the Coverage view's.

## 3. Facts that shape this design

- **Data today** (`baselines/_mappings/rules/`): 9 files. Seven hand-written mSCP -> ISM files
  (113 `supports` links with notes), one generated mSCP -> 800-53 file (`supports`, generated
  by `tools/generate_mscp_nist_800_53_mapping.py` from mSCP's own citations) and one generated
  E4EIT -> ISM file (`related`, written by `tools/import_asd_e4eit.py` from ASD's published
  intersects-with list). Expanded, that is 1,225 rule pairs between 764 rules.
- **Shape of the graph.** mSCP rules only ever `support`; ISM and 800-53 controls are only ever
  supported; E4EIT actions are only ever `related`, and only to ISM controls. So every
  `supports` chain is one hop long today, and the only two-hop chains that mean anything pass
  through an ISM control into or out of E4EIT.
- **Fan-out.** The largest direct lists: 800-53 CM-7 (77), CM-7(1) (75), ISM-0380 (62), AC-20
  (57), SC-7(10) (38), E4EIT IT.PRO-04.1 (32).
- **Index.** `webui/src/logic/mappingIndex.ts` gives each rule its entries from its own side
  (`direction` `outgoing`, `incoming` or `related`), with `mapping` (the file id), `note`,
  releases and changed kinds. It carries no file description and nothing that says whether a
  file is generated.
- **Current tab.** `webui/src/components/rules/MappedRulesTab.tsx` builds the heading as
  `${sourceLabel} ${relationLabel}` from `groupMappedRulesBySource` in
  `webui/src/logic/mappedRuleView.ts`. Group open state, row expansion and the filter live in
  `webui/src/state/mappedRulesView.ts`. Expanded rows render `RuleDetailPanel nested`, which
  has no tabs, so nesting of details stays at one level.
- **No per-source noun.** The vocabulary (`baselines/_vocabulary.json`, `sources`) has a label
  per source and no word for its items ("controls", "rules", "actions").

## 4. Measured reach

A throwaway script (outside the repo) expanded every committed mapping file into pairs and
counted, for some example rules, how many **new** rules each traversal reaches at depths 1 to
4 (a rule reached at depth 1 is not counted again at depth 2). "Every link" follows any link
in either direction at every hop, which is the literal reading of request 2. "Chosen rule" is
the rule in section 5.1.

| Start rule | Direct | Every link, depth 1..4 | Chosen rule, depth 1..4 |
|---|---|---|---|
| mSCP `system_settings_gatekeeper_override_disallow` | 4 | 4, 12, 26, 130 | 4, **1**, 0, 0 |
| mSCP `os_gatekeeper_enable` | 5 | 5, 13, 23, 126 | 5, 0, 0, 0 |
| E4EIT `IT.DET-01.1` | 3 | 3, 13, 4, 15 | 3, **12**, 0, 0 |
| E4EIT `IT.GOV-01.1` | 5 | 5, 1, 2, 0 | 5, 0, 0, 0 |
| ISM `ISM-0380` | 62 | 62, 57, 73, 69 | 62, 0, 0, 0 |
| ISM `ISM-1622` | 2 | 2, 35, 65, 40 | 2, 0, 0, 0 |
| 800-53 `CM-7` | 77 | 77, 22, 50, 90 | 77, 0, 0, 0 |

- **Every link explodes.** From the gatekeeper rule it keeps growing to depth 10
  (4, 12, 26, 130, 56, 60, 98, 39, 46, 23: 494 of the 764 linked rules). From ISM-0380 it
  reaches 584 rules by depth 12. Almost all of that is siblings: other mSCP rules that support
  the same control, then the other controls those rules support, and so on.
- **Chosen rule, whole graph.** 118 of 764 linked rules gain any indirect rule: 99 mSCP rules
  (at most 4 each, all E4EIT actions reached through an ISM control) and 19 E4EIT actions (at
  most 60, mSCP rules reached through ISM controls, from IT.PRO-04.1). ISM and 800-53 controls
  gain none. The deepest chain anywhere is **2 hops**. The most distinct paths from one rule
  is 92 (IT.PRO-04.1), so traversal cost is negligible.
- **The gatekeeper example.** Direct: ISM-0864 and ISM-1584 (Supports), 800-53 CM-5 and
  SI-7(15) (Supports). Indirect: E4EIT IT.PRO-12.2, through ISM-1584, which ASD lists as
  related to that action.
- **Several paths to one rule.** From IT.DET-01.1, each of the 12 mSCP rules is reached
  through both ISM-1985 and ISM-1815 (24 paths for 12 rules), so de-duplication (5.4) matters.

## 5. Behaviour

### 5.1 Which chains count (confirmed by the maintainer, 2026-11-12)

Links are viewable from both sides, so every hop has a step as seen from the rule it leaves:
**up** (this rule `supports` the next, an `outgoing` entry), **down** (this rule is supported
by the next, `incoming`) or **sideways** (`related`).

A chain is followed only when:

1. **Every `supports` hop in the chain points the same way** (all up or all down). Up then up
   means "this rule supports something that supports X", so the rule indirectly supports X.
   Up then down means "X also supports what this rule supports": X is a peer, not a mapping
   of this rule, and this is what explodes (every mSCP rule that supports ISM-0380 would list
   the dozens of other mSCP rules that also support it).
2. **At most one hop is sideways.** `related` is undirected, so two sideways hops always make
   two rules peers through a shared third ("both related to ISM-1985"). One sideways hop at
   any point is allowed: "supports a control that ASD relates to action Y" (up, sideways) and
   "related to a control that mSCP rule Z supports" (sideways, down) are both useful.
3. **No rule appears twice in one chain**, and the open rule and its direct mapped rules are
   never listed as indirect (a direct link always wins).

So the brief's example, E4EIT action -> ISM control <- mSCP rule -> 800-53 control, stops after
the mSCP rule: the next hop (up) reverses the down hop before it. The reader of an E4EIT
action sees which mSCP rules support its related ISM controls, and not every 800-53 control
those rules happen to cite.

What the maintainer gives up: the gatekeeper rule does not list the other mSCP rules that
support ISM-0864 or ISM-1584. Those peers are one click away (open the ISM control's own
Mapped rules tab) and, for a whole selection, on the Coverage view. If the maintainer wants
them on the rule itself, the bounded alternative is a separate, closed-by-default "Also
supports the same controls" group limited to one level (12 rules for the gatekeeper rule,
57 for ISM-0380), never recursive. It is not in this design's tasks.

### 5.2 Depth limit and cycle safety

- **Cap: 4 hops** (`INDIRECT_MAPPING_DEPTH_LIMIT`). The deepest real chain under 5.1 is 2 hops.
  Four leaves room for two more layers of sources (for example a future Windows benchmark
  supporting ISM, related to E4EIT, with a CIS layer above) without a code change, while every
  extra hop weakens what the chain means; a 10-hop chain would be technically safe but not
  readable as a reason.
- **Termination does not depend on the cap.** Traversal tracks visited states as
  (rule, supports direction so far: none/up/down, sideways hop used: yes/no), at most 6 states
  per rule, and never adds a rule already on its own path. Even a cyclic mapping file (the
  validator forbids only a reversed pair, not a longer cycle) cannot loop.
- **When the cap cuts a chain**, the tab says so under the indirect part: "Stopped after 4
  levels; some further indirect links are not shown." No data triggers it today.

### 5.3 Wording of an indirect rule: the weakest hop

- All hops `supports` up: **Supports, indirectly**.
- All hops `supports` down: **Supported by, indirectly**.
- Any hop `related`: **Related, indirectly**, whatever the other hops are.

The badge always carries the word "indirectly" and a dashed outline (section 6), and indirect
rules live only under the "Indirect mapped rules" heading, so an indirect rule never reads as a
direct one. Nothing in the Coverage view counts them.

### 5.4 Several paths to the same rule

- A rule is listed **once**, under its best path: the shortest; among equally short paths, the
  strongest effective relation (supports before related); then the path whose rule ids sort
  first (stable, testable).
- The row adds one muted line naming the other rules it is also linked through at the same
  depth: "Also through ISM-1815". More than three become "Also through ISM-1815, ISM-1984,
  ISM-0123 and 2 more". Longer paths to a rule already reached are not mentioned.

### 5.5 Layout of the tab

Top to bottom:

1. The filter row, as today. It filters direct and indirect rows alike.
2. When the rule has indirect rules: a static heading "Direct mapped rules (N)". When it has
   none, no heading is added and the tab looks as it does today apart from 5.6 and 5.7.
3. The direct groups (5.6), unchanged in behaviour: one per relation and source, closed by
   default.
4. When the rule has indirect rules: a static heading "Indirect mapped rules (M)", then one
   block per **path** ("through" block), ordered by depth, then by the through rules' source
   label and upstream id. Each block:
   - A static sub-heading naming the path from the open rule, each rule preceded by its step:
     "Through ASD ISM ISM-1584 (this rule supports it)". A longer path joins steps with "then":
     "Through ASD ISM ISM-1584 (this rule supports it), then ASD E4EIT IT.PRO-12.2 (related to
     it)". The through rule's title follows on its own muted line, clamped to two lines.
   - Under it, the same relation-and-source groups as the direct part, with the indirect badge
     (5.3), closed by default, behind one fixed left border and padding. The indent is the
     same at every depth; depth is told by the sub-heading's words, never by more indentation.
5. The cap note (5.2) when it applies.

While a filter is active, groups with matches open, empty groups and empty through blocks are
hidden, and "N of M" counts apply per group, as today.

### 5.6 Group headings (request 1)

Visible: `[Supports]` badge, then the source label, then the count:
"[Supports] ASD ISM (2)", "[Supported by] NIST mSCP (3)", "[Related] ASD E4EIT (4)".

- The badge is the existing `Badge` component, one variant per relation so the three look
  different at a glance and in both themes: Supports `default`, Supported by `secondary`,
  Related `outline`. Indirect groups use the same variant plus a dashed border and the word
  "indirectly" inside the badge.
- When a group is open, a muted caption sits above its list, written from the open rule's
  side so it cannot be read backwards: "This rule supports each rule below.", "Each rule below
  supports this rule.", "This rule is related to each rule below." Indirect captions add
  "indirectly" and name the path block they belong to.
- Accessible names: the toggle button's name is its visible text ("Supports ASD ISM (2)");
  the list's `aria-label` is "Supports: ASD ISM" (indirect: "Supports, indirectly, through
  ISM-1584: ASD E4EIT").
- Group order: relation order of `mappingGroupLabel` (Supports, Supported by, Related), then
  source label. Today's order is by source label first; relation first matches the new
  heading, so all "Supports" groups sit together.

### 5.7 Provenance on each row (request 3)

- Under the note (unchanged), one muted line: the mapping file id in mono, then a small
  outline badge "Generated" or "Hand-written". When the index has no file information (an
  older index, or a file id it does not describe), only the id shows.
- **Origin comes from the data, not from wording in the description.** Mapping files gain an
  optional top-level `generated_by` string (the command that writes the file, for example
  `tools/import_asd_e4eit.py`). Both generators write it; hand-written files omit it.
  `tools/mappings.py` accepts it (a non-empty string), `parseMappingFile` accepts it, and the
  index gains an optional top-level `mapping_files` object:
  `{ "<mapping id>": { "description": string | null, "generated_by": string | null } }`.
  `parseMappingIndex` reads it when present and ignores it when absent, so `schema_version`
  stays 1.
- **Indirect rows** show the last hop's note and provenance on the row (the link that brings
  the rule in), plus a "How this is linked" toggle. Expanded, it lists every hop in order as
  a sentence from the earlier rule's side ("ISM-1584 is related to IT.PRO-12.2"), each with
  its file id, origin badge, note and stale-release note.
- **Stale notes.** A direct row computes them against the open rule, as today. An indirect row
  computes the last hop's against the rule just before it on the path; other hops' notes show
  inside "How this is linked".
- **Shared with Coverage.** The id-plus-origin-plus-note block becomes one component,
  `webui/src/components/mappings/MappingProvenance.tsx`, used by the Mapped rules rows, the
  hop list, and the Coverage view's `LinkList` in
  `webui/src/components/selectionCoverage/FrameworkCoverageCard.tsx` (which therefore also
  gains the origin badge). The Coverage view keeps its one-line older-release marker.

### 5.8 Rows

Indirect rows are the same `MappedRuleRow` as direct ones: title with the hover summary, id,
assessment, benchmarks, click to expand details in place with "Go to this rule". A rule is
listed once in the whole tab (5.1 rule 3 and 5.4), so the existing per-rule-id expansion state
still works.

### 5.9 Responsive

- At about 375px: badge, source label and count wrap inside the toggle; the through
  sub-heading wraps; the indirect blocks get one fixed `border-l` plus small padding (no
  per-depth indentation); rows stack as today; nothing scrolls sideways.
- At desktop width (about 1280px): rows keep today's one-line layout with assessment and
  benchmark columns; the through sub-heading stays on one line where it fits.

### 5.10 Accessibility

- The two part headings ("Direct mapped rules", "Indirect mapped rules") are real headings one
  level below the panel's, through sub-headings one below those, and group toggles sit inside
  headings one below that, so heading navigation walks direct, then each through path.
- Every toggle (group headings and "How this is linked") is a `button` with
  `aria-expanded` and, when open, `aria-controls`. Focus stays on the toggle after it is
  pressed; nothing moves focus into the opened content.
- The relation is part of the toggle's accessible name, not only a colour.

## 6. Interfaces (pure logic)

`webui/src/logic/indirectMappings.ts` (new):

```ts
export const INDIRECT_MAPPING_DEPTH_LIMIT = 4

// The step as seen from the rule a hop leaves; the same union as MappingGroupRelation (Task 1).
export type MappingStep = 'supports' | 'supported-by' | 'related'
export type EffectiveRelation = MappingStep

export interface MappingHop {
  fromRuleId: string
  toRuleId: string
  step: MappingStep
  // The index entry as seen from fromRuleId.
  link: MappedRule
}

export interface IndirectMappedRule {
  ruleId: string
  // From the open rule to ruleId; length >= 2.
  path: MappingHop[]
  effectiveRelation: EffectiveRelation
  // Rules just before ruleId on other allowed paths of the same length, sorted.
  alsoThroughRuleIds: string[]
}

export interface IndirectMappings {
  rules: IndirectMappedRule[]
  // True when the depth limit stopped a chain that could have gone on.
  truncated: boolean
}

export function stepOf(link: MappedRule): MappingStep
export function canExtendPath(steps: readonly MappingStep[], next: MappingStep): boolean
export function effectiveRelationOf(steps: readonly MappingStep[]): EffectiveRelation
export function indirectMappedRules(
  startRuleId: string,
  byRule: ReadonlyMap<string, MappedRule[]>,
  depthLimit?: number,
): IndirectMappings
// Cached per byRule map (WeakMap) and start rule, so re-renders and re-opening a rule do not re-walk.
export function cachedIndirectMappedRules(startRuleId: string, byRule: ReadonlyMap<string, MappedRule[]>): IndirectMappings
```

`webui/src/logic/mappedRuleView.ts` (changed):

```ts
export interface MappedRuleItem {
  link: MappedRule
  row: RuleRow
  // Present on indirect items only.
  indirect?: { path: MappingHop[]; alsoThroughRuleIds: string[] }
}

export interface MappedSourceGroup {
  key: string
  sourceName: string
  relation: EffectiveRelation
  indirect: boolean
  relationLabel: string // "Supports", "Supported by", "Related", or with ", indirectly"
  items: MappedRuleItem[]
  total: number
}

export interface IndirectPathBlock {
  key: string // the through rule ids joined
  throughRuleIds: string[]
  throughSteps: MappingStep[] // step into each through rule
  groups: MappedSourceGroup[]
  total: number
}

export function groupIndirectMappedRules(
  indirect: IndirectMappings,
  rowsById: ReadonlyMap<string, RuleRow>,
  sourceLabel: (sourceName: string) => string,
): IndirectPathBlock[]
export function filterIndirectPathBlocks(blocks: readonly IndirectPathBlock[], filter: MappedRuleFilter): IndirectPathBlock[]
export function relationBadgeLabel(relation: EffectiveRelation, indirect: boolean): string
export function groupCaption(relation: EffectiveRelation, indirect: boolean): string
export function throughDescription(block: IndirectPathBlock, ruleLabel: (ruleId: string) => string): string
```

`groupMappedRulesBySource` keeps its signature and fills `relation` and `indirect: false`.

`webui/src/logic/mappingIndex.ts` (changed): `MappingFileInfo { description: string | null;
generatedBy: string | null }`, an optional `mapping_files` in `MappingIndexFile`,
`buildMappingIndex` filling it, `parseMappingIndex` returning `mappingFiles: Map<string,
MappingFileInfo>` (empty when absent or malformed, with a warning when malformed).

## 7. Test strategy

- **Vitest**, small hand-built `byRule` maps:
  - `canExtendPath`: up-up, down-down and up-sideways allowed; up-down, down-up and
    sideways-sideways refused; sideways-down and sideways-up allowed.
  - `indirectMappedRules`: the gatekeeper shape (one indirect E4EIT action through one ISM
    control); the IT.DET-01.1 shape (each rule once, `alsoThroughRuleIds` filled); a direct
    rule never listed as indirect; the start rule never listed; a cycle in `supports` data
    terminates; a chain longer than the limit sets `truncated`; the shortest-then-strongest
    path wins; ordering is stable.
  - Grouping, filter, captions, badge labels, through descriptions.
  - Index: `generated_by` round trip through `buildMappingIndex` and `parseMappingIndex`;
    missing or malformed `mapping_files` tolerated.
- **Python** (`tests/test_mappings.py`): `generated_by` accepted when a non-empty string,
  rejected otherwise; both generators' tests assert they write it.
- **Playwright**: headings and captions from both sides of one link; the gatekeeper rule's
  indirect block with the real committed data (or a routed fixture index built with
  `buildMappingIndex`); "How this is linked" expands with `aria-expanded` and focus stays on
  it; provenance badge on a direct row and on the Coverage view. Existing specs that match
  group names (`smoke.spec.ts` "ASD ISM Supports", "NIST mSCP Supported by";
  `asd-e4eit.spec.ts` `/Related \(\d+\)$/`; `nist-800-53.spec.ts`) are updated to the new
  names.
- **Screenshots** at about 375px and 1280px, light and dark, read with the Read tool, for the
  gatekeeper rule and for E4EIT IT.PRO-04.1 (60 indirect rules, the largest).

## 8. Delivery

`docs/plans/2026-11-12-mapped-rules-rework-plan.md`, four tasks: headings (no data change),
provenance (format, index, shared component), indirect traversal logic, indirect UI. Tasks 1
and 2 can ship before the traversal rule is confirmed.

## 9. Decisions made without the maintainer

| Decision | Alternatives |
|---|---|
| **Traversal rule.** Confirmed by the maintainer on 2026-11-12 (they want the support chain, not nested peers or an exponential field, and direct mappings matter more than indirect): follow `supports` hops only in one direction per chain, and at most one `related` hop; peers ("also supports the same control") are left out. | Every link in every direction (494 of 764 rules from the gatekeeper rule by depth 10); one level of every link, non-recursive (12 for the gatekeeper rule, 57 for ISM-0380); a separate closed "Also supports the same controls" group. |
| Depth cap 4 hops, with a visible note when it cuts a chain. Termination comes from the visited-state set, not the cap. | 10, as the maintainer suggested; 2, matching today's data exactly. |
| Weakest-hop wording: any `related` hop makes the chain "Related, indirectly". | Show each hop's relation only, with no summary relation. |
| A rule reachable by several paths is listed once (shortest, then strongest, then by id) with an "Also through" line. | List it under every path (12 rules twice for IT.DET-01.1). |
| A direct link always wins; a directly mapped rule never also appears as indirect. | Show both, marking the indirect copy. |
| Indirect rules are grouped by path ("through" blocks), then by relation and source, with one fixed indent. | Grouped by relation and source only, with the path on each row; or indented per level. |
| Tab label "Mapped rules (N)" keeps the direct count. | "Mapped rules (4 + 1 indirect)". |
| Headings show the source label without a noun ("[Supports] ASD ISM (2)"). | Add an item noun per source to the vocabulary ("controls", "rules", "actions"). |
| Relation badge colours: Supports `default`, Supported by `secondary`, Related `outline`; indirect adds a dashed border and "indirectly". | One neutral badge style for all relations. |
| Groups ordered by relation, then source label. | Keep today's source-first order. |
| Origin from a new optional `generated_by` key in mapping files, carried into the index. | Infer "generated" from "Generated by" in the description; or keep a list of generated file ids in the web UI. |
| Provenance shows the file id and origin; the file's description is carried in the index but not shown. | Show the description in a tooltip or under the id. |
| Indirect rows show the last hop's provenance on the row and every hop behind "How this is linked". | Every hop's provenance always visible. |
| Indirect rules are not counted on the Coverage view. | Count supports-only chains as indirect coverage. |

## Progress log

- 2026-11-12: Task 1 done. Mapped rules group headings now lead with a relation badge ("Supports ASD ISM (2)"), open groups show a caption saying who supports whom, groups sort by relation then source; e2e selectors updated and a new e2e covers both ends of a link.
  - 08183a8 feat: name the relation first in mapped rules group headings
- 2026-11-12: Task 2 done. Mapping files accept an optional `generated_by`; both generators write it and their outputs were regenerated byte-stable. The index carries a `mapping_files` table, and a shared `MappingProvenance` shows the file id with a "Generated" or "Hand-written" badge on Mapped rules rows and the Coverage view. Also linked each group caption to its list with aria-describedby (Task 1 review note).
  - 6150c46 feat: show where each mapping link comes from
- 2026-11-12: Task 3 done. The maintainer confirmed the traversal rule (support chain only, no peers). `indirectMappings.ts` finds indirect mapped rules (depth cap 4, visited-state set, best path per rule, `truncated` flag) and exports `supportChain` for reuse; `mappedRuleView.ts` groups them into path blocks, filters them and words each path. A Vitest test over the committed mappings pins the reach (gatekeeper rule: 1 indirect; IT.DET-01.1: 12; whole graph: 118 rules with any, at most 60, deepest 2 hops).
  - a20583b feat: add indirect mapping traversal logic
