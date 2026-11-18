# CIS Linux Benchmarks from ComplianceAsCode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import CIS RHEL 9 and CIS Ubuntu 24.04 as two rule sources, one rule per CIS recommendation with title, CIS ID, levels, an audit procedure and a bash fix, all from ComplianceAsCode release `v0.1.82`.

**Architecture:** A table of `BenchmarkSpec`s drives one shared fetcher, normalizer and importer. The fetcher stores unmodified copies of the CaC control file, the product's datastream and the four per-level bash scripts under `sources/<source>/releases/<tag>/upstream/`. The normalizer turns those into v5 rule JSON through the existing `tools/release_import.py` framework, so `--offline` regeneration and the committed-library tests work as they do for NIST and ISM.

**Tech Stack:** Python 3.14+, PyYAML 6.0.3 (already a dependency), stdlib `xml.etree.ElementTree`, `zipfile`, `hashlib`, `urllib`; pytest 9.1.1; webui: React + Vitest + Playwright (Bun, see `docs/plans/2026-08-17-web-ui-mvp-plan.md`).

**Spec:** `docs/plans/2026-11-18-cis-complianceascode-source-design.md` (read it; this plan argues from it).

## Global Constraints

- Every rule field comes from the pinned CaC release or deterministic derivation in this repo. Nothing from cisecurity.org or CIS PDFs; no hand-written or AI-written rule text.
- Pinned upstream: tag `v0.1.82`, commit `3da954fbccfb4ca611da86c9be9205d83c38bfc7`, asset `scap-security-guide-0.1.82.zip`, checksum from asset `scap-security-guide-0.1.82.zip.sha512`.
- No new dependencies. Parse XML with stdlib only, after rejecting any document containing `<!DOCTYPE` or `<!ENTITY`.
- Every CIS rule is `assessment.status: "manual"`. CaC `automated`/`partial`/`supported` map to `manual_reason: "openscap"`.
- Applicability target is `Linux`; versions `RHEL-9` and `Ubuntu-24.04`.
- Benchmark names: `cis_l1_server`, `cis_l2_server`, `cis_l1_workstation`, `cis_l2_workstation`.
- Generated JSON is never edited by hand. Files are written LF-only via `tools/json_output.write_json`.
- Fail loudly with `UnsupportedUpstreamData` naming the control (and CaC rule) on anything unexpected; never skip silently.
- Commits: `type: summary` subject, body explains why, no `Co-Authored-By` or other AI attribution. Stage explicit paths only: the working tree holds someone else's uncommitted ISM / Frameworks-tab work, and none of it may be staged. Push after each commit (branch is not `main`).
- Don't start this plan until the other in-progress work has been committed (design section 11). Check with `git status --short`: `baselines/_manifest.json` must be clean before Task 7.
- Add a progress log entry to the design doc in the same commit as each task's work (`.claude/CLAUDE.md`).
- Never use the em dash character in code, comments, docs or commit messages.

## Review Focus

1. **A CaC rule used by two controls** (4 such rules on RHEL 9): each control gets that rule's audit and fix independently. Test in Task 5.
2. **A rule with a bash fix in the datastream but missing from a level script it should be in**, vs a rule with no bash fix at all: the first fails, the second gets the "No fix in ComplianceAsCode" step. Test in Task 4.
3. **A control id that isn't a YAML string** (e.g. a future unquoted `id: 1.10` loads as float `1.1`): fail, never coerce. Test in Task 2.
4. **A variable with no `refine-value` in the profile and no default `<value>` without selector**: fail, naming the variable. Test in Task 3.
5. **CRLF or a trailing newline difference in a script block**: blocks are compared and stored with line endings normalized to LF, so the committed-library LF test passes and level comparison isn't fooled. Test in Task 4.

---

### Task 1: The `openscap` manual reason

