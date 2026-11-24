# Registry Settings and Display Languages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rules can carry native `registry` settings (shown as a table with a "Download .reg" button, plus PowerShell generated from them) and verbatim `ansible` and `goss` items, across the schema, Python tools and web UI. No source emits them yet; plan 2 (the ansible-lockdown importer) will.

**Spec:** `docs/plans/2026-11-20-windows-cis-lockdown-design.md`, sections 1, 2, 3 and 5 (binding; read them).

**Architecture:** additive schema change. A check entry or remediation step has exactly one body: `shell`, `shell_file` or `registry` (a list of settings). `tools/registry_powershell.py` turns a registry list into PowerShell for importers. The web UI renders registry items as a table and builds the `.reg` file itself (it needs customised ODV values).

**Tech stack:** Python 3 (jsonschema, pytest), React/TS (Vitest, Playwright, Bun).

## Global Constraints

- Languages become `bash`, `powershell`, `zsh`, `python`, `instructions`, `registry`, `ansible`, `goss`. Labels: "Registry", "Ansible", "goss".
- Registry setting: `{hive, path, value_name, type, data, state}`; hive in `HKLM`, `HKCU`, `HKU`, `HKCR`; type in `REG_DWORD`, `REG_QWORD`, `REG_SZ`, `REG_EXPAND_SZ`, `REG_MULTI_SZ`, `REG_BINARY`; `state` `present` or `absent`; when `absent`, `type` and `data` are `null`. Data: integer (DWORD 0..4294967295, QWORD 0..2^64-1), string (SZ, EXPAND_SZ), list of strings (MULTI_SZ), even-length hex string (BINARY), or a whole-value `"$ODV_<name>"`. `path` has no leading or trailing backslash; `value_name` `""` is the key's default value. The `registry` list has `minItems: 1`.
- `registry` language requires the `registry` body; every other language forbids it. `registry` items have `result: null` in checks. `ansible` and `goss` use inline `shell` only (no `shell_file`), never run, and are skipped by the ODV placeholder/quoting scanner.
- `registry`, `ansible`, `goss` are never runnable: they never make a rule automatable and are never picked by `generatedCheckItem`.
- A registry `$ODV_<name>` must name an existing ODV whose datatype fits (`number` for DWORD/QWORD, `string`/`enum`/`regex` for SZ/EXPAND_SZ; MULTI_SZ and BINARY take no ODV).
- `schema_version` stays 7; no release is regenerated.
- `.reg` file: UTF-16LE with BOM, CRLF line endings, `Windows Registry Editor Version 5.00`, blank line, then per key `[HKEY_LOCAL_MACHINE\path]` (long hive names: `HKEY_LOCAL_MACHINE`, `HKEY_CURRENT_USER`, `HKEY_USERS`, `HKEY_CLASSES_ROOT`) in first-seen order, values in item order: `"name"=dword:0000000a` (8 lowercase hex digits), `hex(b):` little-endian 8 bytes, `"name"="text"` (escape `\` and `"`), `hex(2):` / `hex(7):` UTF-16LE bytes with terminators (`hex(7)` ends with an extra `00,00`), `hex:` bytes; `@=` for the default value; `"name"=-` for absent; a blank line after each key block. Filename `<rule id>-<target>-check.reg` for a check item and `<rule id>-<target>-fix.reg` for a remediation step (changed in the final-review fixes: one name for both collided).
- Python `.venv/Scripts/python.exe -m pytest -W error -n auto` (3 known failures in `tests/test_github_fetch.py`). Web UI from `webui/`: `bun run test`, `bun run lint`, `bunx tsc -b`; e2e `PLAYWRIGHT_BASE_URL=http://localhost:5199 bun run test:e2e`. The controller owns the dev server and starts it before Task 3.
- Commits: `type: summary`, body says why, no Co-Authored-By or AI attribution, explicit paths only, push; progress log entry in this plan. Never use the em dash character.

## Review Focus

- A registry value with `value_name: ""` must render as "(Default)" in the table and `@=` in the `.reg` file.
- Non-ASCII and backslashes in SZ data and key paths must survive into the `.reg` file correctly escaped.
- A customised ODV (e.g. 900 instead of 600) must appear in the table, the PowerShell and the `.reg` download alike.
- An overlay that `$replace`s a rule's check list with a registry item must validate in both Python and TS (shared `tests/fixtures/overlays/cases.json`).
- Long key paths at 375px must wrap inside their card, never widen the page.

---

### Task 1: Schema and Python tools

**Files:** `baselines/_rule.schema.json`, new `tools/registry_powershell.py`, `tools/odv_placeholders.py`, `tools/file_references.py`, `tools/overlays.py`, `tools/validate_library.py` (whatever reads languages), tests (`tests/test_library_schema.py` or equivalent, new `tests/test_registry_powershell.py`, `tests/test_odv_placeholders.py`, `tests/test_overlays.py`), `tests/fixtures/overlays/cases.json` (add a case that `$replace`s a target's check list with a registry item and one with an invalid registry setting; Task 2 makes Vitest pass them).

**Interfaces produced:**
- `registry_check_powershell(settings: list[dict]) -> str` and `registry_fix_powershell(settings: list[dict]) -> str`. ODV placeholders pass through unchanged as `$ODV_<name>` PowerShell variables. Check: reads each value with `Get-ItemProperty -ErrorAction SilentlyContinue`, compares (MULTI_SZ by sequence, BINARY by bytes), prints each mismatch and exits 1 if any; else exits 0. Fix: `New-Item -Path <ps path> -Force | Out-Null` when missing, `New-ItemProperty -Force -PropertyType <DWord|QWord|String|ExpandString|MultiString|Binary>`, `Remove-ItemProperty -ErrorAction SilentlyContinue` for absent. PowerShell provider paths: `HKLM:\`, `HKCU:\`, `Registry::HKEY_USERS\`, `Registry::HKEY_CLASSES_ROOT\`. String data in single quotes with `'` doubled.

- [ ] **Step 1: Failing tests:** schema accepts each type with matching data and `absent`; rejects type/data mismatch, `absent` with data, DWORD out of range, odd-length BINARY, a body with both `registry` and `shell`, `registry` body on a `powershell` item, `shell_file` on `ansible`; golden PowerShell for one setting of each type, an absent setting, an ODV setting, and a key with `'` in the path; placeholder checks accept a registry ODV of a fitting datatype and reject an unknown or ill-typed one; the scanner ignores `ansible`/`goss` text containing `{{ }}` and `$`.
- [ ] **Step 2: Implement; run the full Python suite.**
- [ ] **Step 3: Commit** `feat: record registry settings and Ansible and goss items in rules`.

### Task 2: Web UI logic

**Files:** `webui/src/types/library.ts` (`ScriptLanguage` union, `RegistrySetting`, optional `registry` on check entry and remediation step), `logic/targetDisplay.ts` (labels), `logic/fileReferences.ts`, `logic/overlayShape.ts`, `logic/checkPlan.ts` (never pick the new languages), `logic/odv.ts` (substitute customised values in registry `data`), new `logic/registryFile.ts`, new `logic/registryRows.ts`, their tests; fix any exhaustive switch elsewhere that `tsc -b` flags.

**Interfaces produced:**
- `registryRows(settings: RegistrySetting[], odvValues): RegistryRow[]` where `RegistryRow = { hive: string, path: string, fullPath: string, valueName: string /* "(Default)" for "" */, type: string /* "" when absent */, data: string /* display text; MULTI_SZ joined with newlines; hex BINARY spaced in byte pairs */, odvName: string | null, action: 'Set' | 'Delete' }`.
- `registryFileText(settings: RegistrySetting[], odvValues): string` and `registryFileBytes(text: string): Uint8Array` (UTF-16LE with BOM), `registryFileName(ruleId: string, target: string): string`.

- [ ] **Step 1: Failing tests:** golden `.reg` text per type, absent, default value, two keys interleaved (first-seen key order), SZ with `\` and `"`, non-ASCII EXPAND_SZ bytes, customised ODV; `registryFileBytes` starts with `FF FE` and round-trips; rows for the same cases; `generatedCheckItem` skips registry/ansible/goss; overlay shape passes the shared `cases.json` registry cases.
- [ ] **Step 2: Implement; `bun run test`, `bun run lint`, `bunx tsc -b` pass.**
- [ ] **Step 3: Commit** `feat: build registry rows and .reg files in the web UI`.

### Task 3: Components, e2e and screenshots

**Files:** new `webui/src/components/rules/RegistryTable.tsx` (table at `sm` and up, stacked cards below; full path copy with `CopyButton`; "Download .reg" button beside it like `CodeBlock`'s copy button; ODV values highlighted as in scripts), `RuleCheckSection.tsx` and `RuleRemediationSection.tsx` (registry items render `RegistryTable`; ansible/goss render `CodeBlock` with their pill), a new e2e spec.

- [ ] **Step 1: e2e (failing):** via `page.route`, give a rule a Windows target with check items registry, powershell and goss, and remediation steps registry and ansible; assert the registry table's headers and a row's values, "(Default)" for an empty value name, the goss and Ansible pills, and that "Download .reg" downloads `<rule id>-Windows-check.reg` (and the remediation button `<rule id>-Windows-fix.reg`) whose bytes start with `FF FE` and whose text starts with `Windows Registry Editor Version 5.00`.
- [ ] **Step 2: Implement; run unit, lint, `tsc -b`, the full e2e (rerun failures alone).**
- [ ] **Step 3: Screenshots** of the check and remediation sections with registry items at about 375px and 1440px, light and dark; look at them (long key paths must not widen the page).
- [ ] **Step 4: Commit** `feat: show registry settings as a table with a .reg download`; progress log; push.

## Progress log

- 2026-11-20 - Task 1 (schema and Python tools): the rule schema accepts the `registry` body and the `ansible` and `goss` languages, `tools/registry_powershell.py` builds the check and fix PowerShell, and the ODV, file reference and overlay checks know the new languages. Commit: 3095dac82 feat: record registry settings and Ansible and goss items in rules.
- 2026-11-20 - Task 2 (web UI logic): the TS types, labels, overlay shape check and file reference rules know `registry`, `ansible` and `goss`; new `logic/registryRows.ts` and `logic/registryFile.ts` build the table rows and the UTF-16LE `.reg` file with the reader's customised ODV values (resolved in `logic/odv.ts`); Vitest runs the shared `rule_shape_cases` and the ansible/goss file reference cases. Commit: 79c9ba3ba feat: build registry rows and .reg files in the web UI.
- 2026-11-20 - Design change during Task 1 follow-up: inline PowerShell generated from registry settings uses the PowerShell quote dialect (a string ODV is emitted as `'$ODV_x'` and must be declared `single`; a `double` ODV is rejected), the same dialect `.ps1` files already use. Commit: ff3da8394 fix: quote string ODVs in generated registry PowerShell.
- 2026-11-21 - Task 3 (components and e2e): new `RegistryTable` shows registry items as a table (cards below the `sm` breakpoint) with a copyable full key path, the customised ODV value highlighted, and a "Download .reg" button that is disabled with a visible reason when the file cannot be built (no usable ODV value, or a key path, value name or string holding a line break or NUL, or a path holding "]"); `registryFileText` now refuses those and the rule schema rejects them. ansible and goss items show as their pill plus a plain code block. New `e2e/registry-settings.spec.ts`; screenshots checked at 375px and 1440px, light and dark. Commit: 447f903b7 feat: show registry settings as a table with a .reg download.
- 2026-11-22 - Final review fixes. Generated PowerShell: every check read resets `$current` and checks a missing key (an EXPAND_SZ check used to throw on one and reuse the previous value); string checks also verify the value kind; the fix script stops and exits 1 on any failure; names are read and deleted literally through the key object (no wildcard reading of `*`, `?`, `[`). `.reg` builder refuses a DWORD outside 0..4294967295, a QWORD that is negative, not whole or not a safe integer, so the button disables with a reason; a number ODV used as registry data must declare `min >= 0` and a `max` inside the type's range. The TS overlay shape check matches the schema (CR, LF, NUL, `]`, empty path segments, ansible and goss text must be a string), with shared cases in `tests/fixtures/overlays/cases.json`; the schema also rejects empty path segments. ansible and goss text is shown verbatim (no ODV substitution). Registry change labels read "Registry setting 1 data". `.reg` downloads are named `-check.reg` and `-fix.reg`. Decision recorded in spec section 3: the table keeps a merged Key column and shows "Delete this value" with no Action column. Verified on Windows PowerShell 5.1 and PowerShell 7 against HKCU only (every type incl. DWORD 0xFFFFFFFF, QWORD above 2^63, MULTI_SZ, BINARY, EXPAND_SZ with %SystemRoot%, value names with `*` and `[`, absent settings): check exits 1, fix exits 0, check exits 0. Commit: fab150a8c fix: harden registry PowerShell and .reg output after review.
- 2026-11-24 - Scoped re-review of fab150a8c: every finding resolved. Three new minors parked: the TS overlay check rejects the exact QWORD maximum that Python accepts, the table rounds a QWORD above 2^53 (the download refuses it), and the check script does not close its key handle. Recorded in the docs commit that adds this entry.
