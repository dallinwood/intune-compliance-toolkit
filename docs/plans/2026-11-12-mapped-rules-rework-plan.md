# Mapped Rules Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Mapped rules tab names the relation first ("[Supports] ASD ISM (2)"), shows each link's mapping file and whether it is generated or hand-written, and lists indirect mapped rules grouped by the path they came through, worded by their weakest hop.

**Architecture:** Traversal, grouping and wording live in pure modules (`webui/src/logic/indirectMappings.ts` new, `webui/src/logic/mappedRuleView.ts` extended) with Vitest tests. Mapping files gain an optional `generated_by` key that the publish step carries into the index's new optional `mapping_files` table. One shared `MappingProvenance` component serves the Mapped rules tab and the Coverage view.

**Tech Stack:** React 19, TypeScript, Tailwind, Base UI, Vitest, Playwright, Python (validator and generators). Run with Bun, except `test:e2e`, which needs real Node.

**Spec:** `docs/plans/2026-11-12-mapped-rules-rework-design.md`

**Depends on:** nothing unlanded. **Task 3 must not start until the maintainer confirms the traversal rule in design section 5.1** (design section 9, first row). Tasks 1 and 2 do not depend on it.

## Global Constraints

- No new dependencies. Use the existing `components/ui` primitives (`Badge`, `button`) and Base UI.
- Never use the em dash character (U+2014) in code, copy, comments or commit messages.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why"; match the surrounding code's idioms (PEP 8 for Python).
- Indirect rules are never worded or styled as direct: the badge always says "indirectly", and they appear only under "Indirect mapped rules". Their relation is the weakest hop's (design 5.3).
- Nothing on the Coverage view counts indirect links.
- Indentation for indirect content is one fixed step at every depth; depth is told in words (design 5.5).
- `schema_version` of mapping files and of the index stays 1; every new key is optional and its absence is handled.
- Verification before calling any task done: `bun run test`, `bun run lint`, `bunx tsc -b` in `webui/`; `python -m pytest` at the repo root when Python changed; `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`); for any task that changes rendering, ad hoc Playwright screenshots at 375px and 1280px wide, light and dark, opened with the Read tool and checked by eye (`.claude/CLAUDE.md`).
- E2e assertions never hard-code library totals; derive counts from fixtures or from the specific committed links named in a test.
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; other agents may have uncommitted changes, and `.superpowers/` is never staged. `type: summary` subject, a body saying why. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` (and the design's) in each task's commit.

## Review Focus

- **Backwards reading.** From both ends of one link, heading, caption and accessible name must say who supports whom correctly. (Task 1.)
- **Overstated chains.** A chain with any `related` hop must never say "Supports". (Task 3 tests, Task 4 screenshots.)
- **Explosion.** A rule must not list peers (up then down, or two `related` hops). (Task 3 tests.)
- **Narrow screens.** E4EIT IT.PRO-04.1 (60 indirect rules) at 375px must wrap, not scroll or squeeze. (Task 4 screenshots.)
- **Generated files regenerate cleanly.** Running each generator must reproduce the committed file including `generated_by`. (Task 2.)

---

### Task 1: Relation-first group headings

**Files:**
- Modify: `webui/src/logic/mappedRuleView.ts`, `webui/src/logic/mappedRuleView.test.ts`
- Modify: `webui/src/components/rules/MappedRulesTab.tsx`
- Modify: `webui/e2e/smoke.spec.ts`, `webui/e2e/asd-e4eit.spec.ts`, `webui/e2e/nist-800-53.spec.ts` (only selectors that match group names)
- Modify: `README.md` (the Mapped rules tab paragraph, if it quotes a heading)

**Interfaces** (in `mappedRuleView.ts`):
- `export type MappingGroupRelation = 'supports' | 'supported-by' | 'related'` (Task 3 re-exports it as `EffectiveRelation`; define it here so Task 1 stands alone).
- `MappedSourceGroup` gains `relation: MappingGroupRelation` and `indirect: boolean` (always `false` in this task). `relationLabel` stays.
- `export function relationBadgeLabel(relation: MappingGroupRelation, indirect: boolean): string`: "Supports", "Supported by", "Related"; with `indirect` append ", indirectly".
- `export function groupCaption(relation: MappingGroupRelation, indirect: boolean): string`: "This rule supports each rule below.", "Each rule below supports this rule.", "This rule is related to each rule below."; indirect versions insert "indirectly" ("This rule indirectly supports each rule below.").
- `groupMappedRulesBySource` sorts groups by relation order (supports, supported-by, related), then source label.

**Behaviour** (design 5.6):
- The group toggle shows `<Badge>` with the relation label, then the source label, then `(count)`. Variants: supports `default`, supported-by `secondary`, related `outline`.
- The toggle's accessible name is its visible text, e.g. "Supports ASD ISM (2)". The list's `aria-label` is "Supports: ASD ISM".
- An open group shows the caption above its list in muted text.

**Steps:**
- [ ] Write failing Vitest cases for `relationBadgeLabel`, `groupCaption` and the new group order; run, see them fail.
- [ ] Implement; tests pass.
- [ ] Update `MappedRulesTab.tsx`; update the e2e selectors (`'ASD ISM Supports'` becomes `'Supports ASD ISM (2)'` or a regex; `'NIST mSCP Supported by'` list name becomes `'Supported by: NIST mSCP'`; the E4EIT `/Related \(\d+\)$/` button becomes `/^Related ASD (ISM|E4EIT) \(\d+\)$/`).
- [ ] Add an e2e test: open `mscp.system_settings_gatekeeper_override_disallow`, its group reads "Supports ASD ISM"; open `asd_ism.ism-1584`, its group reads "Supported by NIST mSCP"; each caption matches.
- [ ] Full verification (Global Constraints), screenshots of the gatekeeper rule's tab at 375px and 1280px, light and dark.
- [ ] Commit `feat: name the relation first in mapped rules group headings`, progress log entries, push.

---

### Task 2: Mapping provenance (generated or hand-written, file id, note)

**Files:**
- Modify: `tools/mappings.py`, `tests/test_mappings.py`
- Modify: `tools/generate_mscp_nist_800_53_mapping.py`, `tests/test_mscp_nist_800_53_mapping.py`
- Modify: `tools/asd_e4eit_normalize.py` (the mapping file writer near its `"description"`), `tests/test_asd_e4eit_normalize.py` or `tests/test_import_asd_e4eit.py`
- Regenerate: `baselines/_mappings/rules/mscp-to-nist-800-53.json`, `baselines/_mappings/rules/asd-e4eit-to-asd-ism.json` (by running their generators, never by hand)
- Modify: `webui/src/logic/mappingIndex.ts`, `webui/src/logic/mappingIndex.test.ts`
- Modify: `webui/src/data/mappings.ts`, `webui/src/data/ruleRows.ts`, `webui/src/components/layout/AppShell.tsx`, `webui/src/state/mappingsContext.ts`
- Create: `webui/src/components/mappings/MappingProvenance.tsx`
- Modify: `webui/src/components/rules/MappedRulesTab.tsx`, `webui/src/components/selectionCoverage/FrameworkCoverageCard.tsx`
- Modify: `docs/plans/2026-10-27-rule-mappings-design.md` (format section: one line on `generated_by`), `README.md` mapping format section if it lists keys
- Test: `webui/e2e/smoke.spec.ts` (or the spec holding mapped rules tests), `webui/e2e/coverage.spec.ts`

**Format:** mapping files accept an optional top-level `"generated_by": "<command>"`, a non-empty string. `tools/mappings.py` adds it to `ALLOWED_MAPPING_KEYS` and errors when it is present and not a non-empty string. The two generators write it (`tools/generate_mscp_nist_800_53_mapping.py` its `GENERATOR_COMMAND`; the E4EIT writer `tools/import_asd_e4eit.py`). Hand-written files do not get it.

**Interfaces** (in `mappingIndex.ts`):
- `export interface MappingFileInfo { description: string | null; generatedBy: string | null }`
- `MappingIndexFile` gains optional `mapping_files?: Record<string, { description: string | null; generated_by: string | null }>`; `buildMappingIndex` fills it for every file it indexes, keys sorted.
- `parseMappingFile` accepts `generated_by` (add to `MAPPING_KEYS`, reject non-string or empty).
- `ParsedMappingIndex` gains `mappingFiles: Map<string, MappingFileInfo>`. Absent `mapping_files`: empty map, no warning. Present but not an object, or an entry of the wrong shape: that entry (or the whole table) is dropped with a warning; `by_rule` still loads.
- `RuleMappings` (context) gains `mappingFiles: ReadonlyMap<string, MappingFileInfo>`; default empty map.

**Component:** `MappingProvenance({ mapping, note }: { mapping: string; note: string | null })` reads `mappingFiles` from context and renders: the note (muted, wrapping) when not null; then one muted line with the id in mono (`break-all`) and an outline `Badge` "Generated" or "Hand-written", or the id alone when the file is unknown. Used by `MappedRuleRow` (replacing its note paragraph; stale notes stay as they are) and by `LinkList` in `FrameworkCoverageCard.tsx` (replacing its id and note lines; its older-release line stays).

**Steps:**
- [ ] Python: failing tests for `generated_by` (accepted, rejected when empty or non-string) and for each generator writing it; implement; regenerate the two files with their generators; `python -m pytest` passes, and rerunning each generator leaves `git diff` empty.
- [ ] Vitest: failing tests for the `generated_by` round trip (`buildMappingIndex` then `parseMappingIndex`), absent and malformed `mapping_files`; implement through to the context.
- [ ] Build `MappingProvenance`, use it in both places.
- [ ] E2e: a direct row of the gatekeeper rule shows `mscp-to-asd-ism-system-hardening` (or whichever committed file holds that link; read it from the file in the test setup or route a fixture index) with "Hand-written", and its 800-53 row shows "Generated"; a Coverage provenance entry shows the origin badge.
- [ ] Full verification; screenshots of a Mapped rules row and a Coverage provenance list at 375px and 1280px, light and dark.
- [ ] Commit `feat: show where each mapping link comes from`, progress log entries, push.

---

### Task 3: Indirect mapping traversal (pure logic)

**Precondition:** the maintainer has confirmed design 5.1 (or chosen an alternative; then update the design and this task first).

**Files:**
- Create: `webui/src/logic/indirectMappings.ts`, `webui/src/logic/indirectMappings.test.ts`
- Modify: `webui/src/logic/mappedRuleView.ts`, `webui/src/logic/mappedRuleView.test.ts`

**Interfaces:** exactly as design section 6 (`INDIRECT_MAPPING_DEPTH_LIMIT = 4`, `MappingStep`, `EffectiveRelation` (= `MappingGroupRelation` from Task 1), `MappingHop`, `IndirectMappedRule`, `IndirectMappings`, `stepOf`, `canExtendPath`, `effectiveRelationOf`, `indirectMappedRules`, `cachedIndirectMappedRules`; and in `mappedRuleView.ts` `MappedRuleItem.indirect`, `IndirectPathBlock`, `groupIndirectMappedRules`, `filterIndirectPathBlocks`, `throughDescription`).

**Exact behaviour:**
- `stepOf`: `outgoing` supports -> `'supports'`, `incoming` supports -> `'supported-by'`, `related` -> `'related'`.
- `canExtendPath(steps, next)`: false when `next` is `'related'` and `steps` already holds `'related'`; false when `next` is a supports step and `steps` holds the other supports step; true otherwise.
- `effectiveRelationOf(steps)`: `'related'` if any step is `'related'`, else the (single) supports step.
- `indirectMappedRules(start, byRule, depthLimit = 4)`: breadth-first by depth. Excluded: `start` and every rule in `byRule.get(start)`. A search state is (rule id, supports direction so far, related used); each state is expanded once. A path never repeats a rule. At each depth, collect every allowed path reaching a not-yet-listed rule; per rule pick the best path (shortest is implied; then `effectiveRelation` supports or supported-by before related; then `compareText` on the path's rule ids joined with `\n`); the other same-depth paths' second-to-last rule ids, distinct and sorted, form `alsoThroughRuleIds`. `truncated` is true when, at `depthLimit`, some reached state still has an allowed hop to a rule not on its path and not excluded. Result rules sorted by depth, then path key.
- `cachedIndirectMappedRules`: `WeakMap<ReadonlyMap<string, MappedRule[]>, Map<string, IndirectMappings>>`.
- `groupIndirectMappedRules`: one block per through path (path minus its last hop's target); inside, groups keyed by effective relation and the rule's `sourceName`, `indirect: true`, labels from `relationBadgeLabel`; items sorted by upstream id; blocks ordered by depth, then each through rule's source label and upstream id. Rules missing from `rowsById` are skipped.
- `throughDescription`: "Through ASD ISM ISM-1584 (this rule supports it)"; for longer paths join with ", then " and word each later step from the previous rule ("supports it", "is supported by it", "related to it"). `ruleLabel` supplies "ASD ISM ISM-1584".

**Tests (write first, see them fail):**
- `canExtendPath` and `effectiveRelationOf` truth tables (design 7).
- Fixtures mirroring real shapes: the gatekeeper rule (4 direct; 1 indirect E4EIT action through ISM-1584, `related`); IT.DET-01.1 (3 related ISM controls; 12 mSCP rules each through two controls, listed once with one `alsoThroughRuleIds` entry); a direct rule also reachable indirectly is not listed; an up-down peer and a related-related peer are not listed; a supports cycle A->B->C->A terminates; a 5-hop up chain with limit 4 sets `truncated` and lists 3 indirect rules; ties resolved as specified; `cachedIndirectMappedRules` returns the same object on a second call.
- Grouping, filtering (text and assessment across blocks; empty blocks dropped) and `throughDescription` wording.

**Steps:**
- [ ] Failing tests; implement; `bun run test`, `bun run lint`, `bunx tsc -b` clean.
- [ ] Commit `feat: add indirect mapping traversal logic`, progress log entries, push.

---

### Task 4: Indirect mapped rules in the tab, and docs

**Files:**
- Modify: `webui/src/components/rules/MappedRulesTab.tsx` (consider splitting into `MappedRulesTab.tsx`, `MappedRuleGroup.tsx` and `IndirectMappedRules.tsx` if it passes about 400 lines)
- Modify: `webui/src/state/mappedRulesView.ts` (group keys for indirect groups; a set of open "How this is linked" rule ids)
- Modify: `webui/e2e/smoke.spec.ts` or create `webui/e2e/mapped-rules.spec.ts`
- Modify: `README.md` (Mapped rules tab), `docs/plans/2026-11-12-mapped-rules-rework-design.md` (status line), this plan

**Behaviour** (design 5.5 to 5.10):
- `const indirect = useMemo(() => cachedIndirectMappedRules(ruleId, byRule), [ruleId, byRule])`, blocks from `groupIndirectMappedRules`, filtered with the same filter as the direct groups.
- No indirect rules: the tab is as after Tasks 1 and 2. Otherwise headings "Direct mapped rules (N)" and "Indirect mapped rules (M)" (static, one level below the panel's heading), each through block a static sub-heading (`throughDescription`, the through rule's title on a muted second line clamped to two lines), then its groups inside a container with one fixed `border-l` and left padding. Group toggles are the Task 1 toggles with the indirect badge (same variant, dashed border, ", indirectly").
- Indirect rows: `MappedRuleRow` with `self` = the rule before it on the path (for stale notes), `MappingProvenance` for the last hop, an "Also through ISM-1815" line when `alsoThroughRuleIds` is non-empty (up to three ids, then "and K more"), and a "How this is linked" button (`aria-expanded`, `aria-controls` when open) revealing an ordered list of hops: "<from label> supports <to label>" / "is supported by" / "is related to", each with `MappingProvenance` and its stale note. Focus stays on the button.
- `truncated`: one muted line after the indirect part, "Stopped after 4 levels; some further indirect links are not shown."
- Filter active: matching groups open, empty groups and blocks hidden, "N of M" per group.

**Steps:**
- [x] Implement.
- [x] E2e: gatekeeper rule shows "Indirect mapped rules (1)", a block "Through ASD ISM ISM-1584 (this rule supports it)", a group "Related, indirectly ASD E4EIT (1)" holding IT.PRO-12.2; "How this is linked" toggles with `aria-expanded` and keeps focus; `asd_e4eit.it.det-01.1` lists each of its mSCP rules once with an "Also through" line; a rule with no indirect rules shows no part headings; the text filter narrows indirect rows. Prefer a routed fixture index built with `buildMappingIndex` from real committed rule ids (as `coverage.spec.ts` does) so later mapping changes do not break the counts.
- [x] Full verification; ad hoc screenshots at 375px and 1280px, light and dark, of the gatekeeper rule (all groups open, "How this is linked" open) and of `asd_e4eit.it.pro-04.1` (all groups open); read each with the Read tool and fix anything squeezed, clipped or scrolling sideways.
- [x] README: describe relation-first headings, provenance, and indirect mapped rules with the traversal rule in one or two sentences.
- [x] Mark the design implemented; progress log entries.
- [x] Commit `feat: show indirect mapped rules grouped by the path they come through`, push.

## Progress log

- 2026-11-12: Task 1 done. Mapped rules group headings now lead with a relation badge ("Supports ASD ISM (2)"), open groups show a caption saying who supports whom, groups sort by relation then source; e2e selectors updated and a new e2e covers both ends of a link.
  - 08183a8 feat: name the relation first in mapped rules group headings
- 2026-11-12: Task 2 done. Mapping files accept an optional `generated_by`; both generators write it and their outputs were regenerated byte-stable. The index carries a `mapping_files` table, and a shared `MappingProvenance` shows the file id with a "Generated" or "Hand-written" badge on Mapped rules rows and the Coverage view. Also linked each group caption to its list with aria-describedby (Task 1 review note).
  - 6150c46 feat: show where each mapping link comes from
- 2026-11-12: Task 3 done. The maintainer confirmed the traversal rule (support chain only, no peers). `indirectMappings.ts` finds indirect mapped rules (depth cap 4, visited-state set, best path per rule, `truncated` flag) and exports `supportChain` for reuse; `mappedRuleView.ts` groups them into path blocks, filters them and words each path. A Vitest test over the committed mappings pins the reach (gatekeeper rule: 1 indirect; IT.DET-01.1: 12; whole graph: 118 rules with any, at most 60, deepest 2 hops).
  - a20583b feat: add indirect mapping traversal logic
- 2026-11-12: Task 4 done; plan complete. The Mapped rules tab lists indirect rules after the direct groups: one block per path ("Through ASD ISM ism-1584 (this rule supports it)"), groups badged "indirectly" behind one fixed left border, an "Also through" line, a "How this is linked" hop list (aria-expanded, focus stays on the button) and the depth-cap note. The tab was split into MappedRulesTab, MappedRuleGroup, IndirectMappedRules, MappingPathHops and StaleLinkNotes; README and the design status updated.
  - 6d53f31 feat: show indirect mapped rules grouped by the path they come through
- 2026-11-12: Plan closed. Every commit of this plan: 08183a8 feat: name the relation first in mapped rules group headings; 9f1c51f docs: log the relation-first group headings commit in the plan; 6150c46 feat: show where each mapping link comes from; 4970395 docs: log the mapping provenance commit in the mapped rules plan; a20583b feat: add indirect mapping traversal logic; 1e758ba docs: log the indirect mapping traversal commit in the mapped rules plan; 6d53f31 feat: show indirect mapped rules grouped by the path they come through.
- 2026-11-12: Worst-case screenshot check done (final review must-fix; the Task 4 "Full verification" step had skipped it). `asd_e4eit.it.pro-04.1` Mapped rules tab at 375px and 1280px, light and dark, default state and all groups open, plus a 1280px tall full-height shot. Default state: "Direct mapped rules (32)" comes first with its single group collapsed, then "Indirect mapped rules (60)" with both groups collapsed and the counts visible ("Related, indirectly NIST mSCP (58)" and "(2)"), so the tab fits in about one screen. Open, nothing is clipped and the page and panel have 0px horizontal overflow at 375px; long titles and ids wrap. Opening all three groups (92 rows) rendered in 650 to 880 ms in the Vite dev build, measured in the page from click to the second animation frame. No code change was needed. Code under check: 6d53f31 feat: show indirect mapped rules grouped by the path they come through.
