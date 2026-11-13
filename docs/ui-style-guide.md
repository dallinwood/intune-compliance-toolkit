# Web UI Style Guide

Conventions for `webui/`. They codify the best patterns already in the code; where the code disagrees with this guide, the guide wins and the code is on the fix list in `docs/plans/2026-11-13-ui-polish-design.md`. Desktop (about 1280px) is the design target; phones must work without sideways scrolling.

## 1. Tokens and colour

- All colour comes from the tokens in `webui/src/index.css` through their Tailwind names (`bg-panel`, `text-link`, `border-control-border`, ...). No palette classes (`text-slate-300`, `bg-red-500`) and no hex or `oklch()` in components.
- A new colour is a new token: add it to `:root` **and** `.dark`, add the `--color-*` line to `@theme inline`, and note its contrast in the comment above it (4.5:1 for text on every surface it sits on, 3:1 for icons, control borders, focus rings and meaningful graphics).
- Which token for what:

  | Use | Token |
  | --- | --- |
  | Page | `background` / `foreground` |
  | Card, panel, dialog body, expanded detail | `panel` (cards), `card` (rows inside a panel), `popover` (menus, hover cards) |
  | Secondary text | `muted-foreground` (never on `muted` or `section-*`; use `section-muted-foreground` on section bands) |
  | Links and text actions | `link` (not `primary`, which is too dark as text in dark mode) |
  | Filled primary action, current item | `primary` / `primary-foreground` |
  | Control edges (inputs, selects, checkboxes, outline buttons) | `control-border` |
  | Decorative dividers and card edges | `border` |
  | Focus | `focus-ring` |
  | Status | `success-*`, `warning-*`, `destructive`, `status-automated`, `status-manual` |
  | Tags | `custom-*`, `kind-*`, `diff-*` |
  | Meters (coverage bars) | `meter-track`, `meter-fill`, `meter-fill-secondary` |
  | Code surfaces | `code`, `code-foreground`, `code-muted` (always dark, both themes) |

