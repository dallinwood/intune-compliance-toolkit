# mSCP Web UI and Generator (Plan 2 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the web UI and the Intune bundle generator onto the v3 mSCP rule library produced by Plan 1, add attribution, and add a GitHub Pages deploy.

**Architecture:** The UI keeps its layout and flow (filter sidebar, rule table with expandable detail, selection toolbar, review-and-generate screen). Underneath, new v3 types and loaders replace the CIS-era ones. Rules are keyed by their stable v3 id (`mscp.<upstream id>`). Each rule has exactly one check (with per-version overrides) and at most one organization-defined value (ODV). The bash generator is rewritten around mSCP's check model: the preamble, run-time macOS version dispatch, not-applicable handling, ODV text substitution, and in-script comparison when the expected result varies by version. The pure logic stays in `src/logic/` with Vitest coverage; components stay thin.

**Decision (my call):** no benchmark catalogue is added to the data, despite the Plan 1 final-review suggestion. The covered macOS versions are computed in the browser from the index. The ODV prefill uses mSCP's `recommended` value, with per-benchmark values offered as quick picks, as the design says. The Tags facet filters by tag, not by mSCP's tag-derived baselines. That keeps the importer unchanged apart from Task 1's `section` field.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind 4, shadcn/Base UI, zustand 5, fflate, Vitest 4, Playwright 1.62, Bun. Python 3.14 for the one importer change.

**Spec:** `docs/plans/2026-10-20-mscp-source-design.md`, sections 5, 6, 8 and 9, including the confirmed "Revised 2026-10-20" per-version rule in section 6. Plan 1's "Notes for Plan 2" in `docs/plans/2026-10-20-mscp-import-plan.md` are binding inputs.

## Global Constraints

