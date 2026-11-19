# Design: named organization-defined values (several per rule)

Date: 2026-11-18
Status: Implemented

## 1. Intent

A rule can carry at most one organization-defined value (ODV) today: `rule.odv`, written as
`$ODV` in titles, discussions, checks, fixes and payloads. The CIS benchmarks imported from
ComplianceAsCode (`2026-11-18-cis-complianceascode-source-design.md`) need up to seven per
recommendation (e.g. idle timeout 900 plus lock delay 5), and the maintainer wants every one of
them customisable, defaulting to CaC's recommended values.

This design replaces the single ODV with a list of **named** ODVs, used the same way by every
source. The maintainer's direction: aim for simplicity, and have each importer translate its
upstream's conventions into one aligned format, so nothing downstream needs to know which
source a rule came from.

## 2. Goals, non-goals, anti-goals

### Goals

- A rule declares zero or more named ODVs. Each is customised independently in the web UI.
- One placeholder form for all sources: `$ODV_<name>`. Importers translate upstream text into it.
- mSCP rules keep their current behaviour, as a one-item list.
- Saved selections in the browser and exported settings files from before this change keep
  working: they are converted, not discarded.

### Non-goals

- The CaC import itself (its own plan resumes after this one).
- Generating Linux scripts. Script generation stays macOS-only.
- Changing mSCP's validation rules or the hand-reviewed variable-mode allowlist, other than the
  placeholder rename.

### Anti-goals

- Two code paths (one for single-value rules, one for multi-value rules).
- A placeholder in rule text that names no declared ODV, or a declared ODV used nowhere.
- A customised value shown inside a copyable command where it could break out of its quoting.
- Losing an admin's saved values on upgrade.

## 3. Today (the parts this changes)

- Schema: `rule.odv` is `null` or `{datatype, description, validation, recommended,
  by_benchmark}`. 35 mSCP rules (release_27.1) have one; no other source uses it.
- The index carries `has_odv`.
- `$ODV` appears in mSCP titles (19), discussions (20), check shells (5), expected values (13),
  payload `configuration_value` (5) and `ddm_value` (9), `additional_info` (3). No `$ODV` is
  directly followed by a letter, digit or underscore.
- Web UI (`webui/src/logic/odv.ts`): one value per rule; a substitution mode per rule
  (`none` / `variable` / `text`) worked out from the generated check shell; `variable` comes
  from a hand-reviewed allowlist and exports `ODV` before the check; `text` replaces `$ODV` and
  applies strict validation (letters, digits, `. _ : + -` only for strings).
- Selection store: `SelectionEntry.odvValue`, persisted at `PERSIST_VERSION = 2`.
- Settings export: `schemaVersion: 2`, each selection with `odvValue`.
- Overlays may set `odv`; none of the committed overlays do.
- About 35 web UI files and `tools/mscp_normalize.py`, `tools/library_output.py`,
  `tools/overlays.py` touch ODVs.

## 4. Approaches

- **A. Named ODVs for every rule, one model (chosen by the maintainer).** `odv` becomes a list
  of named values; mSCP rules become one-item lists. One code path, touches every ODV site once.
- **B. Keep `odv` and add a separate multi-value field.** Rejected: two paths that drift.
- **C. Split multi-value recommendations into several rules.** Rejected: breaks "one rule = one
  recommendation" and the fixes don't split.

## 5. Design

### 5.1 Rule format

`odv` is replaced by `odvs`: an array, `[]` when the rule has none. Each item:

| Field | Meaning |
|---|---|
| `name` | `^[a-z][a-z0-9_]*$`, unique within the rule |
| `datatype`, `description`, `validation`, `recommended`, `by_benchmark` | as today's `odv` |
| `quoting` | where the placeholder sits in shell text: `unquoted`, `single` or `double` (5.3) |

