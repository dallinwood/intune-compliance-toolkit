# CIS Linux Benchmarks from ComplianceAsCode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import CIS RHEL 9 and CIS Ubuntu 24.04 as two rule sources, one rule per CIS recommendation with title, CIS ID, levels, an audit procedure, a bash fix and customisable values, all from ComplianceAsCode release `v0.1.82`.

**Architecture:** A table of `BenchmarkSpec`s drives one shared fetcher, normalizer and importer. The fetcher stores unmodified copies of the CaC control file, the product's datastream and CaC's licence under `sources/<source>/releases/<tag>/upstream/`. The normalizer turns those into rule JSON (with named ODVs) through the existing `tools/release_import.py` framework, so `--offline` regeneration and the committed-library tests work as they do for NIST and ISM.

**Tech Stack:** Python 3.14+, PyYAML 6.0.3 (already a dependency), stdlib `xml.etree.ElementTree`, `zipfile`, `hashlib`, `urllib`; pytest; webui: React + Vitest + Playwright (Bun).

**Spec:** `docs/plans/2026-11-18-cis-complianceascode-source-design.md`, which depends on `docs/plans/2026-11-18-named-odvs-design.md`. Read both.

## Global Constraints

- **Prerequisite:** the named-ODV plan (`docs/plans/2026-11-18-named-odvs-plan.md`) is fully implemented first. This plan uses its rule schema (version 6, `odvs` list, `quoting`) and its shared placeholder checks.
- Every rule field comes from the pinned CaC release or deterministic derivation in this repo. Nothing from cisecurity.org or CIS PDFs; no hand-written or AI-written rule text.
- Pinned upstream: tag `v0.1.82`, commit `3da954fbccfb4ca611da86c9be9205d83c38bfc7`, asset `scap-security-guide-0.1.82.zip`, checksum from asset `scap-security-guide-0.1.82.zip.sha512`.
- No new dependencies. Parse XML with stdlib only, after rejecting any document containing `<!DOCTYPE` or `<!ENTITY`.
- Every CIS rule is `assessment.status: "manual"`. CaC `automated`/`partial`/`supported` map to `manual_reason: "openscap"`.
- Applicability target is `Linux`; versions `RHEL-9` and `Ubuntu-24.04`.
- Benchmark names: `cis_l1_server`, `cis_l2_server`, `cis_l1_workstation`, `cis_l2_workstation`.
- Generated JSON is never edited by hand. Files are written LF-only via `tools/json_output.write_json`.
- Fail loudly with `UnsupportedUpstreamData` naming the control (and CaC rule) on anything unexpected; never skip silently.
- Commits: `type: summary` subject, body explains why, no `Co-Authored-By` or other AI attribution. Stage explicit paths only; never sweep in other uncommitted work. Push after each commit (branch is not `main`).
- Before Task 6, `git status --short baselines/_manifest.json` must print nothing.
- Add a progress log entry to the CIS design doc in the same commit as each task's work.
- Never use the em dash character in code, comments, docs or commit messages.

## Review Focus

1. **A CaC rule used by two controls** (4 such rules on RHEL 9): each control gets that rule's audit, fix and ODVs independently. Test in Task 4.
2. **A variable in a fix that is not inside single or double quotes**, or a recommended value containing the quote character of its context: fail, naming the control and variable. Test in Task 3 (detection) and Task 4 (failure).
3. **A control id that isn't a YAML string** (e.g. a future unquoted `id: 1.10` loads as float `1.1`): fail, never coerce. Test in Task 2.
4. **A variable with no `refine-value` in a level's profile and no default `<value>` without selector**: fail, naming the variable. Test in Task 3.
5. **An escaped placeholder in OCIL text for a variable the rule's fix doesn't use**: it still becomes an ODV (`quoting: "unquoted"`), so the audit shows the chosen value. Test in Task 4.

---

### Task 0: Close the quote scanner gaps (fail closed)

**Files:**
- Modify: `tools/odv_placeholders.py` (`scan_quotes` and its callers)
- Test: `tests/test_odv_placeholders.py` and, if the shared grammar fixture is affected, the matching Vitest file

