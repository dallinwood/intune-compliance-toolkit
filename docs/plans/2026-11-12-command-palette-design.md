# Design: command palette (Ctrl+K / Cmd+K)

Date: 2026-11-12
Status: Proposed (the calls in section 9 were made without the maintainer and await review)

## 1. Intent

With four sources the library holds about 2,500 current rules. Reaching one means opening the
Rules tab, clearing filters and searching. Idea 5 in
`docs/2026-11-11-ciso-assistant-analysis.md` section 3 (after CISO Assistant's command
palette) is a keyboard-first jump box: press Ctrl+K (Cmd+K on Apple devices), type an id or
words from a title, press Enter, and land on the rule, framework or view.

## 2. Goals, non-goals, anti-goals

### Goals

- Ctrl+K or Cmd+K anywhere in the app opens the palette; a visible header button opens it
  too (mouse, touch, and discoverability).
- One search over views (the tabs in `VIEWS`), frameworks (manifest sources) and every current
  rule of every source, by full id, upstream id, or title words.
- Enter or click goes there in one history entry, so Back returns.
- Fully usable with keyboard only and with a screen reader (WAI-ARIA combobox pattern,
  announced result count, focus returned on close).
- No new npm dependency: Base UI's `Dialog` (already wrapped in
  `webui/src/components/ui/dialog.tsx`) and `Autocomplete` (in the installed
  `@base-ui/react` 1.7.0) cover it.

### Non-goals (for now)

- Actions beyond navigation (select a rule, generate, toggle theme).
- Searching rule discussion text, older releases, catalog licences or products.
- Remembering recent searches.
- A "/" shortcut.

### Anti-goals (failure even if it technically works)

- Hijacking a key the app or the platform needs: the shortcut only fires with Ctrl or Cmd and
  no Alt or Shift, never during IME composition, and never while another modal dialog is open.
- Typing lag: ranking is a linear pass over about 2,500 rows per keystroke, results capped.
- A jump that leaves the target hidden (a rule filtered out of the table, a stale Generate
  screen over the destination).

## 3. Facts that shape this design

- There is no global keyboard shortcut in the app today (no `keydown` listener outside
  individual inputs).
- `useFilterStore` writes the address on every store change (`writeStateToUrl`); a navigation
  must be one `set` to be one history entry.
- `showRuleFromComparison(ruleId, upstreamId, tab)` already does exactly the rule jump in one
  `set`: Rules view, every filter cleared, search set to the upstream id, the rule opened.
- `showComparison(framework, from, to)` sets the framework and range but not the view; it is
  only called from the Frameworks tab today. `null` from and to resolve to the default range.
- `setView(id)` switches tabs. The Generate review screen is AppShell local state
  (`isReviewingSelection`), not part of the store.
- `RuleRow` (`webui/src/types/rule-row.ts`) has `ref.id`, `title`, `sourceName`;
  `upstreamRuleId(id)` strips the source; `termLabel(index, 'sources', name)` gives a source's
  short label.