**Files:**
- Modify: `baselines/_rule.schema.json` (`properties.assessment.properties.manual_reason.enum`)
- Modify: `webui/src/logic/overlayShape.ts:86`
- Modify: `baselines/_vocabulary.json` (`vocabularies.manual_reasons`)
- Test: `tests/test_library_schema.py`, `webui/src/logic/overlayShape.test.ts` (create the test block in the existing file if present, else alongside)

**Interfaces:**
- Produces: `"openscap"` as a valid `assessment.manual_reason`; vocabulary entry `{ "label": "checkable with OpenSCAP", "terms": ["openscap"], "description": "ComplianceAsCode can check this with OpenSCAP; this toolkit has no runnable check for it." }`.

- [ ] **Step 1: Write failing tests.** In `tests/test_library_schema.py`, `test_manual_reason_openscap_is_valid`: take an existing valid manual rule fixture used in that file, set `assessment = {"status": "manual", "manual_reason": "openscap"}`, assert `schema_errors(rule) == []`. In the webui test, assert the overlay shape accepts `manual_reason: 'openscap'`.
- [ ] **Step 2: Run** `python -m pytest tests/test_library_schema.py -k openscap -v` and `bun run test -- overlayShape` from `webui/`. Expected: both FAIL.
- [ ] **Step 3: Add `"openscap"`** to the schema enum, to `oneOf(...)` in `overlayShape.ts`, and the vocabulary entry above. Reword the mSCP-specific descriptions neutrally, keeping labels and terms unchanged: `manual` label "marked manual by the source", description "The source marks this check as manual."; `inherent` "Met by the platform by design."; `permanent` "Cannot be configured on the platform; the source lists this as a permanent finding."; `n_a` "Not applicable to the platform."
- [ ] **Step 4: Run** `python -m pytest` (whole suite) and, from `webui/`, `bun run test`, `bun run typecheck`, `bun run lint`. Expected: all pass.
- [ ] **Step 5: Commit** the four files plus the design doc's progress log entry: `feat: add the openscap manual reason`.

### Task 2: Control file normalization