**Interfaces:**
- Produces: no new names. `placeholder_errors` now reports a `single`/`double` placeholder as an error in these cases, which today pass (found by the named-ODV fix re-review and the automated security review of b5f88172):
  - **Comments:** outside quotes, `#` at the start of a word (bash, `.sh`) or anywhere outside quotes (`.ps1`), and `<# ... #>` blocks (`.ps1`), start a comment; quote characters inside a comment are ignored, and a placeholder inside a comment is an error for `single`/`double` ODVs.
  - **Heredocs (bash):** any `single`/`double` placeholder inside a heredoc body (`<<WORD`, `<<-WORD`, `<<'WORD'`) is an error; the body is skipped for quote tracking.
  - **Command substitution inside double quotes:** a `single`/`double` placeholder anywhere inside a `$(...)` or backtick substitution is an error (fail closed; no nested-context modelling).

- [ ] **Step 1: Write failing tests:** `test_apostrophe_in_comment_does_not_open_a_quote` (`# don't` then `echo $ODV_v` for a `single` ODV: error); `test_placeholder_in_comment_is_error`; `test_powershell_block_comment` (`<# it's #>` then `$x = $ODV_v`: error; `$x = '$ODV_v'` after it: ok); `test_heredoc_body_placeholder_is_error` (`cat <<EOF` body with `'$ODV_v'`: error); `test_lone_quote_in_heredoc_does_not_open_a_quote` (body `it's`, then after `EOF` a line `echo $ODV_v`: error); `test_placeholder_in_command_substitution_inside_double_quotes_is_error` (`"$(printf '%s' "$ODV_v")"`); and keep the CaC banner shape working: `login_banner_text=$(echo "$ODV_v" | sed 's/a/b/')` with a `double` ODV is still ok (the substitution is not inside double quotes).
- [ ] **Step 2: Run** `.venv/Scripts/python.exe -m pytest tests/test_odv_placeholders.py -v`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `.venv/Scripts/python.exe -m pytest -W error -n auto` and, if the shared fixture changed, `bun run test` in `webui/`. Expected: PASS (bar the 3 known `test_github_fetch.py` failures).
- [ ] **Step 5: Commit** `fix: fail closed on comments, heredocs and nested substitutions in the quote scanner` (progress log entry in `docs/plans/2026-11-18-named-odvs-design.md`).

### Task 1: The `openscap` manual reason

**Files:**
- Modify: `baselines/_rule.schema.json` (`properties.assessment.properties.manual_reason.enum`)
- Modify: `webui/src/logic/overlayShape.ts` (the `manual_reason: oneOf(...)` line)
- Modify: `baselines/_vocabulary.json` (`vocabularies.manual_reasons`)
- Test: `tests/test_library_schema.py`, the overlay shape Vitest file

**Interfaces:**
- Produces: `"openscap"` as a valid `assessment.manual_reason`; vocabulary entry `{ "label": "checkable with OpenSCAP", "terms": ["openscap"], "description": "ComplianceAsCode can check this with OpenSCAP; this toolkit has no runnable check for it." }`.