- Colour is never the only cue: pair it with a mark, label or text (the status glyph's check/dash mark is the model).

## 2. Dark mode

- The theme class is on `<html>`; use the `dark:` variant only when a token cannot express the difference. Prefer adding a token over sprinkling `dark:` classes.
- Every new screen is checked in both themes (screenshots at 1280px and 375px, light and dark, read before calling it done, per `.claude/CLAUDE.md`).
- Translucent fills (`bg-foreground/5`, `bg-input/30`) are fine for hover states; never for text or for something that must meet 3:1.

## 3. Spacing and layout

- Spacing steps: `1` (4px) inside compact items, `1.5`/`2` (6-8px) between a control and its label or between pills, `3` (12px) between lines of a block, `4` (16px) between blocks and as padding inside cards, `6` (24px) between page sections. Avoid odd steps (`3.5`, `2.5`) except to match an existing component's internal sizing.
- Gutter: `px-4` for the header, view tabs, toolbars, page content and footer, at every width. Content lines up on that 16px line.
- Sidebars: `w-64` from `md`, `border-r`, `aside aria-label="Filters"`. Catalog navigation trees are the one exception at `w-80` (long names).
- Views fill the width; no centred `max-w-*` columns for app views (long prose inside a panel may cap at `max-w-prose`).
- Scrolling: the app shell is viewport-high; each view has one main scroller (`main`, `overflow-y-auto`, `[scrollbar-gutter:stable]`). A sidebar may scroll only as a fallback; its default content must fit at 1280x800 (collapse long groups instead).

## 4. Type scale

| Role | Classes | Element |
| --- | --- | --- |
| App title | `text-lg font-semibold` | `h1` (only one per page) |
| Page title | `text-lg font-semibold` via `PageTitle` | `h2` |
| Card title | `text-base font-semibold` | `h2`/`h3` by nesting |
| Block heading inside a card or panel | `text-sm font-medium` | next level down |
| Section label (facets, Check, Remediation, Benchmarks) | `text-xs font-semibold uppercase tracking-wide text-muted-foreground` | heading at the right level |
| Body | `text-sm` | |
| Meta, captions, counts | `text-xs text-muted-foreground` | |
| Ids, file names, code | `font-mono text-xs` | |

Heading levels never skip: a heading is one level below the heading it sits under. When a component can appear at different depths, pass the level in rather than hard-coding `h5`.

## 5. Which component for what

| Need | Use | Not |
| --- | --- | --- |
| Any button | `Button` (`components/ui/button.tsx`) | a styled `<button>` |
| Toolbar or row action | `Button variant="outline" size="xs"` | |
| Primary action of a screen (Download, Generate) | `Button` default variant | |
| Quiet in-row action (Details, Change) | `Button variant="ghost" size="xs"` | |
| Text action inside prose (Show 2 rules, Show 42 uncovered) | `Button variant="link" size="xs"` | `text-link underline` classes |
| Back navigation | `BackLink` (ChevronLeft + label naming the destination: "Back to rules", "All frameworks") | |
| Navigation to a URL | `<a>` with `text-link underline underline-offset-4`, external links `target="_blank" rel="noreferrer"` | |
| Toggle pills (one open, pressed, or several on) | `DisclosureButtons` / `SelectionButtons` / `ToggleButtons` (`components/rules/DisclosureButtons.tsx`) | hand-made `rounded-full border` buttons |
| Static label or tag | `Badge` (`secondary` neutral, `outline` metadata, token classes for status/kind) | `rounded-full px-2 text-xs` spans |
| Text field | `Input` | |
| Dropdown | `NativeSelect` (`components/ui/native-select.tsx`) | local `SELECT_CLASS` constants |
| Checkbox / radio | `Checkbox`, `RadioGroup` paired with `Label htmlFor` | |
| Card or panel | `rounded-lg border border-border bg-panel p-4` (`Card`) | `rounded` or `rounded-md` panels |
| A list of many similar items | one bordered container with `divide-y divide-border`, rows `px-3 py-2` | one card per row |
| Collapsible section header | `SectionHeader` (rule table, comparison), `CollapsibleHeading` (catalog) | |
| Expand indicator | `DisclosureChevron` (lucide `ChevronRight`, `size-4`, `rotate-90` when open) | text glyphs ▸ ▾, unmarked toggle rows |
| Tooltip | `Tooltip` / `TooltipTrigger` / `TooltipContent`, uncontrolled, under the app-level `TooltipProvider` | controlled tooltips (if one must be controlled, close on every `onOpenChange(false)`) |
| Dialog | `Dialog` (`components/ui/dialog.tsx`) | |
| Empty, loading, error message in a pane | `StatusMessage` | local `Message` components |

## 6. Buttons, badges, cards and disclosures

- **Buttons:** sentence case, a verb first ("Download bundle (.zip)", "Add supporting checks", "Expand all"). Pills (`rounded-4xl`) come from `buttonVariants`; do not re-create the shape.
- **Pressed and open states:** `aria-pressed` or `aria-expanded` on the button, styled with `aria-pressed:border-foreground/60 aria-pressed:bg-muted` (or the `aria-expanded:` equivalent). Never a colour-only change.
- **Badges:** short nouns ("Supports", "Add-on", "Generated", "Wording"). Status badges use their token pair (`bg-success text-success-foreground`). A badge is not interactive; if it is clickable it is a button.
- **Cards:** title, then one line of muted meta, then content; `space-y-3` inside. Cards are not nested in cards; inside a card use dividers.
- **Disclosures:** the trigger is a real `button` with `aria-expanded` and `aria-controls`, the chevron on the left, the count after the label in `text-muted-foreground` ("Added (44)"). Toolbars offer "Expand all" and "Collapse all" only.

## 7. Icons

- Sizes: `size-4` (16px) in body text, rows and buttons of default size; `size-3` in `xs` buttons and badges (the button and badge variants set this already); `size-8` only for the full-pane loading spinner. Status glyph marks stay at their component's 9px.
- Source: lucide-react for UI icons, bootstrap-icons (raw SVG imports in `logic/targetIcons.ts`) for platform and status glyphs. Do not mix the two for the same meaning.
- Decorative icons get `aria-hidden="true"`; an icon that carries meaning on its own gets `role="img"` and an `aria-label`, and a visible tooltip.

## 8. Wording, labels and capitalisation

- Sentence case everywhere: buttons, tabs, headings, badges, column and facet labels ("Kind of change", "Rules per page", "Sources & licences"). Proper nouns and framework names keep their own case ("ASD ISM", "NIST SP 800-53", "macOS").
- Spelling follows the existing copy: US "organization", "Authorization"; "licence" (noun, the view's name) as the catalog already uses it.
- No "(s)" plurals: write "1 rule", "3 rules" with `pluralize`.
- Empty states: "No <things> match these filters." or "No <things> yet." plus, when useful, what to do ("Select rules in the Rules view to see what they support.").
- Loading: "Loading <thing>…" with the single ellipsis character.
- Errors: say what failed and what still works ("The release history could not be loaded: <reason>").
- Never use the em dash character; use a hyphen or rewrite.

## 9. Numbers and dates

- Counts: `formatCount` from `lib/format.ts` (`Intl.NumberFormat('en-US')`): "2,567 of 2,567 rules", "1,143 controls". Use it for every count a person reads, including facet counts and tiles; `tabular-nums` where counts line up in a column.
- Fractions: "8 of 1,143", not percentages, unless the space only fits a percentage.
- Sizes: one decimal with the unit ("0.5 KB").
- Release labels: show the source's own label first and the tag in parentheses when both help ("Sep 2026 (v2026.09.4)"); dates in prose as "Sep 2026" (month and year) as the release data already does. Machine dates (ISO `2026-09-03`) only in exported files.

## 10. Focus and keyboard

- Every interactive element shows `focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none` (the shared components already do; hand-made controls must add it, wrapped with `rounded-sm` so the ring has a shape).
- One tab stop per composite widget (radio group, status strip); arrow keys inside where the widget supports it.
- Escape closes the topmost popup (dialog, palette, tooltip); focus returns to the trigger.
- Tooltips open on hover and keyboard focus, close on pointer leave, blur and Escape, and only one is open at a time.
- Long pages offer a skip link before repeated filter controls.

## 11. Landmarks and headings

- One `h1` (the app title). Each view's title is an `h2`.
- `header`, `nav aria-label="Views"`, one `main`, `footer` on every view; sidebars are `aside` with an `aria-label`.
- Regions that appear on demand (tab panels, disclosure panels) are labelled by their trigger.