**Files:**
- Create: `tools/cac_benchmarks.py` (the `BenchmarkSpec` table)
- Create: `tools/cac_controls.py`
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
  ```
  with the values in design section 3/4 (`cis_rhel9`: product `rhel9`, `products/rhel9/controls/cis_rhel9.yml`, helpers `{"reload_dconf_db", "enable_authselect"}`; `cis_ubuntu2404`: product `ubuntu2404`, `controls/cis_ubuntu2404.yml`, no helpers). Also `REPOSITORY_URL = "https://github.com/ComplianceAsCode/content"` and `LICENSE = {"name": "BSD-3-Clause", "url": "https://opensource.org/license/bsd-3-clause", "rights_holder": "Red Hat, Inc.", "modified": True}`.
- Produces, in `tools/cac_controls.py`:
  ```python
  @dataclass(frozen=True)
  class Control:
      cis_id: str; title: str; levels: tuple[str, ...]; status: str
      rule_ids: tuple[str, ...]; variable_settings: tuple[tuple[str, str], ...]
      related_rule_ids: tuple[str, ...]; notes: str | None
  def read_controls(document: dict, spec: BenchmarkSpec) -> tuple[str, list[Control]]  # (benchmark version, controls)
  def section_path(cis_id: str) -> list[str]
  def benchmark_names(levels: tuple[str, ...]) -> list[str]        # inheritance expanded, in LEVELS order, "cis_" + level with "l1"/"l2" kept
  def assessment(status: str, where: str) -> dict
  ```

- [ ] **Step 1: Write the fixture** `tests/fixtures/cis_cac/controls.yml` with `version: '9.9.9'`, the four levels (L2 inheriting L1) and controls:
  `1.1.1` "Ensure cramfs kernel module is not available (Automated)", `[l1_server, l1_workstation]`, `automated`, rules `[kernel_module_cramfs_disabled]`;
  `1.2.1` "Ensure minimum password length is configured (Automated)", `[l1_server, l1_workstation]`, `automated`, rules `[accounts_password_pam_minlen, var_password_pam_minlen=14]`;
  `1.2.2` "Ensure cramfs is also covered here (Automated)", `[l2_server]`, `automated`, rules `[kernel_module_cramfs_disabled]` (shared rule);
  `2.1` "Ensure something is reviewed (Manual)", `[l2_server, l2_workstation]`, `manual`, no rules, `notes: "Review by hand."`;
  `3.1` "Ensure root login is restricted (Automated)", `[l1_server, l2_workstation]`, `partial`, rules `[sshd_disable_root_login, rule_without_fix_or_ocil]`, `related_rules: [sshd_disable_root_password_login]`;
  `4.1` "Ensure something inherent (Automated)", `[l1_server]`, `inherently met`, no rules;
  `reload_dconf_db` "Reload Dconf database", `[l1_server, l1_workstation]`, `automated`, rules `[dconf_db_up_to_date]`.
  Use a fixture spec `FIXTURE_SPEC` (in the test module) with helpers `{"reload_dconf_db"}`, product `fixture`, profiles `{"l1_server": "p_l1s", "l2_server": "p_l2s", "l1_workstation": "p_l1w", "l2_workstation": "p_l2w"}`, target `Linux`, version `Fixture-1`.
- [ ] **Step 2: Write failing tests:**
  - `test_reads_cis_controls_and_skips_listed_helpers`: ids `["1.1.1", "1.2.1", "1.2.2", "2.1", "3.1", "4.1"]`, version `"9.9.9"`.
  - `test_unknown_non_cis_id_fails`: a control `enable_foo` not in helpers raises `UnsupportedUpstreamData` matching `enable_foo`.
  - `test_non_string_id_fails`: control with `id: 1.1` as a float raises.
  - `test_variable_settings_are_split_from_rules`: `1.2.1` has `rule_ids == ("accounts_password_pam_minlen",)`, `variable_settings == (("var_password_pam_minlen", "14"),)`.
  - `test_section_path`: `section_path("1.1.1") == ["1", "1.1", "1.1.1"]`.
  - `test_benchmark_names_expand_inheritance`: `("l1_server", "l2_workstation")` gives `["cis_l1_server", "cis_l2_server", "cis_l2_workstation"]`.
  - `test_assessment_mapping`: `automated`/`partial`/`supported` give `{"status": "manual", "manual_reason": "openscap"}`; `manual` gives `"manual"`; `pending` `"no_check"`; `not applicable` `"n_a"`; `inherently met` `"inherent"`; `"bogus"` raises.
  - `test_unknown_level_or_key_fails`: a level `l3_server` raises; an unknown control key raises.
- [ ] **Step 3: Run** `python -m pytest tests/test_cac_controls.py -v`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** both modules. Known control keys: `id, title, levels, status, rules, related_rules, notes`. A rules entry containing `=` is a variable setting.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat: read ComplianceAsCode CIS control files` (the new files plus a progress log entry).

### Task 3: Datastream reader

**Files:**
- Create: `tools/cac_datastream.py`
- Create: `tests/fixtures/cis_cac/ssg-fixture-ds.xml`
- Test: `tests/test_cac_datastream.py`

**Interfaces:**
- Produces:
  ```python
  @dataclass(frozen=True)
  class DatastreamRule:
      rule_id: str; title: str; description_markdown: str; rationale_markdown: str | None
      cce: str | None; cis_references: tuple[str, ...]; variable_ids: tuple[str, ...]
      has_bash_fix: bool; ocil_text: str | None   # escaped placeholders already replaced
  class Datastream:
      def __init__(self, xml_bytes: bytes, profile_ids: Iterable[str]) -> None
      def rule(self, rule_id: str) -> DatastreamRule   # raises UnsupportedUpstreamData if absent
      def variable_values(self, profile_id: str, variable_ids: Iterable[str]) -> dict[str, str]
      def render_for_profile(self, rule_id: str, profile_id: str) -> DatastreamRule
  ```
  `variable_ids` are short names (`var_password_pam_minlen`), collected from every `xccdf-1.2:sub idref` in the rule's description, rationale and `urn:xccdf:fix:script:sh` fix. `render_for_profile` returns the rule with `<sub>` in description/rationale and escaped `&lt;sub idref="var_x" /&gt;` in OCIL replaced by that profile's values.

