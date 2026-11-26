# Rule detail: section cards - design

## Why

In the rule detail panel, sections are separated only by small uppercase
headings. That makes it unclear what belongs to which section. The check and
remediation pills also open content underneath them, and nothing visually
connects that content to the pill that opened it. The goal is a rule view
that is readable, makes it obvious what belongs to which section, and is
formatted cleanly.

## Goals

- Each section (Values, Check, Remediation, Benchmarks, References) is
  visibly a separate unit with clear edges.
- The script choices (PowerShell, Original goss test, ...) read as tabs
  that own the content beneath them, and sit at the left, next to where the
  reader is already looking.
- Works at phone width (~375px) and inside narrow containers (the rule
  details dialog, nested mapped-rule panels).

## Non-goals

- Changing the content of any section, the Details / Mapped rules / History
  tabs, or the code block itself (its copy button already sits inside it,
  top right, and stays there).
- Fixing the ODV description wording ("win11cis_... is the policy setting
  determines ..."); that is a separate data issue.

## Approaches considered

Mockups compared in the brainstorm session (2026-11-26):

- **A. Folder tabs joined to a box** under the existing headings. Smallest
  change, but the heading still floats above the box.
- **B. Cards with a title bar** along the top. Clear grouping. Variants
  moved the tabs left, but the cards add a lot of visual weight.
- **C. A left label column** (spec-sheet style). Clearest, but too much
  padding in the first version.
- **C3 (chosen): a label column inside cards.** Each section is a bordered
  card with its label in a grey strip on the left. Combines C's clarity with
  B's edges.

## Design (C3)

- **Section card**: a new shared component. It's a bordered, rounded white
  card in a two-column grid. The left column (~6.5rem) is a `muted` strip
  with a right border, holding the section's `h3` heading and, when that
  section has custom content, the Custom tag underneath. The right column
  holds the content.
- **Narrow widths**: the layout is decided by the panel's container width
  (a container query), not the viewport, because the panel also renders in
  the dialog and nested panels. When the panel is narrow, the strip becomes
  a bar across the top of the card, with the heading and Custom tag on one
  line.
- **Labels**: "Values" (shortened from "Organization-defined values" so it
  fits the column), "Check", "Remediation", "Benchmarks", "References".
- **Check / Remediation choices**: underline tabs, in the same style as the
  Details / Mapped rules / History tabs. They're built with Base UI Tabs,
  which the panel already uses. The first tab is selected by default and
  one tab is always selected. This replaces the earlier start-closed,
  collapsible pills (user's decision, 2026-11-26). A section with a single
  item still shows its one tab, since the tab says what the script is.
- **Version picker** (per-version checks): a segmented control between the
  tabs and the code. It keeps today's pressed-button semantics.
- **Outside the cards**: the custom/stale notes, the custom title, the
  breadcrumb, the revision line, the discussion text, the "Custom:" field
  line and the "From ... licensed under ..." source line stay as plain text
  above and below the cards.
- **Breadcrumb and revision on one line**: when a rule has both, they sit
  on one muted line separated by ` · `, e.g. `1 › 1.1 · Revision 3, updated
  2026-08-01` (requested by the user, 2026-11-26). Either one alone shows on
  its own, as today.
- **Kept for accessibility and tests**: section headings stay `h3`, and the
  Benchmarks section stays a region named "Benchmarks". Check and
  remediation panels keep the `check-target` / `remediation-target` test
  ids and are labelled by their tab.

## Left to the builder

- Exact spacing within the Tailwind scale, and the container-query
  breakpoint.
- Updating the e2e specs that assert pill `aria-expanded` behaviour to
  assert tab selection instead.
