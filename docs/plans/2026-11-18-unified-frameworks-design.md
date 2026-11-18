# Unified Frameworks tab - design

Status: awaiting approval (builder check done)
Mockups: `.superpowers/brainstorm/frameworks-unify/mockups-v1.html` (layout B, coverage option 2)

## Why

The Rules, Frameworks and Coverage tabs have grown into three views of one
thing: a framework's rules, how it changed between releases, and how much of
another framework it covers. Having them as separate top-level tabs feels
disjointed. The coverage view also cannot answer the question that matters
most when planning a baseline: "of what this framework *could* cover with
today's mappings, how much does my configuration actually cover?"

## Goals

- One top-level **Frameworks** tab replaces Rules, Frameworks and Coverage.
  Licences and Products are unchanged.
- The Frameworks home page is a grid of framework cards (mockup layout B).
  Each card keeps today's release list and adds small coverage bars.
- Opening a card shows that framework's page with three sub-tabs:
  **Rules**, **Releases**, **Coverage**. A "Browse all rules" entry on the
  home page opens the unscoped Rules table (today's Rules view).
- Coverage is reported **per pair of frameworks**, automatically for every
  pair that has at least one mapping link, with a **cap**: the maximum
  coverage the current mappings allow.
- A **combined** report for each framework that is covered by two or more
  other frameworks.
- Every state is in the URL, so a shared link opens the same view.

## Non-goals

- No changes to mapping data, mapping files, or how mappings are generated.
- No change to how the Rules table, filters, selection, Generate review or
  release comparison behave internally; they are re-homed, not rewritten.
- No all-pairs matrix (mockup option 3). The cards' small bars give that
  overview.
- No "combined from the covering side" bar (e.g. mSCP's reach into NIST + ISM
  summed). It mixes two different control sets on one scale; rejected.

## Anti-goals

- A selection bar that can exceed its cap line. The per-pair bar must count
  the same rule set as its cap, or the cap stops meaning anything.
- Pair lists maintained by hand. A new mapping file must show up in coverage
  with no code or config change.
- Breaking existing links (`/rules`, `/coverage`, `/frameworks?framework=...&from=...&to=...`).

## Data today (for scale)

From `baselines/_mappings/rules/`:

| Covering framework | Covered framework | Relation | Controls reachable (cap) | Covered framework size |
|---|---|---|---|---|
| mSCP | NIST 800-53 | supports | 140 | 1,014 |
| mSCP | ASD ISM | supports | 61 | 1,143 |
| ASD E4EIT | ASD ISM | related | 222 (related only) | 1,143 |

No ISM to NIST or E4EIT to NIST links exist. So ISM is the only framework
covered by two others today (and gets a combined bar); NIST does not yet.

## Approaches considered

1. **One Frameworks view, sub-tab in the query string (chosen).**
   `/frameworks` is the card grid; `/frameworks?framework=mscp&tab=coverage`
   is a framework page; `?framework=all&tab=rules` is the unscoped rules
   table. Matches the existing URL model (view from the first path segment,
   everything else in the query string, see `src/state/urlState.ts`) and
   today's comparison URL. Chosen because a shared link reproduces the exact
   view with no routing/hosting changes.
2. **Path sub-pages** (`/frameworks/mscp/coverage`). Nicer URLs, but routing
   only reads the first path segment and `scripts/route-pages.mjs` emits one
   static page per view; deeper paths need new routing and host fallbacks.
   Rejected: cost and risk for a cosmetic gain.
3. **Keep Rules/Coverage as hidden views linked from Frameworks.** Cheapest,
   but sub-tabs would jump between views and lose framework context, which
   defeats the purpose. Rejected.

## Layout (decided)

### Header

Top tabs: **Frameworks · Licences · Products**. The selection toolbar
(selected count, Generate) and command palette stay in the header and are
available on every Frameworks sub-page, because a selection can span
frameworks. Generate's review screen opens from any Frameworks page, as it
does from Rules today.

### Home: framework cards

- A "Browse all rules" link at the top (to `?framework=all&tab=rules`).
- One card per framework (from the manifest sources, as today), showing:
  current release and rule count; the release list (each release still
  opens its comparison, now the Releases sub-tab); a compact coverage block
  (below); links to the Rules and Coverage sub-tabs.
- Compact coverage block on a card lists every pair involving this
  framework *as the covering side* ("→ NIST 800-53") and *as the covered
  side* ("Supported by mSCP", "Related to E4EIT"), each as a small version
  of the per-pair bar with its "max N" cap label. If the card's framework is
  covered by two or more frameworks, a combined "All mapped frameworks" bar
  is last, under a divider.
- A framework with no mappings shows no coverage block.

### Framework page

Title, current release, rule count, and sub-tabs **Rules · Releases ·
Coverage**. Coverage is hidden for a framework with no mappings.

- **Rules:** today's Rules view (filter sidebar + table), scoped to this
  framework. The scope comes from the `framework` URL parameter and is
  separate from the filter store's `sources` set: on a framework page the
  Framework facet is hidden and `sources` is ignored (left untouched, so it
  comes back on `framework=all`). Clear filters does not change the scope.
- **Releases:** today's release comparison. With no `from`/`to`, it defaults
  to the current release against the previous one (what clicking the
  current release does today).
- **Coverage:** the full reports (below).

`framework=all` shows only the Rules sub-tab.

## Coverage reports (decided)

### Terms

- **Covering framework** A, **covered framework** B. A pair (A, B) exists
  when any rule of A reaches a rule of B, either by a direct mapping link or
  through a chain of `supports` links via other frameworks (A → C → B).
  Pairs are discovered from the loaded mappings, never listed by hand.
  (Design call: transitive pairs are included, so every chain counted in a
  cap belongs to a pair that is shown.)
- A pair is a **supports pair** if any `supports` path from A reaches B,
  otherwise a **related-only pair**.
- B's **covering frameworks** are every A with a pair (A, B), excluding B.

### Per-pair report (supports pairs), mockup option 2

Computed with the existing `frameworkCoverage` logic
(`src/logic/selectionCoverage.ts`), run twice:

- **Cap:** as if every rule of A were selected (supporting checks
  included). Counts controls of B covered directly or through supporting
  chains. Multi-hop chains count (A → C → B), as supporting checks do today.
- **Your selection:** only the user's selected rules *from A*, plus only
  the included supporting checks that those A rules pull in (per the
  existing supporting-checks setting). Rules selected from other
  frameworks, and supporting checks pulled in by them, are not counted
  here. This guarantees selection is never above the cap.
- **Scope:** the existing benchmark scope picker (all controls, or one of
  B's benchmarks) stays on the full report. B's total, the cap and the
  selection are all computed within the chosen scope, so the memo key for
  a cap is (A, B, scope, Automated checks only). Cards always use all
  controls. Scope stays component state as today (not in the URL).

Display:

1. **Whole-framework bar**: 0 to B's total control count. Solid = supported
   directly, striped = through supporting checks, grey = related only (as
   today's `CoverageBar`). A vertical cap line labelled **"max N"** (e.g.
   "max 140") at the cap position.
2. **Within-reach bar**: 0 to the cap. Same solid/striped segments.
   Labelled "Within reach of A - N controls", with "X% of the cap" and
   "N direct · N through supporting checks" / "N still to go".
3. A toggle **All rules / Your selection**. "All rules" is the quick
   check: it shows the cap itself (within-reach bar full).
4. The existing "Automated checks only" option applies to both cap and
   selection.
5. Below the bars: the existing per-section breakdown and per-control
   detail from today's `FrameworkCoverageCard`, for the chosen mode.

On A's page the report is titled "A → B"; on B's page the same report is
titled "Supported by A". Both read identically otherwise.

### Related-only pairs

Shown automatically (e.g. E4EIT → ISM) with a single grey bar of related
controls over B's total, labelled "related only". No cap line and no
coverage percentage, because related links never count as covered.

### Combined report

On the covered framework B, when B has two or more covering frameworks
(supports or related):

- **Cap:** as if every rule of every covering framework were selected.
- **Your selection:** the user's whole selection, any framework, with
  every included supporting check (this is what today's Coverage view
  computes). It cannot exceed the cap: any selected rule that reaches B
  belongs to one of B's covering frameworks, because pairs include
  transitive chains, and rules selected from B itself are reported as
  "selected directly" (as today), never as covered.
- Same two-bar format, "max N" cap line and toggle, titled "All mapped
  frameworks". On B's Coverage sub-tab it comes after the per-pair reports.

### What carries over from today's Coverage view

The "selected rules that support no control" list and the "Add supporting
checks" action move to the Coverage sub-tab (on every framework page that
has one). The related-only notice for frameworks with no coverage figure is
replaced by the related-only pair display.

## URLs and redirects (decided)

- `tab` query parameter: `rules` | `releases` | `coverage`. Missing `tab` on
  a framework page means `rules`. `framework=all` accepts only `rules`.
- `/frameworks` with no `framework` shows the card grid. The default view
  (bare base URL) becomes `frameworks` (was `rules`).
- `/rules?...` redirects to `/frameworks?framework=all&tab=rules&...`,
  keeping its filter parameters. If exactly one source filter is set, the
  redirect may go to that framework's page instead (builder's call).