- [ ] **Step 1: Write the fixture datastream** with the real namespaces (`ds` `http://scap.nist.gov/schema/scap/source/1.2`, XCCDF `http://checklists.nist.gov/xccdf/1.2`, OCIL `http://scap.nist.gov/schema/ocil/2.0`, XHTML `http://www.w3.org/1999/xhtml`), one Benchmark holding: rules for every CaC rule id in the Task 2 fixture plus `sshd_disable_root_password_login`; `Value` `xccdf_org.ssgproject.content_value_var_password_pam_minlen` with default `<value>12</value>` and `<value selector="14">14</value>`; four `Profile`s `xccdf_org.ssgproject.content_profile_p_l1s` (etc.), each with `<refine-value idref="..._var_password_pam_minlen" selector="14"/>`. Give `accounts_password_pam_minlen` a description with `<html:code>`, `<html:pre>`, `<html:br/>` and a `<xccdf-1.2:sub idref="..._var_password_pam_minlen" use="legacy"/>`, a CIS reference `href="https://www.cisecurity.org/benchmark/fixture/"` text `1.2.1`, a CCE ident `CCE-00000-1`, an sh fix, and an OCIL `boolean_question` `ocil:ssg-accounts_password_pam_minlen_question:question:1` whose `question_text` is `Verify minlen with: $ grep minlen /etc/security/pwquality.conf minlen = Is it the case that minlen is less than "&lt;sub idref="var_password_pam_minlen" /&gt;"?`. `rule_without_fix_or_ocil` has no sh fix and no OCIL. `kernel_module_cramfs_disabled` has CIS references `1.1.1` and `1.2.2`.
- [ ] **Step 2: Write failing tests:**
  - `test_rejects_doctype_and_entity`: bytes containing `<!DOCTYPE` or `<!ENTITY` raise `UnsupportedUpstreamData`.
  - `test_rule_fields`: title, `cce == "CCE-00000-1"`, `cis_references == ("1.2.1",)`, `variable_ids == ("var_password_pam_minlen",)`, `has_bash_fix is True`.
  - `test_description_to_markdown`: `<html:code>x</html:code>` becomes `` `x` ``, `<html:pre>` a fenced block, `<html:br/>` a line break, `<html:a href="u">t</html:a>` `[t](u)`, `<html:li>` `- ` items; an unknown element raises.
  - `test_render_for_profile_resolves_values`: description contains `14`; OCIL text contains `"14"` and no `&lt;sub` / `<sub`.
  - `test_value_default_used_without_refine`: a profile without the refine-value gives `12`.
  - `test_missing_value_fails`: a sub to an unknown Value raises, naming it.
  - `test_missing_rule_fails` and `test_rule_without_ocil_has_none`.
