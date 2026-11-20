# Several Checks per Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `check[target]` becomes a list of check items (each today's check plus an optional `name`) across the schema, every importer, every committed release and the web UI, with behaviour unchanged for existing rules.

**Spec:** `docs/plans/2026-11-20-multiple-checks-design.md` (binding; read it).

## Global Constraints

- Rule schema version 7; a check item is `{name: string|null, language, default, by_version}`; `check[target]` has `minItems: 1`; `check` itself may still be `null`.
- Existing rules become one-item lists with `name: null`; nothing else in their content changes.
- The check that runs is the first item whose language the generator supports for the target (`bash`, `zsh` on macOS).
- Tasks 1 to 3 land as **one commit** at the end of Task 3 (web UI tests read the committed data). Tasks 1 and 2 leave their work uncommitted.
- Python `.venv/Scripts/python.exe -m pytest -W error -n auto` (`--all-releases` after regeneration; 3 known failures in `tests/test_github_fetch.py`). Web UI from `webui/`: `bun run test`, `bun run lint`, `bunx tsc -b`; e2e `PLAYWRIGHT_BASE_URL=http://localhost:5199 bun run test:e2e`.
- Dev server: the controller stops it before Task 1 regenerates data (Windows file handles) and restarts it before Task 3's e2e. Subagents never start or stop one.
- Commits: `type: summary`, body says why, no Co-Authored-By or AI attribution, explicit paths only (never `git add -A` or a directory), push; progress log in the design doc. Never use the em dash character.

---

### Task 1: Schema 7 and the Python side (uncommitted)

**Files:** `baselines/_rule.schema.json` (+ index schema version), `tools/library_output.py`, `tools/mscp_normalize.py`, `tools/cac_normalize.py`, `tools/odv_placeholders.py`, `tools/file_references.py`, `tools/overlays.py`, `tools/validate_library.py`, any other `tools/*.py` that reads `check`; their tests and fixtures (`tests/fixtures/overlays/cases.json` is shared with Vitest; Task 2 updates the TS side). Regenerate every source offline: `import_mscp.py`, `import_asd_ism.py`, `import_asd_e4eit.py`, `import_nist_800_53.py` (`--offline`), `import_cis_cac.py --benchmark cis_rhel9 --offline` and `cis_ubuntu2404`.

- [ ] **Step 1: Failing tests** for each design "Testing / Python" bullet, including a shared overlay case that `$append`s a check item and one that rejects `$merge` into a check list.
- [ ] **Step 2: Implement, regenerate, run** `--all-releases`. `git grep` for remaining single-check access patterns (`["check"][`, `.get("check")`) and report each was handled.
- [ ] **Step 3: Do not commit.**

### Task 2: Web UI logic (uncommitted)

**Files:** `webui/src/types/library.ts` (`Rule.check: Record<string, CheckItem[]> | null`, `CheckItem = TargetCheck & { name: string | null }`, schema 7), `logic/checkPlan.ts` (`generatedCheckItem(rule): CheckItem | null` = first runnable item on the generated target; replaces `generatedTargetCheck`), `logic/odv.ts`, `logic/chunking.ts`, supporting-check logic, `logic/manualAttestationReport.ts`, `logic/rulesJsonGen.ts`, `logic/changeLabels.ts`, `logic/ruleChanges.ts`, `logic/overlays.ts`, `logic/overlayShape.ts`, `logic/testRuleFixtures.ts`, and their tests (including `libraryData.test.ts` on the regenerated data).

- [ ] **Step 1: Failing tests** for the design's web UI bullets that are logic (first runnable item; labels "Check · macOS" with one item and "Check 2 · Windows" with two; overlay shape accepts a check list).
- [ ] **Step 2: Implement; `bun run test` and `bun run lint` pass (`tsc -b` may still fail in components).**
- [ ] **Step 3: Do not commit.**

### Task 3: Components, e2e and the combined commit

**Files:** `webui/src/components/rules/RuleCheckSection.tsx` (one selectable entry per item, labelled by `name` else language label, like the Remediation section), any other component reading `rule.check`, e2e specs.

- [ ] **Step 1: e2e:** existing check display and generation specs pass unchanged; new spec gives a rule a second check item via `page.route` and asserts two entries with their labels.
- [ ] **Step 2: Implement; run unit, lint, `tsc -b`, full e2e (rerun failures alone), and the Python suite with `--all-releases`.**
- [ ] **Step 3: Screenshots** of a one-item and a two-item check section at about 375px and 1440px; look at them.
- [ ] **Step 4: Commit** Tasks 1 to 3 as `feat: allow several checks per platform`, explicit paths only (build the list from `git status`; the working tree holds only this plan's changes), design `Status: Implemented`, progress log; push.