The placeholder for an ODV is always `$ODV_<name>`; it is derived, not stored. The rule schema
version goes from 5 to 6 (`tools/library_output.SCHEMA_VERSION`), and every committed release of
every source is regenerated (rules without ODVs gain `"odvs": []`). `has_odv` in the index stays,
meaning "has at least one".

### 5.2 Importers align upstream text

- **mSCP:** the single ODV gets `name: "value"`, `quoting: "unquoted"`, and the importer rewrites
  every `$ODV` in the rule to `$ODV_value`. The variable-mode allowlist in `odv.ts` is updated
  to the rewritten shells, and variable mode exports `ODV_value` instead of `ODV`.
- **CaC** (in its own plan): each XCCDF variable a fix uses becomes an ODV named after it
  (`var_password_pam_minlen`), and each `<xccdf-1.2:sub>` becomes `$ODV_<name>`.
- **Every importer** fails loudly if a rule contains a `$ODV_` placeholder that names no declared
  ODV, declares an ODV that no text uses, or contains a bare `$ODV` not followed by `_<name>`.

### 5.3 Quoting and validation

Two separate gates exist today, and both stay:

1. **What an admin may store** depends on the rule's substitution mode, worked out as today from
   the generated (macOS) check shell: `text` mode applies the strict rules, `none` and `variable`
   only the datatype checks plus the carriage return and NUL ban. Unchanged by this design; it
   now runs per ODV, with the mode computed from that ODV's placeholder. CaC rules have no
   generated check, so their ODVs are always in `none` mode here.