- [ ] **Step 1: Write failing tests.** `test_manual_reason_openscap_is_valid` in `tests/test_library_schema.py`: an existing valid manual rule fixture with `assessment = {"status": "manual", "manual_reason": "openscap"}` gives `schema_errors(rule) == []`. In Vitest, the overlay shape accepts `manual_reason: 'openscap'`.
- [ ] **Step 2: Run** `python -m pytest tests/test_library_schema.py -k openscap -v` and the Vitest file. Expected: FAIL.
- [ ] **Step 3: Add `"openscap"`** to the schema enum, `overlayShape.ts` and the vocabulary. Reword the mSCP-specific descriptions neutrally, labels and terms unchanged: `manual` label "marked manual by the source", description "The source marks this check as manual."; `inherent` "Met by the platform by design."; `permanent` "Cannot be configured on the platform; the source lists this as a permanent finding."; `n_a` "Not applicable to the platform."
- [ ] **Step 4: Run** `python -m pytest`, and from `webui/` `bun run test`, `bun run typecheck`, `bun run lint`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: add the openscap manual reason` (with a progress log entry).

### Task 2: Control file normalization

**Files:**
- Create: `tools/cac_benchmarks.py`, `tools/cac_controls.py`
- Create: `tests/fixtures/cis_cac/controls.yml`
- Test: `tests/test_cac_controls.py`

**Interfaces:**
- Produces, in `tools/cac_benchmarks.py`:
  ```python
  LEVELS = ("l1_server", "l2_server", "l1_workstation", "l2_workstation")
  LEVEL_INHERITANCE = {"l2_server": "l1_server", "l2_workstation": "l1_workstation"}
  @dataclass(frozen=True)
  class BenchmarkSpec:
      source_name: str; display_name: str; product: str; controls_path: str
      level_profiles: Mapping[str, str]   # level -> CaC profile id
      target: str; version: str; helper_control_ids: frozenset[str]
  BENCHMARKS: dict[str, BenchmarkSpec]   # keyed by source_name
  REPOSITORY_URL = "https://github.com/ComplianceAsCode/content"
  LICENSE = {"name": "BSD-3-Clause", "url": "https://opensource.org/license/bsd-3-clause", "rights_holder": "Red Hat, Inc.", "modified": True}
  ```
  Entries per design sections 3 and 4: `cis_rhel9` (product `rhel9`, `products/rhel9/controls/cis_rhel9.yml`, profiles `cis_server_l1`/`cis`/`cis_workstation_l1`/`cis_workstation_l2`, version `RHEL-9`, helpers `{"reload_dconf_db", "enable_authselect"}`); `cis_ubuntu2404` (product `ubuntu2404`, `controls/cis_ubuntu2404.yml`, profiles `cis_level1_server`/`cis_level2_server`/`cis_level1_workstation`/`cis_level2_workstation`, version `Ubuntu-24.04`, no helpers). Target `Linux` for both.
- Produces, in `tools/cac_controls.py`:
  ```python
  @dataclass(frozen=True)
  class Control:
      cis_id: str; title: str; levels: tuple[str, ...]; status: str
      rule_ids: tuple[str, ...]; related_rule_ids: tuple[str, ...]; notes: str | None
  def read_controls(document: dict, spec: BenchmarkSpec) -> tuple[str, list[Control]]  # (benchmark version, controls)
  def section_path(cis_id: str) -> list[str]
  def levels_with_inheritance(levels: tuple[str, ...]) -> list[str]   # in LEVELS order
  def benchmark_name(level: str) -> str                               # "cis_" + level
  def assessment(status: str, where: str) -> dict
  ```
  Rules entries containing `=` (CaC's `var_name=value` settings) are dropped: their effect is already in the profiles' refine-values (design 5.7).

- [ ] **Step 1: Write the fixture** `tests/fixtures/cis_cac/controls.yml`: `version: '9.9.9'`, the four levels (L2 inheriting L1), and controls:
  `1.1.1` "Ensure cramfs kernel module is not available (Automated)", `[l1_server, l1_workstation]`, `automated`, rules `[kernel_module_cramfs_disabled]`;
  `1.2.1` "Ensure minimum password length is configured (Automated)", `[l1_server, l1_workstation]`, `automated`, rules `[accounts_password_pam_minlen, var_password_pam_minlen=14]`;
  `1.2.2` "Ensure cramfs is also covered here (Automated)", `[l2_server]`, `automated`, rules `[kernel_module_cramfs_disabled]`;
  `2.1` "Ensure something is reviewed (Manual)", `[l2_server, l2_workstation]`, `manual`, no rules, `notes: "Review by hand."`;
  `3.1` "Ensure root login is restricted (Automated)", `[l1_server, l2_workstation]`, `partial`, rules `[sshd_disable_root_login, rule_without_fix_or_ocil]`, `related_rules: [sshd_disable_root_password_login]`;
  `4.1` "Ensure something inherent (Automated)", `[l1_server]`, `inherently met`, no rules;
  `5.1` "Ensure a banner is configured (Automated)", `[l1_server, l1_workstation]`, `automated`, rules `[banner_etc_issue]`;
  `reload_dconf_db` "Reload Dconf database", `[l1_server, l1_workstation]`, `automated`, rules `[dconf_db_up_to_date]`.
  The test module defines `FIXTURE_SPEC`: source `cis_fixture`, product `fixture`, helpers `{"reload_dconf_db"}`, profiles `{"l1_server": "p_l1s", "l2_server": "p_l2s", "l1_workstation": "p_l1w", "l2_workstation": "p_l2w"}`, target `Linux`, version `Fixture-1`.
- [ ] **Step 2: Write failing tests:** `test_reads_cis_controls_and_skips_listed_helpers` (ids `["1.1.1", "1.2.1", "1.2.2", "2.1", "3.1", "4.1", "5.1"]`, version `"9.9.9"`); `test_unknown_non_cis_id_fails`; `test_non_string_id_fails` (`id: 1.1` as float); `test_variable_settings_are_dropped` (`1.2.1.rule_ids == ("accounts_password_pam_minlen",)`); `test_section_path` (`"1.1.1"` gives `["1", "1.1", "1.1.1"]`); `test_levels_with_inheritance` (`("l1_server", "l2_workstation")` gives `["l1_server", "l2_server", "l2_workstation"]`); `test_assessment_mapping` (`automated`/`partial`/`supported` give `{"status": "manual", "manual_reason": "openscap"}`, `manual` `"manual"`, `pending` `"no_check"`, `not applicable` `"n_a"`, `inherently met` `"inherent"`, `"bogus"` raises); `test_unknown_level_or_key_fails`.
- [ ] **Step 3: Run** `python -m pytest tests/test_cac_controls.py -v`. Expected: FAIL.
- [ ] **Step 4: Implement.** Known control keys: `id, title, levels, status, rules, related_rules, notes`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat: read ComplianceAsCode CIS control files`.

