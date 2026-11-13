# UI Polish: Readability, Accessibility and Consistency Audit

Status: Implemented (every finding except P3-8, the phone header, which is deferred). See the plan's progress log for the commits.

Audit of the whole web UI (`webui/`, branch `macos-compliance-framework-rebase`, 2026-11-13) against the maintainer's goals: "a full readability and accessibility pass over the entire app", "making sure things look good, and consistent", and consistency of "how we do styling and formatting". Desktop (about 1280px) is the focus; mobile changes are included only where they cost desktop nothing.

The conventions the fixes converge on are in `docs/ui-style-guide.md`. The implementation order is in `docs/plans/2026-11-13-ui-polish-plan.md`.

## 1. Method

- Read `.claude/CLAUDE.md`, `webui/src/index.css` (tokens), `webui/src/components/ui/*` and every view's components.
- Screenshots with a throwaway Playwright script (run under Bun, scrollbars not hidden) at 1280x900 light and dark and 375px light and dark, of: Rules (table, filters, expanded sections, rule detail Details / Mapped rules with an indirect group / History tabs, an organization value), Generate (checks panel, supporting checks list, rule Details dialog), Coverage, Frameworks (cards, comparison, empty-release comparison), Licences, Products, the Sources & licences dialog and the command palette. Every screenshot was read. File names below are `<state>-<width>-<theme>.png`; they are not committed (scratch output), so re-create them with the plan's screenshot step.
- Accessibility: a DOM pass per view listing headings, landmarks and unnamed controls; a Tab walk through Rules, Frameworks, a release comparison and Licences recording the focused element and its focus indicator; contrast computed from the `oklch()` token values in `index.css` (converted to sRGB, WCAG 2.x relative luminance, alpha tokens composited on their surface).
- Code: grep tallies of radii, hard-coded palette colours, arbitrary values, local class constants, native `<button>`/`<select>` versus the shared components, empty and loading strings, and number formatting.

What is already good and should be kept: the token set in `index.css` is well commented and nearly all text tokens pass AA; every focusable control showed a visible focus ring in the Tab walk; landmarks (`header`, `nav "Views"`, `main`, `footer`) exist on every view; the rule status icons carry a non-colour mark; facet groups are labelled groups; the dark theme is complete (every app token has a dark value).

## 2. Findings

Priorities: **P1** must fix (maintainer-reported, or a real defect), **P2** should fix (visible inconsistency or an accessibility gap), **P3** nice to have.

### P1

#### P1-1. The icon key above the Rules table is cramped (maintainer-reported)

- **View / screenshot:** Rules; `rules-1280-light.png`, `rules-expanded-1280-dark.png`.
- **What it looks like:** "Key: automated check, manual, no platform, linked to automated rules, linked to manual rules" sits in a 20px strip jammed between the toolbar's bottom border and the first section band. Entries are 14px apart while each glyph's status mark overhangs its right edge by 4px, so a glyph reads as belonging to the previous label. "Key:" starts 8px right of the toolbar buttons above it.
- **Root cause:**
  - `webui/src/components/rules/RuleTable.tsx:161`: the legend wrapper is `px-4 pb-2 md:px-6`, no top padding, and sits directly under `SectionToolbar`'s `border-b ... py-2` (`SectionToolbar.tsx:12`), so it has no space above and only 8px before the `bg-section-1` band. Its `md:px-6` does not match the toolbar's `px-4`.
  - `webui/src/components/rules/RuleStatusLegend.tsx:17`: `gap-x-3.5` between entries is the same rhythm as the 6px glyph-to-label gap scaled up only slightly; the `StatusGlyph` mark (`StatusGlyph.tsx:16`, `-right-1`) eats part of it.
- **Fix:** Render the key inside the toolbar row instead of as its own strip: `SectionToolbar` takes an optional `trailing` slot rendered as `ml-auto`, and `RuleTable` passes `<RuleStatusLegend />` there. The row becomes `flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-2` (one gutter, see P2-11). In the legend: `gap-x-5 gap-y-1`, each entry `gap-2`, "Key" as `font-medium text-foreground` without the colon. At 1280px the two buttons and the key fit on one line (about 170px + 680px in a 1024px column); below that it wraps under the buttons with an 8px row gap. Keep `data-testid="rule-status-legend"`.

