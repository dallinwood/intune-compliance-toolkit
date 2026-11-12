# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Ctrl+K / Cmd+K palette, also opened from a header button, that searches views, frameworks and every current rule by id or title and jumps there in one history entry.

**Architecture:** A pure module `webui/src/logic/commandPalette.ts` builds entries, ranks matches and recognises the shortcut. A `CommandPalette` component composes Base UI `Dialog` (via `webui/src/components/ui/dialog.tsx`) and inline `Autocomplete`, mounted once in `AppShell` with a header trigger.

**Tech Stack:** React 19, TypeScript, Tailwind, Base UI (installed), Vitest, Playwright. Run with Bun, except `test:e2e`, which needs real Node.

**Spec:** `docs/plans/2026-11-12-command-palette-design.md`

**Depends on:** nothing unlanded. Works before or after `docs/plans/2026-11-12-release-links-plan.md`.

## Global Constraints

- No new dependencies. Use `@base-ui/react` as installed (1.7.0); do not upgrade it in this work.
- Never use the em dash character (U+2014) in code, copy or comments.
- Code style: full descriptive names, no single-letter variables, comments only for a non-obvious "why"; match the surrounding code's idioms.
- Every jump is a single `useFilterStore` `set` (one address write, one history entry).
- The shortcut never fires with Alt or Shift, during IME composition, or while another dialog is open.
- Existing e2e specs pass unchanged.
- E2e assertions never hard-code rule totals; pick rule ids from `baselines/_manifest.json` and release indexes with `readFileSync`, as `frameworks.spec.ts` does.
- Verification before calling a UI task done: `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e` against a dev server (`bun run dev -- --port 5199 --strictPort`, then `PLAYWRIGHT_BASE_URL=http://localhost:5199`), plus ad hoc screenshots at 375px and 1280px in light and dark mode, read with the Read tool (`.claude/CLAUDE.md`).
- Commit and push after each task (branch `macos-compliance-framework-rebase`). Stage files by explicit path; other agents may have uncommitted changes. No `Co-Authored-By` or other AI attribution lines.
- Add an entry to this plan's `## Progress log` in each task's commit.

## Review Focus

- **Accessibility.** Combobox, listbox and option roles; `aria-activedescendant` moves with the arrows; the result count is announced; focus returns on close.
- **History.** One Back press undoes a jump.
- **375px.** The dialog fits with a 16px gutter; long ids wrap; the header button does not push the title off screen.

---

### Task 1: Palette logic and one-step framework navigation

**Files:**
- Create: `webui/src/logic/commandPalette.ts`, `webui/src/logic/commandPalette.test.ts`
- Modify: `webui/src/state/filterStore.ts` (`showComparison` also sets `view: 'frameworks'` in the same `set`)

**Interfaces:** exactly design section 6.

**Exact behaviour:**
- `buildPaletteEntries`: views in given order, then frameworks in manifest order, then rules sorted by full id. Match texts, lower-cased: view `"<label> <id>"`; framework `"<display_name> <short label> <name>"`; rule `"<full id> <upstream id> <title> <source label>"`. `upstreamId` via `upstreamRuleId`.
- `normalizeQuery`: lower-case, trim, collapse runs of whitespace to one space.
- `searchPalette`: empty normalised query returns all views and frameworks, no rules, `totalRuleMatches` 0. Otherwise an entry matches when each space-separated query word is a substring of `matchText`; views and frameworks keep order; rules ranked by the tiers in design section 4 (tiers compare the whole normalised query against the lower-cased upstream id, full id and title), then upstream id with `localeCompare(other, 'en', { numeric: true })`, then full id; `rules` holds the first `ruleLimit` (default `RULE_RESULT_LIMIT`), `totalRuleMatches` all of them.
- `resultStatus`: total = views + frameworks + rules shown. 0 gives "No matches"; when `totalRuleMatches > rules.length`, "Showing <rules.length> of <totalRuleMatches> rules; keep typing to narrow"; else "<total> result" or "<total> results".
- `isPaletteShortcut`: `(ctrlKey || metaKey) && !altKey && !shiftKey && !isComposing && !defaultPrevented && key.toLowerCase() === 'k'`.
- `isApplePlatform`: true when `/Mac|iPhone|iPad|iPod/` matches `platform`, or `platform` is empty and it matches `userAgent`.

- [ ] **Step 1: Write the failing tests:**
  - `builds view, framework and rule entries with keys and match texts`
  - `an empty query lists views and frameworks only`
  - `every query word must match, in any order`
  - `an exact upstream id ranks first, then id prefix, title prefix, id substring, others`
  - `ties sort by upstream id with numeric order`
  - `rules are capped at the limit with the full match count`
  - `resultStatus covers none, singular, plural and capped`
  - `isPaletteShortcut accepts Ctrl+K and Cmd+K, rejects Alt, Shift, composing and prevented`
  - `isApplePlatform detects Mac and iOS platforms and falls back to the user agent`
