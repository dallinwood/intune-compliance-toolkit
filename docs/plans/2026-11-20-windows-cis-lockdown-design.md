# Design: Windows CIS benchmarks from ansible-lockdown, with native registry settings

Date: 2026-11-20
Status: Approved 2026-11-20

## Intent

The maintainer wants CIS benchmarks for Windows alongside the Linux ones imported from
ComplianceAsCode (`docs/plans/2026-11-18-cis-complianceascode-source-design.md`). The source is
ansible-lockdown: an Ansible role per benchmark that applies the settings, plus a companion
"Audit" repo of goss tests that check them. A user should be able to read, for each CIS
recommendation, what is checked and what is changed, as real values and as scripts.

Most Windows CIS recommendations are a single registry value. The maintainer also wants registry
settings recorded natively (not only buried in a script), and shown in the web UI so a reader can
see the hive, key path, value name, type and data at a glance.

### Maintainer decisions (recorded, not reopened)

- Licensing (2026-11-18): content an open source project publishes under an open source licence,
  freely available, may be used as that project released it; only those projects are a source,
  never CIS itself. All eight repos below are MIT, copyright MindPoint Group / Ansible Lockdown,
  with no CIS disclaimer. The public Audit repos state they are generated from a private
  subscriber repo; the maintainer chose (2026-11-20) to use both the role and the public Audit
  repo, since what we copy is the public MIT release.
- OpenSCAP is not a Windows source (Windows support deprecated in 2022).
- One framework per repo, each imported and updated on its own, never mixed.
- Scope: Windows 11, Server 2025, Server 2022, Server 2019 only (not 10 or 2016).
- Representation (the "B and A" combination): keep the original Ansible task and goss test as
  their own languages, and translate what we can into PowerShell with real values.
- Several checks per platform (implemented 2026-11-20, `7906af76`) is the prerequisite.
- A rule is automated only when we have something we can run: here, a PowerShell check.
- Provenance: community.

## Goals, non-goals, anti-goals

- Goal: four sources, one rule per CIS recommendation, with CIS ID, title, levels/profiles,
  checks (registry where possible, PowerShell, original goss), fixes (registry where possible,
  PowerShell, original Ansible) and ODVs with the role's defaults as recommended values.
- Goal: a native `registry` representation usable by any framework, shown as a table.
- Goal: the importer is table-driven, so a new ansible-lockdown Windows repo is a table entry.
- Non-goal: native representations for user rights, security policy, audit policy or services
  (they get PowerShell plus the original Ansible); possible later.
- Non-goal: running Windows checks or deploying fixes from the toolkit (no Windows generator yet).
- Anti-goal: anything sourced from CIS directly; mixing benchmarks in one framework; showing a
  translated script whose values differ from the native registry data.

## Source facts (researched 2026-11-20)

| Source id | Role repo, release | Benchmark | Audit repo, branch | Rules |
|---|---|---|---|---|
| `cis_windows11` | Windows-11-CIS 3.0.3 | v3.0.0 | Windows-11-CIS-Audit `benchmark_v3.0.0` | 539 |
| `cis_windows2025` | Windows-2025-CIS 1.2.2 | v1.0.0 | Windows-2025-CIS-Audit `benchmark_v1.0.0` | 463 |
| `cis_windows2022` | Windows-2022-CIS 4.2.0 | v4.0.0 | Windows-2022-CIS-Audit `benchmark_v4.0.0` | 445 |
| `cis_windows2019` | Windows-2019-CIS 4.2.0 | v4.0.0 | Windows-2019-CIS-Audit `latest` | 434 |

- Role tasks live in `tasks/section*.yml`, named `"<ID> | PATCH | <title>"` (sub-tasks
  `"<ID> | AUDIT|PATCH | <title> | <step>"`), toggled by `winNNcis_rule_<id>` and tagged with the
  rule and its profiles (`level1-corporate-enterprise-environment`, `level2-bitlocker`,
  `level1-memberserver`, `level2-domaincontroller`, `ngws-*`, ...).
