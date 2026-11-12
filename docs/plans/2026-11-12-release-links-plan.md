# Release Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each release pill on the Frameworks tab open the comparison with the release before it, remove the "Compare releases" button, and add an "Empty release" baseline so a first release (and a single-release framework) opens the same view with every rule added.

**Architecture:** A pure module `webui/src/logic/releaseRange.ts` owns the empty-release tag, range resolution, labels and the comparison address; `compareReleases` learns the empty baseline. `FrameworkCards`, `FrameworksView`, `ReleaseComparisonView` and `ComparisonSidebar` use them.

**Tech Stack:** React 19, TypeScript, Tailwind, Vitest, Playwright. Run with Bun, except `test:e2e`, which needs real Node.

**Spec:** `docs/plans/2026-11-12-release-links-design.md`

**Depends on:** nothing unlanded.

## Global Constraints

- No new dependencies.
- Never use the em dash character (U+2014) in code, copy or comments.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why"; match the surrounding code's idioms.
- Existing comparison addresses keep working unchanged; all existing `frameworks.spec.ts` tests pass unchanged except the one that pressed "Compare releases", which Task 2 rewrites.
- E2e assertions never hard-code rule totals or release tags; read them from `baselines/_manifest.json` and the published history index, as `frameworks.spec.ts` does.
- Verification before calling a UI task done: `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`), plus ad hoc screenshots at 375px and 1280px in light and dark mode, read with the Read tool (`.claude/CLAUDE.md`).
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; other agents may have uncommitted changes. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` in each task's commit.

## Review Focus

- **Default range.** An address with no or an invalid range still opens previous-to-current for multi-release frameworks; only single-release ones default to the empty release.
- **Accessibility.** Pill links have names starting with their visible text and a visible focus ring.
- **375px.** Pills and the hint line wrap without horizontal scroll; the comparison heading and the empty-release line wrap.

---

### Task 1: Empty-release logic

**Files:**
- Create: `webui/src/logic/releaseRange.ts`, `webui/src/logic/releaseRange.test.ts`
- Modify: `webui/src/logic/historyIndex.ts`, `webui/src/logic/historyIndex.test.ts`

**Interfaces:** exactly design section 6.

**Exact behaviour:**
- `isEmptyRelease(tags, tag)`: `tag === EMPTY_RELEASE_TAG && !tags.includes(EMPTY_RELEASE_TAG)`.
- `previousReleaseTag(tags, tag)`: position 0 gives `EMPTY_RELEASE_TAG`; position p > 0 gives `tags[p - 1]`; absent gives `null`.
- `resolveComparisonRange(tags, from, to)`: throws `Error` for an empty list. When `to` is a real tag and either `from` is a real tag before it or `isEmptyRelease(tags, from)`, returns `{ fromTag: from, toTag: to }`. Otherwise the default: `{ fromTag: tags.at(-2), toTag: tags.at(-1) }` with two or more tags, `{ fromTag: EMPTY_RELEASE_TAG, toTag: tags[0] }` with one.
- `releaseLabel(releases, tag)`: `EMPTY_RELEASE_LABEL` when `isEmptyRelease` holds for the releases' tags; else the release's label; else the tag.
- `comparisonLocation(sourceName, range, basePath)`: `serializeUrlLocation({ ...parseUrlState(''), view: 'frameworks', framework: sourceName, compareFrom: range.fromTag, compareTo: range.toTag }, { automation: DEFAULT_AUTOMATION, size: DEFAULT_PAGE_SIZE }, basePath)`.
- `compareReleases(index, fromTag, toTag)`: when `isEmptyRelease(index's tags, fromTag)`, every rule's before is `null`, To must be a real tag (throw as today otherwise), and the result is every rule present in To under `added`, sorted by id. Any other input behaves exactly as today.

- [ ] **Step 1: Write the failing tests:**
  - `previousReleaseTag gives the release before, empty for the first, null for an unknown tag`
  - `resolveComparisonRange keeps a valid real range and a valid empty range`
  - `resolveComparisonRange defaults to the last two releases, or empty to the only release`
  - `resolveComparisonRange falls back when From is after To or a tag is unknown`
  - `a real release tagged empty wins over the empty baseline`
  - `releaseLabel names the empty release and falls back to the tag`
  - `comparisonLocation writes framework, from and to in the frameworks path`
  - `compareReleases from the empty release lists every rule in To as added and nothing else`
  - `compareReleases from the empty release leaves out rules absent from To`
- [ ] **Step 2: Run to verify failure.** `cd webui && bunx vitest run src/logic/releaseRange.test.ts src/logic/historyIndex.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass**, then `bun run test`, `bun run lint`, `bunx tsc -b`.
- [ ] **Step 5: Commit**: `feat: add an empty-release baseline for release comparisons`

### Task 2: Clickable release pills and empty-release comparisons

**Files:**
- Modify: `webui/src/components/frameworks/FrameworkCards.tsx`, `webui/src/views/FrameworksView.tsx`, `webui/src/components/frameworks/ReleaseComparisonView.tsx`, `webui/src/components/frameworks/ComparisonSidebar.tsx`, `webui/e2e/frameworks.spec.ts`

**Interfaces:**
- Consumes Task 1's exports, `useFilterStore` `showComparison`, and `import.meta.env.BASE_URL` for `comparisonLocation`.

**Exact behaviour:** design section 5, in particular:
- `FrameworkCards`: remove the button, `ONLY_ONE_RELEASE` and the `previous` variable; add the hint line `Choose a release to see what changed in it.` (`text-sm text-muted-foreground`); each pill is `<li><a href aria-label onClick>`, with the click handler skipping modified and non-left clicks (reuse the `isPlainClick` shape from `ReleaseComparisonView.tsx`; move it to `webui/src/lib/utils.ts` as `isPlainLeftClick(event)` and use it in both places and in `ViewTabs.tsx`).
- `FrameworksView`: render `ReleaseComparisonView` whenever the source exists.
- `ReleaseComparisonView`: delete `resolvedRange`; use `resolveComparisonRange(history.releases.map((release) => release.tag), compareFrom, compareTo)` and `releaseLabel`; when `isEmptyRelease` holds for From, render below the heading `<p className="text-sm text-muted-foreground">Compared with an empty release, so every rule in {toLabel} is listed as added.</p>`.
- `ComparisonSidebar`: Framework select lists every source; `changeFramework` opens `resolveComparisonRange(tags, null, null)` of the chosen source; From select's first option is `<option value={EMPTY_RELEASE_TAG}>{EMPTY_RELEASE_LABEL}</option>` followed by today's options; `changeFrom(EMPTY_RELEASE_TAG)` keeps To; `laterReleases` is every release when From is empty.

**Tests (`webui/e2e/frameworks.spec.ts`):**
- Replace `Compare releases opens the comparison from the previous release to the current one` with `pressing the current release opens its comparison with the release before it` (same URL and Back assertions, pressing the link named starting with the current label).
- `pressing a middle release compares it with the release before it` (ISM's second-to-last release).
- `pressing the first release compares it with an empty release, so every rule is added`: URL has `from=empty&to=<first tag>`; heading has "Empty release to"; the explanatory line is visible; the Added tile equals the number of rules whose first `versions` entry is non-null in the published ISM history index; the other three tiles are 0.
- `a single-release framework's release opens its comparison`: NIST SP 800-53 pill, `from=empty`, Added equals `rule_count` from the manifest.
- `the cards have no Compare releases button`.
- `the From select offers Empty release and choosing it lists every rule in To as added`.
- `the Framework select lists every framework`.
- `an empty-release address survives a reload`.
- Ad hoc screenshots: a scratchpad Playwright script at 375x800 and 1280x900, light and dark, of `/frameworks` and of `/frameworks?framework=asd_ism&from=empty&to=<first tag>`. Read each PNG; check pill wrapping, focus ring (tab to a pill before capturing one shot), heading and line wrapping.

- [ ] **Step 1:** Write the e2e changes; run them; expect failures.
- [ ] **Step 2:** Move `isPlainLeftClick` to `lib/utils.ts` and update its callers; `bun run test:e2e` still passes for the untouched specs.
- [ ] **Step 3:** Implement the card, view, comparison and sidebar changes.
- [ ] **Step 4:** Run `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e`. Expected: all pass.
- [ ] **Step 5:** Screenshots; read them; fix and repeat.
- [ ] **Step 6: Commit**: `feat: open a release's changes from its pill on the Frameworks tab`

### Task 3: Documentation

**Files:**
- Modify: `README.md` (section "Releases, history and comparing frameworks": the Frameworks tab bullet says each release opens what changed in it against the release before, the first release compares with an empty release so everything is added, and the From select offers "Empty release"), the design's Status line.

- [ ] **Step 1:** Write the README text. Plain prose, no em dashes.
- [ ] **Step 2:** Update the design status.
- [ ] **Step 3: Commit**: `docs: describe release links on the Frameworks tab`

## Progress log
