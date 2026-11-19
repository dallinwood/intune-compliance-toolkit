# Named Organization-Defined Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each rule's single ODV (`odv`, `$ODV`) with a list of named ODVs (`odvs`, `$ODV_<name>`), customised independently, with mSCP behaviour unchanged and old saved selections and settings files converted.

**Architecture:** A shared Python module defines the placeholder grammar and the import-time checks; importers translate upstream text into `$ODV_<name>`; the rule schema goes to version 6 and every committed release is regenerated. In the web UI, `odv.ts` works per ODV and per name, the selection store holds a values map, and the settings file goes to version 3 with a converter for version 2.

**Tech Stack:** Python 3.14+, pytest, jsonschema; React + TypeScript, Zustand, Vitest, Playwright, Bun.

**Spec:** `docs/plans/2026-11-18-named-odvs-design.md` (read it; this plan argues from it).

## Global Constraints

- Placeholder grammar: `$ODV_<name>`, name `^[a-z][a-z0-9_]*$`. A bare `$ODV` (not followed by `_<name>`) is an error anywhere in rule data after import. Replace only the `$ODV` token: mSCP shells contain `-v ODV=$ODV`, whose `ODV=` must stay.
- mSCP's single ODV is named `value` with `quoting: "unquoted"`. Its observable behaviour (what may be stored, what is shown, generated scripts) must not change apart from the placeholder and exported variable being `ODV_value` instead of `ODV`.
- `quoting` (`unquoted` | `single` | `double`) only gates whether a value is shown inside a displayed shell command (design 5.3). Storage validation stays mode-based as today, computed per ODV.
- Overlays may set `odvs` only with `$replace` (whole list); `$merge`/`$append` on `odvs` are invalid. Overlaid rules, and script files they reference, must pass `placeholder_errors` in CI. The browser checks overlay shape only (design 5.5).
- Rule `schema_version` becomes 6 (`tools/library_output.SCHEMA_VERSION`, `webui/src/types/library.ts`). `has_odv` stays, meaning `len(odvs) > 0`.
- `PERSIST_VERSION` 3 (convert version 2: non-null `odvValue` -> `odvValues.value`; discard below 2 as today). Settings file `schemaVersion` 3 (import accepts 3, and 2 converted the same way).
- Tasks 3 to 5 change data, Python and web UI together and land as **one commit** at the end of Task 5; Tasks 3 and 4 leave their work uncommitted for the next task. Every commit must pass `python -m pytest -W error`, and in `webui/`: `bun run test`, `bun run lint`, `bunx tsc -b`.
- Before Task 3: the other in-progress work in the working tree must be committed. Check `git status --short`: nothing under `baselines/`, `sources/`, `tools/`, `tests/` or `webui/` may be modified or untracked except this plan's own files. Otherwise stop and ask the maintainer.
- Commits: `type: summary`, body explains why, no `Co-Authored-By` or other AI attribution, stage explicit paths only, push after committing (branch is not `main`). Add a progress log entry to the design doc in each commit.
- Dev server: the coordinating session starts `bun run dev -- --port 5199 --strictPort` in `webui/` once and waits for `http://localhost:5199/` to answer 200. Subagents use `PLAYWRIGHT_BASE_URL=http://localhost:5199` and never start or stop it.
- Python runs from the repo `.venv` (`.venv/Scripts/python.exe -m pytest -W error -n auto`; it has `requirements-dev.txt`). At `fc3c4f68` one test already failed: `tests/test_github_fetch.py::test_download_pinned_files_skips_an_absent_optional_file` (another agent's in-progress area); a task is not responsible for it but must not add failures.
- Never use the em dash character anywhere.

## Review Focus

1. **Two ODVs whose names share a prefix** (`a` and `a_b`): substituting `$ODV_a_b` must never use `a`'s value. Tests in Task 1 (Python) and Task 4 (TS).
2. **A version 2 browser state or settings file with an `odvValue` for a rule that no longer has an ODV, or has an invalid value**: dropped with a reason, as today, never crashing. Test in Task 4.
3. **An mSCP shell with `-v ODV=$ODV`**: becomes `-v ODV=$ODV_value`. Test in Task 3.
4. **A value containing `'` for a `single` ODV**: kept as stored (if storage rules allow) but not shown inside the fix command; the placeholder stays. Test in Task 4.
5. **Variable-mode rules** (`os_policy_banner_ssh_configure`, `system_settings_admin_group_membership_defined`): the generated script exports `ODV_value` and the check expands `"$ODV_value"`. Test in Task 4 and the existing e2e banner test (Task 5).

---

### Task 1: Shared placeholder rules (Python)

**Files:**
- Create: `tools/odv_placeholders.py`
- Test: `tests/test_odv_placeholders.py`

**Interfaces:**
- Produces:
  ```python
  NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
  PLACEHOLDER_PATTERN = re.compile(r"\$ODV(?:_([a-z][a-z0-9_]*))?(?![A-Za-z0-9_])")   # group 1 None = bare $ODV
  QUOTINGS = ("unquoted", "single", "double")
  def placeholder(name: str) -> str                                   # "$ODV_" + name
  def display_gate_problem(quoting: str, value: str | int) -> str | None
  def placeholder_errors(rule: dict) -> list[str]
  ```
  `display_gate_problem`: `single` forbids `'`, `\n`, `\r`, `\0`; `double` forbids `"`, `` ` ``, `$`, `\`, `\n`, `\r`, `\0`; `unquoted` returns None (its gate is the web UI's text-mode rules, unchanged). `placeholder_errors` walks every string in the rule and reports: a bare `$ODV`; a placeholder naming no declared ODV; a declared ODV never used; an invalid or duplicate ODV name; an unknown `quoting`; for `single`/`double`, any occurrence in a check or remediation `shell` (`check[*].default.shell`, `check[*].by_version[*].shell`, `remediation[*].steps[*].shell`) that is not inside that kind of quotes on its line (track quote state left to right, honouring `\` escapes inside double quotes); and any `recommended` or `by_benchmark` value failing `display_gate_problem`. Each message starts with the rule id.

- [ ] **Step 1: Write failing tests:** `test_prefix_names_do_not_collide` (`PLACEHOLDER_PATTERN` over `"$ODV_a $ODV_a_b"` yields names `["a", "a_b"]`); `test_bare_placeholder_reported`; `test_unknown_and_unused_names_reported`; `test_single_quoted_occurrence_ok` (`x='$ODV_v'`); `test_single_declared_but_unquoted_reported` (`echo $ODV_v`); `test_double_quoted_occurrence_ok` (`$(echo "$ODV_v" | sed 's/a/b/')`); `test_double_declared_inside_single_quotes_reported`; `test_recommended_failing_gate_reported` (single, recommended `"it's"`); `test_unquoted_has_no_gate`; `test_duplicate_and_invalid_names_reported`.
- [ ] **Step 2: Run** `python -m pytest tests/test_odv_placeholders.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add shared rules for named ODV placeholders`.

### Task 2: Placeholder checks for referenced script files (Python)

**Files:**
- Modify: `tools/odv_placeholders.py`
- Test: `tests/test_odv_placeholders.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `placeholder_errors(rule: dict, read_script: Callable[[str], str] | None = None) -> list[str]`. When `read_script` is given, every `shell_file` path in `check[*].default`, `check[*].by_version[*]` and `remediation[*].steps[*]` is read with it, and its text counts as shell text: its placeholders count towards "used", and `single`/`double` occurrences in it must sit inside that quoting. Double-quote escape character by file extension: `\` for `.sh` and `.py`, `` ` `` for `.ps1`; an unknown extension is reported as an error. Without `read_script`, behaviour is unchanged. Messages name the script path.

- [ ] **Step 1: Write failing tests:** `test_script_file_placeholder_counts_as_used`; `test_script_file_single_quoted_ok` (`.ps1` text `$Value = '$ODV_v'`); `test_script_file_unquoted_reported` (`.sh` text `echo $ODV_v` for a `single` ODV, message names the path); `test_powershell_backtick_escape_inside_double_quotes` (`.ps1` text ``"a`"b $ODV_v"`` keeps the placeholder inside double quotes); `test_unknown_script_extension_reported`; `test_without_reader_script_files_are_ignored`.
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/test_odv_placeholders.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file's tests, then `.venv/Scripts/python.exe -m pytest -W error -n auto`. Expected: PASS (apart from failures already present at the base commit, which the report lists).
- [ ] **Step 5: Commit** `feat: check ODV placeholders in referenced script files`.

### Task 3: Named ODVs in the rule format and Python importers (uncommitted)

**Files:**
- Modify: `baselines/_rule.schema.json`: `schema_version` const 6; `odv` replaced by required `odvs` (array of closed objects: `name` (pattern), `datatype`, `description`, `validation`, `recommended`, `by_benchmark`, `quoting` enum); integer check result `value` `oneOf` integer or `{"type": "string", "pattern": "^\\$ODV_[a-z][a-z0-9_]*$"}`.
- Modify: `tools/library_output.py` (`SCHEMA_VERSION = 6`, `has_odv = len(rule["odvs"]) > 0`), `tools/mscp_normalize.py`, `tools/asd_ism_normalize.py`, `tools/asd_e4eit_normalize.py`, `tools/nist_800_53_normalize.py` (`"odvs": []`), `tools/file_references.py` (use `PLACEHOLDER_PATTERN`), `tools/validate_library.py` (run `placeholder_errors` on every rule, with a `read_script` that reads repo files)
- Modify: `tools/overlays.py`: `odvs` is a list field that only accepts `$replace` (`$merge`/`$append` raise `InvalidOverlay("odvs: only $replace is allowed")`); `apply_overlay_to_index_entry` sets `has_odv` from the replacing list's length and drops the old `odv` seeding, `ODV_REQUIRED_KEYS` and completeness check; the CI overlay check runs `placeholder_errors(overlaid_rule, read_script)` on every overlaid rule and reports each message as a failure
- Modify: `tests/fixtures/overlays/cases.json` (shared with the web UI, which Task 4 updates): replace the `odv` cases with `odvs` cases: `$replace` with a one-item list (index `has_odv` true), `$replace` with `[]` (false), `$merge` and `$append` rejected; `tests/fixtures/overlays/invalid/odv-validation-wrong-type.json` becomes an `odvs` item with a wrong-typed `validation`
- Regenerate: every committed release of every source
- Test: `tests/test_mscp_normalize.py`, `test_library_schema.py`, `test_library_output.py`, `test_file_references.py`, `test_asd_ism_normalize.py`, `test_asd_e4eit_normalize.py`, `test_nist_800_53_normalize.py`, `test_mappings_change_aware.py`, `test_release_import.py`, `test_committed_library.py`, `test_overlays.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: rule JSON with `odvs`; mSCP ODV `{"name": "value", ..., "quoting": "unquoted"}`; every `$ODV` token in a mSCP rule rewritten to `$ODV_value` (`re.sub(r"\$ODV(?![A-Za-z0-9_])", "$ODV_value", text)` over every string).

- [ ] **Step 1: Confirm the precondition** in Global Constraints (other work committed). If not, stop and ask.
- [ ] **Step 2: Update tests first:** in `test_mscp_normalize.py`, the ODV fixtures expect `odvs == [{"name": "value", ..., "quoting": "unquoted"}]`; add `test_odv_token_rewritten_not_bare_name` (a shell `awk -v ODV=$ODV` becomes `awk -v ODV=$ODV_value`) and `test_unused_odv_raises`; `test_odv_placeholder_without_odv_raises` keeps raising. In `test_library_schema.py`: `test_odv_placeholder_allowed_as_integer_value` uses `$ODV_value`; add `test_bad_odv_name_rejected`, `test_unknown_quoting_rejected`. Replace `"odv": None` fixtures with `"odvs": []` in the other listed tests. `test_file_references.py`: the check-script case uses `$ODV_value`. `test_overlays.py`: the new `cases.json` cases pass; add `test_overlay_with_own_script_and_odvs_is_valid` (an overlay that `$replace`s `odvs` with `[{"name": "max_age", ..., "quoting": "single"}]` and adds a remediation step whose `shell_file` is a test `.ps1` containing `$MaxAge = '$ODV_max_age'`) and `test_overlay_placeholder_outside_quotes_is_rejected` (same, script text `$MaxAge = $ODV_max_age`).
- [ ] **Step 3: Run** `python -m pytest -W error`. Expected: FAIL in the updated tests.
- [ ] **Step 4: Implement** the schema, `library_output`, normalizers, `file_references`, `validate_library` changes.
- [ ] **Step 5: Regenerate** with `python tools/import_mscp.py --offline`, `python tools/import_asd_ism.py --offline`, `python tools/import_asd_e4eit.py --offline`, `python tools/import_nist_800_53.py --offline`.
- [ ] **Step 6: Run** `python -m pytest -W error --all-releases`. Expected: PASS. `git grep -nE '\$ODV([^_]|$)' -- baselines` prints nothing (check `baselines/_mappings/rules/mscp-to-asd-ism-system-access.json` by hand: a title copied there may need the same rename; it is maintainer-written, so edit it only if it holds rule text, and say so in the commit body).
- [ ] **Step 7: Do not commit.** Hand over to Task 4 with the Python suite green.

### Task 4: Web UI logic on named ODVs (uncommitted)

**Files:**
- Modify: `webui/src/types/library.ts`, `webui/src/logic/{odv,selectionEntry,exportImport,checkPlan,chunking,odvExportDisplay,supportingCheckValue,manualAttestationReport,rulesJsonGen,changeLabels,ruleChanges,testRuleFixtures}.ts`, `webui/src/logic/scriptGen/bash.ts`, `webui/src/state/selectionStore.ts`
- Modify (overlays, matching Task 3's Python and the shared `cases.json`): `webui/src/logic/overlays.ts` (`FIELD_KINDS.odvs` replace-only list, `INDEX_OVERLAY_FIELDS` uses `odvs`, `applyOverlayToIndexEntry` sets `has_odv` from the list length, `ODV_REQUIRED_KEYS` and the `odv` seeding removed), `overlayIndex.ts` (`reduceOdv`/`indexFieldsOf`: the index keeps only whether the replacing list is non-empty), `overlayShape.ts` (`odvs`: list of objects with the design 5.1 keys, `quoting` enum); tests `overlays.test.ts`, `overlayIndex.test.ts`, `overlayShape.test.ts`, `webui/src/data/overlays.test.ts`, `webui/src/data/ruleRows.test.ts`
- Test: the matching `*.test.ts` files, `logic/libraryData.test.ts`, and the fixture-only tests listed in the inventory (`odv: null` to `odvs: []`)

**Interfaces:**
- Consumes: Task 3's data.
- Produces (types): `type OdvQuoting = 'unquoted' | 'single' | 'double'`; `Odv` gains `name: string` and `quoting: OdvQuoting`; `Rule.odvs: Odv[]`; `schema_version: 6`; `type OdvValues = Record<string, OrgDefinedValue>`.
- Produces (`odv.ts`), replacing the single-value functions:
  ```ts
  export function odvPlaceholder(name: string): string
  export function odvSubstitutionMode(rule: Rule, odv: Odv): OdvSubstitutionMode    // shells containing this ODV's placeholder
  export function validateOdvValue(odv: Odv, value: OrgDefinedValue, mode: OdvSubstitutionMode, ruleId: string): string | null
  export function prepareOdvValue(odv: Odv, value: OrgDefinedValue, mode: OdvSubstitutionMode, ruleId: string): OdvPreparation
  export function usableOdvValues(rule: Rule, stored: OdvValues): OdvValues               // every ODV: valid stored value, else recommended
  export function substituteOdvs(text: string, values: Partial<OdvValues>, missing?: string): string   // one regex pass; unknown name left as-is
  export function displayWithOdvs(text: string, values: Partial<OdvValues>): string        // missing -> "[value]"
  export interface CodeOdvValues { script: Partial<OdvValues>; json: Partial<OdvValues>; exported: Partial<OdvValues> }
  export function codeOdvValues(rule: Rule, values: OdvValues): CodeOdvValues
  export function codeTextWithOdvs(code: string, values: Partial<OdvValues>, isJson: boolean): string
  export function containsOdvPlaceholder(text: string): boolean
  export function odvQuickPicks(odv: Odv, index: VocabularyIndex): OdvQuickPick[]          // unchanged
  ```
  `ODV_RULE_VALUE_CHECKS` and `ODV_VARIABLE_ALLOWLIST` are keyed `` `${ruleId}:${odvName}` `` (`mscp.system_settings_softwareupdate_current:value`, ...); the allowlisted shells use `$ODV_value`. `codeOdvValues` script gate: `unquoted` uses today's strict text-mode rules; `single`/`double` use the design 5.3 rules; variable mode puts the value in `exported` only.
- Produces (selection): `SelectionEntry.odvValues: OdvValues`; `PERSIST_VERSION = 3`; `migratePersistedSelections` converts version 2; store actions `setOdvValue(ref: RuleRef, name: string, value: OrgDefinedValue)` and `clearOdvValue(ref: RuleRef, name: string)`.
- Produces (settings file): `SettingsFileV3 { schemaVersion: 3; ...; selections: SelectionEntry[] }`; `validateSettingsFile` accepts 3 and converts 2; `sanitizeImportedSelections` validates each name, dropping unknown names with reason `"This rule has no organization-defined value named <name>."`.
- Produces (generation): `RuleCheckPlan.odvValues: OdvValues`, `RuleCheckPlan.exportedOdvs: Record<string, string>`; `planRuleCheck(rule, coveredVersions, selected: OdvValues)`; `bash.ts` writes `export ODV_<name>='...' ; ` per exported ODV; `odvExportDisplay` takes the ODV name (`expandsOdvOnlyAsQuotedVariable(shell, name)`, `shellWithExportedOdv(shell, name, value)`); `supportingCheckValueSummary(odv, mode, storedValue, ruleId)` unchanged in shape, called per ODV.

- [ ] **Step 1: Write failing tests:** `odv.test.ts`: `substituteOdvs` with names `a` and `a_b`; `codeOdvValues` showing a `/etc/x.conf` value for a `single` ODV but not for an `unquoted` one, and hiding `it's` for `single`; allowlist keyed by `rule:name`. `selectionEntry.test.ts`: version 2 state `{odvValue: 5}` becomes `{odvValues: {value: 5}}`, `{odvValue: null}` becomes `{odvValues: {}}`, version 1 discarded. `exportImport.test.ts`: a version 2 file converts; a version 3 file round-trips; an unknown ODV name is dropped with the reason above. `bash.test.ts`: `export ODV_value='...'`. `libraryData.test.ts`: `EXPECTED_ODV_SUBSTITUTION_MODES` keyed by rule and name with the same 2 variable / 17 text / 16 none split; pinned shells use `$ODV_value`; every recommended and `by_benchmark` value of every ODV validates. Update the other listed tests' fixtures.
- [ ] **Step 2: Run** `bun run test` in `webui/`. Expected: FAIL.
- [ ] **Step 3: Implement** the logic, types and store changes.
- [ ] **Step 4: Run** `bun run test` and `bun run lint`. Expected: PASS for logic tests (`bunx tsc -b` may still fail on components until Task 5).
- [ ] **Step 5: Do not commit.** Hand over to Task 5.

### Task 5: Web UI components, end-to-end and the combined commit

**Files:**
- Modify: `webui/src/components/rules/{OrgDefinedValueInput,CodeBlock,DiscussionText,ReferencedFile,RuleCheckSection,RuleRemediationSection,RuleDetailPanel,MappedRuleSummary}.tsx`, `webui/src/components/generate/{GenerateReviewScreen,SupportingCheckRow,SupportingChecksPanel}.tsx`, `webui/src/components/selection/ExportImportControls.tsx`, `webui/src/hooks/{useRule,useDisplayTitle}.ts`
- Modify: `webui/e2e/{coverage,frameworks,generate-checks,supporting-checks,smoke}.spec.ts`, `README.md` (ODV mentions)
- Test: Playwright

**Interfaces:**
- Consumes: Task 4.
- Produces: rule detail shows an "Organization-defined values" section with one `OrgDefinedValueInput` per ODV (label: description, or name when empty; props gain `odvName: string`); hooks `useStoredOdvValues(ruleRef): OdvValues` and `useUsableOdvValues(rule, ruleRef): OdvValues`; code and discussion components take `odvValues: Partial<OdvValues>` and `codeOdv: CodeOdvValues` instead of `odvValue`; `CodeBlock`'s notes name each placeholder (`$ODV_value stands for ...`); `useDisplayTitle` fetches the rule when the title contains `$ODV_`.

- [ ] **Step 1: Update e2e specs:** seeded persisted state uses `version: 3` and `odvValues: { value: ... }`; text expectations change `$ODV` to `$ODV_value` and `export ODV=` to `export ODV_value=`; add `version 2 saved selections still apply` (seed `version: 2` with `odvValue: 14` for the pwpolicy rule, expect `14` shown); add `a rule with two ODVs shows two inputs` using a test overlay-free fixture route if one exists, otherwise defer that check to the CIS plan's Task 8 and note it in the progress log.
- [ ] **Step 2: Implement** the component and hook changes.
- [ ] **Step 3: Run** in `webui/`: `bun run test`, `bun run lint`, `bunx tsc -b`, and with the shared dev server `bun run test:e2e`. Then `python -m pytest -W error --all-releases`. Expected: all PASS.
- [ ] **Step 4: Screenshot** the mSCP pwpolicy rule and the SSH banner rule detail at 375px and 1440px with a short Playwright script and look at each with the Read tool: the ODV section, the code blocks with the substituted value or export line, no horizontal scroll.
- [ ] **Step 5: Commit** everything from Tasks 3 to 5 (explicit paths: `baselines/`, `tools/`, `tests/`, `webui/src`, `webui/e2e`, `README.md`, the design doc) as `feat: support several named organization-defined values per rule`, with a body explaining the schema 6 regeneration, the `$ODV_value` rename and the storage/export conversions. Mark the design `Status: Implemented` and add the progress log entry.