- [ ] **Step 2: Run to verify failure.** `cd webui && bunx vitest run src/logic/commandPalette.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and change `showComparison` in `filterStore.ts`.
- [ ] **Step 4: Run to verify pass**, then `bun run test`, `bun run lint`, `bunx tsc -b`, and `bunx playwright test e2e/frameworks.spec.ts` (with real Node, as `test:e2e` does) to confirm the store change keeps the Frameworks tab working.
- [ ] **Step 5: Commit**: `feat: add command palette search logic`

### Task 2: Palette component, header button and shortcut

**Files:**
- Create: `webui/src/components/layout/CommandPalette.tsx`, `webui/e2e/command-palette.spec.ts`
- Modify: `webui/src/components/layout/AppShell.tsx`

**Interfaces:**
- Produces: `export function CommandPalette({ rows, sources, onNavigate }: { rows: RuleRow[]; sources: ManifestSource[]; onNavigate: () => void })`, rendering both the header trigger button and the dialog, and registering the `window` `keydown` listener (removed on unmount).
- Consumes: Task 1's exports; `VIEWS` from `webui/src/views/viewRegistry.tsx`; `useVocabularyIndex` and `termLabel(index, 'sources', name)`; `useFilterStore` `setView`, `showComparison`, `showRuleFromComparison`; `upstreamRuleId`; `Dialog`, `DialogContent`, `DialogTitle`, `DialogDescription` from `@/components/ui/dialog`; `Autocomplete` from `@base-ui/react/autocomplete`.

**Exact behaviour:** design section 5. Notes:
- Entries come from `useMemo(() => buildPaletteEntries(...), [rows, sources, vocabularyIndex])`; results from `searchPalette(entries, query)` per render.
- `Autocomplete.Root` with `inline`, `open` bound to the dialog's open state, `items` the flattened shown results, `filter={null}`, `autoHighlight`, `value`/`onValueChange` bound to the query, `itemToStringValue` giving the entry's label; activation via each item's `onClick` (Base UI items also fire click on Enter for the highlighted item; confirm in Step 1).
- The other-dialog check: `document.querySelector('[data-slot="dialog-content"]:not([data-command-palette])') !== null` means ignore the shortcut.
- In `AppShell`, render `<CommandPalette rows={rows} sources={sources} onNavigate={() => setIsReviewingSelection(false)} />` in the header, on every view, after the existing right-hand group; keep the header's `flex-wrap`.

**Tests (`webui/e2e/command-palette.spec.ts`):**
- `Ctrl+K opens the palette with the input focused and Escape closes it, returning focus`
- `the header Search button opens the palette`
- `typing an ISM upstream id and pressing Enter opens that rule on the Rules tab`, then `page.goBack()` returns to the previous address.
- `choosing a framework opens its comparison on the Frameworks tab` (ASD ISM: URL has `framework=asd_ism`).
- `choosing the Coverage view switches to it`
- `the result list exposes combobox, listbox and option roles and announces a count`
- `Ctrl+K does nothing while another dialog is open` (open the footer's third-party packages dialog first).
- `a query with no matches says No matches`
- Ad hoc screenshots: a scratchpad Playwright script at 375x800 and 1280x900, light and dark: the header at rest, the palette open with "ism" typed (all groups may not appear; also capture an empty query showing Views and Frameworks), and "No matches". Read each PNG.

- [ ] **Step 1:** Read the Base UI Autocomplete docs for 1.7 (https://base-ui.com/react/components/autocomplete) on inline lists inside a Dialog, grouping and Enter activation. If inline grouped results cannot be done, build the list by hand following the WAI-ARIA combobox pattern (input `role="combobox"`, `aria-controls`, `aria-activedescendant`; `role="listbox"` with `role="option"` items and `role="group"` sections), and record the switch in the progress log.
- [ ] **Step 2:** Write `command-palette.spec.ts`; run it; expect failures.
- [ ] **Step 3:** Build `CommandPalette` and wire it into `AppShell`.
- [ ] **Step 4:** Run `bun run test`, `bun run lint`, `bunx tsc -b`, `bun run test:e2e`. Expected: all pass.
- [ ] **Step 5:** Screenshots; read them; fix and repeat.
- [ ] **Step 6: Commit**: `feat: add a Ctrl+K command palette`

### Task 3: Documentation

**Files:**
- Modify: `README.md` (the web UI feature list: Ctrl+K or Cmd+K, or the Search button, jumps to any rule by id or title, any framework's release comparison, or any view), `docs/2026-11-11-ciso-assistant-analysis.md` (mark idea 5 built, with the Task 2 commit hash), the design's Status line.

- [ ] **Step 1:** Write the README text. Plain prose, no em dashes.
- [ ] **Step 2:** Update the analysis doc and the design status.
- [ ] **Step 3: Commit**: `docs: describe the command palette`

## Progress log
