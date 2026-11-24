# Windows CIS (ansible-lockdown) Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four new community sources, `cis_windows11`, `cis_windows2025`, `cis_windows2022`, `cis_windows2019`, each imported on its own from one ansible-lockdown role release plus its Audit repo, one rule per CIS recommendation with registry, PowerShell and original goss checks, registry, PowerShell and original Ansible fixes, levels/profiles as benchmarks, and ODVs from the role defaults.

**Spec:** `docs/plans/2026-11-20-windows-cis-lockdown-design.md`, especially "Source facts" and section 4 (binding; read it). Plan 1 (registry settings and display languages) is complete: the `registry` body, `ansible`/`goss` languages and `tools/registry_powershell.py` exist.

**Architecture:** a parsing module per upstream (`tools/lockdown_role.py` for the Ansible role, `tools/lockdown_audit.py` for the Audit repo), a normalizer that joins them into rules (`tools/lockdown_normalize.py`), a fetcher (`tools/lockdown_fetch.py`, modelled on `tools/mscp_fetch.py`: tarball at a pinned commit, extract only the needed subset under `upstream/`), a table of sources (`tools/lockdown_sources.py`, modelled on `tools/cac_benchmarks.py`) and the entry point `tools/import_cis_lockdown.py` using `tools/release_import.py` like `tools/import_cis_cac.py`.

**Tech stack:** Python 3, PyYAML 6.0.3 (already a dependency; `yaml.safe_load` only), jsonschema, pytest.

## Global Constraints

