# Design: CIS Linux benchmarks as rule sources, imported from ComplianceAsCode

Date: 2026-11-18
Status: Approved 2026-11-18, not yet implemented

## 1. Intent

The maintainer wants a basic list of CIS benchmark recommendations per platform: title, CIS ID,
level, an audit and a fix. CIS content was removed from this repo on 2026-10-20
(`docs/2026-08-20-cis-content-licensing-review.md`) because it came from CIS's own PDFs.

This design brings CIS benchmarks back, sourced **only** from open source projects that publish
the content themselves. Linux comes first, from ComplianceAsCode/content (CaC), BSD-3-Clause.
Each CIS benchmark becomes its own source (framework) in the library, imported through the
existing per-release importer (`tools/release_import.py`) like mSCP, ISM and NIST 800-53.

### Maintainer's decision on licensing (recorded, not reopened)

On 2026-11-18 the maintainer decided: content that an open source project publishes under an open
source licence, freely available, may be used as that project released it. The import must use
only those projects as its source. Nothing is taken from cisecurity.org, CIS PDFs, or any other
CIS publication. The earlier concern (CaC's control files repeat CIS's recommendation titles, and
CaC can't license text it doesn't own) was raised and considered; this is the maintainer's call.

## 2. Goals, non-goals, anti-goals

### Goals

- Two new sources, `cis_rhel9` and `cis_ubuntu2404`, one rule per CIS recommendation, each with:
  title, CIS ID, level(s), an audit procedure and a bash fix, all from one tagged CaC release.
- The importer is shared and table-driven, so more CaC benchmarks (Debian, AlmaLinux, Amazon
  Linux, RHEL 8/10, ...) can be added later by adding a table entry, not new code.
- Rules appear in the web UI's Rules view, filterable by source and by CIS level.
- Credit CaC and carry its BSD-3-Clause notice in NOTICE, README and the UI.

### Non-goals (for now)

- **Windows.** ansible-lockdown is a separate design; its source shape (Ansible tasks plus a
  separate goss audit repo) is different.
- **macOS.** Out of scope (maintainer, 2026-11-18). See section 10 for why it was considered.
- **Runnable audit scripts.** CaC's automated checks are OVAL (XML). The audit stored here is
  CaC's readable check procedure (OCIL), not a script that returns pass or fail.
- Ansible fixes. Bash only; the Ansible playbooks can be added later from the same release.
- CaC releases other than `v0.1.82`, and CaC benchmarks other than the two above.
- Links between these rules and other sources. No cross-source mapping is generated here.
- Rules spanning several platforms. Each source is one benchmark for one platform, so every rule
  has exactly one target. (The schema still allows several; nothing here needs it.)

### Anti-goals (failure even if it technically works)

- Any field whose content did not come from the pinned CaC release, or from deterministic
  derivation in this repo's code. No text from CIS directly, no AI-written rule content.
- A CIS recommendation from the control file silently dropped, or a CaC rule it lists silently
  missing its audit or fix. Gaps are either represented explicitly or fail the import.
- Hand-edited generated JSON.
- Any change to existing sources' rule files or mappings.
- Unstable rule ids.

## 3. Facts about the upstream that shape this design

All checked on 2026-11-18 against CaC release `v0.1.82`:

- **Release.** Tag `v0.1.82`, commit `3da954fbccfb4ca611da86c9be9205d83c38bfc7`. Release asset
  `scap-security-guide-0.1.82.zip`, 183,230,482 bytes, SHA-512 in the companion
  `scap-security-guide-0.1.82.zip.sha512` asset
  (`1caea418f0a5aaef7025e1655ca45a80942ea87ee832b943644ba6f9991b14a6ac5b35dddcd04b754e1fc8fbdee7b7f394507d24b123e821cca0354dc4e03cfd`).
  The zip holds prebuilt output; nothing needs CaC's build toolchain.
- **Licence.** Repo `LICENSE`: "SPDX license identifier: BSD-3-Clause", "Copyright (c)
  2012-2017, Red Hat, Inc." The repo's `DISCLAIMER` file concerns DISA STIG support only.
