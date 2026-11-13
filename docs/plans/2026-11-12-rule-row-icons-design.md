# Design: rule row status icons (coloured platform and link icons)

Status: implemented (Option B, confirmed by the maintainer). See the
progress log at the end.

## 1. Intent

The maintainer's main goal is readability of the rule rows. Today each row
shows grey platform icons, then a text pill ("Automated", or "Manual -
<reason>", up to about 167px wide), in a 240px assessment column. The
request:

- Put a link icon (Bootstrap Icons `link`) after the pill on every rule
  that has mapped rules, coloured by the linked rules: green when a linked
  rule has an automated check, orange when a linked rule is manual.
- Colour the platform icons the same way, per platform: a Windows icon is
  orange when Windows has no automated check, while macOS can be green on
  the same rule.
- Optionally replace the pill: a clipboard icon for a rule with no
  platform, the coloured platform icons otherwise, with the text on hover.

## 2. Goals, non-goals, anti-goals

### Goals

- A row's automation status and its links' status read at a glance, from
  icons alone, without reading pill text.
- The assessment column shrinks, so the title column gets the space back.
- Colour is never the only cue, and every icon has an accessible name.
- Desktop first; narrow screens keep today's folded layout.

### Non-goals

- Indirect mapping chains. They stay on the Mapped rules tab.
- Changing any rule's `assessment`, or the index schema (see section 4).
- Making a link icon a navigation control (a follow-up idea, section 9).

### Anti-goals

- A tab stop per icon (up to four per row across thousands of rows).
- A legend so large it pushes the first rule below the fold.

## 3. Facts that shape this design

- **Icons already exist.** `webui/src/logic/targetIcons.ts` imports
  Bootstrap Icons 1.13.2 glyphs (`bootstrap-icons/icons/<name>.svg?raw`,
  already a dependency) and `components/rules/TargetIcons.tsx` renders them
  with a tooltip. The same package has `link`, `clipboard`,
  `check-circle-fill` and `dash-circle-fill`.
- **The licence is already listed.** The Sources & licences dialog lists
  packages from the `thirdPartyLicences` Vite plugin
  (`webui/vite-plugins/packageLicences.ts`), which collects every package
  the bundle imports. `bootstrap-icons` is imported today, so its MIT
  licence is already shown; no new entry is needed.
- **Assessment is per rule, not per target.** `RuleRow.assessment` is one
  `{ status, manual_reason }`. Per-target checks (schema v5,
  `docs/plans/2026-10-26-multi-target-checks-design.md`) live only in the
  full rule JSON, which the table never loads. The release indexes carry
  no per-target check data.
- **No rule has two targets today.** Across every release index: 5,470
  rules have no target (all manual), 527 have one target and are
  automated, 175 have one target and are manual. So "Windows orange,
  macOS green on one rule" cannot occur in the current library; it is a
  future case.
- **"Has a check" is not "automated".** In mSCP 27.1, 6 manual rules still
  carry a check script. A per-target status must therefore combine the
  rule's assessment with which targets have a check, not use the check
  alone.
- **Links.** `mappingsByRule` (from `logic/mappingIndex.ts`, filtered to
  the loaded library by `linksWithinLibrary`) gives each rule's direct
  links (`supports` both ways and `related`), and `useRuleMappings()`
  exposes it with `rowsById`. 764 rules have at least one link. Real
  examples: `asd_ism.ism-1985` links to 12 automated and 2 manual rules;
  `mscp.os_sshd_login_grace_time_configure` (automated) links to 2 manual
  ISM controls.
- **Existing colours fail the deuteranope test.** `--success-foreground`
  and `--warning-foreground` sit at almost the same OKLCH lightness (0.43
  and 0.41), so they rely on hue alone.

## 4. Per-target status

`targetStatus(row, target)` is `automated` when the rule's assessment is
automated, otherwise `manual`. Every target icon on a row therefore shows
the rule's status, which is exact for today's library (no rule has two
targets).

The function takes the row and the target, so the later change is local:
when the first two-target rule is planned, add a `check_targets` list
(targets with a non-null check) to the index entry, beside `has_odv`, and
make the function return `automated` only when the rule is automated and
the target is in `check_targets`. That index change (schema, Python
writer, overlay `index_fields`, regenerated indexes) is out of scope here.

## 5. Options (mockups)

Three throwaway static mockups were built from five rows: an automated
mSCP macOS rule linked to manual ISM controls, an ISM control with no
platform linked to 12 automated and 2 manual rules, a hypothetical
two-target rule (macOS automated, Windows manual), an ISM control with no
platform and one manual link, and an automated mSCP rule with no links.
Each was captured at 375px and 1280px in light and dark.

- **Option A - keep the pill, colour the platform icons, add link icons.**
  The smallest change. The row still carries the long pill, so the column
  stays 240px wide, and on a two-target rule the pill's single word
  ("Manual") contradicts a green macOS icon beside it.
- **Option B - replace the pill with status icons (recommended).** Each
  row shows its platform icons (or a clipboard when it has no platform),
  a thin divider, then up to two link icons. Every icon is coloured by
  status and carries a corner mark: a filled check for automated, a
  filled dash for manual. The column drops to about 128px, the cell reads
  as one short strip, and the two-target case reads correctly. The manual
  reason moves into the tooltip.
- **Option C - a short outlined chip.** A pill reading "Auto" or
  "Manual", solid outline for automated and dashed for manual, with the
  platform glyphs inside it and link icons after it. It keeps a word on
  screen, but is still about 190px wide, and tinting glyphs inside a chip
  of the other colour (the two-target case) is hard to read.

**Recommendation: Option B**, because it gives the most room back to the
title, reads correctly for multi-target rules, and is the maintainer's
own suggested direction. Needs maintainer confirmation.

## 6. Option B in detail

### 6.1 Icons and colours

- **Glyphs** (all Bootstrap Icons, imported in `targetIcons.ts` like the
  platform glyphs): platform glyphs as today; `clipboard` for a rule with
  no target; `link` for links; `check-circle-fill` and `dash-circle-fill`
  as the corner marks.
- **Mark:** a 9px mark at the glyph's bottom-right, offset slightly
  outside it, on a disc of the row background so it stays legible over
  the glyph. Shape is the non-colour cue: check means automated, dash
  means manual.
- **Tokens:** two new theme tokens on the Okabe-Ito pair, hue kept,
  lightness tuned per theme so each passes 3:1 against the row
  backgrounds and the two differ in lightness:

  | Token | Light | Dark |
  | --- | --- | --- |
  | `--status-automated` | `oklch(0.500 0.115 165.5)` (#007753) | `oklch(0.620 0.130 165.5)` (#009E73) |
  | `--status-manual` | `oklch(0.640 0.135 76.8)` (#BA7F00) | `oklch(0.753 0.158 76.8)` (#E69F00) |

  Measured contrast (WCAG): light automated 5.6 on the background, 5.1 on
  `--muted`, 5.3 on `--expanded`; light manual 3.4, 3.1, 3.2; dark
  automated 5.8, 4.4, 4.7; dark manual 8.8, 6.6, 7.2. Hover rows use
  `--muted` at 60%, which is closer to the background, so they sit
  between those numbers. Raw #E69F00 is only 2.3:1 on white, which is why
  the light manual token is darker. The existing `--success-*` and
  `--warning-*` tokens stay for badges elsewhere.

### 6.2 What a row shows

- **Platform part:** one icon per target in `targetIconsOf` order, each
  coloured by `targetStatus`. A row with no target shows one clipboard
  icon coloured by the rule's status.
- **Link part:** a green link icon when at least one directly linked rule
  is automated, an orange one when at least one is manual, both when
  mixed, automated first. Counts are of distinct linked rule ids present
  in `rowsById`. A divider (1px, `--border`, `aria-hidden`) separates the
  two parts and is shown only when there is a link icon.
- **No mappings:** no link icons and no divider.

### 6.3 Text, tooltips and keyboard

- **Per icon** (hover tooltip and `role="img"` with `aria-label`, same
  text):
  - target: "macOS: automated check" or "Windows: manual check - <reason
    label>" (the reason label is today's `manual_reasons` vocabulary
    label; plain "manual check" when there is none);
  - no target: "No platform: manual - <reason label>" (or "automated");
  - link: "Linked to 12 automated rules" / "Linked to 1 manual rule".
- **One tab stop per strip.** The strip is a single focusable element
  (`tabIndex=0`) whose focus tooltip lists every icon's line, and whose
  accessible name is those lines joined with ". ". Hovering an icon still
  shows that icon's own tooltip. This keeps keyboard access without four
  tab stops per row.
- **Touch:** no extra tap handling; a tap on the row expands it as
  today, and the legend explains the icons. (Free on desktop, so the
  strip still opens its tooltip on focus.)

### 6.4 Where it applies

- **Rule table rows** and **Mapped rules tab group rows** (both use
  `AssessmentCell`) switch to the strip.
- **Mapped rules tab summary header** (`MappedRuleSummary`, one per page)
  keeps the text pill for the current rule and gains the coloured
  platform icons, since it is a heading, not a scanning list.
- **Product detail and the per-target check and remediation headings**
  keep neutral (muted) platform icons: they are labels, not status.
- **Column width:** the table's assessment column goes from `md:w-60`
  (240px) to `md:w-32` (128px), with the column comment updated. The
  narrow layout (strip and benchmark text folded under the title) is
  unchanged.

### 6.5 Legend

A one-line key above the rule table: "Key:" then five samples (macOS
with check "automated check", macOS with dash "manual", clipboard "no
platform", green link "linked to automated rules", orange link "linked to
manual rules"), in `text-xs text-muted-foreground`, wrapping at narrow
widths. The sample icons are `aria-hidden`; the text carries the meaning.

## 7. Interfaces (pure logic)

In `webui/src/logic/ruleStatusIcons.ts`:

```ts
export type CheckStatus = 'automated' | 'manual'

export interface StatusIcon {
  kind: 'target' | 'no-target' | 'link'
  // Target name for 'target'; absent otherwise.
  targetName?: string
  status: CheckStatus
  label: string
}

export function targetStatus(row: RuleRow, targetName: string): CheckStatus
export function linkStatusCounts(ruleId: string, byRule: ReadonlyMap<string, MappedRule[]>, rowsById: ReadonlyMap<string, RuleRow>): { automated: number; manual: number }
export function rowStatusIcons(row: RuleRow, linkCounts: { automated: number; manual: number }, index: VocabularyIndex): StatusIcon[]
export function stripAccessibleName(icons: readonly StatusIcon[]): string
```

`targetIcons.ts` gains `NO_TARGET_ICON`, `LINK_ICON` and
`STATUS_MARK_ICONS: Record<CheckStatus, string>`.

## 8. Test strategy

- **Vitest** for `ruleStatusIcons.ts`: target order and status, no-target
  clipboard, reason labels, link counts (distinct ids, both directions,
  related, ids missing from the library ignored), mixed links giving two
  icons in automated-then-manual order, no links giving none, accessible
  name joining.
- **Playwright e2e:** row strip names and tooltips on hover and focus for
  a real automated mSCP rule and a real linked ISM control (ids read from
  the release indexes and mapping files, not hard-coded totals); the
  legend is present; existing assertions on pill text in rows are moved
  to the new names.
- **Screenshots** at about 375px and 1280px, light and dark, read before
  calling the work done (`.claude/CLAUDE.md`).

## 9. Suggestions beyond the request

- Make the link icons a shortcut to the row's Mapped rules tab (a click
  target needs care: the row itself expands on click).
- Add a "Has linked automated rules" filter, which answers "which manual
  controls are covered by automation" directly.
- Add `check_targets` to the index before the first two-target rule
  (section 4).

## 10. Decisions made without the maintainer

- **Option B over A and C** (needs confirmation). Alternatives: A keeps
  text on screen at the cost of width; C keeps one word in a narrower
  chip.
- **Per-target colour uses the rule's assessment for every target.**
  Alternative: add `check_targets` to the index now; deferred because no
  rule has two targets and it touches the schema, the Python writer,
  overlays and every regenerated index.
- **Corner marks (check / dash) as the second cue.** Alternatives: filled
  vs outline glyphs (brand glyphs such as Apple have no outline form), or
  a dashed underline.
- **Token values** in section 6.1. Alternative: reuse
  `--success-foreground` / `--warning-foreground` (rejected: same
  lightness, so not deuteranope-safe).
- **One tab stop per strip with a combined focus tooltip.** Alternative:
  each icon focusable (up to four tab stops per row).
- **Links counted as distinct direct linked rules of any relation**
  (supports either way, related), within the loaded library. Alternative:
  count only rules that support this one.
- **Manual reason moves to the tooltip** in rows; the Mapped rules
  summary header keeps the text pill.
- **No tap-to-open tooltip on touch**; the legend covers it.
- **No licence change**: Bootstrap Icons is already bundled and listed by
  the licence plugin.

## Progress log
- 2026-11-13: Implemented as Option B. The maintainer confirmed Option B and the token values; the glyphs reuse the bundled bootstrap-icons package. Commits: 7855be2 feat: add rule status icon logic and status colour tokens; cbaf063 feat: show rule status as coloured platform and link icons. Notes: the strip tooltip opens on keyboard focus only (a programmatic `focus()` without keyboard modality does not open it); the hover tooltip belongs to each icon.