- `/coverage` redirects to `/frameworks` (the card grid).
- `/frameworks?framework=X&from=..&to=..` (today's comparison links) opens
  X's Releases sub-tab with that range.
- `scripts/route-pages.mjs` keeps emitting `rules/` and `coverage/` pages
  so old links load the app and redirect; a test keeps it in step with the
  view registry.
- Redirects replace the history entry (no back-button loop).
- An unknown `framework` shows the card grid; an unknown or disallowed
  `tab` falls back to `rules`. Switching framework (from a card or link)
  opens the tab the link names; `tab` is not carried between frameworks.

## Constraints

- Follow existing conventions (CLAUDE.md): Vitest for `logic/*`, Playwright
  e2e plus real screenshots at ~375px and desktop for every visual change.
- Pair and cap computation runs for all pairs on the home page; reuse a
  memoised cap per pair (it only depends on mappings, rows and Automated
  checks only, not on the selection).
- Accessible: bars keep `role="img"` with an `aria-label` that states the
  numbers, including the cap.

## Left to the builder

- Component structure and file names; whether `RulesView`/`CoverageView`
  become sub-tab components or are wrapped.
- Exact copy and spacing, within the mockup's direction.
- Whether a filtered `/rules` link redirects to a specific framework page.
- How the compact bars degrade at ~375px (stack, shorten labels).