- **Control files** (from the git tag, not the zip; the zip does not contain them):
  - `products/rhel9/controls/cis_rhel9.yml`: policy "CIS Benchmark for Red Hat Enterprise
    Linux 9", `version: '2.0.0'`, 300 controls, flat (no nesting).
  - `controls/cis_ubuntu2404.yml`: policy "CIS Benchmark for Ubuntu 24.04 LTS",
    `version: "1.0.0"`, 312 controls, flat.
  - Both declare levels `l1_server`, `l2_server` (inherits `l1_server`), `l1_workstation`,
    `l2_workstation` (inherits `l1_workstation`).
  - Control keys: `id`, `title`, `levels`, `status`, and optionally `rules`, `related_rules`,
    `notes`. Every control has a title. No duplicate ids.
  - Ids are CIS numbers (`1.1.1.1`) except two RHEL 9 helper entries, `reload_dconf_db` and
    `enable_authselect`, which CaC adds itself and which are not CIS recommendations.
  - Status values seen: `automated`, `manual`, `partial`, `pending`, `supported`,
    `not applicable` (RHEL 9); `automated`, `manual`, `partial`, `inherently met` (Ubuntu).
  - Rules per control: 0 to 13 on RHEL 9 (42 have none), 0 to 47 on Ubuntu (21 have none).
    Entries of the form `var_name=value` (70 on RHEL 9, 65 on Ubuntu) set variables, not rules.
  - Titles end in CIS's "(Automated)" or "(Manual)" suffix.
- **Datastream** `ssg-<product>-ds.xml` (RHEL 9: 28.9 MB). Every rule the control files list is
  present. Per rule: CaC's own title, description, rationale, severity, a CIS reference
  (`href="https://www.cisecurity.org/benchmark/red_hat_linux/"` with the CIS number), OVAL check,
  usually an OCIL check and bash and Ansible fixes. Coverage of listed rules:

  | | rules | bash fix | Ansible fix | OCIL check | OVAL check |
  |---|---|---|---|---|---|
  | RHEL 9 | 404 | 374 | 371 | 388 | 404 |
  | Ubuntu 24.04 | 512 | 470 | 411 | 470 | 495 |

  Fixes and OCIL text in the datastream contain unresolved `<xccdf-1.2:sub idref=...>`
  variable references (457 of 1,316 RHEL 9 bash fixes).
