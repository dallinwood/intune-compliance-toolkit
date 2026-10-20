# Design: macOS rules sourced from the NIST macOS Security Compliance Project

Date: 2026-10-20
Status: Approved; Plan 1 (import) implemented

## 1. Intent

The toolkit stalled because its rule content was extracted from CIS benchmark
PDFs, whose terms of use forbid that use. Every workaround since (the
clean-room control specs, the independent-authoring workflow) exists only to
route around that restriction.

The NIST macOS Security Compliance Project (mSCP,
https://github.com/usnistgov/macos_security) publishes 350 macOS rules, each
with a check script, expected result, organization-defined values (ODVs) and
mappings to CIS, DISA STIG, NIST 800-53/800-171, CMMC and others. Its
content is licensed CC BY 4.0 (verified against `LICENSE.md` at tag
`release_27.0`), which allows reuse and modification with attribution.

This rework makes mSCP the toolkit's macOS rule source. Rule content comes
only from mSCP; nothing is authored from, or depends on, CIS PDFs or any
other third-party document. Updating to a newer mSCP release is a single
local command whose result is a reviewable git diff, after which the GitHub
Pages site reflects the new data.

## 2. Goals, non-goals, anti-goals

### Goals

- Keep the existing web tool and its approach: one list of all rules, filter
  (OS version, benchmark, tags, etc.), select, supply organization values,
  generate an Intune custom compliance bundle (discovery script + Rules[]
  JSON, chunked, zipped) plus the manual attestation report.
- Rules are loaded automatically from the mSCP source. Users never choose
  "mSCP" as a thing; they just see rules.
- Pin to mSCP's published release tags (first target: `release_27.0`).
- Re-import is one command, run manually by the maintainer.
- Store mSCP data under `sources/mscp/` so other sources can sit alongside it
  later.
- The generated discovery script runs mSCP's own check commands and
  compares against mSCP's own expected results.
- Comply with CC BY 4.0 attribution.

### Non-goals (for now)

- Windows rules. They return later as another source; keep the code shaped
  so that is additive (see section 9).
- A GitHub Action that watches for new mSCP releases (later).
- A UI option to view or switch the mSCP release in use (later; the user
  wants this eventually, so don't design it out).
- Generating configuration profiles (.mobileconfig) or Settings Catalog
  policies. mSCP's `mobileconfig_info` is shown as remediation guidance
  only.
- iOS and visionOS rules.

### Anti-goals (failure even if it technically works)

- Any rule text, check, or mapping that did not come from mSCP (or from this
  repo's own code). No CIS PDF or CIS-derived markdown is read by anything.
- Hand-edited rule JSON. Generated files are only ever regenerated.
- An import that silently rewrites rule identities, so saved selections and
  exports stop matching after a routine update.
- Shipping Apple "Vendor Description content" (excluded from mSCP's CC BY
  grant; see section 8).

## 3. Facts about mSCP that shape this design

All verified against the `release_27.0` tarball (published 2026-09-11):

- **Layout.** mSCP 2.0 keeps its data under `src/mscp/data/`: `rules/<section>/<rule_id>.yaml`
  (468 rules, 350 with a `platforms.macOS` entry), `baselines/<os>/*.yaml`,
  `schema/mscp_rule.json`. The top-level `rules`, `baselines`, `schema` paths
  are symlinks, which do not extract on Windows. The importer must read
  `src/mscp/data/` directly.
- **Per-version applicability.** `platforms.macOS` has version keys
  (`'15.0'`, `'26.0'`, `'27.0'` in this release), each listing the benchmarks
  the rule belongs to on that version (`cis_lvl1`, `cis_lvl2`, `disa_stig`
  with a severity, `nlmapgov_base`, `nlmapgov_plus`). Membership differs by
  version.
- **Checks.** `platforms.macOS.enforcement_info.check` holds `shell` and
  `result`. 37 rules also have a version-level `enforcement_info` that
  overrides the top-level one for that version (e.g. `audit_auditd_enabled`
  uses a different check on 15.0). One rule (`os_messages_app_disable_familycontrols`)
  has only version-level checks.
- **Result types.** `integer` (111), `string` (154), `base64` (1). mSCP's
  own compliance script compares the raw output to the expected value by
  string equality.
- **No check.** 83 macOS rules have no check. Tags also mark rules mSCP
  itself excludes from its compliance script: `inherent` (43), `permanent`
  (20), `n_a` (9), `supplemental` (8), plus `manual` (5). Tags `arm64`/`i386`
  (3 each) restrict a rule to one architecture.
- **ODVs.** 34 rules have an `odv` block: `hint {datatype: number|string|enum,
  description, validation {min,max | regex | enumValues}}` (28 have
  `validation`), `recommended`, and per-benchmark values (`cis_lvl1`,
  `disa_stig`, ...). `$ODV` appears in check shell (20), check result (13),
  discussion (22) and `mobileconfig_info` (12).
- **ODV substitution is plain text replacement.** mSCP's own generator
  (`src/mscp/classes/macsecurityrule.py`, ~line 709) replaces `$ODV` in the
  rule text; it is not a shell variable. 9 checks use `$ODV` inside single
  quotes (e.g. an awk `-v ODV=$ODV` argument), where a shell variable would
  never expand. We must substitute the same way.
- **Preamble variables.** Checks rely on variables that mSCP's compliance
  script template (`templates/shell_scripts/compliance_script.sh.jinja`)
  defines up front: `CURRENT_USER`, `CURR_USER_UID`, `CURR_HOSTNAME`, `arch`,
  `plb`. The generated discovery script must define the same.
- **Apple vendor content.** No rule in `release_27.0` contains a "Vendor
  Description" or "Apple Inc" marker. The importer still guards for it.

## 4. Architecture

```
mSCP GitHub release tag
        |  tools/import_mscp.py --tag release_27.0   (run by the maintainer)
        v
sources/mscp/upstream/          untouched copy of the files we use
sources/mscp/source.json        lock: tag, commit SHA, retrieved date, URL
        |  (same command, second stage)
        v
baselines/_manifest.json        list of sources and their index files
baselines/mscp/_index.json      one summary entry per rule (drives the table)
baselines/mscp/rules/<id>.json  one normalized rule per file (detail + generator)
        |  scripts/copy-baselines.mjs (unchanged role)
        v
webui (GitHub Pages)            same UI, reads normalized JSON only
```

The web UI never reads mSCP YAML. It reads one normalized, source-agnostic
format, so a Windows source later only needs its own importer.

### 4.1 Vendored upstream copy

- `sources/mscp/upstream/` mirrors the needed parts of `src/mscp/data/`
  from the tag, byte for byte: `rules/**`, `baselines/macos/**`,
  `schema/mscp_rule.json`, plus the repo's `LICENSE.md` and `CHANGELOG.md`.
- It is replaced in place on each import, so `git diff` after a re-import
  shows exactly what NIST changed. (My call: one folder replaced in place
  instead of the `sources/mscp/<release>/` per-release folders I described
  earlier, because side-by-side release folders make every update a
  whole-new-folder diff. The future "pick an mSCP release" feature can still
  be built from git history or by adding folders then.)
- `sources/mscp/source.json` records `tag`, `commit_sha` (resolved via the
  GitHub API `git/ref/tags/<tag>`), `retrieved_date`, `repository_url`.

### 4.2 Importer (`tools/import_mscp.py`)

One command, two stages, both deterministic:

1. **Fetch** (`--tag <tag>`, required, no "latest" default): download the tag
   tarball, extract into a fresh temp directory without following symlinks,
   copy the listed files to `sources/mscp/upstream/`, write `source.json`.
   `--offline` skips the fetch and regenerates from the existing copy.
2. **Normalize**: read `sources/mscp/upstream/`, write `baselines/mscp/` and
   `baselines/_manifest.json`, validate every output file against
   `baselines/_rule.schema.json` and the index schema, and fail loudly
   (non-zero exit, no partial output) on anything unexpected: an unknown
   result type, an unknown ODV datatype, a vendor-content marker, a schema
   violation. Unknown is an error, not a skip, so upstream format changes are
   noticed.

Output must be byte-stable for the same input (sorted keys, sorted rules,
fixed indentation, LF endings) so a re-import with no upstream change
produces no diff.

Dependency: PyYAML for reading the YAML. It is a genuine need (YAML parsing
is not worth hand-writing); 6.0.3 is installed in `.venv` today. The builder
should confirm the current stable version before pinning it in
`requirements.txt`. Fetching uses the standard library (`urllib`, `tarfile`).
`pymupdf`/`pymupdf4llm` are removed from `requirements.txt`.

### 4.3 Normalized rule format (schema v3)

`baselines/_rule.schema.json` is replaced with a v3 shaped around what mSCP
actually provides. The v2 fields with no mSCP equivalent (`rationale`,
`impact`, `default_value`, `authoring_mode`, `policy_classification`,
required `remediation.methods`) are dropped rather than filled with invented
text. Field-level design is left to the builder, but it must carry:

- **`id`**: stable and source-namespaced: `mscp.<mscp rule id>`, e.g.
  `mscp.os_gatekeeper_enable`. Never a sequential number. This keeps saved
  selections and exports valid across re-imports.
- **`source`**: `{ name: "mscp", release_tag, commit_sha, upstream_rule_id,
  upstream_url, license: { name: "CC BY 4.0", url, rights_holder, modified: true } }`.
- **`platform`**: `"macOS"`.
- **`title`**, **`discussion`**: from mSCP. `discussion` is AsciiDoc-flavoured
  text (`_MUST_`, `[source,bash]` blocks); store it as-is and render it
  sensibly in the UI (builder's choice how).
- **`applicability`**: per macOS version, the benchmarks it belongs to, with
  STIG severity where given. E.g. `{ "26.0": [{ "name": "cis_lvl1" }, { "name": "disa_stig", "severity": "high" }] }`.
- **`tags`**: mSCP tags as-is (800-53r5_moderate, cisv8, inherent, ...).
- **`references`**: mSCP's `references` block, carried through (CIS
  benchmark section numbers, STIG ids, 800-53, CCE, etc.). Referencing CIS
  section numbers is fine; it is mSCP's data, not CIS text.
- **`assessment`**: `automated` or `manual`, plus a `manual_reason` taken
  from the tag (`inherent`, `permanent`, `n_a`, `supplemental`, `manual`) or
  `no_check`. A rule is automated only if it has a check and none of those
  tags, matching mSCP's own `check.jinja` exclusion list.
- **`architecture`**: `arm64`, `i386`, or absent (from tags).
- **`check`**: `{ default: { shell, result: { type: integer|string|base64, value } }, by_version: { "15.0": {...} } }`.
  `value` may be the literal `"$ODV"`.
- **`odv`** (optional): `{ datatype, description, validation, recommended, by_benchmark: { cis_lvl1: ..., disa_stig: ... } }`.
- **`remediation`** (optional, display only): mSCP's `fix` text if present
  and `mobileconfig_info` (payload type + keys).

`_index.json` entries carry what the table and filters need without fetching
each rule: `id`, `title`, `assessment`, `applicability`, `tags`,
`architecture`, `has_odv`, and the file path.

`_manifest.json` lists sources: `{ name: "mscp", display_name, release_tag,
retrieved_date, index_path, rule_count }`. The UI shows the release tag
(e.g. in the footer next to the attribution), which is the first step toward
the later "which mSCP version is this" feature.

The existing `value_source` mismatch (`rule_defined` in the schema,
`benchmark` in `webui/src/types/rule-detail.ts`) disappears with v2; make
sure v3 has one name, defined once.

## 5. Web UI changes

The UI keeps its look, layout and flow. Changes are under the hood:

- **Loaders and types** (`src/data/*`, `src/types/*`): read the manifest ->
  per-source `_index.json` -> per-rule JSON in the v3 shape. `RuleRow` and
  `RuleRef` become source + id based instead of family/product/version.
- **Filters** (`FilterSidebar.tsx`, `logic/ruleFilters.ts`): OS version,
  benchmark (scoped to the chosen OS version, since membership is per
  version), STIG severity, tags (800-53, CMMC, cisv8, ...), automated vs
  manual, has-ODV, free-text search. Exact filter UX is the builder's call.
- **Rule detail panel**: show discussion, check script and expected result
  (per version where they differ), ODV input, references, remediation
  guidance (fix text, mobileconfig keys), and the source/release/licence
  line.
- **Organization-defined values**: reuse the existing ODV input and
  "needs a value" flow (`OrgDefinedValueInput.tsx`, `selectionStore.ts`),
  keyed by rule id. (My call:) prefill with mSCP's `recommended` value and
  show the per-benchmark values (e.g. "CIS L1: 60d OR 5G, STIG: 7d") as
  quick picks, mirroring mSCP's own behaviour of defaulting to
  `recommended`. Validate input against `odv.hint.validation`
  (min/max, regex, enumValues). Rules with no `validation` (6 today) accept
  only a conservative character set: no quotes, backslash, `$`, backtick or
  newline. The value ends up in a script that Intune runs as root.
- **Export/import of selections** (`logic/exportImport.ts`): keyed by the
  new stable ids. Old exports from the CIS era are not migrated (there are
  no rules for them to match today). My call.
- **Attribution**: footer credit naming NIST mSCP, linking the repo and
  CC BY 4.0, noting the content is modified, and showing the release tag.

## 6. Discovery script and Rules[] generation

Keep the existing generator structure (`logic/scriptGen/bash.ts`,
`rulesJsonGen.ts`, `operatorMap.ts`, `chunking.ts`, `limitsConfig.ts`,
`bundleFiles.ts`, `zipBundle.ts`, `manualAttestationReport.ts`) and adapt it:

- **Preamble**: emit mSCP's variable setup before any check
  (`CURRENT_USER`, `CURR_USER_UID`, `CURR_HOSTNAME`, `arch`, `plb`), copied
  from the template's definitions.
- **ODV substitution**: replace `$ODV` in the check shell and in the
  expected result by text replacement, exactly as mSCP does, after the value
  passes validation.
- **Per-version checks**: when a rule has `by_version` overrides, the script
  reads the macOS major version (`sw_vers -productVersion`) at run time and
  runs the matching check, falling back to `default` for any other version,
  including versions mSCP has no key for (e.g. 14, or a release newer than
  the imported one). (My call: one script that works across a mixed fleet,
  rather than asking the user to pick a single target OS version. Falling
  back to `default` rather than auto-passing avoids hiding real
  non-compliance on a new macOS release before mSCP catches up.) The OS
  version and benchmark filters in the UI only choose which rules get
  selected; they do not limit what the script runs on a given device.
- **Rules whose expected result differs by version**: in `release_27.0`, 21
  version overrides change the expected result's value or type (e.g.
  `os_tftpd_disable` expects string `PASS` by default but integer `1` on
  15.0). Intune's Rules[] entry has one fixed operand and data type, so for
  these rules the script compares in-script against the right expected value
  for the device's version and reports a boolean, the same pattern
  `operatorMap.ts` already uses for `contains`. Rules with one expected
  result keep reporting the raw value, so admins still see actual values in
  Intune's compliance details. (My call: hybrid, not boolean-everywhere.)
- **Architecture**: on a device whose `arch` doesn't match the rule's
  architecture, report the expected value so the rule passes, matching
  mSCP's own "does not apply, finding NO" behaviour. (My call.)
- **Comparison**: one Intune Rules[] entry per automated rule, `IsEquals`
  against the expected result. `integer` -> Int64; `string` -> String;
  `base64` -> String compared with the base64 of the substituted value
  (the check already pipes its output through `base64`; the builder should
  confirm the exact encoding, including trailing newline handling, against
  mSCP's own compliance script output).
- Capture and JSON-escape each check's output with the existing
  `__json_int` / `__json_str` helpers. Strip the trailing newline the same
  way mSCP's `$(...)` capture does.
- **Manual rules** go to the attestation report, as today, with their
  `manual_reason`.
- Chunking, size limits and zip packaging are unchanged.

Assumption carried over from the MVP plan's research (not re-verified in
this pass): Intune custom compliance supports macOS shell discovery scripts
with the limits already encoded in `limitsConfig.ts`.

**mSCP checks are shipped as-is.** There is no repo-owned list that
overrides or excludes individual mSCP checks in this rework. (My call: an
override list fights "re-import and done", and nothing yet shows one is
needed.) Known risk to verify on a real Intune-managed Mac in phase 3:
Intune runs the script as root, possibly with nobody logged in.
`CURRENT_USER` comes from `loginwindow lastUserName` (the last user, not
the console session), so user-scoped checks should still run, but this has
not been tested. Also check total run time against Intune's script limits
with a large selection. If specific checks turn out to be unusable under
Intune, raise it with the maintainer before adding any override mechanism.

## 7. Removals

Delete (git history keeps them):

- `tools/pdf_to_markdown.py`, `tools/benchmark_markdown.py`,
  `tools/rule_extraction.py`, `tools/verify_extraction.py`,
  `tools/generate_metadata.py`, `tools/validate_metadata.py`,
  `tools/validate_specs.py`, and their tests
  (`test_pdf_to_markdown.py`, `test_benchmark_markdown.py`,
  `test_rule_extraction.py`, `test_generate_metadata.py`,
  `test_metadata_schema.py`, `test_control_spec_schema.py`).
- `tools/generate_index.py` and `tools/validate_rules.py`: replaced by the
  importer's own generation and validation (or rewritten for v3 if the
  builder prefers to keep them as separate commands).
- `baselines/_metadata.schema.json` (the CIS section hierarchy has no mSCP
  equivalent).
- `specs/` (all 12 control specs and the schema).
- `.claude/skills/compliance-benchmark-json/`.
- The `.claude/settings.json` PostToolUse hook and `tools/hooks/`: they
  validate hand-edited rule JSON, which no longer exists. Remove, or repoint
  at the v3 validator if useful.
- `baseline-references/` is gitignored and local only; nothing reads it after
  this change. The maintainer can delete it locally.

Superseded plans (`docs/plans/2026-08-19-*`, `2026-08-20-*`, `2026-08-21-*`)
stay as history, each with a Progress log entry noting they are superseded
by this design. `docs/2026-08-20-cis-content-licensing-review.md` stays,
with a closing note that the CIS content was removed.

## 8. Licensing and attribution

- The repo keeps AGPL-3.0 for its own code. mSCP content in
  `sources/mscp/upstream/` and the generated `baselines/mscp/` stays under
  CC BY 4.0. No relicensing is needed.
- Add a root `NOTICE` (or a README section) stating: content from the NIST
  macOS Security Compliance Project (link), licensed CC BY 4.0 (link),
  modified by this project (normalized format, ODV substitution, script
  assembly), with the warranty disclaimer reference. Keep mSCP's
  `LICENSE.md` in the vendored copy.
- Rewrite README's Licensing section: drop the ASD ISM/E8 adaptation text
  (no such content exists any more) and describe the mSCP arrangement.
- Each normalized rule carries `source.license` (section 4.3), and the UI
  footer carries the credit (section 5).
- The importer refuses to emit any text marked as Apple "Vendor Description
  content", which mSCP's licence excludes.

## 9. Keeping Windows possible later

- The normalized format has `platform` and namespaced ids, and the manifest
  lists sources, so a Windows importer adds a source without changing the
  macOS one.
- Keep `logic/platformScriptKind.ts` and `logic/scriptGen/powershell.ts`.
  Adapt them only as far as needed to keep typecheck and tests passing
  against the v3 types. If that turns out to be substantial, stop and raise
  it rather than rewriting them speculatively.

## 10. Updating to a new mSCP release (maintainer workflow)

1. `python tools/import_mscp.py --tag <new tag>`
2. Review `git diff sources/mscp/` (what NIST changed) and
   `git diff baselines/` (what users will see).
3. Run the tests (Python + Vitest + Playwright).
4. Commit (`feat: import mSCP <tag>`) and push; the Pages deploy publishes it.

## 11. Delivery phases

This is several pieces of work. Each phase ends with passing tests and its
own commit(s), per the repo's CLAUDE.md:

1. **Import**: vendored copy, lock file, importer, v3 schema, generated
   `baselines/mscp/`, Python tests.
2. **UI data layer**: loaders, types, table, filters, detail panel on v3.
3. **Generator**: preamble, ODV substitution and validation, per-version
   and architecture handling, Rules[] mapping, attestation report.
4. **Removals and cleanup**: section 7.
5. **Attribution and deploy**: NOTICE, README, footer, GitHub Pages deploy
   workflow (no `deploy-pages.yml` exists on any branch yet).

## 12. Branch and git history (maintainer's decision)

- Work continues on the current branch, `macos-compliance-framework-rebase`
  (same commit as `rework`), and is merged into `main` once the project is
  back in a good state. The Pages deploy workflow deploys from `main`.
- The CIS-derived text still present in published git history is out of
  scope for this rework. The maintainer will rewrite history and delete the
  old branches later, as a separate step. Nothing in this rework should
  force-push, rebase or delete branches.

## 13. Left to the builder

- Exact v3 field names and nesting, within section 4.3's requirements.
- How AsciiDoc discussion text is rendered.
- Filter UX details.
- Whether the importer is one script or a small package with a CLI.
- Test structure, including running a few generated checks through bash
  in Vitest as the existing `bash.test.ts` does.

## Progress log

- 2026-10-20: Plan 1 (import) completed; commit range db33dc0..this commit (feat: import mSCP release_27.0).