- [ ] **Step 3: Run** `python -m pytest tests/test_cac_datastream.py -v`. Expected: FAIL.
- [ ] **Step 4: Implement.** Supported XHTML elements: `code`, `tt`, `pre`, `br`, `i`, `em`, `b`, `strong`, `a`, `ul`, `ol`, `li`, `p` (the real RHEL 9 data uses `pre`, `code`, `br`, `i`, `a`, `b`, `ul`, `li`). OCIL lookup id: `ocil:ssg-<rule_id>_question:question:1`.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat: read rules, values and audit text from a CaC datastream` (plus progress log entry).

### Task 4: Per-level bash script blocks

**Files:**
- Create: `tools/cac_scripts.py`
- Create: `tests/fixtures/cis_cac/fixture-script-p_l1s.sh` (and `p_l2s`, `p_l1w`, `p_l2w`)
- Test: `tests/test_cac_scripts.py`

**Interfaces:**
- Produces:
  ```python
  def fix_blocks(script_text: str, where: str) -> dict[str, str]   # CaC rule id -> block, LF, progress-echo line removed, stripped of surrounding blank lines
  def fix_for_control(rule_id: str, levels_with_inheritance: list[str], blocks_by_level: Mapping[str, Mapping[str, str]], has_bash_fix: bool, where: str) -> str | None
  ```
  Block markers: `# BEGIN fix (n / N) for 'xccdf_org.ssgproject.content_rule_<id>'` to `# END fix for 'xccdf_org.ssgproject.content_rule_<id>'`. Remove the line matching `^\(>&2 echo "Remediating rule \d+/\d+: .*"\)$`. `fix_for_control` returns the block from the lowest level present (order `LEVELS`); returns `None` when `has_bash_fix` is false and no level has a block; raises if blocks differ between levels, or exist in some levels and not others, or are missing while `has_bash_fix` is true.

- [ ] **Step 1: Write fixture scripts** with blocks for `kernel_module_cramfs_disabled`, `accounts_password_pam_minlen` (`var_password_pam_minlen='14'`), `sshd_disable_root_login`, `dconf_db_up_to_date` in each level the Task 2 controls belong to. Write `p_l1w` with CRLF line endings.
- [ ] **Step 2: Write failing tests:** `test_blocks_parsed_and_echo_removed`; `test_crlf_normalized` (same block from `p_l1s` and `p_l1w` compares equal); `test_unbalanced_markers_fail`; `test_differing_blocks_fail`; `test_block_missing_in_one_level_fails`; `test_no_bash_fix_returns_none`; `test_has_fix_but_absent_everywhere_fails`.
- [ ] **Step 3: Run** `python -m pytest tests/test_cac_scripts.py -v`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat: extract per-rule fixes from CaC level scripts` (plus progress log entry).

### Task 5: Rule assembly

**Files:**
- Create: `tools/cac_normalize.py`
- Test: `tests/test_cac_normalize.py`

**Interfaces:**
- Consumes: Tasks 2 to 4.
- Produces:
  ```python
  def normalize_benchmark(upstream_dir: Path, spec: BenchmarkSpec, lock: SourceLock) -> tuple[str, list[dict]]   # (benchmark version, rules)
  ```
  Reads `upstream_dir / spec.controls_path`, `upstream_dir / "release" / f"ssg-{spec.product}-ds.xml"`, `upstream_dir / "release" / "bash" / f"{spec.product}-script-{profile}.sh"`.

Rule shape (design 5.2 to 5.5), for each control:
- `id`: `f"{spec.source_name}.{cis_id}"`; `schema_version`: `SCHEMA_VERSION`; `title`: verbatim; `section_path`: `section_path(cis_id)`; `architecture`: `None`; `tags`: `[]`; `odv`: `None`; `discussion_format`: `"markdown"`.
- `discussion`: per linked CaC rule (rendered for the lowest level's profile): `## <CaC title>`, description, then rationale under `**Rationale:**`; then, if any, `**Notes:**` and the control's notes. Controls with no rules: the notes, or `"ComplianceAsCode links no rule to this recommendation."`.
- `applicability`: `[{"target": spec.target, "version": spec.version, "benchmarks": [{"name": n, "severity": None} for n in benchmark_names(levels)]}]`.
- `assessment`: `assessment(status)`.
- `check`: `None` with no rules; else `{spec.target: {"language": "bash", "default": {"shell": None, "result": None, "additional_info": TEXT}, "by_version": {}}}` where TEXT is, per CaC rule: `== <CaC title>`, the OCIL text inside a `----` block (or `No audit procedure in ComplianceAsCode.`), then, if the rule has variables, `Expected values for <level label>: var_a = 1, var_b = 2` (level label e.g. `CIS L1 Server`).
- `remediation`: `None` with no rules; else `{spec.target: {"steps": [...], "payloads": []}}`, one step per CaC rule: `{"name": <CaC title>, "language": "bash", "shell": <block or None>, "additional_info": <"ComplianceAsCode rule `<id>`" or "No fix in ComplianceAsCode (rule `<id>`).">, "versions": None}`.
- `references`: `{"cis": {"benchmark_version": v, "id": cis_id, "levels": list(levels)}, "complianceascode": {"status": status, "rules": [...], "related_rules": [...], "cce": {rule_id: cce}}}` (omit empty lists and the `cce` map when empty).
- `source`: `name` spec.source_name, `release_tag` lock.tag, `commit_sha` lock.commit_sha, `upstream_rule_id` cis_id, `upstream_path` spec.controls_path, `upstream_revision` None, `upstream_updated` None, `upstream_url` `f"{REPOSITORY_URL}/blob/{lock.commit_sha}/{spec.controls_path}"`, `license` LICENSE.
- Fail if any linked rule's `cis_references` doesn't include the control's id.
- Fail if a linked rule's resolved OCIL text or variable values differ between the profiles of the control's levels (inheritance included), naming the control, rule and levels.