- The primary module per rule: about 75 to 80% `win_regedit`, about 10% `win_user_right` or
  `win_security_policy`, the rest `win_shell` (AuditPol, secedit, ...) or `win_service`.
- ODVs: variables in `defaults/main/main.yml`, each with a comment block naming its rule, prose
  and `# Default: N`; tasks use `"{{ winNNcis_x }}"`. The Audit repo reuses the same names.
- The Audit repo is syver (a goss fork): one Go-template YAML file per control,
  `cis_<ID>.yml`, plus `coverage.json` (rule id, clean title, gate).
- Release tags are the role's semver, not the benchmark version. Audit repos have no tags.

## Design

### 1. Native registry settings (any framework)

A new language `registry`. A check entry or remediation step whose language is `registry`
carries a `registry` list instead of `shell`/`shell_file` (exactly one of the three is present,
as `shell` and `shell_file` are today). Each element is one setting:

| Field | Meaning |
|---|---|
| `hive` | `HKLM`, `HKCU` (per user; also used for ansible-lockdown's loops over every user's `HKU\<SID>`), `HKU`, `HKCR` |
| `path` | key path under the hive, backslash-separated, no leading backslash |
| `value_name` | value name; `""` for the key's default value |
| `type` | `REG_DWORD`, `REG_QWORD`, `REG_SZ`, `REG_EXPAND_SZ`, `REG_MULTI_SZ`, `REG_BINARY`; `null` when `state` is `absent` |
| `data` | the value: integer for DWORD/QWORD, string for SZ/EXPAND_SZ, list of strings for MULTI_SZ, hex string for BINARY; may be `"$ODV_<name>"` (whole value only); `null` when absent |
| `state` | `present` (value must equal `data`) or `absent` (value must not exist) |

In a check, the list means "every setting matches"; in a fix, "set every setting". The schema
validates the type/data pairing. Placeholder validation (`tools/odv_placeholders.py`) accepts an
`$ODV_<name>` in `data` only when the ODV exists and its datatype fits the registry type; no
quoting applies.

`registry` is not runnable. A shared Python function, `tools/registry_powershell.py`, turns a
registry list into a PowerShell check (exit non-zero on any mismatch) and a PowerShell fix
(`New-Item -Force`, `Set-ItemProperty -Type`, `Remove-ItemProperty`). Importers emit both the
registry item and the PowerShell generated from it, so the table and the script cannot disagree.

### 2. Two display-only languages

`ansible` (the original task YAML, verbatim) and `goss` (the original Audit test YAML, verbatim).
Both are shown with code formatting and a language pill, never run, and do not make a rule
automated. Their text may contain Jinja/Go-template expressions; the ODV placeholder scanner skips
these two languages (their variables are the upstream names, not ours).

### 3. Web UI

- Check and Remediation sections show a `registry` item as a table: Hive, Key path, Value name,
  Type, Data, Action (Set / Delete). Data shows the customised ODV value the way scripts do,
  with the ODV highlighted. Key paths are copyable (full `HKLM\...` path). At narrow widths each
  row becomes a stacked card; nothing scrolls horizontally except a long key path inside its cell.
- Each registry table has a "Download .reg" button (beside it, the way code blocks have a copy
  button; maintainer request 2026-11-20). It saves a `.reg` file that sets every setting in that
  item: `Windows Registry Editor Version 5.00` header, one `[HIVE\path]` section per key, values
  as `dword:`, `hex(b):` (QWORD), `hex(2):` (EXPAND_SZ), `hex(7):` (MULTI_SZ), `hex:` (BINARY) or
  quoted strings, and `"name"=-` for `absent`. Hives are written in long form
  (`HKEY_LOCAL_MACHINE`, ...). ODVs use the reader's customised values. The file is UTF-16LE with
  a BOM, as regedit writes it. It is generated in the web UI (it needs the customised values) by
  a pure function with Vitest golden tests. The button appears on check items too, since the
  file is the same "set these values" either way.
