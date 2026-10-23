# ISM UI (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web UI handle the 1,143 ASD ISM rules properly. This means:
- a fast table;
- Target and Version filters with a "None" option;
- ISM benchmarks that can be reached in filters and the table;
- detail panels that render ISM content correctly;
- correct per-source credit everywhere.

**Architecture:**
- **Speed.** A profile (2026-10-23) found the cost is Base UI's `Checkbox` looking up its associated label on every render. That lookup is quadratic in DOM size with 1,493 row checkboxes. An explicit `aria-labelledby` skips the lookup. Measured counterfactual, production build: first load 1.3-1.9s -> 0.7-0.85s; clear search or uncheck a facet about 2.3s -> about 0.2s.
- **Filters.** Applicability gains a "scope key" for entries without a version, so benchmarks on unversioned entries (every ISM rule) flow through the same facet, filter and summary paths as versioned ones.
- **Text and credit.** The detail panel and attribution text stop assuming mSCP and macOS.

**Tech Stack:** React + TypeScript + zustand + Base UI + Tailwind; Vitest; Playwright; Bun. No new dependencies. ISM discussions use only bullet lists (104 of them) and `[text](https://...)` links (29); a small extension of `logic/discussionMarkup.ts` covers that.

**Spec:** `docs/plans/2026-10-22-asd-ism-source-design.md`, sections 4 (filtering on null), 8 (web UI) and 11 (phase 3, including every gap recorded there on 2026-10-23).

## Global Constraints

- **No new dependencies.** No new generated data, and no schema change except the vocabulary-schema pattern in Task 2.
- **Facet titles:** "Platform" becomes **"Target"** and "macOS version" becomes **"Version"**. The other facet titles are unchanged.
- **"None" options:**
  - The Target facet offers **"None"** for rules with an applicability entry whose `target` is `null`.
  - The Version facet offers **"None"** for rules with an entry whose `version` is `null`.
  - A rule with a null target or version does not match a specific target or version selection. It matches "None".
  - "None" sorts last in its facet.
- **Sentinels.** Exported from `webui/src/logic/applicability.ts`:
  - `NO_TARGET_KEY = 'none'` and `NO_VERSION_KEY = 'none'`. Version keys always contain a space and targets are display words, so neither collides.
  - Their facet label is the literal `None`, applied in code, not from the vocabulary.
- **Benchmarks on unversioned entries** are reachable in the Benchmark facet, the filter and the table's benchmark column. For example, an ISM row shows `ISM Non-classified · ISM OFFICIAL: Sensitive · ...` in vocabulary order.
- **Table benchmark cell:** shows "No version listed" only when the row has no versioned entries and no benchmarks at all. Today that is the two mSCP rules `os_firewall_log_enable` and `os_gatekeeper_rearm`. It shows "Not in a benchmark" when it has versions but no benchmarks in scope.
- **Detail panel:**
  - **Breadcrumb:** `section_path` joined with ` › ` (U+203A), shown above the discussion.
  - **Revision line:** `Revision {upstream_revision}, updated {upstream_updated}`, showing only the non-null parts, and nothing when both are null (all mSCP rules).
  - **Discussion:** `discussion_format: "markdown"` renders `- ` lines as a bulleted list and `[text](url)` as a link. Only `http:` and `https:` URLs become links, opened with `target="_blank" rel="noreferrer"`; anything else renders as plain text. `"asciidoc"` keeps today's renderer unchanged.
  - **Missing-version warning:** shown only when the rule has a `macOS` (`GENERATED_TARGET`) entry but no macOS version. The text becomes `No macOS version listed: the source does not map this rule to any macOS release.` ISM rules show no such warning.
- **Credit:**
  - **Per-rule line:** `From {source label} {release_tag} ({upstream_rule_id}), licensed {license}, modified for this tool.` The source label is `termLabel(index, 'sources', source.name)`.
  - **Vocabulary:** gains `{ "label": "NIST mSCP", "terms": ["mscp"] }` under `sources`, so mSCP rules read exactly as today, and the Source facet shows "NIST mSCP".
  - **Footer:** each line starts `Rules from the` instead of `macOS rules from the`.
  - **Manual attestation report:** ends with one attribution line per source with at least one entry in the report, ordered by source name, in the existing format `Rule content from the {display_name} ({repository_url}), licensed {license.name} ({license.url}). Content modified by this project.` The mSCP line must be byte-identical to today's constant. A report with no entries has no attribution block.