- **Rule identity:** rules are identified by the v3 `id` (e.g. `mscp.os_gatekeeper_enable`). Selections, exports, React keys and refKey all use it. Never use a positional or sequential id.
- **Rule content:** rule content shown in the UI comes from the generated `baselines/` JSON only. The UI never reads `sources/`.
- **Automated vs manual:** a rule is "Automated" exactly when `assessment.status === "automated"`. ODVs never make a rule manual.
- **ODV defaults:** the effective ODV value is the admin's value if set, else mSCP's `recommended`, else none. A rule with an ODV and no effective value blocks generation, with a visible message naming the rule.
- **ODV validation**, applied to every ODV value before it can be stored or substituted:
  - datatype `number`: integer matching `^-?[0-9]+$`, within `validation.min`/`max` when present
  - `enum`: one of `validation.enumValues`
  - `string`/`regex`: matches `validation.regex` when present
  - `regex` datatype: must also compile as a JavaScript `RegExp`
  - all datatypes: reject any value containing `'`, `"`, a backtick, `\`, a newline, a carriage return, `$(` or `${`
- **ODV substitution:** substitute by plain text replacement of every `$ODV` in check shell text and expected values, as mSCP does. For a `base64` result, the expected value is the base64 (UTF-8) encoding of the substituted value, as mSCP does (`macsecurityrule.py:312`).
- **Per-version rule** (design section 6, confirmed):
  - a rule applies on a device whose macOS major version appears among the rule's `applicability` keys
  - on a version newer than every version the imported library covers, the rule runs the check for its highest listed version
  - on any other version, it is not applicable and reports a passing value
  - "Covered versions" = the union of `applicability` keys across all loaded rules
  - the check for version `v` is `check.by_version[v]` if present, else `check.default`
- **Architecture:** on a device whose `arch` differs from the rule's `architecture`, the rule reports a passing value.
- **Intune SettingName:** the upstream rule id with every character outside `[A-Za-z0-9_]` replaced by `_`. Duplicate SettingNames within one policy remain a hard error.
- **Discovery script:** must run under macOS's bash 3.2: no associative arrays, no `${var,,}`, no `mapfile`.
- **Licence attribution:** NIST macOS Security Compliance Project, `https://github.com/usnistgov/macos_security`, licence CC BY 4.0 `https://creativecommons.org/licenses/by/4.0/`, content modified by this project.
- **Verification for rendering changes:** run Vitest, `bun run lint` and `bun run build`. Rendering changes also need `bun run test:e2e` (with `bun run dev` running) plus Playwright screenshots at about 375px and about 1280px wide, opened and inspected with the Read tool, per `.claude/CLAUDE.md`.
- **Commits:**
  - format: `type: summary` with a why-body when not obvious
  - no `Co-Authored-By` trailer and no AI attribution line
  - implementers commit only; the controller pushes after review
- **Typography:** no em dash characters (U+2014) in anything written.

## Review Focus

- **An ODV containing shell metacharacters** (for example an SSH banner with an apostrophe, or `$(reboot)`). Expected: rejected in the input with a clear message, and never reaches a script. Pinned in Task 2 (validator) and Task 4 (generator refuses an invalid value even if one reaches it).
- **A device on a macOS version that a rule does not list, a version newer than the library covers, or one older than it.** Expected: pass, newest check, pass, respectively. Pinned in Task 4 by executing generated bash with an overridden OS major.
- **Hyphenated upstream ids** (`os_mfa_network_non-priv`). Expected: a valid bash variable and Intune SettingName. Pinned in Task 4.
- **A browser with CIS-era (v1) selections in localStorage, or an old exported settings file.** Expected: the app loads with an empty selection, and the import shows a clear "unsupported version" error. Pinned in Task 2.
- **`$ODV` in titles and discussion** (19 titles). Expected: the effective value or a `[value]` placeholder is shown, never a raw `$ODV`. Pinned in Task 2 (helper) and Task 3 (e2e on `pwpolicy_minimum_length_enforce`).

---

### Task 1: Add `section` to index entries

**Files:**
- Modify: `tools/mscp_normalize.py` (`index_entry`), `baselines/_index.schema.json`
- Modify: `tests/test_mscp_normalize.py`, `tests/test_library_schema.py`
- Regenerate: `baselines/mscp/_index.json` via `python tools/import_mscp.py --offline`

**Interfaces:**
- Produces: every index entry gains `section: string`. It is the folder name under `rules/` in `upstream_path` (`os`, `system_settings`, `audit`, `pwpolicy`, `icloud`, `auth`, `supplemental`), and the schema requires it with pattern `^[a-z0-9_]+(?![\s\S])`.

- [ ] **Step 1: Write failing tests:**
  - `test_index_entry_fields` now expects exactly `{id, title, file, section, assessment, architecture, applicability, tags, has_odv}`.
  - A new `test_index_entry_section_from_upstream_path` expects `"system_settings"` for `rules/system_settings/x.yaml`.
  - A schema test checks that an index entry without `section` is invalid.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/test_mscp_normalize.py tests/test_library_schema.py -q`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** `index_entry(rule, file)` reads the section from `rule["source"]["upstream_path"]`. Update the schema.
- [ ] **Step 4: Regenerate.** Run `.venv/Scripts/python.exe tools/import_mscp.py --offline`, then the full suite with `-W error`. Expected: all pass. `git diff --stat` shows only `baselines/mscp/_index.json` among the generated files.
- [ ] **Step 5: Commit** `feat: add upstream section to rule index entries`.

---

### Task 2: v3 types, loaders and pure UI logic

**Files:**
- Create: `webui/src/types/library.ts` (replaces `types/rule.ts`, `types/rule-detail.ts`, `types/index-manifest.ts`; delete those three)
- Modify: `webui/src/types/rule-row.ts`
- Modify: `webui/src/data/manifest.ts`, `data/ruleIndex.ts`, `data/ruleDetail.ts`, `data/ruleRows.ts`
- Modify: `webui/src/logic/selectionEntry.ts`, `logic/exportImport.ts`, `logic/ruleFilters.ts`, `state/selectionStore.ts`, `state/filterStore.ts`
- Create: `webui/src/logic/odv.ts`, `webui/src/logic/benchmarkLabels.ts`
- Modify: `scripts/copy-baselines.mjs` (skip dot-prefixed entries at any depth)
- Tests: `logic/odv.test.ts`, `logic/selectionEntry.test.ts`, `logic/exportImport.test.ts`, `logic/ruleFilters.test.ts`, `logic/benchmarkLabels.test.ts`, `data/ruleRows.test.ts`, `logic/libraryData.test.ts`

This task leaves components referring to removed types, so `bun run build` fails until Task 3. Verify with Vitest only.

**Interfaces:**
- Produces, in `types/library.ts`: TypeScript mirrors of `baselines/_rule.schema.json`, `_index.schema.json` and `_manifest.schema.json`, with snake_case field names exactly as in the JSON.
  - `Rule`, `RuleCheck` (`{ shell: string; result: CheckResult | null; additional_info: string | null }`), `CheckResult` (`{ type: 'integer' | 'string' | 'base64'; value: number | string }`), `Odv`, `OdvValidation`, `Assessment`, `ManualReason`, `Architecture` (`'arm64' | 'i386' | null`), `Applicability` (`Record<string, { name: string; severity: string | null }[]>`), `IndexEntry`, `RuleIndex`, `ManifestSource`, `Manifest`.
- `RuleRef = { id: string; path: string }`, where `path` is relative to `baselines/` (e.g. `mscp/rules/os_gatekeeper_enable.json`, built as the index_path's directory + `/` + entry `file`). `refKey(ref) = ref.id`.
- `RuleRow`:
  - `{ ref: RuleRef; title: string; section: string; sourceName: string; releaseTag: string; assessment: Assessment; architecture: Architecture; applicability: Applicability; osVersions: string[]; benchmarks: string[]; tags: string[]; hasOdv: boolean }`
  - `osVersions` is sorted numerically descending, and `benchmarks` is the sorted union over all versions.
- `loadLibrary(): Promise<{ rows: RuleRow[]; sources: ManifestSource[]; coveredVersions: string[] }>`, in `data/ruleRows.ts`. `coveredVersions` is the union of all rows' `osVersions`, sorted descending. `fetchRule(ref: RuleRef): Promise<Rule>` lives in `data/ruleDetail.ts` and is cached per id.
- `SelectionEntry = { ref: RuleRef; enabled: boolean; odvValue: OrgDefinedValue | null }`, with `OrgDefinedValue = string | number`. Store actions: `setEnabled(ref, enabled)`, `setOdvValue(ref, value)`, `clearOdvValue(ref)`, `clearAll()`, `setAllSelections(map)`. The persisted store uses `version: 2` with a `migrate` that returns `{ selections: {} }` for any older version.
- `logic/exportImport.ts`: `SETTINGS_SCHEMA_VERSION = 2`, `SettingsFileV2 = { schemaVersion: 2; generatedAt: string; libraryReleases: Record<string, string>; selections: SelectionEntry[] }`. `libraryReleases` maps source name to release tag at export time. `validateSettingsFile` rejects other versions with `Unsupported settings schema version: <v>.` `resolveImportedSelections(file, knownIds: ReadonlySet<string>)` returns `{ selections, unresolvedRefs }`.
- `logic/odv.ts`:
  - `effectiveOdvValue(odv: Odv | null, selected: OrgDefinedValue | null): OrgDefinedValue | null`
  - `validateOdvValue(odv: Odv, value: OrgDefinedValue): string | null` (null means valid; otherwise a human-readable reason, per Global Constraints)
  - `substituteOdv(text: string, value: OrgDefinedValue): string`
  - `displayWithOdv(text: string, value: OrgDefinedValue | null): string`, which substitutes the value, or `[value]` when it is null
  - `odvQuickPicks(odv: Odv): { label: string; value: OrgDefinedValue }[]`, giving "Recommended" first (when present) and then one entry per `by_benchmark` key, labelled via `benchmarkLabel`, with duplicate values merged into one label such as `CIS Level 1, CIS Level 2`
- `logic/benchmarkLabels.ts`:
  - `benchmarkLabel(name)`: `cis_lvl1` gives `CIS Level 1`, `cis_lvl2` gives `CIS Level 2`, `disa_stig` gives `DISA STIG`, `nlmapgov_base` gives `NLMAPGOV Base`, `nlmapgov_plus` gives `NLMAPGOV Plus`, and anything else is returned unchanged
  - `macosVersionLabel("26.0")` gives `macOS 26`
- `FilterState`:
  - `{ search; osVersions: Set<string>; benchmarks: Set<string>; sections: Set<string>; tags: Set<string>; automatable: 'all' | 'automatable' | 'manual' }`, plus a toggle per set
  - `FilterDimension = 'osVersions' | 'benchmarks' | 'sections' | 'tags'`
  - `facetOptions` and `allFacetValues` keep their signatures

`matchesFilters(row, filters, excludeDimension?)`:
- **osVersions:** the row lists at least one selected version.
- **benchmarks:** some version `v` has a selected benchmark in `applicability[v]`. When versions are selected (and not excluded), only those `v` count.
- **sections and tags:** any match.
- **automatable:** compared against `assessment.status`.
- **search:** case-insensitive substring of the title or the id without the `mscp.` prefix.

- [ ] **Step 1: Write failing tests**, including:
  - `odv.test.ts`:
    - number min/max and non-integers
    - enum membership
    - regex validation
    - an invalid JavaScript regex for datatype `regex`
    - each denied character or sequence, including an SSH banner with an apostrophe
    - `effectiveOdvValue` precedence
    - `displayWithOdv("At Least $ODV Characters", null) === "At Least [value] Characters"`
    - quick-pick merging
  - `libraryData.test.ts` reads the real committed `../baselines` JSON from disk and asserts:
    - every rule's `odv.recommended` and every `by_benchmark` value passes `validateOdvValue`. If some do not, stop and report rather than loosen the rules silently.
    - every index entry's `section` is non-empty
  - `selectionEntry.test.ts`: v2 shape, and refKey is the id.
  - `exportImport.test.ts`:
    - v2 round trip
    - a v1 file is rejected with the exact message
    - unknown ids are reported as unresolved
  - Store migration: the v1 persisted state migrates to empty selections. Test the `migrate` function directly.
  - `ruleFilters.test.ts`:
    - version-scoped benchmark matching: a rule that is CIS L1 on 26.0 only matches versions={27.0} + benchmarks={cis_lvl1} = no match
    - search by upstream id
  - `ruleRows.test.ts`: row building from a manifest plus index fixture, `coveredVersions`, and the path join.
- [ ] **Step 2: Run** `cd webui && bun x vitest run src/logic src/data`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the files above. Make `copy-baselines.mjs` skip any file or directory whose name starts with `.`.
- [ ] **Step 4: Run** the same command. Expected: the new and updated tests pass. (Old component-facing tests that reference removed types are deleted here only if their module is deleted. `chunking`, `rulesJsonGen`, `bundleFiles`, `scriptGen/bash`, `outputCheckText`, `auditMethods` and `naturalId` are handled in Tasks 3 and 4. Exclude them from this run with `--exclude`.)
- [ ] **Step 5: Commit** `feat: add v3 library types, loaders and selection logic`.

---

### Task 3: Browse UI on the v3 library

**Files:**
- Modify: `webui/src/App.tsx`, `components/layout/AppShell.tsx`, `components/rules/RuleTable.tsx`, `components/filters/FilterSidebar.tsx`, `components/rules/RuleDetailPanel.tsx`, `components/rules/OrgDefinedValueInput.tsx`, `components/selection/SelectionToolbar.tsx`, `components/selection/ExportImportControls.tsx`
- Create: `components/rules/RuleCheckSection.tsx`, `components/rules/RuleRemediationSection.tsx`, `components/rules/RuleReferences.tsx`, `components/rules/DiscussionText.tsx`, `components/layout/AttributionFooter.tsx`
- Delete: `components/rules/AuditMethodList.tsx`, `AuditMethodCard.tsx`, `OutputCheckRow.tsx`, `RemediationMethodList.tsx`, `RemediationMethodCard.tsx`, `logic/auditMethods.ts` (and its test), `logic/outputCheckText.ts` (and its test), `logic/naturalId.ts` (and its test)
- Modify: `components/generate/GenerateReviewScreen.tsx`. Until Task 4 it renders "Bundle generation is being rebuilt for the new rule library." with the Back button, and imports nothing from `chunking`/`bundleFiles`.
- Rewrite: `webui/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes Task 2: `loadLibrary`, `fetchRule`, `RuleRow`, `Rule`, the selection store v2, the filter store v3, `matchesFilters`/`facetOptions`/`allFacetValues`, `odv.ts` and `benchmarkLabels.ts`.
- `AppShell` receives `{ rows, sources, coveredVersions }`. `coveredVersions` is passed down for Task 4.

**UI behaviour (layout and flow unchanged; my calls on details):**
- **Table:**
  - Grouped by `section` (heading order: `os`, `system_settings`, `pwpolicy`, `auth`, `audit`, `icloud`, `supplemental`, then any other alphabetically), with rows sorted by title.
  - Columns: checkbox; expand chevron; title (with `displayWithOdv` using the effective value, and the existing ODV icon when `hasOdv`) with the upstream id beneath in small mono text; assessment badge (`Automated`, or `Manual` with the reason as a tooltip and a short suffix such as `Manual - inherent`); benchmarks column (labels for the newest listed version, STIG severity in parentheses).
  - Keep `table-fixed` with explicit widths.
- **Filter sidebar facets, in order:**
  - Automation (radio)
  - macOS version (labels via `macosVersionLabel`)
  - Benchmark (labels via `benchmarkLabel`)
  - Section
  - Tags
  - Keep the stable-facet behaviour.
- **Detail panel, in order:**
  - discussion (`DiscussionText`: paragraphs, `[source,bash]`/`----` blocks rendered as code, `_text_` as emphasis, all with `displayWithOdv`)
  - the ODV input, if any: shows description, datatype input (number, enum select, text), quick-pick buttons from `odvQuickPicks`, inline validation error from `validateOdvValue` (an invalid value is not stored), and a "using recommended value" hint when no value is set
  - check (`RuleCheckSection`): default check and per-version overrides, labelled by `macosVersionLabel`, each with shell in a code block and expected result `type`/`value`, `additional_info` when present, a "No macOS version listed" note when `applicability` is empty, and an architecture note
  - remediation (`RuleRemediationSection`): fix shell/additional_info, per-version fixes, mobileconfig payloads pretty-printed as JSON, and DDM info
  - references (`RuleReferences`): render the references tree as label and value lists, keeping only `macos_*` keys where a level is keyed by OS
  - source line: "From NIST mSCP <release_tag>", with a link to `source.upstream_url` and the licence name linked
- **Footer (`AttributionFooter`):** "macOS rules from the NIST macOS Security Compliance Project (<release_tag>), licensed CC BY 4.0, modified for this tool." Links to the repo and the licence.

- [ ] **Step 1: Rewrite `e2e/smoke.spec.ts`** for the new data, as failing tests:
  - the browser loads and shows "350 rules" (the count text), and expanding "Enable Gatekeeper" shows its check shell
  - the macOS version and Benchmark facets narrow the table (macOS 27 + CIS Level 1 gives fewer rows than either alone)
  - the row checkbox selects without expanding
  - `pwpolicy_minimum_length_enforce`'s title shows a number instead of `$ODV`
  - typing a value with an apostrophe into its ODV input shows a validation error
  - an unreachable facet option greys out, fades, then disappears (port the existing test to the new facets)
- [ ] **Step 2: Implement** the components above. Delete the listed files.
- [ ] **Step 3: Verify:**
  - `bun x vitest run --exclude src/logic/chunking.test.ts --exclude src/logic/rulesJsonGen.test.ts --exclude src/logic/bundleFiles.test.ts --exclude src/logic/scriptGen/bash.test.ts`
  - `bun run lint`
  - `bun run build`
  - with `bun run dev` running in the background, `bun run test:e2e`
  - Expected: all pass. Build may only fail inside `logic/chunking.ts`, `rulesJsonGen.ts`, `bundleFiles.ts` and `scriptGen/bash.ts` if they are still unreferenced. If it does, add those four files to a temporary `exclude` in `tsconfig.app.json`, with a comment naming Task 4, rather than editing them here.
- [ ] **Step 4: Screenshots.** Use a short Playwright script, not committed, at 375x812 and 1280x800. Capture:
  - the table
  - the expanded `pwpolicy_minimum_length_enforce` detail
  - the filter sidebar with macOS 27 + CIS Level 1 selected
  - Read each image and fix any unreadable layout. Report the screenshot paths.
- [ ] **Step 5: Commit** `feat: browse mSCP rules in the web UI`.

---

### Task 4: Generator: check planning, discovery script and Rules JSON

**Files:**
- Create: `webui/src/logic/checkPlan.ts`, `logic/checkPlan.test.ts`
- Rewrite: `webui/src/logic/scriptGen/bash.ts`, `scriptGen/bash.test.ts`, `logic/rulesJsonGen.ts`, `logic/rulesJsonGen.test.ts`
- Modify: `webui/src/logic/operatorMap.ts` (keep `IntuneOperator`/`IntuneDataType`; remove anything only the old OutputCheck model used)
- Modify: `webui/src/logic/scriptGen/powershell.ts`, `powershell.test.ts`. Keep the Windows generator compiling by moving the old `AuditStep`/`OutputCheck`/`OutputDataType`/`Operator` types it needs into `webui/src/logic/scriptGen/legacyWindowsTypes.ts` (header comment: kept for the future Windows source, not wired into generation). Raise the real-PowerShell test's timeout to 30000 ms (it flaked at 5000 ms under full-suite load).
- Remove the temporary `tsconfig.app.json` exclusions from Task 3 for the files this task rewrites.

**Interfaces:**
- Consumes: `Rule` (Task 2), `substituteOdv`/`validateOdvValue`/`effectiveOdvValue` (Task 2), `coveredVersions` (Task 2/3).
- Produces:
  - `settingNameFor(rule: Rule): string`, per Global Constraints.
  - `planRuleCheck(rule: Rule, coveredVersions: string[], odvValue: OrgDefinedValue | null): RuleCheckPlan | { problem: string }`
    - returns `problem` when: the rule is manual; an ODV is needed but missing or invalid; a listed version resolves to no check, or to a check with a null result; or the rule has no listed macOS version at all (problem text: "mSCP does not map this rule to any macOS version." This covers `os_gatekeeper_rearm` and `os_firewall_log_enable`, which would otherwise always pass)
  - `RuleCheckPlan`:
    - `{ id: string; title: string; settingName: string; architecture: Architecture; reporting: 'raw' | 'boolean'; dataType: 'Int64' | 'String' | 'Boolean'; operand: number | string | boolean; branches: { majors: string[]; shell: string; expected: { type: 'integer' | 'string' | 'base64'; value: number | string } }[]; newerThan: string; newerBranch: { shell: string; expected: { type: 'integer' | 'string' | 'base64'; value: number | string } } | null }`
    - `majors` are major-version strings (`"26"`), and `newerThan` is the highest covered major
    - `reporting` is `raw` when every branch (including `newerBranch`) has an identical expected type and value. `dataType`/`operand` then come from that expected value (`integer` gives `Int64` and the number; `string`/`base64` give `String` and the string). Otherwise it is `boolean`, with `dataType: 'Boolean'` and `operand: true`.
  - `generateBashScript(plans: RuleCheckPlan[]): string`:
    - **Preamble:** copied from mSCP's vendored `compliance_script.sh.jinja` variable block (`CURRENT_USER`, `CURR_USER_UID`, `CURR_HOSTNAME`, `arch`, `plb`). `arch` is `${ICT_TEST_ARCH:-$(/usr/bin/arch)}`. `__os_major` is `${ICT_TEST_OS_MAJOR:-$(/usr/bin/sw_vers -productVersion | /usr/bin/cut -d. -f1)}`. The two `ICT_TEST_*` overrides exist only so tests can execute the script; a comment says so.
    - **Per rule:** dispatch on `__os_major`. A listed major runs its branch's shell captured as `$( <shell>\n)` (the newline before `)` keeps heredocs inside checks working, as mSCP does). A major greater than `newerThan` runs `newerBranch` (or passes if null). Anything else passes. An architecture mismatch passes.
    - **Pass value:** the operand for `raw`, `true` for `boolean`.
    - **`boolean` reporting:** compares the trimmed captured output against the branch's expected value as a string, in-script.
    - **Output:** one compact JSON object keyed by SettingName using the existing `__json_int`/`__json_str`/`__json_bool` helpers, printed last.
    - **Safety:** throws if any plan's shell or expected value still contains `$ODV`.
  - `buildRuleEntry(plan: RuleCheckPlan, rule: Rule): IntuneRuleEntry`:
    - `SettingName`, `Operator: 'IsEquals'`, and `DataType`/`Operand` from the plan
    - `MoreInfoUrl = rule.source.upstream_url`
    - `RemediationStrings`: `[{ Language: 'en_US', Title: displayWithOdv(title, value), Description: first paragraph of discussion with displayWithOdv }]`

- [ ] **Step 1: Write failing tests:**
  - `checkPlan.test.ts` uses small inline Rule fixtures plus three real committed rules read from `../baselines`:
    - `os_tftpd_disable`, whose 15.0 override changes the result type, so reporting is `boolean`
    - `os_gatekeeper_enable`, reported `raw`, `String`, `"PASS"`
    - `audit_configure_capacity_notify`, where `$ODV` in an integer result gives `Int64` with the ODV value
  - It also covers:
    - a base64 `$ODV` result is encoded
    - a hyphenated id produces `os_mfa_network_non_priv`
    - a missing ODV and an invalid ODV each produce a problem
    - `os_messages_app_disable_familycontrols` with covered versions 15/26/27 has no branch for 27 and a `newerBranch` from 26
  - `bash.test.ts` writes the generated script to a temp file and executes it with `bash` (as today), using fixture plans whose shells are `echo` statements. It sets `ICT_TEST_OS_MAJOR` to a listed major, an unlisted covered major, a newer major and an older major, and sets `ICT_TEST_ARCH`. It asserts the exact JSON emitted, the `true`/`false` in-script comparison for `boolean` reporting, and that output parses as JSON. It also checks that a check containing a heredoc works.
  - `rulesJsonGen.test.ts` covers entry shape and the `$ODV` display substitution in the title.
- [ ] **Step 2: Run** `cd webui && bun x vitest run src/logic/checkPlan.test.ts src/logic/scriptGen src/logic/rulesJsonGen.test.ts`. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests, then `bun run lint` and `bun run build`. Expected: pass (`chunking.ts`/`bundleFiles.ts` may still be excluded until Task 5).
- [ ] **Step 5: Commit** `feat: generate mSCP discovery scripts and Intune rules`.

---

### Task 5: Review-and-generate screen, chunking and bundle

**Files:**
- Rewrite: `webui/src/logic/chunking.ts`, `chunking.test.ts`, `logic/bundleFiles.ts`, `bundleFiles.test.ts`, `logic/manualAttestationReport.ts`, `manualAttestationReport.test.ts`
- Modify: `webui/src/components/generate/GenerateReviewScreen.tsx`, `BundleGroupCard.tsx`, `ManualAttestationReport.tsx`
- Modify: `webui/e2e/smoke.spec.ts` (add a generate test)
- Remove all remaining temporary `tsconfig.app.json` exclusions.

**Interfaces:**
- Consumes: `planRuleCheck`, `generateBashScript`, `buildRuleEntry` (Task 4); `fetchRule`, selections and `coveredVersions` (Tasks 2-3).
- Produces:
  - `classifyRule(rule: Rule, selection: SelectionEntry, coveredVersions: string[]): { kind: 'generatable'; rule: GeneratableRule } | { kind: 'manual'; entry: ManualAttestationEntry } | { kind: 'blocked'; entry: BlockedEntry }`
    - manual: `assessment.status === 'manual'`
    - blocked: an ODV with no effective value or an invalid one
    - generatable: otherwise, unless `planRuleCheck` returns a problem, in which case it is manual with that problem as the reason
  - `GeneratableRule = { id; title; section; sourceName; releaseTag; plan: RuleCheckPlan; ruleEntry: IntuneRuleEntry }`
  - `packChunks(rules, options?)` groups by `sourceName` + `releaseTag` + `section`, then splits by the existing limits (keep the even-split algorithm and the per-rule-fits check). Duplicate SettingName within a chunk is an error.
  - **Bundle file names:** `macOS-<sourceName>-<releaseTag>-<section>[-part<N>]-discovery.sh` and `...-rules.json`.
  - **Manual attestation reasons:**

    | `manual_reason` | Text |
    |---|---|
    | `inherent` | "Met by macOS by design (mSCP: inherent)." |
    | `permanent` | "Cannot be configured on macOS; mSCP lists this as a permanent finding." |
    | `n_a` | "Not applicable to macOS (mSCP: n_a)." |
    | `supplemental` | "Supplemental guidance with no check." |
    | `manual` | "mSCP marks this check as manual." |
    | `no_check` | "mSCP provides no automated check." |

    Append the check's `additional_info` when present.
  - **Review screen:** the same structure as before. Blocked rules list the rule and why (missing or invalid organization value). The download is disabled while any are blocked.

- [ ] **Step 1: Write failing tests:**
  - `chunking.test.ts`:
    - classification per kind, including an ODV rule with the recommended default (generatable with no admin input) and one with no default (blocked)
    - grouping by section
    - even split at the limits
    - a duplicate SettingName error
  - `bundleFiles.test.ts`: file names and no collisions.
  - `manualAttestationReport.test.ts`: the reason texts.
  - An e2e test: select Enable Gatekeeper, `pwpolicy_minimum_length_enforce` and one inherent rule, go to Review & generate, check that the download button is enabled and the manual list contains the inherent rule. Clear the ODV to an invalid value and check that the rule shows as blocked.
- [ ] **Step 2: Run** them. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify:** full `bun run test`, `bun run lint`, `bun run build`, and `bun run test:e2e` with dev running. Also generate a real bundle in the browser via Playwright (download event), unzip it in a temp dir, run `bash -n` on every `.sh` file, and parse every `-rules.json`. Take screenshots of the review screen at 375 and 1280 and Read them. Expected: all pass.
- [ ] **Step 5: Commit** `feat: generate mSCP compliance bundles from the review screen`.

---

### Task 6: Attribution, README and Pages deploy

**Files:**
- Create: `NOTICE`, `.github/workflows/deploy-pages.yml`
- Modify: `README.md`, `docs/plans/2026-10-20-mscp-webui-plan.md` (Progress log), `docs/plans/2026-10-20-mscp-source-design.md` (Progress log; Status line becomes `Approved; Plans 1 and 2 implemented`)

**Interfaces:** none (docs and CI).

- [ ] **Step 1: NOTICE.** State:
  - This project's code is AGPL-3.0.
  - `sources/mscp/upstream/` is an unmodified copy of parts of the NIST macOS Security Compliance Project (URL, release tag from `sources/mscp/source.json`), CC BY 4.0 (URL), see `sources/mscp/upstream/LICENSE.md`.
  - `baselines/mscp/` and the generated discovery scripts are adapted from that material (normalized format, ODV substitution, script assembly). They remain CC BY 4.0 and are provided as-is, with the warranty disclaimer in section 5 of that licence.
  - No endorsement by NIST is implied.
- [ ] **Step 2: README.**
  - Update steps: step 1 installs `requirements-dev.txt` (which includes `requirements.txt`).
  - Add a short "Web UI" section: `cd webui && bun install && bun run dev`, and `bun run build`.
  - Point the Licensing section at NOTICE.
- [ ] **Step 3: Deploy workflow.**
  - Triggers: push to `main` plus `workflow_dispatch`.
  - Permissions: `contents: read`, `pages: write`, `id-token: write`. Concurrency group `pages`.
  - Steps: checkout; `oven-sh/setup-bun@v2`; `bun install --frozen-lockfile` in `webui`; `bun run test`; `bun run build`; `actions/configure-pages@v5`; `actions/upload-pages-artifact@v3` with `path: webui/dist`; `actions/deploy-pages@v4`.
  - Before writing, confirm each action's current major version on its GitHub releases page. If a newer major exists, use it and say so in the report.
  - Validate the YAML parses (`python -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" .github/workflows/deploy-pages.yml`).
- [ ] **Step 3b: Report the manual step.** The maintainer must set the repository's Pages source to "GitHub Actions" in GitHub settings. Report it; do not attempt it.
- [ ] **Step 4: Progress logs.** Add one dated entry per task 1-6 with short hash and subject. Task 6 uses "this commit (docs: add attribution notice and Pages deploy)".
- [ ] **Step 5: Commit** `docs: add attribution notice and Pages deploy`.

---

## Progress log

(none yet)