#### P1-2. Two vertical scrollbars on the Rules view (maintainer-reported)

- **View / screenshot:** Rules; `scroll-1280x800.png` (also at 1280x720, 1366x768, 1920x1080), and the same on a release comparison (`comparison-1280-light.png`) and Products (`products-1280-light.png`).
- **What happens:** The document itself never scrolls (`scrollHeight == clientHeight` at every size measured). Two sibling elements are scroll containers: the filter list (x 0-255, a 15px classic scrollbar at x 240-255) and `main` (x 256-1280). The sidebar's scrollbar sits mid-screen, flush against the table's left border, so it reads as a second page scrollbar.
- **Root cause (height chain):**
  1. `webui/src/components/layout/AppShell.tsx:86` pins the shell to the viewport (`flex h-screen flex-col`).
  2. `webui/src/views/RulesView.tsx:171` makes the view `flex-1 overflow-hidden`, so its children are clipped to the remaining 674px instead of growing the page.
  3. `webui/src/views/RulesView.tsx:175` gives `main` its own `overflow-y-auto`, and `webui/src/components/filters/FilterSidebar.tsx:146,152` stretches the `aside` to the same 674px and makes its list `min-h-0 flex-1 overflow-y-auto`.
  4. The filter list is 3,738px tall in a 610px box because every facet group (Automation, Target, Version, Source, Benchmark, Section, Tags) always lists every option; Section and Tags alone are about 70 rows on the full library. So the sidebar's scrollbar is always present at desktop sizes, not only in edge cases.