- **OCIL text** is readable, e.g. for `sshd_disable_root_login`: "To determine how the SSH
  daemon's PermitRootLogin option is set, run the following command: `$ sudo grep -i
  PermitRootLogin /etc/ssh/sshd_config.d/00-complianceascode-hardening.conf` If a line
  indicating no is returned, then the required value is set."
- **OCIL text loses variable values.** Unlike fixes and descriptions, the built OCIL question
  text has no `<sub>` elements: CaC's build drops the value (RHEL 9
  `accounts_password_pam_minlen`: "enforces a minimum -character password length", "minlen = ")
  or leaves it as escaped text (`"&lt;sub idref="var_password_pam_minlen" /&gt;"`). Escaped
  placeholders appear in 20 of 388 RHEL 9 and 17 of 470 Ubuntu OCIL texts; rules that use a
  variable at all (so may have a dropped value) are 77 and 95. The per-profile HTML guides in
  the zip do not contain OCIL text either. (Found 2026-11-18 while planning.)
- **Per-profile bash scripts** `bash/<product>-script-<profile>.sh` have every variable already
  resolved for that profile. Checked 2026-11-18: each script block equals the datastream's sh
  fix with that profile's values put in place of its `<sub>` elements (0 differences across
  `cis_server_l1`, `cis`, `cis_level1_server` and `cis_level2_workstation`, ignoring CaC's
  separator and progress lines; the only mismatches are "FIX FOR THIS RULE ... IS MISSING!"
  placeholders for rules without a fix). So the datastream alone is enough, and the scripts are
  not used.
- **Variables in fixes** sit in a single-quoted assignment (`var_x='<sub/>'`) in 582 of 588
  places; the other 6 are login banner texts inside double quotes (`$(echo "<sub/>" ...)`).
- **Several values per recommendation.** Counting the variables a control's linked fixes use:
  RHEL 9 has 40 controls with one, 12 with two to four; Ubuntu 24.04 has 54 with one, 17 with
  two to seven. XCCDF `Value` types used are `number` and `string`.
- The profile ids differ per product:

  | level | RHEL 9 profile | Ubuntu 24.04 profile |
  |---|---|---|
  | `l1_server` | `cis_server_l1` | `cis_level1_server` |
  | `l2_server` | `cis` | `cis_level2_server` |
  | `l1_workstation` | `cis_workstation_l1` | `cis_level1_workstation` |
  | `l2_workstation` | `cis_workstation_l2` | `cis_level2_workstation` |

## 4. Source naming and rule ids

- Source names are CaC's control-file ids: `cis_rhel9`, `cis_ubuntu2404`.
- Display names: "CIS Red Hat Enterprise Linux 9 (ComplianceAsCode)", "CIS Ubuntu 24.04 LTS
  (ComplianceAsCode)".
- Rule id: `<source>.<CIS number>`, e.g. `cis_rhel9.5.1.20`. This matches the schema's id
  pattern and is stable across CaC releases as long as CIS keeps the number.
- Release tag: the CaC tag (`v0.1.82`). Release label: the benchmark version from the control
  file, e.g. "v2.0.0". Two CaC releases carrying the same benchmark version get the same label;
  the release history design already shows tag beside label.

## 5. Normalization

### 5.1 Which controls become rules

Every control whose id is a CIS number becomes a rule. Non-CIS helper ids (`reload_dconf_db`,
`enable_authselect`) are skipped, by an explicit allowlist per source so a new unknown non-CIS id
fails the import instead of being silently skipped.

### 5.2 Field mapping

| Rule field | From |
|---|---|
| `title` | control `title`, verbatim (including the "(Automated)"/"(Manual)" suffix) |
| `section_path` | the CIS number's prefixes: `1.1.1.1` gives `["1", "1.1", "1.1.1", "1.1.1.1"]` (the control file has no section names) |
| `discussion` (markdown) | for each linked CaC rule: its title as a heading, then its description and rationale, converted from XCCDF HTML to markdown; then the control's `notes`, if any |
| `applicability` | one entry: target `Linux` (the library's existing key, which the UI's Linux icon and the product catalog use), version `RHEL-9` / `Ubuntu-24.04` (versions can't contain spaces), benchmarks per section 5.3. `check` and `remediation` are keyed by `Linux` too |
| `assessment` | section 5.5 |
| `check` | section 5.4 |
| `remediation` | section 5.4 |
| `references` | `cis`: `{benchmark_version, id, levels}` (levels as listed in the control file); `complianceascode`: `{status, rules, related_rules}`; plus each linked rule's CCE id for this product |
| `source` | as other sources; `upstream_rule_id` is the CIS number, `upstream_path` the control-file path, `upstream_url` a link to the control file at the tag |
| `odvs` | section 5.7: one named ODV per XCCDF variable the linked rules use (requires `2026-11-18-named-odvs-design.md`) |

### 5.3 Levels

Benchmark names: `cis_l1_server`, `cis_l2_server`, `cis_l1_workstation`, `cis_l2_workstation`,
added to `baselines/_vocabulary.json` with labels "CIS L1 Server" and so on.

Level inheritance is expanded, the same way mSCP marks a Level 1 rule as both `cis_lvl1` and
`cis_lvl2`: a control at `l1_server` gets `cis_l1_server` and `cis_l2_server`. Filtering on
"L2 Server" then gives the complete L2 Server list. The level CIS assigned is kept unexpanded
in `references.cis.levels`, so the UI can still show "Level 1".

### 5.4 Audit and fix

- **Fix** (`remediation[target].steps`): one step per linked CaC rule, in control-file order,
  `language: bash`, `name` the CaC rule title, `shell` the rule's datastream sh fix with each
  `<xccdf-1.2:sub>` replaced by `$ODV_<variable>` (so the admin's value, or the recommended
  one, is shown and copied), `additional_info` the CaC rule id.
- **Audit** (`check[target]`): CaC's OCIL question text for each linked rule, with the CaC rule
  title before each. Because built OCIL text loses variable values (section 3), each escaped
  `<sub idref="var_x" />` placeholder becomes `$ODV_var_x`, and every rule that uses variables
  gets a line after its text listing them, e.g. "Expected values: var_password_pam_minlen =
  $ODV_var_password_pam_minlen", which the UI shows with the chosen value. Dropped values can't
  be put back into the sentence itself; the listed values make the audit usable anyway. Stored as
  `language: bash`, `shell: null`, `result: null`, the text in `additional_info`. The schema
  allows only one check entry per target, so multiple CaC rules are concatenated into it.
- A linked CaC rule with no bash fix, or no OCIL text, is listed in the step or audit text as
  "No fix in ComplianceAsCode" / "No audit procedure in ComplianceAsCode" rather than dropped.
- Controls with no `rules` get `check: null` and `remediation: null`.
- `related_rules` (CaC rules that partly cover a control) are listed in references only; their
  checks and fixes are not included.

### 5.5 Assessment

Maintainer's rule (2026-11-18): a rule is `automated` only when this toolkit has something it
can run or deploy itself (a check command, a deployable policy). If we can't run it ourselves,
it is `manual`. That applies to every rule in these sources, since the stored audit is
readable text.

| CaC status | `assessment` |
|---|---|
| `automated`, `partial`, `supported` | `manual`, `openscap` (new) |
| `manual` | `manual`, `manual` |
| `pending` | `manual`, `no_check` |
| `not applicable` | `manual`, `n_a` |
| `inherently met` | `manual`, `inherent` |

Any other status fails the import.

`openscap` is a new `manual_reason`, labelled "Checkable with OpenSCAP": CaC can check this
rule with OpenSCAP, but this toolkit has no runnable check for it. Adding it touches the
closed enum in `baselines/_rule.schema.json`, its mirror in `webui/src/logic/overlayShape.ts`,
and the `manual_reasons` vocabulary. The existing reasons and existing rules are unchanged.

### 5.6 Fail loudly

The import fails, naming the control, on: an unknown status or level; a listed rule missing
from the datastream; an unresolvable variable (no `refine-value` and no default); a variable in
a fix that is not inside single or double quotes; a recommended or per-level value that breaks
its own quoting rules; an unknown non-CIS control id; a CIS reference in the datastream that
disagrees with the control id.

### 5.7 Organization-defined values

Per `2026-11-18-named-odvs-design.md`, each XCCDF variable used by any linked rule of a control
(in its sh fix, description, rationale or OCIL text) becomes one ODV on that rule:

| ODV field | From |
|---|---|
| `name` | the variable id without CaC's prefix, e.g. `var_password_pam_minlen` |
| `datatype` | XCCDF `Value` `type`: `number` or `string` (any other type fails) |
| `description` | the `Value`'s title |
| `validation` | `null` |
| `recommended` | the value for the control's lowest listed level |
| `by_benchmark` | the value for each benchmark name the rule has (5.3, inheritance expanded) |
| `quoting` | `single` or `double`, from where the variable sits in the fixes; `unquoted` for a variable used only in prose (it is never shown inside a command) |

A level's value is the profile's `refine-value` selector, else the `Value`'s default `<value>`
(the one without a selector). Every text field's `<xccdf-1.2:sub>` becomes the placeholder, so
descriptions also show the chosen value. The ODVs the control-file's `var_name=value` entries
set are already reflected in the profiles' refine-values, so they need no separate handling.

## 6. Importer

### 6.1 Layout

- `tools/cac_fetch.py`: downloads the release zip, verifies its SHA-512 against the companion
  asset, downloads the control file from the tag, and stores in
  `sources/<source>/releases/<tag>/upstream/` unmodified copies of: the control file, the
  product's datastream and CaC's `LICENSE` (the per-profile scripts are not needed, section 3).
- `tools/cac_normalize.py`: section 5, pure functions. The datastream is parsed with the
  standard library's `xml.etree.ElementTree` after rejecting any document that contains a
  `<!DOCTYPE` or `<!ENTITY` declaration, which blocks entity-expansion attacks without adding
  a dependency (`defusedxml` would be the alternative).
- `tools/import_cis_cac.py`: one `SourceImporter` per table entry (source name, display name,
  CaC product, control-file path, level-to-profile map, target, version, helper-id allowlist).
- Import format id: `cac-cis-1`.

### 6.2 Size

Storing the datastream verbatim costs about 29 MB per benchmark per release in `sources/`
(NIST 800-53 is 24 MB today). The 183 MB zip itself is never committed. Trimming the datastream
to the rules used would cut this sharply but means storing a derived file, not an unmodified
copy; that trade is left to the builder to measure and propose.

## 7. Licence and attribution

- NOTICE gets a CaC entry in the existing format: project URL, release, BSD-3-Clause, the
  copyright line, and where the licence text is kept
  (`sources/<source>/releases/<tag>/upstream/LICENSE`). It states that `baselines/cis_*` is
  adapted (normalized, variables turned into customisable values) from that material.
- The manifest `license` block: name "BSD-3-Clause", rights holder "Red Hat, Inc.",
  `modified: true`.
- README and the UI's source attribution follow the existing pattern.

## 8. Web UI

- The new sources and benchmark terms appear through the vocabulary and manifest; no new view.
  They show up as framework cards on the unified Frameworks tab
  (`2026-11-18-unified-frameworks-design.md`) with no change to that work.
- The `manual_reasons` vocabulary descriptions are worded for mSCP/macOS; reword them neutrally
  so they read correctly on CIS rules.
- Generate checks is unaffected: `webui/src/logic/checkPlan.ts` only builds macOS checks, so a
  `shell: null` Linux check never reaches a script.
- Check and fix panels must render an audit that is text only (`shell: null`) and a fix with
  many steps. Verified with Playwright and screenshots at about 375px and desktop width, per
  `.claude/CLAUDE.md`.

## 9. Test strategy

- Fixtures: a trimmed control file and datastream and profile scripts covering each status,
  a multi-rule control, a no-rule control, a helper id, a variable-bearing fix, a rule with no
  OCIL and one with no bash fix.
- Unit tests for each row of 5.2 to 5.5 and each fail-loudly case in 5.6.
- Fetch test with the zip checksum mismatch.
- The existing committed-library and schema tests cover the generated output.

## 10. macOS (out of scope)

The maintainer originally wanted CIS rules linked to the related mSCP rules. With one source
per benchmark and Linux sources only, there is nothing in mSCP to link to. mSCP rules already
record their CIS ID and level per macOS version (e.g. `"macos_26": ["3.1 (level 1)"]`). A
`cis_macos26` source built from those references could link to the mSCP rules, but its titles
would be mSCP's (mSCP doesn't publish CIS titles) and its audit and fix would be mSCP's. On
2026-11-18 the maintainer decided to keep macOS out of scope for now.

## 11. Delivery

Other work (the unified Frameworks tab and older ASD ISM releases) is in progress in the same
working tree and also rewrites `baselines/_manifest.json`. This work starts only once that is
committed, and commits stage explicit paths so nothing of the other work is swept in.

1. The `openscap` manual reason: schema, overlay shape, vocabulary (5.5).
1. Fetch and source lock for `cis_rhel9` at `v0.1.82`.
2. Normalizer and importer for RHEL 9; generated library; tests.
3. Add `cis_ubuntu2404` as a second table entry.
4. Vocabulary, NOTICE, README, manifest licence.
5. Web UI checks and Playwright verification.

## 12. Calls made without the maintainer

For the maintainer to check while reading:

- Rule id `<source>.<CIS number>`; release label = the benchmark version (section 4).
- Title kept verbatim, including "(Automated)"/"(Manual)" (5.2).
- `section_path` as CIS number prefixes, since the control file has no section names (5.2).
- Level inheritance expanded for filtering, with the CIS-assigned level kept in references (5.3).
- Target `Linux`, version `RHEL-9` / `Ubuntu-24.04` (5.2).
- Bash fixes only, taken from the datastream with variables as customisable values (5.4, 5.7).
- Multiple CaC rules' audit text concatenated into the one check entry the schema allows (5.4).
- Upstream datastream stored verbatim, about 29 MB per benchmark per release (6.2).

## Progress log

(none yet)