- [ ] **Step 1: Write failing tests** against the fixtures (copy them into `tmp_path/upstream` in the layout above):
  - `test_rule_ids_and_count`: six rules, `cis_fixture.1.1.1` ... (set `FIXTURE_SPEC.source_name = "cis_fixture"`).
  - `test_minlen_rule`: check text contains `"14"`, `Expected values for CIS L1 Server: var_password_pam_minlen = 14`, no `<sub`; fix step shell contains `var_password_pam_minlen='14'`; benchmarks `["cis_l1_server", "cis_l2_server", "cis_l1_workstation", "cis_l2_workstation"]`; `references.cis.levels == ["l1_server", "l1_workstation"]`.
  - `test_shared_rule_in_two_controls`: `1.1.1` and `1.2.2` both carry the cramfs fix step.
  - `test_multi_rule_partial_control`: `3.1` has two steps, the second with `shell is None` and the "No fix" text; check text has `No audit procedure in ComplianceAsCode.`; assessment `openscap`; `related_rules == ["sshd_disable_root_password_login"]` and no step for it.
  - `test_ruleless_controls`: `2.1` and `4.1` have `check is None`, `remediation is None`, discussion `Review by hand.` for `2.1`; `4.1` reason `inherent`.
  - `test_cis_reference_mismatch_fails`: edit the fixture reference of `sshd_disable_root_login` to `9.9` and assert failure naming `3.1`.
  - `test_values_differing_between_levels_fail`: change the `p_l2s` refine-value selector for `var_password_pam_minlen` to a new `<value selector="15">15</value>` and assert failure naming `1.2.1` and `accounts_password_pam_minlen`.
  - `test_every_rule_validates`: `schema_errors(rule) == []` for all rules.
- [ ] **Step 2: Run** `python -m pytest tests/test_cac_normalize.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: normalize CaC CIS controls into rules` (plus progress log entry).

### Task 6: Fetcher and importer

**Files:**
- Create: `tools/cac_fetch.py`, `tools/import_cis_cac.py`
- Test: `tests/test_cac_fetch.py`, `tests/test_import_cis_cac.py`