- Base UI `Autocomplete.Root` supports `inline` with `open` for a list rendered inside a
  `Dialog` (its own docs say to bind the dialog's open state for the reset), plus
  `autoHighlight`, `filter={null}` (we supply ranked items), `Group`, `GroupLabel`, `Empty`
  and `Status` (a polite live region). Registry check on 2026-11-12: `@base-ui/react` latest
  is 1.9.0 against 1.7.0 installed, so the installed version is current enough. `cmdk`, the
  usual palette package, is at 1.1.1 with no publish since August 2025, which is one more
  reason not to add it.
- Chrome and Firefox bind Ctrl+K to the browser's search bar; `preventDefault` on the
  page's `keydown` takes it over while the page has focus, as GitHub and many docs sites do.

## 4. Entries and matching

Three kinds of entry, built once per library load:

- **View**: one per `VIEWS` entry: label (for example "Coverage"), matched on label and id.
- **Framework**: one per manifest source: display name and short source label, matched on
  both and the source name.
- **Rule**: one per current rule row: upstream id (monospace), title, source short label,
  matched on full id, upstream id, title and source label.

Query normalising: lower-case, trim, collapse whitespace; split into words. An entry matches
when every word is a substring of its match text. An empty query shows all views and
frameworks and no rules.

Rule ranking tiers, best first: (0) the whole query equals the upstream or full id;
(1) the upstream id starts with the query; (2) the title starts with the query; (3) the
upstream id contains the query; (4) any other match. Within a tier, by upstream id with
numeric collation (`localeCompare(other, 'en', { numeric: true })`), then full id. Views
and frameworks keep their natural order (tab order, manifest order). At most 50 rules are
shown; the status line then says "Showing 50 of N rules; keep typing to narrow".

Groups render in a fixed order: Views, Frameworks, Rules; empty groups are hidden.

## 5. Behaviour

### 5.1 Opening and closing

- `keydown` on `window`: Ctrl or Meta, no Alt, no Shift, `key` "k" or "K", not
  `isComposing`, not `defaultPrevented`. Then `preventDefault` and toggle the palette, unless
  another dialog is open (any element with `data-slot="dialog-content"` that is not the
  palette's own popup, which carries `data-command-palette`).
- Header button, right-aligned in the existing header on every view: a search icon, the text
  "Search", and a `<kbd>` hint "Ctrl K" or "⌘ K" (Apple platforms, detected from
  `navigator.platform`, falling back to `navigator.userAgent`). Below `sm` the hint is hidden,
  the icon and "Search" stay. `aria-keyshortcuts="Control+K Meta+K"`.
- Escape, the close button, a click on the backdrop, or Ctrl+K again close it. Focus returns
  to the element focused before opening (Base UI Dialog). Closing clears the query.

### 5.2 Dialog

- `DialogContent` with `data-command-palette`, narrower than the default (`max-w-xl`), placed
  toward the top (`top-[10vh] translate-y-0`) so the list grows downward.
- Title "Go to" (visually hidden via `sr-only`), description "Search rules, frameworks and
  views" (`sr-only`).
- The input: placeholder "Search rules, frameworks and views…", `aria-label` the same,
  autofocused.
- Inline listbox under the input, scrolling inside the dialog (`max-h-[60dvh]`). Group labels
  "Views", "Frameworks", "Rules". A rule item shows the upstream id (mono, `break-all`), the
  title (`line-clamp-2`), and the source label as a small badge. A framework item shows its
  display name and "Framework"; a view item its label and "View".
- Arrow keys move the highlight (Base UI); the first result is highlighted after typing
  (`autoHighlight`); Enter activates; click activates.
- `Autocomplete.Status` announces "N results" (or the "Showing 50 of N rules" text);
  `Autocomplete.Empty` shows "No matches".

### 5.3 Activating an entry

Every activation closes the palette, then closes the Generate review screen if it is open
(an `onNavigate` callback from `AppShell`), then:

- View: `setView(id)`.
- Framework: `showComparison(sourceName, null, null)`, which now also sets `view:
  'frameworks'` in the same `set`, opening that framework's default comparison (and, once
  `docs/plans/2026-11-12-release-links-design.md` lands, a single-release framework's
  empty-release comparison; before that, its card list).
- Rule: `showRuleFromComparison(ruleId, upstreamRuleId(ruleId), null)`.

## 6. Interfaces (pure logic)

`webui/src/logic/commandPalette.ts`:

```ts
export type PaletteEntry =
  | { kind: 'view'; key: string; viewId: string; label: string; matchText: string }
  | { kind: 'framework'; key: string; sourceName: string; label: string; shortLabel: string; matchText: string }
  | { kind: 'rule'; key: string; ruleId: string; upstreamId: string; title: string; sourceLabel: string; matchText: string }

export interface PaletteResults {
  views: PaletteEntry[]
  frameworks: PaletteEntry[]
  rules: PaletteEntry[]
  totalRuleMatches: number
}

export const RULE_RESULT_LIMIT = 50

export function buildPaletteEntries(
  views: readonly { id: string; label: string }[],
  sources: readonly { name: string; display_name: string }[],
  rows: readonly { ref: { id: string }; title: string; sourceName: string }[],
  sourceLabel: (sourceName: string) => string,
): PaletteEntry[]

export function normalizeQuery(query: string): string
export function searchPalette(entries: readonly PaletteEntry[], query: string, ruleLimit?: number): PaletteResults
export function resultStatus(results: PaletteResults): string
export function isPaletteShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'>): boolean
export function isApplePlatform(platform: string, userAgent: string): boolean
```

`key` is `view:<id>`, `framework:<name>` or `rule:<id>`, unique, used as React key and item value.
`matchText` is the lower-cased text the query words are tested against.

## 7. Test strategy

- Vitest, `commandPalette.test.ts`: entries per kind; matching and every ranking tier; the
  rule limit and total; empty query; status text; the shortcut predicate's accepted and
  rejected combinations; Apple platform detection.
- Playwright, `webui/e2e/command-palette.spec.ts`: open by Ctrl+K and by the header button;
  jump to a rule by upstream id with the keyboard only; to a framework; to a view; Escape
  returns focus; Ctrl+K does nothing while another dialog (the third-party packages dialog in
  the footer) is open; ARIA roles (`combobox`, `listbox`, `option`) present.
- Ad hoc screenshots at about 375px and 1280px, light and dark: the header button, the open
  palette with results in all three groups, and the "No matches" state.

## 8. Delivery

Three commits (plan tasks): logic and the store change; the component, its wiring and e2e;
the README.

## 9. Decisions made without the maintainer

| Decision | Alternative |
|---|---|
| Base UI `Dialog` plus inline `Autocomplete`, no new dependency. | `cmdk` (stale since August 2025), or a hand-rolled listbox (the fallback if Base UI's inline mode cannot render the groups; see the plan). |
| A framework entry opens its default release comparison on the Frameworks tab. | Filter the Rules tab to that source. |
| A rule jump clears every Rules filter and searches the upstream id (the existing comparison-to-rule jump). | Keep the filters and widen only those that hide the rule (`filtersShowingRule`), which leaves the table in a less predictable state. |
| Ctrl+K and Cmd+K both open it on every platform, overriding the browser's own Ctrl+K while the page has focus. | Only the platform's own modifier; or a different key to leave the browser's binding alone. |
| The shortcut works while typing in an input. | Ignore it inside inputs, as some apps do; there is no app binding to clash with. |
| No rules for an empty query; at most 50 rule results. | Show recent or popular rules; a higher cap. |
| A visible "Search" header button on every view. | Shortcut only, which keyboard-only discovery and touch users would miss. |
| `showComparison` now also sets the view to Frameworks. | A separate store action for the palette. |

## Progress log