- **Search** strips any `<source>.` id prefix (use `upstreamRuleId`), not only `mscp.`.
- **Empty facets:** a facet group with no reachable options and nothing selected in it is not rendered. Example: Tags when filtered to ASD ISM.
- **Generator unchanged:** bundle bytes for mSCP-only selections are unchanged. The one exception is the attestation report attribution, which now lists only the sources present.
- **Verification:**
  - From `webui/`: `bun run test`, `bun run lint`, `bun run build`, `bun run test:e2e` with a dev server running.
  - Python: `python -m pytest -W error` whenever `baselines/` changes.
  - Per `.claude/CLAUDE.md`, every task that changes rendering takes Playwright screenshots at about 375px and about 1280px and looks at them with Read.
- **Commits:** subject is `type: summary`, with a why-body. No `Co-Authored-By` or AI attribution. No em dash (U+2014). Implementers commit only; the controller pushes.

## Review Focus

- **Selecting Version "None" alone** shows the 1,143 ISM rules plus the two version-less mSCP rules (1,145). Selecting Target "macOS" plus Version "None" shows only the two mSCP rules. Pinned in `ruleFilters.test.ts` and e2e (Task 2).
- **An ISM benchmark selection**, e.g. `Essential Eight ML3`, narrows the table to ISM rows only, and the Version facet still offers "None" while it is selected. Pinned in `ruleFilters.test.ts` and e2e (Task 2).
- **A Markdown link with a non-http URL** (`[x](javascript:alert(1))`) renders as text, not a link. Pinned in `discussionMarkup.test.ts` (Task 3).
- **A mixed selection** (one mSCP manual rule and one ISM rule) credits both sources in `manual-attestation.md`. An mSCP-only report keeps its exact current attribution text. Pinned in `manualAttestationReport.test.ts` and e2e (Task 4).
- **Interaction speed** after the checkbox fix: clearing a search on the full 1,493-row table repaints quickly enough that e2e runs in parallel again without timeouts (Task 1).

---

### Task 1: Row checkbox label lookup (table speed)

**Files:**
- Modify: `webui/src/components/rules/RuleTable.tsx` (row `Checkbox`, around line 121)
- Modify: `webui/playwright.config.ts` (the `workers: 1` block and its comment)

**Interfaces:** none new. The row checkbox's accessible name must stay exactly `Select {upstream id}`, because e2e selects rows by it.

- [ ] **Step 1: Measure the baseline.** Using a throwaway Node Playwright script in the plan workspace's `scratch/`, record:
  - time to `1493 of 1493 rules` on first load;
  - time to repaint after clearing a one-letter search;
  - time to repaint after unchecking a Source facet option.

  Take the median of 3 runs, in dev. If quick, also in a production build: `bun run build`, then `bun run preview --base /intune-compliance-toolkit/`. In Git Bash, set `MSYS_NO_PATHCONV=1`.
- [ ] **Step 2: Give each row checkbox an explicit label element.** Render a visually hidden span (`className="sr-only"`) with the text `Select {upstreamRuleId(row.ref.id)}` and an id from React `useId()`. Pass `aria-labelledby={thatId}` to the `Checkbox`, and remove its `aria-label`.
- [ ] **Step 3: Re-measure** with the same script. Expected: a clearly lower first load and interaction latency, in line with the counterfactual above. Record both sets of numbers in the report.
- [ ] **Step 4: Restore parallel e2e.** Remove `workers: 1` and its comment, then run `bun run test:e2e` three times in a row.
  - If all three pass, keep the default workers.
  - Otherwise set `workers` to the highest value that passes three consecutive runs, with a comment giving the measured reason.
- [ ] **Step 5:** Run `bun run test && bun run lint && bun run build`, take screenshots, and confirm the table looks unchanged.
- [ ] **Step 6: Commit** `perf: give row checkboxes an explicit label so the table stays fast`. The body includes the before and after numbers.

### Task 2: Target and Version "None", and benchmarks on unversioned entries

