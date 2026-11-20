# CIS Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the loose ends found after the CIS ComplianceAsCode import: an `instructions` language for plain-English checks and fixes, markdown rendering of CIS discussions, and two failing e2e specs.

**Specs:** `docs/plans/2026-11-20-instructions-language-design.md` (Task 1); this plan's task text for Tasks 2 and 3 (maintainer decisions recorded inline). Background: `docs/plans/2026-11-18-cis-complianceascode-source-design.md`.

## Global Constraints

- Python from the repo `.venv` (`.venv/Scripts/python.exe -m pytest -W error -n auto`); 3 known failures in `tests/test_github_fetch.py` are not ours, add none.
- Web UI from `webui/`: `bun run test`, `bun run lint`, `bunx tsc -b`; e2e `PLAYWRIGHT_BASE_URL=http://localhost:5199 bun run test:e2e`. The controller owns the dev server on 5199; never start or stop one. It copies baselines at start, so after regenerating data the controller restarts it before e2e.
- Any visual change: Playwright screenshots at about 375px and 1440px, looked at with the Read tool (`.claude/CLAUDE.md`).
- Commits: `type: summary`, body says why, no Co-Authored-By or AI attribution, explicit paths only, push. Progress log entry in the task's spec/design doc.
- Never use the em dash character.

---

### Task 1: The `instructions` language

Implements `docs/plans/2026-11-20-instructions-language-design.md` in full.

**Files:** `baselines/_rule.schema.json` (language enum plus the `instructions` constraints for check entries and remediation steps); `tools/cac_normalize.py` (audit language, `check: null` when no linked rule has OCIL, `instructions` step for a rule without a fix); web UI types (`webui/src/types/library.ts`), `webui/src/logic/overlayShape.ts`, `webui/src/logic/targetDisplay.ts` / `codeLanguage.ts` (label "Instructions", no syntax highlighting), `webui/src/components/rules/RuleCheckSection.tsx` and `RuleRemediationSection.tsx` (render `additional_info` as prose for `instructions`, replacing Task 8's "Audit" pill with "Instructions"), `webui/src/logic/checkPlan.ts` (an `instructions` check is never generated or automatable); regenerate `baselines/cis_rhel9` and `baselines/cis_ubuntu2404` with `--offline`.

- [ ] **Step 1: Failing tests:** schema accepts `instructions` with `shell: null`, no `shell_file`, `result: null`, and rejects it with a `shell`, `shell_file` or `result` (check and step); `test_cac_normalize.py`: the audit uses `instructions`, a control whose linked rules have no OCIL gets `check is None`, the step for `rule_without_fix_or_ocil` uses `instructions`, bash fixes stay `bash`; Vitest: label "Instructions", `planRuleCheck` treats an `instructions` check as no check.
- [ ] **Step 2: Implement, regenerate both CIS releases offline, run Python and web UI suites.**
- [ ] **Step 3: Commit** `feat: add an instructions language for plain-English checks and fixes`. The controller then restarts the dev server; take screenshots of `cis_rhel9.5.1.20` and `cis_rhel9.1.1.1.3` (Check and Fix sections) at both widths and an mSCP rule with a bash check (unchanged), and report what they show.

### Task 2: Markdown discussions render code and bold

Maintainer-visible bug: CIS discussions (markdown) show raw ```` ``` ```` fences, backticks and `**Rationale:**`, because `parseMarkdownDiscussion` / `parseInline` in `webui/src/logic/discussionMarkup.ts` only support headings, bullets, paragraphs and links.

**Files:** `webui/src/logic/discussionMarkup.ts` (+ test), `webui/src/components/rules/DiscussionText.tsx` if a new segment kind needs rendering.

- [ ] **Step 1: Failing tests** in `discussionMarkup.test.ts` (markdown format): a fenced block (```` ``` ```` with optional language) becomes a `code` block with its exact text; `` `x` `` becomes a `code` segment; `**Rationale:**` becomes a strong/emphasis segment (add a `strong` kind if emphasis is semantically wrong); existing asciidoc and markdown cases unchanged.
- [ ] **Step 2: Implement; run the web UI suite.**
- [ ] **Step 3: Screenshot** the discussion of the RHEL 9 rule linking `accounts_password_pam_minlen` at both widths; confirm no raw markdown remains.
- [ ] **Step 4: Commit** `fix: render code blocks, inline code and bold in markdown discussions`.

### Task 3: Sidebar scroll and the go-back scroll spec

- **Sidebar (maintainer decision 2026-11-20):** the filter sidebar scrolls vertically on its own when its content is taller than the space available, instead of requiring the filter list to fit. Replace the e2e assertion in `webui/e2e/filter-sidebar.spec.ts` ("the filter list fits the sidebar on the full library, so only the table scrolls") with: the sidebar scroll area can scroll vertically when its content overflows, and scrolling it does not scroll the table, and vice versa. Record the decision in the progress log of `docs/plans/2026-10-22-sidebar-scroll-and-severity-plan.md`.
- **Go-back spec:** `webui/e2e/mappings.spec.ts` "going back to a rule link scrolls that rule into view" fails consistently since the CIS data was added. First check whether it also fails at commit `bb091879` (before the CIS import) by reading what the test relies on (rule position, page size, sort); then fix the cause (app or test) and explain which it was.
- **`&rule=` on framework pages:** Task 8 reported that a `&rule=` URL parameter does not open a rule on framework pages. Determine whether that was ever supported (read the routing code and e2e specs); if it never was, report it without changing anything; if it regressed, fix it with a test.

- [ ] **Step 1: Write or adjust the specs; run them; implement; run the full e2e suite once and rerun failures alone.**
- [ ] **Step 2: Screenshot** the rules page with the sidebar scrolled at 1440px and at a short height (e.g. 1440x700), and at 375px.
- [ ] **Step 3: Commit** `fix: let the filter sidebar scroll and keep the go-back scroll working`.

### Task 4: mSCP text-only remediation steps use `instructions`

Maintainer request (2026-11-20): other frameworks with plain-English steps must use `instructions` too (e.g. `mscp.os_external_storage_access_defined`, whose Fix shows a Bash pill over "This is implemented by Declarative Device Management (DDM)."). Measured on the committed data: mSCP has 84 remediation steps with `shell: null` and no `shell_file`, all `bash`; no mSCP check is scriptless; ASD ISM, ASD E4EIT, NIST 800-53 and the overlays have none. Needs Task 1 (the schema value). Runs alongside Task 2 (disjoint files).

**Files:** `tools/mscp_normalize.py` (a remediation step with no `shell` and no `shell_file` gets `language: "instructions"`; same rule for a check entry, should one ever appear), `tests/test_mscp_normalize.py`; regenerate both stored mSCP releases (`.venv/Scripts/python.exe tools/import_mscp.py --offline`); update any web UI test or e2e expectation that pins the Bash label on such a step.

- [ ] **Step 1: Failing test:** a mSCP rule whose fix is a profile/DDM payload gets a step with `language == "instructions"`; a step with a real `shell` keeps `bash`.
- [ ] **Step 2: Implement, regenerate, run** `.venv/Scripts/python.exe -m pytest -W error -n auto --all-releases` and the web UI unit suite. Confirm with a script that no committed rule of any source has a `bash`/`zsh`/`powershell`/`python` check or step without a script.
- [ ] **Step 3: Commit** `fix: mark mSCP plain-English remediation steps as instructions`. The controller restarts the dev server and screenshots `mscp.os_external_storage_access_defined` at both widths.