### Task 3: Datastream reader

**Files:**
- Create: `tools/cac_datastream.py`
- Create: `tests/fixtures/cis_cac/ssg-fixture-ds.xml`
- Test: `tests/test_cac_datastream.py`

**Interfaces:**
- Produces:
  ```python
  @dataclass(frozen=True)
  class VariableUse:
      name: str                      # e.g. "var_password_pam_minlen"
      quoting: str                   # "single" | "double" | "unquoted" (unquoted = not in the fix)
  @dataclass(frozen=True)
  class DatastreamRule:
      rule_id: str; title: str
      description_markdown: str; rationale_markdown: str | None   # <sub> -> $ODV_<name>
      cce: str | None; cis_references: tuple[str, ...]
      fix_shell: str | None          # sh fix, <sub> -> $ODV_<name>, None when CaC has no sh fix
      ocil_text: str | None          # escaped placeholders -> $ODV_<name>
      variables: tuple[VariableUse, ...]   # every variable in any of the fields above, first-seen order
  @dataclass(frozen=True)
  class ValueDefinition:
      name: str; datatype: str; title: str     # datatype "number" | "string"
  class Datastream:
      def __init__(self, xml_bytes: bytes) -> None
      def rule(self, rule_id: str) -> DatastreamRule
      def value_definition(self, name: str) -> ValueDefinition
      def value_for_profile(self, name: str, profile_id: str) -> str   # refine-value selector, else default <value>
  ```
  Quoting detection: in the sh fix, a `<sub>` that is the whole content of a single-quoted assignment (`name='<sub/>'`) is `single`; one inside a double-quoted string (`"<sub/>"` or `"...<sub/>..."` on one line) is `double`; any other placement raises. A variable both single- and double-quoted in one rule raises.

- [ ] **Step 1: Write the fixture datastream** with the real namespaces (`ds` `http://scap.nist.gov/schema/scap/source/1.2`, XCCDF `http://checklists.nist.gov/xccdf/1.2`, OCIL `http://scap.nist.gov/schema/ocil/2.0`, XHTML `http://www.w3.org/1999/xhtml`): a Benchmark with rules for every CaC rule id in the Task 2 fixture plus `sshd_disable_root_password_login`; `Value`s `..._var_password_pam_minlen` (`type="number"`, title "minlen", default `<value>12</value>`, `<value selector="14">14</value>`), `..._login_banner_text` (`type="string"`, title "Login banner", default `<value>Authorized use only</value>`), `..._var_ocil_only` (`type="number"`, default `<value>3</value>`); four `Profile`s `..._p_l1s` etc., each with `<refine-value idref="..._var_password_pam_minlen" selector="14"/>`.
  `accounts_password_pam_minlen`: description with `<html:code>`, `<html:pre>`, `<html:br/>` and a `<xccdf-1.2:sub idref="..._var_password_pam_minlen" use="legacy"/>`; CIS reference (`href="https://www.cisecurity.org/benchmark/fixture/"`) `1.2.1`; CCE `CCE-00000-1`; sh fix containing `var_password_pam_minlen='<xccdf-1.2:sub idref="..._var_password_pam_minlen" use="legacy"/>'`; OCIL `question_text` `Verify minlen with: $ grep minlen /etc/security/pwquality.conf minlen = Is it the case that minlen is less than "&lt;sub idref="var_password_pam_minlen" /&gt;" or retries exceed "&lt;sub idref="var_ocil_only" /&gt;"?`.
  `banner_etc_issue`: sh fix `login_banner_text=$(echo "<sub idref="..._login_banner_text"/>" | sed 's/x/y/')`, CIS ref `5.1`.
  `rule_without_fix_or_ocil`: no sh fix, no OCIL. `kernel_module_cramfs_disabled`: CIS references `1.1.1` and `1.2.2`, a plain sh fix.