**Files:**
- Modify: `webui/src/logic/applicability.ts`, `applicability.test.ts`
- Modify: `webui/src/types/rule-row.ts`, `webui/src/data/ruleRows.ts`, `ruleRows.test.ts`
- Modify: `webui/src/logic/ruleFilters.ts`, `ruleFilters.test.ts`
- Modify: `webui/src/logic/ruleDisplay.ts`, `ruleDisplay.test.ts`
- Modify: `webui/src/components/filters/FilterSidebar.tsx` and its stable facet group component (empty-facet rule)
- Modify: `webui/src/components/rules/RuleTable.tsx` (`BenchmarkText`)
- Modify: `baselines/_vocabulary.schema.json`: `versions` terms must match `^\S.* \S+(?![\s\S])`, i.e. a target, a space, then a version
- Modify: `webui/e2e/smoke.spec.ts`

**Interfaces:**
- Produces, in `applicability.ts`:
  - `NO_TARGET_KEY` and `NO_VERSION_KEY`.
  - `scopeKeysOf(applicability: Applicability): string[]`: version keys sorted with `compareVersionKeys`, followed by `NO_VERSION_KEY` if any entry has a null version.
  - `benchmarksAt(applicability, key)`: for `NO_VERSION_KEY`, returns the concatenated benchmarks of every null-version entry, de-duplicated by name and severity.
  - `targetKeysOf(applicability: Applicability): string[]`: targets, with `null` mapped to `NO_TARGET_KEY`.
  - `compareScopeKeys(left, right)`: version-key order, with `NO_VERSION_KEY` last.
  - `parseVersionKey(key)`: on a key with no space, returns `{ target: '', version: key }` instead of slicing wrongly.
- `RuleRow`: `versionKeys` is replaced by `scopeKeys: string[]` (from `scopeKeysOf`), and `targets` becomes `targetKeys: string[]` (from `targetKeysOf`).
- `ruleFilters.ts`:
  - `targetGroupKeys` uses `targetKeys`; `NO_TARGET_KEY` passes through ungrouped.
  - `versionsUnder` and `versionsListingAnyOf` work on scope keys; `NO_VERSION_KEY` passes through ungrouped.
  - The benchmark helpers use `benchmarksAt` with scope keys.
- `benchmarkSummary(applicability, scopeKeysInScope, index)`: labels `NO_VERSION_KEY` as `None` where version labels are listed.
- Facet `labelOf` for Target and Version maps the sentinel to `None`; vocabulary otherwise.

- [ ] **Step 1: Write the failing tests.**
  - `applicability.test.ts`:
    - an ISM-shaped applicability gives scope keys `['none']`, and `benchmarksAt` gives its benchmarks;
    - mixed macOS 27.0, macOS null and target-null entries;
    - `parseVersionKey('27.0')` returns `{ target: '', version: '27.0' }`.
  - `ruleFilters.test.ts`, with synthetic rows (one ISM-shaped, one version-less macOS, one macOS 27.0):
    - Version "None" matches the first two;
    - Target "None" matches only the ISM row;
    - Target macOS + Version None matches the version-less macOS row;
    - benchmark `e8_ml3` matches only the ISM row;
    - selecting `e8_ml3` keeps "None" reachable in the Version facet and removes macOS versions.
  - `ruleDisplay.test.ts`: `benchmarkSummary` on the ISM row lists its benchmarks in vocabulary order.
  - e2e:
    - facet titles `Target` and `Version`;
    - Version "None" gives `1145 of 1493 rules`;
    - Target "None" gives `1143 of 1493 rules`;
    - Benchmark `Essential Eight ML3` gives a non-zero count with only `ism-` ids visible;
    - an ISM row's benchmark cell contains `ISM Non-classified`;
    - with Source "ASD ISM" selected, the Tags facet heading is absent.
  - Update every e2e test that referenced `Platform` or `macOS version` titles.