- Sources (exact): `cis_windows11` (ansible-lockdown/Windows-11-CIS release `3.0.3`, benchmark `v3.0.0`, Audit `Windows-11-CIS-Audit` branch `benchmark_v3.0.0`, prefix `win11cis`, version `11`), `cis_windows2025` (Windows-2025-CIS `1.2.2`, `v1.0.0`, `Windows-2025-CIS-Audit` `benchmark_v1.0.0`, `win25cis`, `Server-2025`), `cis_windows2022` (Windows-2022-CIS `4.2.0`, `v4.0.0`, `Windows-2022-CIS-Audit` `benchmark_v4.0.0`, `win22cis`, `Server-2022`), `cis_windows2019` (Windows-2019-CIS `4.2.0`, `v4.0.0`, `Windows-2019-CIS-Audit` `latest`, `win19cis`, `Server-2019`). Verify each prefix against the role's `defaults/main/main.yml` before using it. Target `Windows`; provenance `community`; licence MIT, rights holder as in each repo's LICENSE; display names "CIS Windows 11 (ansible-lockdown)", "CIS Windows Server 2025 (ansible-lockdown)", and so on.
- A release is the role's tag; the Audit repo is pinned by the commit SHA of its branch at import time; role tag, role commit, Audit branch, Audit commit and benchmark version are recorded in the release's `source.json`. Upstream files are copied only from these two repos, never from CIS.
- Rule id `<source id>.<CIS ID>` (as the CaC sources do); `section_path` stops at the parent section; title from the Audit `coverage.json`, else the task name's title part with the "MS only | Member Server" style suffix removed.
- Benchmarks: one per profile tag, named by the tag with `-` replaced by `_` (e.g. `level1_memberserver`, `level2_domaincontroller`, `level1_corporate_enterprise_environment`, `level1_bitlocker`, `ngws_...`).
- Check items in order: `registry` (only when every primary write of the rule is a translatable `win_regedit`), `powershell` (from `registry_powershell.registry_check_powershell`, or translated from `win_user_right`/`win_security_policy`/`win_service`), `goss` (verbatim Audit file). Fix steps in order: `registry`, `powershell` (generated, translated, or `win_shell` body verbatim), `ansible` (the rule's role tasks, verbatim YAML). Names: `null` except the goss item ("Original goss test") and the Ansible step ("Original Ansible tasks").
- Translatable: module arguments are literals or exactly `"{{ <prefix>_<name> }}"` naming a defaults variable that becomes an ODV; any other Jinja, a `when` beyond the rule toggle and range checks, a loop other than the per-user HKU loop, or an unknown module makes the rule Ansible/goss only with `assessment: {status: manual, manual_reason: "ansible_only"}`. Otherwise `assessment` is automated.
- `win_regedit` mapping: `path: HKLM:\...` to hive `HKLM` (likewise `HKCU:`, `HKU:`, `HKCR:`), HKU per-user loops to `HKCU`; `type` `dword`/`qword`/`string`/`expandstring`/`multistring`/`binary` to `REG_DWORD`/`REG_QWORD`/`REG_SZ`/`REG_EXPAND_SZ`/`REG_MULTI_SZ`/`REG_BINARY`; `state: absent` to `state: absent`; `name` missing or empty to `value_name: ""`.
- ODVs: from `defaults/main/main.yml` comment blocks (name without `<prefix>_`, description from the prose, `recommended` from the default). Number ODVs used as DWORD/QWORD data need `validation.min >= 0` and a `max` in range: take them from the role's range `when`/warning conditions when present, else the type's full range. String ODVs in registry data get `quoting: "single"`.
- Rules sharing an ID merge into one rule (all their tasks in the Ansible step); AUDIT and warning sub-tasks are not fixes but stay in the Ansible step.
- Python `.venv/Scripts/python.exe -m pytest -W error -n auto` (3 known failures in `tests/test_github_fetch.py`). Run `bun run test` from Git Bash, not PowerShell (PowerShell resolves `bash` to WSL). Web UI from `webui/`: `bun run test`, `bun run lint`, `bunx tsc -b`; e2e `PLAYWRIGHT_BASE_URL=http://localhost:5199 bun run test:e2e`. The controller stops the dev server before Task 4 generates releases and restarts it before Task 4's e2e.
- Fixtures under `tests/fixtures/lockdown/` are small excerpts of the real MIT files (with their LICENSE); mark them `-text` in `.gitattributes`, and mark `sources/cis_windows*/releases/*/upstream/** -text`.
- Commits: `type: summary`, body says why, no Co-Authored-By or AI attribution, explicit paths only, push; progress log entry in this plan. Never use the em dash character.

## Review Focus

- A `win_regedit` whose `data` is a Jinja expression other than a single defaults variable (arithmetic, filters, conditionals) must make the rule Ansible-only, never a registry item with the raw Jinja text as data.
- A rule whose tasks write registry and also run `win_shell` must not get a `registry` item claiming to be the whole fix.
- A role variable referenced by a task but missing from defaults must fail the import loudly, not produce a dangling `$ODV_`.
- Titles containing quotes or backslashes must come from `coverage.json` intact.
- Re-running the import offline for the same tag must reproduce the committed release byte for byte.

---

### Task 1: Role parsing and registry translation

**Files:** new `tools/lockdown_role.py`, `tests/test_lockdown_role.py`, fixtures under `tests/fixtures/lockdown/role/` (a `defaults/main/main.yml` excerpt and `tasks/section*.yml` excerpts covering each case below).

**Interfaces produced:**
- `load_role_tasks(role_dir: Path) -> list[RoleTask]` (`RoleTask`: `rule_id`, `verb` (`PATCH`/`AUDIT`/other), `title`, `module`, `args: dict`, `when: list[str]`, `loop`, `tags: list[str]`, `source_yaml: str` (verbatim text of the task), `file`).
- `group_by_rule(tasks) -> dict[str, list[RoleTask]]` (keeps upstream order, merges duplicate IDs).
- `load_role_odvs(role_dir: Path, prefix: str) -> dict[str, RoleOdv]` (name, description, default, min, max).
- `translate_registry(tasks, odvs, prefix) -> list[dict] | None` (registry settings, or `None` when any primary write is not a translatable `win_regedit`).

- [ ] **Step 1: Failing tests:** task name parsing (plain, sub-task, "MS only" suffix); grouping and the duplicate `1.2.1`; ODV extraction with description, default and range; each registry type; `state: absent`; empty name to `""`; HKU per-user loop to `HKCU`; a single-variable ODV value; a filtered/arithmetic Jinja value returns `None`; a rule mixing `win_regedit` and `win_shell` returns `None`; an unknown variable raises.
- [ ] **Step 2: Implement; run the new tests and the full suite.**
- [ ] **Step 3: Commit** `feat: parse ansible-lockdown Windows role tasks and registry settings`.

### Task 2: Other modules, the Audit repo and profiles

**Files:** `tools/lockdown_role.py` (translations), new `tools/lockdown_audit.py`, tests and fixtures under `tests/fixtures/lockdown/audit/` (a `coverage.json` excerpt and a few `cis_<ID>.yml`).

**Interfaces produced:**
- `translate_powershell(tasks, odvs, prefix) -> tuple[str, str] | None` (check and fix PowerShell for `win_user_right`, `win_security_policy`, `win_service`, `win_shell`-only fixes return `(None, body)`), ODV placeholders as in plan 1 (numbers bare, strings `'$ODV_x'`).
- `load_audit(audit_dir: Path) -> dict[str, AuditControl]` (`AuditControl`: `rule_id`, `title`, `gate`, `goss_text` verbatim, `meta`).
- `profiles_for(tasks) -> list[str]` (benchmark names from profile tags).

- [ ] **Step 1: Failing tests:** user right check and fix PowerShell (golden); security policy (golden, via `secedit` export/compare and `/configure`); service start mode and state (golden); `win_shell` verbatim fix with no check; coverage titles with quotes and backslashes intact; goss text verbatim; profiles from tags for a workstation and a server rule.
- [ ] **Step 2: Implement; run tests; run each generated golden script once on this Windows machine where it is read-only (the check scripts), and report.**
- [ ] **Step 3: Commit** `feat: translate lockdown user rights, security policy and services, and read the Audit repo`.

### Task 3: Normalizer, fetcher and importer

**Files:** new `tools/lockdown_sources.py`, `tools/lockdown_normalize.py`, `tools/lockdown_fetch.py`, `tools/import_cis_lockdown.py`, tests (`tests/test_lockdown_normalize.py`, `tests/test_lockdown_fetch.py` with a fake opener, `tests/test_import_cis_lockdown.py` offline on fixtures).

**Interfaces produced:** `normalize_rules(spec, role_dir, audit_dir) -> list[dict]` (schema-valid rules); CLI `tools/import_cis_lockdown.py --source <id> [--tag <role tag>] [--offline] [--release <tag>]` mirroring `tools/import_cis_cac.py`.

- [ ] **Step 1: Failing tests:** a fixture rule of each kind normalizes to the exact check items, fix steps, names, assessment, applicability (target, version, benchmarks), ODVs (with `quoting`) and passes `placeholder_errors`; an `ansible_only` rule; the fetcher records role tag and commit, Audit branch and commit, benchmark version, and extracts only the needed subset; the offline import is deterministic.
- [ ] **Step 2: Implement; run the full suite.**
- [ ] **Step 3: Commit** `feat: import Windows CIS benchmarks from ansible-lockdown`.

### Task 4: The four releases, credits and the web UI check

**Files:** generated `baselines/cis_windows*/`, `sources/cis_windows*/`, `baselines/_manifest.json`; `NOTICE`, `README.md` (credit ansible-lockdown with its MIT notice, as for ComplianceAsCode); `.gitattributes`; `tests/test_committed_library.py` (the four sources, their provenance, rule counts within 5% of 539/463/445/434 and an automated share reported); an e2e spec for one Windows CIS rule.

- [ ] **Step 1: Generate** each source's release (controller has stopped the dev server); report per source: rules, automated, `ansible_only`, registry items, ODVs, and any task the importer could not classify.
- [ ] **Step 2: Failing e2e then passing:** the Frameworks home lists the four under Community; a known registry rule shows the registry table, PowerShell and goss checks, and a working "Download .reg"; an `ansible_only` rule shows Manual and its Ansible step.
- [ ] **Step 3: Run** the full Python suite, `bun run test`, lint, `tsc -b`, full e2e (controller restarts the dev server first); screenshots of a Windows CIS rule at about 375px and 1440px; look at them.
- [ ] **Step 4: Commit** `feat: add CIS Windows 11 and Server 2025, 2022 and 2019 from ansible-lockdown` (explicit paths from `git status`); progress log; push.

## Progress log

- 2026-11-24: Task 1 done. Added `tools/lockdown_role.py` (role task and ODV parsing, `win_regedit` to native registry settings) with tests and verbatim Windows-2022-CIS fixtures under `tests/fixtures/lockdown/role/`. Run over the four real roles it finds 540, 462, 444 and 433 rules (Windows 11, 2025, 2022, 2019) with no parse failures; strict registry translation covers 342, 305, 286 and 282 of them. Commit: 22b893b10 feat: parse ansible-lockdown Windows role tasks and registry settings.
- 2026-11-24: Task 2 done. Added PowerShell translation for `win_user_right`, `win_security_policy`, `win_service` and `win_shell`-only rules (`tools/lockdown_role.py` plus the script builders in `tools/lockdown_powershell.py`), the Audit repo reader `tools/lockdown_audit.py`, and `profiles_for`. Four controller rulings also changed Task 1's code: profile gates and `win_skip_for_test` are tolerated by default, number ODVs in REG_SZ stay Ansible-only, ODV names that start with a digit become `value_<name>`, and an equality `when` is not a range (ODV ranges now also come from the AUDIT warnings, narrower bound wins). Over the four real roles the registry rules rise to 405, 353, 333 and 322 and all but 41, 28, 30 and 30 rules now have a registry item, a PowerShell check or a PowerShell fix. Commit: see `git log` (feat: translate lockdown user rights, security policy and services, and read the Audit repo).
- 2026-11-24: Task 3 done. Added the source table (`tools/lockdown_sources.py`), the normalizer that joins role and Audit repo into schema-valid rules (`tools/lockdown_normalize.py`), the fetcher that pins both repos by commit and extracts only the needed subset (`tools/lockdown_fetch.py`) and the CLI (`tools/import_cis_lockdown.py --source <id> --tag|--offline`). `SourceLock` gained an optional `details` map (left out of the file when empty) for the Audit branch, Audit commit and benchmark version. The domain-scoped account policy and standalone gates are now tolerated like the other profile gates. Normalizing the four real `main` clones in memory gives 540, 462, 444 and 433 rules (483, 411, 393 and 381 automated after the follow-up that makes rules without a runnable check manual) with no schema or placeholder failures. Because the schema has no `ansible_only` manual reason, Ansible-only rules use `no_check` and say why in the discussion. Commit: see `git log` (feat: import Windows CIS benchmarks from ansible-lockdown).
- 2026-11-24: Task 4 done. Generated the four releases online from the role tags (Windows 11 3.0.3: 540 rules, 483 automated; Server 2025 1.2.2: 462, 411; Server 2022 4.2.0: 444, 393; Server 2019 4.2.0: 433, 381), confirmed an offline rerun reproduces them byte for byte, credited the role and Audit repos in NOTICE and README (the Windows-11 Audit repo names a different company in its LICENSE), added vocabulary labels, committed-library tests and `webui/e2e/cis-windows.spec.ts`, and updated the e2e library-size and paging constants (3,177 to 5,056 rules). Full e2e passes against the running dev server. Commit: feat: add CIS Windows 11 and Server 2025, 2022 and 2019 from ansible-lockdown (this commit).
- 2026-11-24: Final-review fixes. Role defaults that are Jinja (the server 2.2.34 account list) no longer become ODVs or script text: those rules are manual with the original Ansible, and the normalizer fails the import if Jinja reaches an ODV default or generated registry/PowerShell. Audit rule ids must be dotted numbers. Tolerated `when` comparisons are checked against the role defaults. Number ODVs without a derived range get a minimum of 0 (and the registry type's maximum when written as DWORD/QWORD). `AUDIT|PATCH` style verbs parse and count as writes. Re-importing a stored tag with a different Audit commit fails unless `--replace-release` is passed. Comma-separated account ODVs are split in the generated PowerShell as Ansible does. Manual rules explain themselves in plain English, BitLocker and domain-scoped notes were added to the discussion, and benchmark friendly labels were added to `baselines/_vocabulary.json`. Regenerated the four releases offline (Windows 11: 540 rules, 483 automated, 57 manual; Server 2025: 462, 410, 52; Server 2022: 444, 392, 52; Server 2019: 433, 380, 53) and confirmed a second offline run changes nothing. Commit: fix: harden the lockdown importer after review (this commit).
- 2026-11-24: Commits for this plan: Task 1 `22b893b1` (log `7ce97ddf`), Task 2 `f4291552`, Task 3 `aaa7ea4a` and `3d717f16` (rules without a runnable check are manual), Task 4 `4e6a56d7`, final-review fixes `884b465f`. Scoped re-review clean; parked minors: profile cross-check against Audit meta, per-rule credit of the Audit rights holder, secedit temp folder ACL, title fallback ignoring AUDIT|PATCH tasks. Open: the user-rights and security-policy checks have not yet run elevated on Windows (maintainer run pending). e2e for cis-windows, smoke and provenance specs pass after the regeneration.
- 2026-11-24: Elevated run on Windows 11 by the maintainer of the generated checks for 1.1.1 (security policy), 2.2.1, 2.2.8, 2.2.21 (user rights) and 2.3.1.1 (registry): no script errors; 2.2.1, 2.2.8 and 2.2.21 compliant; 1.1.1 and 2.3.1.1 reported mismatches that match the machine (password history "None" against 24, NoConnectedUser unset against 3). The secedit-based checks therefore work elevated; fixes and Server hosts are still unverified.