- [ ] **Step 2: Write failing tests:** `test_rejects_doctype_and_entity`; `test_rule_fields` (title, `cce`, `cis_references == ("1.2.1",)`); `test_fix_and_text_get_placeholders` (fix contains `var_password_pam_minlen='$ODV_var_password_pam_minlen'`, description contains `$ODV_var_password_pam_minlen`, OCIL contains `"$ODV_var_password_pam_minlen"` and `"$ODV_var_ocil_only"`, no `<sub` or `&lt;sub` anywhere); `test_variable_quoting` (minlen `single`, ocil-only `unquoted`, banner `double`); `test_unquoted_variable_in_fix_fails` (a fix with `echo <sub/>` raises naming the rule and variable); `test_description_to_markdown` (`<html:code>x</html:code>` -> `` `x` ``, `<html:pre>` fenced, `<html:br/>` line break, `<html:a href="u">t</html:a>` -> `[t](u)`, `<html:li>` -> `- `; an unknown element raises); `test_value_for_profile` (`p_l1s` gives `"14"`; a profile without refine gives `"12"`); `test_missing_value_fails`; `test_unknown_value_type_fails`; `test_missing_rule_fails`; `test_rule_without_fix_or_ocil` (`fix_shell is None`, `ocil_text is None`).
- [ ] **Step 3: Run** `python -m pytest tests/test_cac_datastream.py -v`. Expected: FAIL.
- [ ] **Step 4: Implement.** Supported XHTML elements: `code`, `tt`, `pre`, `br`, `i`, `em`, `b`, `strong`, `a`, `ul`, `ol`, `li`, `p`. OCIL lookup id: `ocil:ssg-<rule_id>_question:question:1`. Escaped OCIL placeholder pattern: `<sub idref="(var name)" />` after XML unescaping.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat: read rules, values and audit text from a CaC datastream`.

### Task 4: Rule assembly

**Files:**
- Create: `tools/cac_normalize.py`
- Test: `tests/test_cac_normalize.py`

**Interfaces:**
- Consumes: Tasks 2 and 3; from the named-ODV plan, the shared placeholder check (`tools.odv_placeholders.placeholder_errors(rule) -> list[str]`, see that plan's Interfaces).
- Produces:
  ```python
  def normalize_benchmark(upstream_dir: Path, spec: BenchmarkSpec, lock: SourceLock) -> tuple[str, list[dict]]   # (benchmark version, rules)
  ```
  Reads `upstream_dir / spec.controls_path` and `upstream_dir / "release" / f"ssg-{spec.product}-ds.xml"`.

Rule shape (design 5.2 to 5.7), for each control:
- `id` `f"{spec.source_name}.{cis_id}"`; `schema_version` `SCHEMA_VERSION`; `title` verbatim; `section_path`; `architecture` `None`; `tags` `[]`; `discussion_format` `"markdown"`.
- `discussion`: per linked CaC rule `## <CaC title>`, its description, then `**Rationale:**` and the rationale; then `**Notes:**` and the control's notes if any. With no rules: the notes, or `"ComplianceAsCode links no rule to this recommendation."`.
- `applicability`: `[{"target": spec.target, "version": spec.version, "benchmarks": [{"name": benchmark_name(level), "severity": None} for level in levels_with_inheritance(levels)]}]`.
- `assessment`: `assessment(status)`.
- `check`: `None` with no rules; else `{spec.target: {"language": "bash", "default": {"shell": None, "result": None, "additional_info": TEXT}, "by_version": {}}}`. TEXT per CaC rule: `== <CaC title>`, the OCIL text in a `----` block (or `No audit procedure in ComplianceAsCode.`), then, if the rule has variables, `Expected values: var_a = $ODV_var_a, var_b = $ODV_var_b`.
- `remediation`: `None` with no rules; else `{spec.target: {"steps": [...], "payloads": []}}`, one step per CaC rule: `{"name": <CaC title>, "language": "bash", "shell": <fix_shell or None>, "additional_info": "ComplianceAsCode rule `<id>`" or "No fix in ComplianceAsCode (rule `<id>`).", "versions": None}`.
- `odvs`: one per distinct variable across the control's linked rules, first-seen order: `{"name", "datatype", "description": <Value title>, "validation": None, "recommended": <value for the lowest of the control's own listed levels>, "by_benchmark": {benchmark_name(level): value for level in levels_with_inheritance(levels)}, "quoting": <single/double/unquoted>}`. Number values become `int`. A variable quoted differently by two linked rules fails.
- `references`: `{"cis": {"benchmark_version", "id", "levels": list(levels)}, "complianceascode": {"status", "rules", "related_rules", "cce": {rule_id: cce}}}` (omit empty lists and an empty `cce`).
- `source`: as the NIST importer; `upstream_rule_id` cis_id, `upstream_path` spec.controls_path, `upstream_url` `f"{REPOSITORY_URL}/blob/{lock.commit_sha}/{spec.controls_path}"`, `upstream_revision`/`upstream_updated` `None`, `license` LICENSE.
- Fail if a linked rule's `cis_references` lacks the control id; if a `single`/`double` ODV's recommended or `by_benchmark` value contains a character its quoting forbids (named-ODV design 5.3); or if `placeholder_errors(rule)` is non-empty.

- [ ] **Step 1: Write failing tests** against the fixtures copied into `tmp_path/upstream` in the layout above:
  - `test_rule_ids_and_count`: seven rules, ids `cis_fixture.1.1.1` ... `cis_fixture.5.1`.
  - `test_minlen_rule`: `odvs` is `[{"name": "var_password_pam_minlen", "datatype": "number", "description": "minlen", "validation": None, "recommended": 14, "by_benchmark": {"cis_l1_server": 14, "cis_l2_server": 14, "cis_l1_workstation": 14, "cis_l2_workstation": 14}, "quoting": "single"}, {"name": "var_ocil_only", ..., "recommended": 3, "quoting": "unquoted"}]`; check text contains `Expected values: var_password_pam_minlen = $ODV_var_password_pam_minlen, var_ocil_only = $ODV_var_ocil_only`; fix step shell contains `'$ODV_var_password_pam_minlen'`.
  - `test_banner_odv_is_double_quoted`: `5.1` ODV `login_banner_text` has `quoting == "double"`, `recommended == "Authorized use only"`.
  - `test_double_quoted_value_with_quote_fails`: change the banner default to `Say "hi"` and assert failure naming `5.1`.
  - `test_shared_rule_in_two_controls`: `1.1.1` and `1.2.2` both carry the cramfs fix step.
  - `test_multi_rule_partial_control`: `3.1` has two steps, the second with `shell is None` and the "No fix" text; the check text has `No audit procedure in ComplianceAsCode.`; assessment reason `openscap`; `related_rules == ["sshd_disable_root_password_login"]` and no step for it.
  - `test_ruleless_controls`: `2.1` and `4.1` have `check is None`, `remediation is None`, `odvs == []`; `2.1` discussion `Review by hand.`; `4.1` reason `inherent`.
  - `test_cis_reference_mismatch_fails`: reference of `sshd_disable_root_login` edited to `9.9` fails naming `3.1`.
  - `test_every_rule_validates`: `schema_errors(rule) == []` and `placeholder_errors(rule) == []` for all.
- [ ] **Step 2: Run** `python -m pytest tests/test_cac_normalize.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: normalize CaC CIS controls into rules`.

### Task 5: Fetcher and importer

**Files:**
- Create: `tools/cac_fetch.py`, `tools/import_cis_cac.py`
- Test: `tests/test_cac_fetch.py`, `tests/test_import_cis_cac.py`

**Interfaces:**
- Consumes: `tools.github_fetch.resolve_tag_commit`, `fetch_release_published_date`, `download_pinned_files`, `validate_tag`, `default_opener`; `tools.release_import.SourceImporter`, `run_cli`; `tools.library_output.index_entry`, `SCHEMA_VERSION`.
- Produces:
  ```python
  # cac_fetch.py
  IMPORTER_FORMAT = "cac-cis-1"
  def release_asset_url(tag: str, file_name: str) -> str
  def fetch(spec: BenchmarkSpec, tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock
  # import_cis_cac.py
  IMPORTERS: dict[str, SourceImporter]          # one per BENCHMARKS entry
  def main(argv: list[str] | None = None) -> int  # --benchmark <source_name>, then run_cli's own arguments
  ```
  `fetch` downloads `scap-security-guide-<tag without v>.zip` and its `.sha512` (first whitespace-separated token) from `https://github.com/ComplianceAsCode/content/releases/download/<tag>/`, streams the zip to a temp file while hashing it with SHA-512, raises `ValueError` on mismatch, extracts only `scap-security-guide-<version>/ssg-<product>-ds.xml` to `upstream/release/ssg-<product>-ds.xml` byte-for-byte, and downloads `LICENSE` and `spec.controls_path` at the tag commit with `download_pinned_files`. Lock as in `tools/nist_800_53_fetch.py`. The zip is deleted afterwards and never stored. Each importer's `build_rule_tree` writes `rules/<cis id>.json` plus `_index.json` like `tools/import_nist_800_53.py`; `release_label` returns `f"v{benchmark version}"`.

- [ ] **Step 1: Write failing tests** with a fake opener (pattern from `tests/test_nist_800_53_fetch.py`) serving an in-memory zip built from the fixture datastream: `test_fetch_stores_expected_files` (exactly `LICENSE`, the controls path and `release/ssg-fixture-ds.xml`, bytes identical to the sources); `test_checksum_mismatch_fails_and_stores_nothing`; `test_missing_zip_member_fails`. In `tests/test_import_cis_cac.py`: `test_generate_release_from_fixture` (`generate_release` as in `tests/test_import_nist_800_53.py`, then `validate_library(baselines_dir) == []`, manifest source `cis_fixture` with label `v9.9.9`); `test_main_requires_known_benchmark`.
- [ ] **Step 2: Run** `python -m pytest tests/test_cac_fetch.py tests/test_import_cis_cac.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python -m pytest`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fetch and import CIS benchmarks from ComplianceAsCode`.

### Task 6: Import RHEL 9 and Ubuntu 24.04 into the library

**Files:**
- Modify: `tests/test_committed_library.py` (`IMPORTERS_BY_NAME`: add `*import_cis_cac.IMPORTERS.values()`)
- Modify: `baselines/_vocabulary.json`: `sources` `{"label": "CIS RHEL 9 (CaC)", "terms": ["cis_rhel9"]}`, `{"label": "CIS Ubuntu 24.04 (CaC)", "terms": ["cis_ubuntu2404"]}`; `benchmarks` `CIS L1 Server`, `CIS L2 Server`, `CIS L1 Workstation`, `CIS L2 Workstation` for the four names, each `"metadata": ["benchmark"]`; `versions` `{"label": "RHEL 9", "terms": ["Linux RHEL-9"], "metadata": ["platform"]}`, `{"label": "Ubuntu 24.04", "terms": ["Linux Ubuntu-24.04"], "metadata": ["platform"]}`.
- Generated: `sources/cis_rhel9/`, `sources/cis_ubuntu2404/`, `baselines/cis_rhel9/`, `baselines/cis_ubuntu2404/`, `baselines/_manifest.json`

- [ ] **Step 1: Confirm** `git status --short baselines/_manifest.json` prints nothing. Otherwise stop and ask the maintainer.
- [ ] **Step 2: Run** `python tools/import_cis_cac.py --benchmark cis_rhel9 --tag v0.1.82`. Expected: `Imported 298 CIS Red Hat Enterprise Linux 9 (ComplianceAsCode) rules from v0.1.82 (3da954f)`.
- [ ] **Step 3: Run** `python tools/import_cis_cac.py --benchmark cis_ubuntu2404 --tag v0.1.82`. Expected: `Imported 312 ...`.
- [ ] **Step 4: Spot-check** `baselines/cis_rhel9/releases/v0.1.82/rules/5.1.20.json` (fix contains `PermitRootLogin`, audit contains `sudo grep -i PermitRootLogin`, reason `openscap`) and the rule that links `accounts_password_pam_minlen` (an ODV `var_password_pam_minlen`, `recommended` 14, `quoting` `single`).
- [ ] **Step 5: Add the vocabulary entries and importer registration**, then run `python -m pytest`. Expected: PASS, including `test_committed_release_matches_regeneration` for both new releases.
- [ ] **Step 6: Commit** only `sources/cis_rhel9 sources/cis_ubuntu2404 baselines/cis_rhel9 baselines/cis_ubuntu2404 baselines/_manifest.json baselines/_vocabulary.json tests/test_committed_library.py` plus the progress log: `feat: import CIS RHEL 9 and Ubuntu 24.04 from ComplianceAsCode v0.1.82`. Note the stored size in the body.

### Task 7: Attribution

**Files:**
- Modify: `NOTICE`, `README.md` (Licensing section; a new "Updating the CIS (ComplianceAsCode) rules" section after "Updating the NIST SP 800-53 rules")

- [ ] **Step 1: NOTICE entry** in the existing format: `sources/cis_rhel9/releases/<tag>/upstream/` and `sources/cis_ubuntu2404/...` are unmodified copies of parts of ComplianceAsCode/content (project URL, release `v0.1.82`, BSD-3-Clause, "Copyright (c) 2012-2017, Red Hat, Inc.", licence text at `.../upstream/LICENSE`); `baselines/cis_*` is adapted (normalized, values made customisable, audit and fix text assembled). Include BSD-3-Clause's no-endorsement clause as worded in the vendored LICENSE.
- [ ] **Step 2: README** Licensing paragraph in the same style, and the update section: `python tools/import_cis_cac.py --benchmark <source> --tag <CaC tag>`, `--offline`, and adding a benchmark (one `BenchmarkSpec`).
- [ ] **Step 3: Run** `python -m pytest`. Expected: PASS.
- [ ] **Step 4: Commit** `docs: credit ComplianceAsCode for the CIS rule sources`.

### Task 8: Web UI audit display and visual check

**Files:**
- Modify: `webui/src/components/rules/RuleCheckSection.tsx` (`CheckEntry`)
- Test: Playwright, extend an existing spec in `webui/e2e/`

The coordinating session starts the shared dev server (`bun run dev -- --port 5199 --strictPort` from `webui/`) and waits for `http://localhost:5199/` to answer 200; subagents use `PLAYWRIGHT_BASE_URL=http://localhost:5199` and never start or stop it.

- [ ] **Step 1: Write failing e2e tests:** `CIS rule shows its audit procedure` (open `cis_rhel9.5.1.20`: text `Audit procedure` and `PermitRootLogin` visible, `No check script.` absent); `CIS value is customisable` (open the RHEL 9 rule with `var_password_pam_minlen`: its input shows `14`; set it to `16`; the fix code block and the audit's expected values both show `16`).
- [ ] **Step 2: Run** `bun run test:e2e`. Expected: the audit test FAILS.
- [ ] **Step 3: Change `CheckEntry`**: when `check.shell` is null, there's no `shell_file`, and `additional_info` is set, show the label "Audit procedure" instead of "No check script.".
- [ ] **Step 4: Run** `bun run test`, `bun run typecheck`, `bun run lint`, `bun run test:e2e`. Expected: PASS.
- [ ] **Step 5: Screenshot** the rule panel for `cis_rhel9.5.1.20`, the minlen rule and an Ubuntu rule with several ODVs (e.g. CIS `4.3.5`, nftables) at 375px and 1440px width with a short Playwright script, and look at each with the Read tool: titles readable, ODV inputs labelled and usable, long bash blocks scroll inside their box, no horizontal page scroll. Check the Frameworks home shows the two CIS cards and the level filter lists the four CIS benchmarks.
- [ ] **Step 6: Commit** `feat: show text-only audits as an audit procedure` (progress log, and mark the CIS design `Status: Implemented`).