- `ansible` and `goss` get labels and pills like the other languages.
- Change labels, the custom-changes notice, overlays and attestation reports treat `registry`
  entries as list data (paths into `registry[i].data`, etc.).

### 4. The importer (`tools/import_cis_lockdown.py`)

Table-driven like `tools/cac_benchmarks.py`: per source the role repo, audit repo and branch,
variable prefix (`win11cis`, ...), target `Windows`, version (`11`, `Server-2025`, `Server-2022`,
`Server-2019`), display name and provenance `community`. A release is the role's tag; the Audit
repo is pinned by commit SHA, and both, plus the benchmark version, are recorded in
`source.json`. Upstream files are copied under `sources/<id>/releases/<tag>/upstream/` as for
CaC.

Per rule (rule id = CIS ID):

- **Title:** from the Audit `coverage.json` (clean), falling back to the task name.
- **Levels and profiles:** each profile tag becomes a benchmark of the source (e.g.
  `level1_memberserver`, `level2_domaincontroller`, `level1_bitlocker`), the way CaC sources carry
  `cis_l1_server` and the rest; the Audit `meta` cross-checks.
- **Check items, in order:** `registry` (when every primary write is a translatable
  `win_regedit`), PowerShell (generated from the registry, or translated from
  `win_user_right` / `win_security_policy` / `win_service`), `goss` (the original test).
- **Fix steps, in order:** `registry` (same condition), PowerShell (generated or translated;
  `win_shell` bodies taken verbatim as PowerShell), `ansible` (all of the rule's tasks).
- **Translatable** means the module's arguments are literals or a single `{{ winNNcis_x }}` that
  is an ODV. Any other Jinja, a `when` on host facts beyond the rule toggle, or an unknown module
  makes that rule Ansible/goss only, `assessment` manual with a reason (`ansible_only`).
- **ODVs:** from `defaults/main/main.yml` comment blocks (name without prefix, description, the
  default as `recommended`, range validation from the role's `when` checks where present).
- **Edge cases:** tasks for the same ID merge into one rule (the duplicate `1.2.1`); AUDIT and
  warning sub-tasks are not fixes; "MS only | Member Server" suffixes become applicability notes,
  not title text.

### 5. Schema version

Additive only: new language values and the optional `registry` body. Existing data does not
change, so `schema_version` stays 7 and no existing release is regenerated (the same call as the
provenance field).

## Delivery (two plans)

This is two units of work; each gets its own plan and review:

1. **Registry and display languages:** schema, `registry_powershell.py`, placeholder and overlay
   support, web UI table and pills, tests and screenshots, using fixture rules (no source yet).
2. **ansible-lockdown importer:** the four sources and their first releases, NOTICE/README credit.

## Testing

- Schema accepts each registry type with matching data, rejects mismatches, `absent` with data,
  and a body with both `registry` and `shell`.
- `registry_powershell.py`: golden scripts per type and `absent`; ODV placeholder carried through.
- Importer: fixture tasks for each module type, a Jinja-valued task (falls back to Ansible only),
  the duplicate ID, an HKU per-user loop, ODV extraction; committed-library tests for all four.
- Web UI: Vitest for table rows from a registry item; e2e on a Windows CIS rule showing the
  table, the PowerShell and the goss items; screenshots at about 375px and 1440px.
- `.reg` export: golden files per registry type, `absent`, the default value (`@=`), several
  keys, a customised ODV; e2e clicks the button and checks the download's name and header.

## Calls made without the maintainer

- `HKU\<each SID>` loops are stored as `HKCU` (it is what the setting means per user).
- Only the PowerShell check counts toward automated; the registry item alone does not, since the
  toolkit cannot run it.
- No schema version bump.
- Native types for user rights, security policy and services are left for later.
- Version strings `11`, `Server-2025`, `Server-2022`, `Server-2019` under target `Windows`.