- **Fix (root cause, no hidden scrollbars):** keep the app-shell layout (the table's single scroller and sticky chrome are worth keeping) and make the sidebar's content fit it:
  - Make each facet group a disclosure (`FacetGroup`, `FilterSidebar.tsx:307`): the heading becomes a button with the shared chevron (P2-6), `aria-expanded`, and the options list in a region. Automation, Target and Source start open; Version, Benchmark, Section and Tags start closed; any group with a selected value is open and stays open. A closed group's heading shows the number selected ("Section (2 selected)") so filters never hide silently.
  - With that default the list is about 520px, inside the 610px available at 1280x800, so no sidebar scrollbar appears; the `overflow-y-auto` stays only as the fallback when someone opens several long groups at once, which is the one case a second scrollbar is warranted.
  - Add `scrollbar-gutter: stable` to `main` (a Tailwind arbitrary property in `RulesView.tsx:175`) so the table does not jump when its own scrollbar appears or goes.
  - Apply the same disclosure to `ComparisonSidebar.tsx:148-149` (Section and Benchmark start closed), which has the same structure and the same symptom.
  - Products and Licences navigation trees (`ProductsView.tsx:42`, `LicencesView.tsx:81`) are lists of destinations, not filters; their groups are already collapsible and default open for the vendor only. Leave them, but note they show a second scrollbar once several groups are opened.
- **Alternative considered and rejected:** make the document the only scroller (drop `h-screen`/`overflow-hidden`, sticky header and sidebar). It still needs a scrolling sidebar for 3,738px of filters, so on its own it does not remove the second scrollbar, and it touches every view's height chain. Also rejected: `scrollbar-width: none` on the sidebar, which hides the symptom and leaves keyboard and wheel users without a cue.
- **Tests:** existing e2e that tick Benchmark, Section or Tags options (`e2e/smoke.spec.ts:126`, `:168`, `:354` and others using `sidebar-scroll-area`) need a helper that opens the group first. Add an e2e that at 1280x800 the sidebar list has `scrollHeight <= clientHeight` on the full library, and that a group with a selection restored from the URL starts open.

#### P1-3. Remove "Expand one level" and "Collapse one level" (maintainer-reported)

- **Views / screenshots:** every location that has them:
  1. Rules table toolbar: `webui/src/components/rules/RuleTable.tsx:155-160` (handlers at `:156-157`) via `SectionToolbar`; `rules-1280-light.png`.
  2. Frameworks release comparison toolbar: `webui/src/components/frameworks/ReleaseComparisonView.tsx:338-343` (handlers at `:339-340`); `comparison-1280-light.png`, `comparison-empty-release-1280-light.png`. Here the one-level handlers are identical to Expand all / Collapse all (`groupsOpen.expand(shownGroupKeys)`), so the buttons are pure duplicates.
  - No other view has them: Coverage, Licences, Products, the Mapped rules tab and the Generate screen were checked (`grep -rn "one level"`).
- **Root cause:** `webui/src/components/rules/SectionToolbar.tsx:4-5,10,13-18` declares and renders the two buttons for every caller.
- **Fix:** delete the two props and buttons from `SectionToolbar` (keep `role="group" aria-label="Sections"`, Expand all, Collapse all), remove the props at both call sites, delete the now-unused `expandOneLevel` / `collapseOneLevel` from `webui/src/logic/sectionTree.ts:174-195` and their tests (`sectionTree.test.ts:7-8,174-217`), and the imports at `RuleTable.tsx:13-14`.
- **Tests:** `e2e/smoke.spec.ts:1027-1050` ("expand and collapse one level walk ...") is deleted; `e2e/smoke.spec.ts:1153` uses "Expand one level" as setup and switches to "Expand all" with its expected row and heading counts recomputed. Add an assertion that neither button exists on `/rules` or on a comparison.

#### P1-4. Status icon tooltips stay open and pile up down the column (maintainer-reported)

- **View / screenshot:** Rules; `tooltip-stacked-1280-light.png`. Reproduction: search "smartcard", Expand all, hover the status strip of eight rows in turn, move the pointer away. Nine tooltips remain open (`[role=tooltip]` count 9) and Escape closes none of them. Hovering a single icon and leaving it swaps its tooltip for the strip's combined tooltip, which then stays.
- **Root cause:** `webui/src/components/rules/RuleStatusIcons.tsx:42-45`. The strip's tooltip is controlled, and its change handler inverts closing:
  ```tsx
  onOpenChange={(isOpen, eventDetails) => setIsStripTooltipOpen(!isOpen || eventDetails.reason === 'trigger-focus')}
  ```
  Any close request (`isOpen === false`, from pointer leave, Escape, blur or outside press) evaluates to `true`, so a close opens the tooltip and nothing can close it again. Hover-opens are correctly refused, but the pointer leaving the strip sends a close, which opens it. Each row has its own controlled instance, so the provider's shared delay group (`RuleTable.tsx:170`) cannot help, and the open ones stack. Because all tooltip popups portal to `body` at the same `z-50`, whichever opened later paints on top: that is how a strip tooltip ("Linked to 2 manua...") ends up clipped under another popup such as the benchmark text tooltip ("CIS Level 1 · CIS Level 2 ...", `RuleRowCells.tsx:62`) in the next column.
  - Aggravating: each row renders the strip twice (`RuleTable.tsx:401-403` for phones, `md:hidden`, and `:406-407` for desktop), doubling the tooltip instances in the DOM.
- **Fix:**
  - Open only for keyboard focus, close for every close request:
    ```tsx
    onOpenChange={(isOpen, eventDetails) => setIsStripTooltipOpen(isOpen && eventDetails.reason === 'trigger-focus')}
    ```
    Move the decision into a pure function in `webui/src/logic/ruleStatusIcons.ts` (`stripTooltipShouldOpen(isOpen, reason)`) so Vitest pins it: open only for `true` + `'trigger-focus'`, closed for every `false` regardless of reason.
  - Only one tooltip at a time: move the single `TooltipProvider` from `RuleTable.tsx:170-178` to `AppShell` so every tooltip in the app (including the Mapped rules hover cards and catalog target icons, which today sit outside or inside different providers) shares one delay group. Uncontrolled Base UI tooltips close on pointer leave, Escape and blur by default; with the inverted handler gone nothing overrides that.
  - Layering and collision: give `TooltipContent` (`components/ui/tooltip.tsx:24`) `collisionPadding={8}` on the positioner and keep `side="top"`; with one tooltip open at a time nothing stacks over the benchmark column. No z-index change needed.
- **Every other tooltip checked for the same pattern:**
  | Location | Kind | Same bug? |
  | --- | --- | --- |
  | `RuleStatusIcons.tsx:18` per-icon tooltip | uncontrolled | No (closes on leave); nested inside the strip trigger, which is fine once the strip only opens on focus |
  | `RuleStatusIcons.tsx:42` strip tooltip | controlled | **Yes** (the bug above) |
  | `RuleRowCells.tsx:62` benchmark overflow text | uncontrolled, `disabled` when not overflowing | No |
  | `TargetIcons.tsx:21` check/fix target icons (rule detail, Mapped rules summary, Product detail) | uncontrolled | No, but `ProductDetail` renders them outside any `TooltipProvider` |
  | `MappedRuleGroup.tsx:171` mapped rule hover summary | uncontrolled | No |
  | Native `title` tooltips: `AssessmentBadge` (`RuleRowCells.tsx:27`), `CustomTag.tsx:7`, `LicenceList.tsx:57` needs-review dot, `AvailabilityBadge.tsx:67` | browser | No, but `title` is not shown on keyboard focus; acceptable for the badges (their text is visible), not for the needs-review dot (P2-13) |
- **Tests:** e2e in `rule-status-icons.spec.ts`: hover three strips in sequence then move away, expect `getByRole('tooltip')` count 0; focus a strip by Tab, expect its combined tooltip, press Escape, expect 0; focus then Tab away, expect 0; hover an icon, expect exactly one tooltip.

#### P1-5. Generate: the supporting checks list is one heavy card per row (maintainer-noted)

- **View / screenshot:** Generate with supporting checks on; `generate-full-1280-light.png`, `generate-supporting-1280-dark.png`. 63 rows at 93px each: about 5,900px of bordered cards, each with a full-width "Details" button on its own line, so six rows fill the screen.
- **Root cause:** `webui/src/components/generate/SupportingCheckRow.tsx:79` makes every row its own bordered card (`rounded border border-border bg-card px-3 py-2`); `:104-113` puts Change and Details on a separate line under the text; `SupportingChecksPanel.tsx:158` spaces the cards with `space-y-1.5`.
- **Fix:** One bordered list, rows separated by dividers: the `<ul>` becomes `divide-y divide-border rounded-lg border border-border bg-card`; each `<li>` is `flex items-start gap-3 px-3 py-2` with checkbox, a text column (id and title on line one, "Supports ..." muted on line two, value or chain lines only when present) and the actions on the right of line one (`ml-auto flex shrink-0 gap-1.5`, `Button variant="ghost" size="xs"`). The Change editor still opens under the row. Result: about 52px per row, 63 rows in about 3,300px, and the eye can scan the ids down one column. Keep `data-rule-id`, button names ("Change", "Details") and `aria-label="Include <id>"` so e2e selectors do not change.

#### P1-6. Coverage formats numbers two ways (maintainer-noted)

- **View / screenshot:** Coverage; `coverage-1280-light.png` shows "Supports 8 of 1143 controls"; after adding supporting checks the same card reads "of 1,143".
- **Root cause:** `webui/src/logic/selectionCoverage.ts:274` returns the old unformatted string when `coveredThroughSupporting === 0` and only the other branch uses `COUNT_FORMAT` (`:269`); `coverageBarLabel` (`:285`) does the same. The pinned test `selectionCoverage.test.ts:397-398` expects the unformatted form.
- **Fix:** one shared `formatCount` (new `webui/src/lib/format.ts`, `new Intl.NumberFormat('en-US')`) used in both branches of both functions, and the tests updated to "1,143". The same module replaces `NUMBER_FORMAT` in `SupportingChecksPanel.tsx:24` and is applied everywhere a count of rules or controls is shown (P2-10).

### P2

#### P2-1. "Note" severity chip text fails AA

- **Screenshot:** `generate-1280-light.png` ("Note" chip in Checks).
- **Root cause:** `webui/src/components/generate/GenerateChecksPanel.tsx:10` uses `bg-muted text-muted-foreground`: 4.39:1 in light (needs 4.5).
- **Fix:** use the secondary badge colours (`bg-secondary text-secondary-foreground`, 16.1:1) via `<Badge variant="secondary">`, the same as the other neutral tags.

#### P2-2. Coverage bars are nearly invisible

- **Screenshots:** `coverage-1280-light.png`, `coverage-1280-dark.png`.
- **Root cause:** `webui/src/components/selectionCoverage/CoverageBar.tsx:18-21`. Track `bg-muted` on the card's `bg-panel` is 1.05:1 (light) and 1.19:1 (dark), so the bar's extent cannot be seen; the "through supporting rules" segment `bg-primary/50` on the track is 1.65:1 (light) and 1.53:1 (dark); in dark the solid segment `bg-primary` on the track is 2.05:1. WCAG 1.4.11 asks 3:1 for graphics needed to understand content. The text next to each bar carries the numbers, so this is a readability gap more than a blocker.
- **Fix:** add meter tokens to `index.css` (`--meter-track`, `--meter-fill`, `--meter-fill-secondary`, plus `@theme` entries): track as `--control-border` at about 35% (visible edge), fill as `--link` (5.5:1 light, 10:1 dark on the track's surface), secondary fill as `--link` at 55% with a 1px `--background` gap between segments so the two never merge. Check the computed ratios with the same script as this audit (the plan includes it).

#### P2-3. Two `h1`s on Coverage, and page titles use three sizes and two levels

- **Screenshots:** `coverage-1280-light.png`, `generate-1280-light.png`, `comparison-1280-light.png`, `licences-selected-1280-dark.png`.
- **Root cause:** `webui/src/views/CoverageView.tsx:58` is an `h1` next to the app's `h1` (`AppShell.tsx:100`). Page titles: "Review & generate" `h2 text-lg` (`GenerateReviewScreen.tsx:251`), Coverage `h1 text-lg`, comparison `h2 text-lg` (`ReleaseComparisonView.tsx:309`), licence and product `h2 text-xl` (`LicenceDetail.tsx:118`, `ProductDetail.tsx:139`, `LicenceCompare.tsx:61`).
- **Fix:** one `PageTitle` in `components/ui/page-title.tsx`: `h2`, `text-lg font-semibold`, optional muted subtitle and trailing actions slot. Use it on all five.

#### P2-4. Heading levels skip

- **Root cause:** rule detail section labels are `h5` (`CodeBlock.tsx:98`, `IndirectMappedRules.tsx:35`) directly under the table's `h2`/`h3` section headers; Licences and Products start their navigation at `h3`/`h4` (`ProductList.tsx:153`, `LicenceList.tsx:135`) with no `h2` on the page (DOM pass in section 1).
- **Fix:** rule detail headings become one level below the deepest section header they sit in (pass `headingLevel` down from `RuleTable`, capped at 6), or simpler, make them `h3` and the detail panel a labelled `region` so they are scoped. Licences and Products get a visually hidden `h2` ("Licences", "Products") above the tree.

#### P2-5. Filter sidebars are unnamed landmarks

- **Root cause:** `FilterSidebar.tsx:146` and `ComparisonSidebar.tsx:148` render `<aside>` with no name, so screen reader landmark lists show two bare "complementary" entries on a comparison.
- **Fix:** `aria-label="Filters"` on both (Licences/Products already name their `nav`).

#### P2-6. Four different expand affordances

- **Screenshots:** `rules-expanded-1280-light.png` (row "▸"), `detail-mapped-1280-light.png` (lucide chevrons), `coverage-open-1280-light.png` and `comparison-1280-light.png` (no indicator at all).
- **Root cause:** rule rows use text glyphs "▸"/"▾" in a ghost icon button (`RuleTable.tsx:384-396`); section headers, mapped groups and catalog trees use lucide `ChevronRight`/`ChevronDown` at three sizes; Coverage section rows (`FrameworkCoverageCard.tsx:137`), Coverage control rows (`:111`) and comparison rows (`ReleaseComparisonView.tsx:112`) are toggle buttons with no indicator, so nothing says they open.
- **Fix:** a `DisclosureChevron` component (`components/ui/disclosure-chevron.tsx`): lucide `ChevronRight`, `size-4`, `text-muted-foreground`, `transition-transform`, `rotate-90` when open, `aria-hidden`. Use it in all of the above, replacing the text glyphs.

#### P2-7. Text-link actions are styled six ways

- **Screenshots:** `generate-1280-light.png` ("Back to browse", "Show 2 rules", "Review supporting checks (63)"), `comparison-1280-light.png` ("All frameworks"), `coverage-open-1280-light.png` ("Show 42 uncovered").
- **Root cause:** ad hoc classes instead of `Button variant="link"`: `GenerateReviewScreen.tsx:252` (muted xs underline), `ReleaseComparisonView.tsx:306` (link sm underline, no focus class), `CoverageView.tsx:14` and `FrameworkCoverageCard.tsx:24` (two copies of `TOGGLE_CLASS`), `SupportingChecksPanel.tsx:140,197`, `SupportingCheckRow.tsx:32` (no focus-visible class), `AttributionFooter.tsx:13`.
- **Fix:** in-page text actions use `<Button variant="link" size="xs">` (or `size="sm"`); navigation back uses one `BackLink` (`ChevronLeft` + text-link label, `text-sm`) for "Back to rules" (rename from "Back to browse", which names no screen) and "All frameworks". External links keep `<a>` with the `text-link underline` look.

#### P2-8. Native selects styled four ways

- **Root cause:** `ComparisonSidebar.tsx:15`, `RuleHistoryTab.tsx:23`, `FrameworkCoverageCard.tsx:23` each define `SELECT_CLASS` (two differ only by `w-full`/`max-w-xs`); `PagingBar.tsx:42` uses `bg-card text-foreground/90`; `OrgDefinedValueInput.tsx:104` uses `h-7 bg-transparent` and no radius.
- **Fix:** `components/ui/native-select.tsx` (a styled `<select>`, `h-8 rounded-md border border-control-border bg-background px-2 text-sm`, focus ring as `Input`), with width left to the caller.

#### P2-9. Ad hoc pills duplicate Button and Badge

- **Root cause:** `FrameworkCards.tsx:43` (release links), `LicenceDetail.tsx:63` and `LicenceList.tsx:106,118` (toggle and Compare pills), `AppShell.tsx:95` ("Filters" toggle, `rounded` not pill), `CommandPalette.tsx:49` (source chip), `FieldChangeList.tsx:81,88`.
- **Fix:** interactive pills use `buttonVariants({ variant: 'outline', size: 'xs' })` (pressed state via `aria-pressed:border-foreground/60 aria-pressed:bg-muted`, the `DisclosureButtons` pattern); the current release uses `variant: 'default'`. Static chips use `Badge` (`outline` for neutral metadata such as the palette's source). `FieldChangeList` keeps its diff colours but through `Badge` with the `diff-*` tokens.

#### P2-10. Numbers and plurals are formatted inconsistently

- **Root cause:** counts above 999 print without separators in `AppShell.tsx:105` ("2567 of 2567 rules"), `FrameworkCards.tsx:23` ("1143 rules"), facet counts, comparison tiles, and coverage section rows; "(s)" plurals in `GenerateReviewScreen.tsx:391` ("3 bundle(s)", "scripted rule(s)", "rule(s) need manual attestation"), `BundleGroupCard.tsx` ("1 rule(s)"), `ExportImportControls.tsx:28,36`.
- **Fix:** `formatCount` (P1-6) and `pluralize(count, singular, plural)` in `lib/format.ts`, used for every user-facing count. E2e that pin "2567 of 2567 rules" (`smoke.spec.ts`) change to "2,567 of 2,567 rules"; specs that read totals from indexes format them the same way.

#### P2-11. Gutters and widths differ between views

- **Screenshots:** `rules-1280-light.png`, `coverage-1280-light.png`, `licences-1280-light.png`.
- **Root cause:** header and toolbars `px-4`, legend and table cells `md:px-6`/`md:pl-6`, Coverage centres a `max-w-5xl` column (`CoverageView.tsx:56`) while every other view is full width; filter sidebars are `md:w-64` (`FilterSidebar.tsx:146`, `ComparisonSidebar.tsx:148`) while catalog sidebars are `lg:w-80` (`LicencesView.tsx:81`, `ProductsView.tsx:42`).
- **Fix:** one main-column gutter `px-4` at every width (the table's 4px accent border plus `pl-3` keeps its first column on the same 16px line); Coverage drops `mx-auto max-w-5xl` and uses the same full-width grid as Frameworks; all sidebars `w-64` at `md`, except the catalog trees which keep `w-80` because their labels are long, documented as the one exception.

#### P2-12. Catalog tree headings are smaller and fainter than their children

- **Screenshots:** `products-selected-1280-light.png`, `licences-selected-1280-dark.png`.
- **Root cause:** family/category headings use `text-xs font-medium text-muted-foreground` (`ProductList.tsx:153`, `LicenceList.tsx:135`) while their items are `text-sm text-foreground`, so the hierarchy reads upside down.
- **Fix:** use the facet heading style (`text-xs font-semibold uppercase tracking-wide text-muted-foreground`) only for true section labels, and make collapsible group rows `text-sm font-medium text-foreground` with the shared chevron.

#### P2-13. The licence "needs review" dot relies on colour and hover

- **Screenshot:** `licences-selected-1280-dark.png`.
- **Root cause:** `LicenceList.tsx:57` is an 8px yellow dot with `title`; its meaning is not visible without hovering and `title` does not appear on keyboard focus.
- **Fix:** show it as a small `Badge` "Needs review" with the warning tokens in the detail pane, and in the list keep the dot but add a legend line above the list ("● needs review").

#### P2-14. Empty and loading states use different wording and components

- **Root cause:** "No rules match the current filters." (`RuleTable.tsx:167`) vs "No rules match these filters." (`ReleaseComparisonView.tsx:363`) vs "No mapped rules match these filters." vs "No products match."; "Loading supporting checks..." with three dots (`SupportingChecksPanel.tsx:182`) vs "…" elsewhere; three copies of a local `Message` component (`ReleaseComparisonView.tsx:201`, `LicencesView.tsx`, `ProductsView.tsx`) with different padding.
- **Fix:** `components/ui/status-message.tsx` (`p-4 text-sm text-muted-foreground`, `role="status"` for loading) and the wording rules in the style guide ("No <things> match these filters.", "Loading <thing>…").

#### P2-15. Radii and card styles vary

- **Root cause:** 36 plain `rounded` (4px), 14 `rounded-md`, 4 `rounded-lg` across the views; cards and panels mix them: Coverage and Framework cards `rounded-lg bg-panel`, the supporting checks panel `rounded border bg-panel` (`SupportingChecksPanel.tsx:167`), Generate notes and bundle cards `rounded`, history cards `rounded-lg`.
- **Fix:** cards and panels `rounded-lg border border-border bg-panel p-4` (one `Card` class or component); controls `rounded-md`; pills `rounded-full`; focus-ring wrappers on inline buttons `rounded-sm`.

### P3

- **P3-1. Comparison rows place the id inconsistently** (`comparison-1280-dark.png`): `ReleaseComparisonView.tsx:112-115` uses `flex-wrap`, so short titles show the id inline and long ones below. Put the id on its own line as the Rules table does.
- **P3-2. Comparison summary tiles do not look pressable** (`comparison-1280-light.png`): `ReleaseComparisonView.tsx:44-53` are `aria-pressed` buttons styled like static stat cards. Add a hover border and a "Show only" hint in the label's `title`, or a small "Filter" caption.
- **P3-3. "Error" severity uses warning colours** (`GenerateChecksPanel.tsx:8`): use the destructive tokens so error and warning differ by more than the label.
- **P3-4. Code colours are hard-coded** (`CodeBlock.tsx:23`, `CopyButton.tsx:15`, `FieldChangeList.tsx:41-51`, slate and white palette classes): add `--code`, `--code-foreground`, `--code-muted` tokens (same values) so the code surface is defined in one place.
- **P3-5. Text inputs look disabled** (`detail-orgvalue-1280-light.png`): `components/ui/input.tsx:12` fills inputs with `bg-input/50`, the same grey as disabled controls elsewhere. Use `bg-background` with the existing `border-control-border`.
- **P3-6. The status strip is rendered twice per row** (`RuleTable.tsx:401-407`): one copy for phones and one for desktop. Render once and move it with CSS grid, halving the strip's DOM and tooltip instances on a 200-row page.
- **P3-7. Disabled Generate gives no reason** (`rules-1280-light.png`): add `aria-describedby` text "Select rules to generate a bundle." shown as a tooltip on the wrapper.
- **P3-8. Phone header takes about 40% of the viewport** (`rules-375-light.png`): the header wraps into four rows. Only if it costs desktop nothing: hide the "x of y rules" count below `sm` (the table shows it) and put Export/Import in an overflow menu. Lowest priority.
- **P3-9. Uppercase micro-headings** use two different letter spacings (`tracking-wide` in the sidebar and detail sections, none in `ComparisonSidebar`'s "RELEASES" block). Use the one `SectionLabel` class from the style guide.

## 3. Contrast results

Computed from `index.css` (sRGB, WCAG 2.x). Text needs 4.5:1, non-text 3:1.

| Pair | Light | Dark |
| --- | --- | --- |
| foreground / background | 19.89 | 19.05 |
| muted-foreground / background | 4.83 | 7.56 |
| muted-foreground / panel | 4.62 | 6.74 |
| muted-foreground / muted | **4.39** (P2-1) | 5.66 |
| section-muted-foreground / section-1 | 5.75 | 6.75 |
| link / background, expanded, panel | 5.72, 5.38, 5.48 | 10.25, 8.31, 9.14 |
| primary-foreground / primary | 5.07 | 6.97 |
| control-border / background (3:1) | 3.96 | 4.26 |
| focus-ring / background, section-1 (3:1) | 5.72, 4.25 | 8.30, 5.27 |
| status-automated / background (3:1) | 5.57 | 5.82 |
| status-manual / background, expanded (3:1) | 3.43, 3.23 | 8.84, 7.17 |
| muted (bar track) / panel (3:1) | **1.05** (P2-2) | **1.19** |
| primary / muted (bar fill) (3:1) | 4.80 | **2.05** |
| primary at 50% / muted (through fill) (3:1) | **1.65** | **1.53** |
| success, warning, custom, kind and diff tags | 6.7 to 11.0 | 8.2 to 11.0 |

`--border` is 1.27:1 (light) and 2.89:1 (dark) on the page, which is fine for decorative dividers and card edges; every control boundary already uses `--control-border`. `muted-foreground` on `section-1` is 3.59:1 but no element uses that pair (section headers use `section-muted-foreground`); the style guide forbids it.

## 4. Keyboard and screen reader notes

- Tab order on Rules: Export, Import, Search (Ctrl K), the five view tabs, the filter search, then facets, then the table. Every stop showed a visible ring (`focus-visible:ring-2 ring-focus-ring` or the global `outline-focus-ring`). There is no skip link; with 30 to 40 filter stops before the table, add a visually hidden "Skip to rules" link as the first stop (P2-5 task).
- The strip tooltip (P1-4) is the only tooltip that opens on focus by design; after the fix it also closes on Escape and blur.
- Dialogs (Sources & licences, rule Details, command palette) trap focus and close on Escape; focus returns to the trigger (checked by the existing supporting-checks e2e for Details).

## 5. axe-core

Recommended, as a dev dependency for the e2e suite only: `@axe-core/playwright` 4.14.0 with `axe-core` 4.14.0 (latest stable on the registry on 2026-11-13). It would have caught P2-1, P2-3, P2-4 and P2-5 automatically and keeps checking states (dialogs, expanded rows, dark mode) that a one-off audit only samples. Not installed; it needs the maintainer's go-ahead. Suggested use: one spec that runs `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])` on each view in light and dark, failing on new violations.

## 6. Decisions made without the maintainer

1. **The two maintainer-noted items (supporting checks list, Coverage number format) are P1** alongside the three reported issues and the tooltip bug, because the maintainer raised them and each is small.
2. **Double scrollbar fix keeps the app-shell layout** and makes the filter list fit by collapsing four facet groups by default (P1-2), rather than switching the whole app to document scrolling. Rejected options and reasons are in P1-2. If the maintainer prefers filters always fully expanded, the fallback is the document-scroll layout with a sticky sidebar, which still shows a sidebar scrollbar.
3. **Which facet groups start open:** Automation, Target, Source (short, most used); any group with a selection is open.
4. **The icon key moves into the toolbar row** instead of getting more padding as its own strip; it saves a 28px band at the top of the table and lines the key up with the buttons.
5. **Supporting checks become a divided list with right-aligned actions**, not a grid of smaller cards: the ids are what people scan, and a single column keeps them aligned.
6. **Count format is `en-US` with thousands separators** everywhere (the app's copy is US English: "organization", "Authorization"), matching what Coverage already does in its second branch.
7. **"Back to browse" is renamed "Back to rules"** to name the screen it returns to.
8. **Catalog sidebars stay 320px wide** as the one exception to the 256px sidebar width, because product and licence names are long.
9. **Tooltip fix moves the `TooltipProvider` to `AppShell`** so the one-open-at-a-time behaviour and delay apply app-wide.
10. **Hard-coded code colours are P3**, not P2: they are deliberate (code is always on a dark surface) and only need to become tokens.