**Interfaces:**
- Consumes: `tools.github_fetch.resolve_tag_commit`, `fetch_release_published_date`, `download_pinned_files`, `validate_tag`, `default_opener` (use only these existing functions; the module has someone else's uncommitted edits, so don't change it); `tools.release_import.SourceImporter`, `run_cli`; `tools.library_output.index_entry`, `SCHEMA_VERSION`.
- Produces:
  ```python
  # cac_fetch.py
  IMPORTER_FORMAT = "cac-cis-1"
  def release_asset_url(tag: str, file_name: str) -> str
  def fetch(spec: BenchmarkSpec, tag: str, sources_dir: Path, today: str, opener=default_opener) -> SourceLock
  # import_cis_cac.py
  IMPORTERS: dict[str, SourceImporter]          # one per BENCHMARKS entry
  def main(argv: list[str] | None = None) -> int  # --benchmark <source_name> then run_cli's own arguments
  ```
  `fetch` downloads `scap-security-guide-<tag without v>.zip` and its `.sha512` (first whitespace-separated token) from `https://github.com/ComplianceAsCode/content/releases/download/<tag>/`, streams the zip to a temp file while hashing with SHA-512, raises `ValueError` on mismatch, extracts only `scap-security-guide-<version>/ssg-<product>-ds.xml` and the four `bash/<product>-script-<profile>.sh` members into `upstream/release/` (byte-for-byte), and downloads `LICENSE` and `spec.controls_path` at the tag commit with `download_pinned_files`. Lock as in `tools/nist_800_53_fetch.py`. The zip is deleted afterwards and never stored. Each importer's `build_rule_tree` writes `rules/<cis id>.json` plus `_index.json` like `tools/import_nist_800_53.py`; `release_label` returns `f"v{benchmark version}"`.

- [ ] **Step 1: Write failing tests** with a fake opener (pattern from `tests/test_nist_800_53_fetch.py`) serving a tiny in-memory zip built from the Task 3/4 fixtures: `test_fetch_stores_expected_files` (exact file list under `upstream/`, bytes identical to the zip members); `test_checksum_mismatch_fails_and_stores_nothing`; `test_missing_zip_member_fails`. In `tests/test_import_cis_cac.py`: `test_generate_release_from_fixture` (use `generate_release` like `tests/test_import_nist_800_53.py`, then `validate_library(baselines_dir) == []` and the manifest lists source `cis_fixture` with label `v9.9.9`); `test_main_requires_known_benchmark`.
- [ ] **Step 2: Run** `python -m pytest tests/test_cac_fetch.py tests/test_import_cis_cac.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole suite: `python -m pytest`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fetch and import CIS benchmarks from ComplianceAsCode` (plus progress log entry).

### Task 7: Import RHEL 9 and Ubuntu 24.04 into the library

**Files:**
- Modify: `tests/test_committed_library.py` (`IMPORTERS_BY_NAME`: add `*import_cis_cac.IMPORTERS.values()`)
- Modify: `baselines/_vocabulary.json`: `sources` `{"label": "CIS RHEL 9 (CaC)", "terms": ["cis_rhel9"]}`, `{"label": "CIS Ubuntu 24.04 (CaC)", "terms": ["cis_ubuntu2404"]}`; `benchmarks` `CIS L1 Server`/`CIS L2 Server`/`CIS L1 Workstation`/`CIS L2 Workstation` for the four names with `"metadata": ["benchmark"]`; `versions` `{"label": "RHEL 9", "terms": ["Linux RHEL-9"], "metadata": ["platform"]}`, `{"label": "Ubuntu 24.04", "terms": ["Linux Ubuntu-24.04"], "metadata": ["platform"]}`.
- Generated: `sources/cis_rhel9/`, `sources/cis_ubuntu2404/`, `baselines/cis_rhel9/`, `baselines/cis_ubuntu2404/`, `baselines/_manifest.json`