2. **Whether a value is shown inside a displayed (copyable) shell command** instead of the
   placeholder (`codeOdvValues`). Today this always uses the strict text-mode rules. `quoting`
   only changes this gate:
   - `unquoted` (default, and every mSCP ODV): the strict text-mode rules, as today.
   - `single`: the placeholder only ever appears inside single quotes; the value is shown unless
     it contains `'`, a newline, a carriage return or NUL.
   - `double`: only inside double quotes; shown unless it contains `"`, `` ` ``, `$`, `\`, a
     newline, a carriage return or NUL.

   A value that fails its gate is not shown in the command; the placeholder stays, as today.

The importer that sets `single` or `double` verifies every occurrence of the placeholder in the
rule's check and remediation shell text sits inside that quoting, and fails otherwise; it also
fails if the recommended value or any `by_benchmark` value would fail that ODV's display gate.
An ODV whose placeholder appears in no shell text gets `unquoted` (it is never displayed in a
command, so the gate never applies). The per-rule `variable` mode (mSCP allowlist) is unchanged.

### 5.4 Web UI

- Selection entries hold `odvValues: Record<string, OrgDefinedValue>` (a missing name means "use
  the recommended value") instead of `odvValue`. `PERSIST_VERSION` becomes 3; version 2 state
  is migrated by moving a non-null `odvValue` to `odvValues.value`.
- Settings export `schemaVersion` becomes 3 with `odvValues`. Import accepts version 3 and
  version 2 (converted the same way); version 1 is still rejected.
- Rule detail shows one input per ODV, labelled by its description (or name when the
  description is empty), each with its own quick picks (Recommended, then per benchmark).
- Substitution, display and validation functions in `odv.ts` take the rule's ODV list and a
  values map, replacing each `$ODV_<name>` with its own value, using one pattern that matches
  whole placeholders so `$ODV_a` never matches inside `$ODV_ab`.
- Script generation, the manual attestation report, rules JSON generation, change labels,
  supporting checks and overlays handle the list in the same way they handle one value today.
  Script generation stays macOS-only.

### 5.5 Overlays

Maintainer decision (2026-11-19, replacing an earlier ban): overlays may set ODVs and use
`$ODV_<name>` placeholders, because an overlay that adds its own script (as the ASD blueprint
overlays already do) may need its own values.

- **`odvs` is a replace-only field.** An overlay sets the whole list with `$replace`; `$merge`
  and `$append` on `odvs` are invalid. An overlay only sets ODVs together with its own custom
  script, so supplying the full list is natural, and no by-name merge is needed in either merge
  engine.
- **The index stand-in follows the list.** `has_odv` on an overlaid index entry is
  `len(odvs) > 0` of the replacing list; the partial-object seeding and completeness check for
  the old single `odv` (`odv: {}`/`null` seeding, `ODV_REQUIRED_KEYS`, `reduceOdv`) go away.
- **Overlaid rules get the same placeholder and quoting checks as imported rules,** in CI
  (`tools/overlays.py`, run by `tests/test_overlays.py`): `placeholder_errors` on every overlaid
  rule, including the text of script files the rule references through `shell_file` (check and
  remediation). In a script file, double-quote escapes follow the file's language: `\` for
  `.sh`/`.py`, `` ` `` for `.ps1`. The quoting rules themselves (5.3) hold for both bash and
  PowerShell, since a value can contain neither quote character nor `$`, `` ` `` or `\`.
- **The browser** keeps its existing split (custom overlays design 3.4): it checks overlay
  shape and merge types only, now including that `odvs` is a `$replace`d list of objects; full
  rule validation, including these checks, stays CI's job. Overlays only come from the repo, so
  every published overlay has passed CI.

## 6. Testing

- Python: schema accepts the new shape and rejects a bad name, a duplicate name or an unknown
  `quoting`; mSCP normalization rewrites `$ODV` and fails on unmatched or unused placeholders;
  overlays accept a `$replace`d `odvs`, reject `$merge`/`$append` on it, and reject an overlaid
  rule (or a script file it references) whose placeholders break the quoting rules; the
  committed-library tests regenerate every release under the new schema.
- Web UI (Vitest): substitution with two ODVs whose names share a prefix; validation per
  `quoting`; persisted-state migration from version 2; settings import of version 2 and 3
  files; variable-mode export name.
- Playwright: a mSCP rule with an ODV still edits, displays and generates as before; screenshots
  of a rule with several ODV inputs at about 375px and desktop width (using a test fixture
  until the CaC rules exist).

## 7. Calls made without the maintainer

- The field is renamed `odv` to `odvs` (an array, never null) rather than keeping `odv` as a list.
- mSCP's ODV is named `value`, so its placeholder is `$ODV_value`.
- Quoting is declared per ODV by the importer and verified at import, rather than inferred at
  runtime.
- `has_odv` keeps its name.
- `quoting` only affects whether a value is shown inside a displayed command; what an admin may
  store stays mode-based as today (5.3). This keeps every current mSCP value valid.
- Overlays set ODVs by replacing the whole list; overlaid rules, and the script files they
  reference, are checked in CI only, matching how overlays are validated today (5.5).
- Rule-specific value checks (`ODV_RULE_VALUE_CHECKS`) and the variable-mode allowlist are keyed
  by rule id and ODV name.

## Progress log

- 2026-11-18: Added `tools/odv_placeholders.py`, the shared placeholder and quoting rules, with tests (this commit).
- 2026-11-19: Extended `placeholder_errors` with an optional script reader so `shell_file` scripts get the same placeholder and quoting checks (this commit).
- 2026-11-19: Implemented end to end: rule schema 6 with `odvs` on every release of every source, the importers and overlays on named ODVs (`$ODV_<name>`, mSCP's is `$ODV_value`), the web UI logic and components (one input per ODV, `useStoredOdvValues` / `useUsableOdvValues`, per-placeholder code block notes), saved selections at version 3 with version 2 converted, and settings files at version 3 with version 2 converted on import. Playwright covers the renamed mSCP behaviour, version 2 saved selections and a two-ODV rule (a pwpolicy rule given a second ODV by a route in the spec, since no committed rule has two yet); screenshots at 375px and 1440px checked. Commit: `feat: support several named organization-defined values per rule`.