- [ ] **Step 2: Run them to verify they fail** (`bun run test`, `bun run test:e2e`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Run the full web suite plus `python -m pytest -W error` (the vocabulary schema changed). Take screenshots of the sidebar showing None options and of an ISM row with its benchmarks, and look at them.
- [ ] **Step 5: Commit** `feat: add None to the Target and Version filters and show ISM benchmarks`.

### Task 3: Rule detail panel for ISM content

**Files:**
- Modify: `webui/src/logic/discussionMarkup.ts`, `discussionMarkup.test.ts`
- Modify: `webui/src/components/rules/DiscussionText.tsx`
- Modify: `webui/src/components/rules/RuleDetailPanel.tsx` (breadcrumb, revision line; not the credit line, which is Task 4)
- Modify: `webui/src/components/rules/RuleCheckSection.tsx` (missing-version warning)
- Modify: `webui/e2e/smoke.spec.ts`

**Interfaces:**
- `discussionMarkup.ts` gains:
  - `parseMarkdownDiscussion(text: string): DiscussionBlock[]`
  - a new block kind `{ kind: 'list'; items: string[] }` (items are inline text, parsed with the same inline parser);
  - Markdown inline links `[text](url)`, recognised only for `http(s)` URLs.
- `DiscussionText` takes `format: 'asciidoc' | 'markdown'`, and `RuleDetailPanel` passes `rule.discussion_format`.

- [ ] **Step 1: Write the failing tests.**
  - `discussionMarkup.test.ts`:
    - the `ism-1803` statement (lead-in, 5 `- ` items, then a paragraph) parses to paragraph, list (5 items), paragraph;
    - `[ACSC](https://www.cyber.gov.au/)` becomes a link segment;
    - `[x](javascript:alert(1))` stays text;
    - the AsciiDoc parser's output is unchanged for an existing mSCP sample.
  - e2e:
    - `asd_ism.ism-1803` details show a `listitem` containing `to whom the cyber security incident was reported.`;
    - the breadcrumb `Guidelines for cyber security incidents › ...` is visible;
    - `Revision` text is visible;
    - no `No macOS version listed` text appears in the ISM detail panel;
    - `mscp.os_firewall_log_enable` details still show the macOS warning with the new wording, and no `Revision` text.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** with the full web suite. Take screenshots of the `ism-1803`, `ism-1667` and `mscp.audit_acls_folders_configure` details at 375px and 1280px, and look at them.
- [ ] **Step 5: Commit** `feat: render ISM rule details with breadcrumb, revision and Markdown`.

### Task 4: Source-neutral credit and search

**Files:**
- Modify: `baselines/_vocabulary.json` (the `sources` entry for `mscp`)
- Modify: `webui/src/components/rules/RuleDetailPanel.tsx` (credit line)
- Modify: `webui/src/components/layout/AttributionFooter.tsx`
- Modify: `webui/src/logic/manualAttestationReport.ts`, `manualAttestationReport.test.ts`, `webui/src/logic/bundleFiles.ts`, `bundleFiles.test.ts`
- Modify: `webui/src/components/generate/GenerateReviewScreen.tsx` (pass the manifest sources through; they are already loaded in `App`)
- Modify: `webui/src/logic/ruleFilters.ts` (search prefix), `ruleFilters.test.ts`
- Modify: `webui/e2e/smoke.spec.ts` (the Source option `mscp` becomes `NIST mSCP`)

**Interfaces:**
- `buildManualAttestationMarkdown(entries: ManualAttestationEntry[], sources: ManifestSource[]): string` names a source by matching the entry id prefix `<source.name>.`.
- `buildBundleFiles(chunks: Chunk[], manualEntries: ManualAttestationEntry[], sources: ManifestSource[]): BundleFile[]`

- [ ] **Step 1: Write the failing tests.**
  - `manualAttestationReport.test.ts`:
    - an mSCP-only report ends with exactly today's attribution string;
    - an mSCP + ISM report has both lines, ordered `asd_ism` then `mscp`;
    - an empty report has no `---` attribution block.
  - `ruleFilters.test.ts`: searching `asd` does not match an ISM row whose title lacks "asd"; searching `1667` matches `asd_ism.ism-1667`.
  - e2e:
    - the `ism-1667` detail credit reads `From ASD ISM v2026.09.4 (ism-1667)`;
    - an mSCP detail still reads `From NIST mSCP release_27.0`;
    - the footer contains no `macOS rules`;
    - a mixed mSCP + ISM manual selection's `manual-attestation.md` contains both `ASD Information Security Manual` and `NIST macOS Security Compliance Project`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** with the full web suite and `python -m pytest -W error` (the vocabulary changed). Take screenshots of the footer and an ISM detail credit line, and look at them.
- [ ] **Step 5: Commit** `fix: credit each rule's own source in the UI and attestation report`.

## Progress log

- 2026-10-23: Plan written after profiling the 1,493-row table (no code yet).