- [ ] **Step 1: Confirm** `git status --short baselines/_manifest.json` prints nothing. If it prints anything, stop and ask the maintainer.
- [ ] **Step 2: Run** `python tools/import_cis_cac.py --benchmark cis_rhel9 --tag v0.1.82`. Expected: `Imported 298 CIS Red Hat Enterprise Linux 9 (ComplianceAsCode) rules from v0.1.82 (3da954f)`.
- [ ] **Step 3: Run** `python tools/import_cis_cac.py --benchmark cis_ubuntu2404 --tag v0.1.82`. Expected: `Imported 312 ...`.
- [ ] **Step 4: Spot-check** `baselines/cis_rhel9/releases/v0.1.82/rules/5.1.20.json`: title starts "Ensure", fix step shell contains `PermitRootLogin`, check text contains `sudo grep -i PermitRootLogin`, assessment `openscap`. And `.../rules/` for the CIS id whose rules include `accounts_password_pam_minlen`: check text shows `var_password_pam_minlen = 14`.
- [ ] **Step 5: Add vocabulary entries** and the importer registration, then run `python -m pytest`. Expected: PASS, including `test_committed_release_matches_regeneration[cis_rhel9-v0.1.82]` and `[cis_ubuntu2404-v0.1.82]`.
- [ ] **Step 6: Commit** only `sources/cis_rhel9 sources/cis_ubuntu2404 baselines/cis_rhel9 baselines/cis_ubuntu2404 baselines/_manifest.json baselines/_vocabulary.json tests/test_committed_library.py` plus the progress log: `feat: import CIS RHEL 9 and Ubuntu 24.04 from ComplianceAsCode v0.1.82`. Note the stored size in the body.

### Task 8: Attribution

**Files:**
- Modify: `NOTICE`, `README.md` (Licensing section; new "Updating the CIS (ComplianceAsCode) rules" section after "Updating the NIST SP 800-53 rules")

- [ ] **Step 1: NOTICE entry** in the existing format: `sources/cis_rhel9/releases/<tag>/upstream/` and `sources/cis_ubuntu2404/...` are unmodified copies of parts of ComplianceAsCode/content (Project URL, Release `v0.1.82`, Licence BSD-3-Clause, "Copyright (c) 2012-2017, Red Hat, Inc.", licence text at `.../upstream/LICENSE`); `baselines/cis_*` is adapted (normalized, variable values filled in, audit and fix text assembled). Include BSD-3-Clause's no-endorsement clause wording from the vendored LICENSE.
- [ ] **Step 2: README** Licensing paragraph in the same style, and the update section: `python tools/import_cis_cac.py --benchmark <source> --tag <CaC tag>`, `--offline`, and how to add a benchmark (one `BenchmarkSpec`).
- [ ] **Step 3: Run** `python -m pytest`. Expected: PASS.
- [ ] **Step 4: Commit** `docs: credit ComplianceAsCode for the CIS rule sources` (plus progress log entry).

### Task 9: Web UI audit display and visual check

**Files:**
- Modify: `webui/src/components/rules/RuleCheckSection.tsx` (`CheckEntry`)
- Test: Playwright, `webui/e2e/` (extend the existing spec)

The coordinating session starts the shared dev server (`bun run dev -- --port 5199 --strictPort` from `webui/`) and waits for `http://localhost:5199/` to answer 200; subagents use `PLAYWRIGHT_BASE_URL=http://localhost:5199` and never start or stop it.

- [ ] **Step 1: Write a failing e2e test** `CIS rule shows its audit procedure`: open rule `cis_rhel9.5.1.20`, expect text `Audit procedure` and `PermitRootLogin`, and no `No check script.`.
- [ ] **Step 2: Run** `bun run test:e2e`. Expected: FAIL.
- [ ] **Step 3: Change `CheckEntry`**: when `check.shell` is null, there's no `shell_file`, and `additional_info` is set, show the label "Audit procedure" instead of "No check script.".
- [ ] **Step 4: Run** `bun run test`, `bun run typecheck`, `bun run lint`, `bun run test:e2e`. Expected: PASS.
- [ ] **Step 5: Screenshot** the rule panel for `cis_rhel9.5.1.20` and a multi-step rule (e.g. the `accounts_password_pam_minlen` one) at 375px and 1440px width with a short Playwright script, and look at each with the Read tool: titles readable, long bash blocks scroll inside their box, no horizontal page scroll. Also check the Frameworks home shows the two CIS cards and the level filter lists the four CIS benchmarks.
- [ ] **Step 6: Commit** `feat: show text-only audits as an audit procedure` (plus progress log entry, and mark the design doc `Status: Implemented`).
