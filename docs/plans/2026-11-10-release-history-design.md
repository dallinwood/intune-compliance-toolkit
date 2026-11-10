# Design: release history and framework comparison

Date: 2026-11-10
Status: Approved 2026-11-10

## 1. Intent

Frameworks get new releases: NIST mSCP ships point releases (27.0, then 27.1) and the ASD ISM
publishes a new edition every few months. Today the library holds exactly one release per
source. Each import replaces the previous one, so the app can't say what changed.

The maintainer's real situation: an organisation was compliant with a framework release some
time ago, and nobody has reviewed the infrastructure since. Today the only options are to
re-read every rule by hand or to do a full audit. The goal is to cut that down by showing exactly
what changed between the release they were last compliant with and the current one, so only
those rules need re-checking.

There is a second, rule-level need: custom changes (the project's "overlays",
`docs/plans/2026-10-23-custom-overlays-design.md`) sit on top of imported rules. When the
underlying rule changes upstream, the maintainer needs to notice that and decide whether the
custom changes still hold.

Three things are added:

1. **Per-release storage.** Every imported release of a source is kept, not just the latest.
2. **Rule history.** A rule's detail panel gets a History tab: a timeline of the releases in
   which it changed, with a field-by-field diff for each.
3. **Framework comparison.** A new Frameworks tab lists each framework and its releases, and
   compares any two releases of one framework: rules added, removed and changed, with the same
   field-by-field diffs.

## 2. Goals, non-goals, anti-goals

### Goals

- Keep every imported release of every source in the repo. The newest release (the "current"
  release) drives everything that exists today: browsing, filters, counts, mappings, overlays and
  Generate.
- Compare our normalised rule format against our normalised rule format, always. Raw upstream
  data is never compared.
- Show a rule's history as a timeline. Releases where the rule did not change fold away.
- Compare any two releases of a framework, not only neighbouring ones.
- Sort each change into a kind (Behaviour, Scope, Wording, References) so a reviewer can narrow a
  large comparison to the changes that matter.
- Keep one importer per upstream source format, so an old release can always be re-imported with
  the importer that understands its format.
- Tell the maintainer when a rule they have customised has changed since the custom changes were
  written, and link straight to the diff.
- Stay with the app's current styling: the same tabs, section headers, pills, code blocks and
  light/dark theme tokens.

### Non-goals (for now)

- **Showing older releases in browse/filter views.** Browsing shows only the current release. An
  opt-in "show older releases" toggle may come later, but it is not part of this work.
- **Exporting a comparison** (CSV, printable report, ticket list). The maintainer wants this
  later, as its own piece of work. Keep the comparison data in a shape an export could reuse, but
  build no export UI.
- **mSCP releases before 27.0.** Earlier mSCP releases ship one release per OS in an older
  format. They would need a second mSCP importer, so mSCP history starts at 27.0. The
  per-format importer structure (section 4.3) must make adding that importer later a contained
  change.
- **Detecting renamed rules.** A rule whose id changes between releases shows as one removed
  rule and one added rule.
- **Applying old releases' content to Generate, mappings or overlays.** Those keep using the
  current release only.

### Anti-goals (failure even if it technically works)

- A comparison where nearly every rule shows as "changed" because of release bookkeeping (commit
  SHA, release tag, upstream URL). Ignored fields must really be ignored.
- A comparison that reports a change in *our* format (a schema migration, an importer bug fix) as
  if upstream had changed the rule. All releases of a source must be produced by the current
  importer code and schema.
- Releases with no change for a rule spelled out one by one in that rule's history.
- Older releases leaking into the Rules view's table, filters, counts or Generate.
- Using the word "overlay" in user-facing text. Users see "custom changes", matching the existing
  purple **Custom** tag.

## 3. Releases to import

| Source | Releases kept | Notes |
|---|---|---|
| NIST mSCP | `release_27.0` (already imported), `release_27.1` (new, published 2026-10-22) | 27.1 becomes current. |
| ASD ISM | `v2025.12.9`, `v2026.03.24`, `v2026.06.18` (new), `v2026.09.4` (already imported, current) | The last 12 months of ISM editions as of 2026-11-10. |

All four ISM tags were checked on 2026-11-10. They are still published, and each publishes the
same set of files (`ISM_catalog.json`, the per-classification and Essential Eight baseline
profiles, `README.md`). So they very likely share one format, but the contents of
`ISM_catalog.json` have not been compared field by field. Milestone 2 runs the current importer
against each older tag first. If any tag fails or produces suspect output, the builder **stops
and asks the maintainer** before writing a second importer or dropping that edition. Neither of
those is decided here.

Milestone 2 also reports, per source and release pair, how many rule ids were added and removed.
This shows how much "renamed rule = removed + added" noise there really is. A rename heuristic
stays a non-goal unless the maintainer asks for one after seeing those numbers.

## 4. Storage and import

### 4.1 Approach (decided)

Releases are stored as **one folder per release**, listed in the manifest. Using git history to
reconstruct old releases was considered and rejected. The web app is a static GitHub Pages site
with no git access at runtime. Mining history at build time would break on shallow CI clones, and
it would make correctness depend on commit hygiene.

Approximate cost: about 3 MB per mSCP release and 6.5 MB per ISM release of normalised JSON,
plus a similar amount of vendored upstream data per release. That's acceptable for years of
releases.

### 4.2 Layout

- `baselines/<source>/releases/<release_tag>/rules/*.json` and `.../_index.json`, one folder per
  release. Same rule file format and index format as today.
- `sources/<source>/releases/<release_tag>/source.json` (source lock) and `.../upstream/`
  (vendored upstream copy), one folder per release. Every release can then be re-imported offline,
  exactly as the current release can today.
- `baselines/_manifest.json` lists every release per source and names the current one. Today each
  source entry carries one `release_tag`, `commit_sha`, `index_path` and `rule_count`. These move
  into a per-release list, and the source entry gains a `current_release`. The schema version
  bumps and `_manifest.schema.json` is updated. The builder decides the exact field names.
- Rule ids (`mscp.os_gatekeeper_enable`, `asd_ism.ism-0359`) do not change. Overlays and mappings
  keep referring to rules by id and keep applying to the current release.

### 4.3 One importer per upstream format

- Each source lock records which importer format reads it (for example `"importer_format":
  "mscp-2"`). Both current importers become the first format for their source.
- Format-specific code (fetching and normalising) lives in its own module per format. Shared
  output code (`tools/library_output.py`, `tools/json_output.py` and so on) stays shared.
- The import command can import a new release and can re-import any or all existing releases
  from their vendored upstream copies. Each release goes through the importer its lock names.
- `tools/validate_library.py` checks that every release of a source has the same
  `schema_version` as the current schema. A schema change therefore forces every release to be
  re-imported, which is what stops format changes from showing up as rule changes.

### 4.4 Choosing the current release

The current release is the newest by upstream publish date. The builder decides whether the
importer works this out or the maintainer sets it explicitly, but adding an older release (as
this work does for ISM) must never make it current. Re-importing an existing release (one or
all) must be idempotent: same output, and `current_release` untouched.

## 5. How changes are computed

### 5.1 Identity and ignored fields

- Rules are matched across releases by `id`.
- There is **one global ignore list** for all sources, written against our rule format, not per
  framework. Ignoring a field ignores everything under it. It contains at least `source` (commit
  SHA, release tag, upstream path and URL, upstream revision and updated date) and
  `schema_version`. The builder may add other fields that turn out to be pure bookkeeping, and
  records each addition and the reason in the design's progress log.

### 5.2 Kinds of change

Every top-level field not on the ignore list belongs to exactly one kind:

| Kind | Fields | Shown by default in the comparison |
|---|---|---|
| Behaviour | `check`, `remediation`, `odv`, `assessment`, `architecture` | yes |
| Scope | `applicability` (targets, versions, benchmarks, severity) | yes |
| Wording | `title`, `discussion`, `discussion_format` | yes |
| References | `references`, `tags`, `section_path` | no (box unticked) |

For ISM, `title` holds the control statement, so a reworded control counts as Wording.
Putting `section_path` (a rule moving section) under References is a builder's call (see
section 9).

A rule can have several kinds of change at once. It counts once in "rules changed" and carries a
tag for each kind.

### 5.3 Where the work happens

Following the existing pattern for the overlay, mapping and catalogue indexes,
`scripts/copy-baselines.mjs` precomputes history data at build time from the committed release
folders. It writes this only to the published copy, never to the repo. The diff and
categorisation logic is a pure TypeScript module under `webui/src/logic/`, covered by Vitest and
shared by the build script and the app.

The app must not fetch every rule of two ISM releases (more than 2,000 files) to draw a
comparison. Recommended shape, which the builder may change if they keep its properties:

- A **history index** per source, fetched when the Frameworks tab or a History tab opens. For each
  rule and each release, it holds whether the rule exists in that release, plus one fingerprint per
  kind of change (a hash of that kind's fields with ignored fields removed). Comparing any two
  releases is then a fingerprint comparison: the kinds whose fingerprints differ are the kinds
  that changed. This holds even when a change in one release is reverted in a later one. The
  index also carries each rule's display title, section and the facets the compare view's
  filters use (applicability benchmarks such as ISM classification and Essential Eight), so the
  comparison list, its search and its filters work without further fetches. A rule's title,
  section and facets come from the latest release in which it exists, so removed rules can still
  be filtered.
- A **history file** per rule. It holds the distinct versions of the rule (ignored fields
  stripped) and which releases each version covers. It is fetched only when a row is expanded or a
  History tab is opened. The field-level diff is computed in the browser from two versions.

## 6. User interface

The maintainer approved these layouts in mockups on 2026-11-10 (layout "B" for rule history).
Mockup files: `.superpowers/brainstorm/1153-1794280049/content/rule-history.html` and
`framework-compare.html` (local only, not committed).

### 6.1 Diff rendering (shared by both views)

- Each changed field shows on its own row: a field label on the left, the change on the right.
- Prose (title, discussion): the text is shown once, with removed words highlighted red and
  struck through, and inserted words highlighted green.
- Code (check shell, remediation scripts, payloads): line-based, with `-` lines on a red tint and
  `+` lines on a green tint, inside the existing dark code block style.
- Lists and sets (benchmarks, tags, reference ids): added items as green "+" pills, removed items
  as red struck-through pills.
- Nested structures (applicability per version, references per framework) are labelled by path
  in plain words (for example "Benchmarks · macOS 27" or "References · NIST 800-53r5"), not by raw
  JSON path.
- Kind tags: Behaviour (red), Scope (amber), Wording (blue), References (grey). Colours are
  added as theme tokens with dark-mode values and must meet the same WCAG AA contrast as the
  existing tokens.

### 6.2 Rule History tab

- The rule detail panel gets a **History** tab beside Details and Mapped rules, labelled with
  the number of releases where the rule changed (for example "History (2 changes)"). It appears
  only when the rule's source has more than one release.
- The tab body is a single timeline, newest first:
  - Each release where the rule changed is a collapsible card. Its header shows the release's
    friendly name (for example "Sep 2026" or "27.1"), the release tag, and the kind tags. The
    newest change starts open; the rest start closed.
  - A run of consecutive releases with no change folds into one dashed bar: "── 1 release with no
    changes (Jun 2026) ── show". Clicking it expands the bar into plain "no changes" entries.
  - The earliest release in history is marked "earliest release in history". A rule that first
    appears in a later release is marked "Added in <release>". A rule absent from the current
    release (opened from a comparison) is marked "Removed in <release>".
- A "Compare any two" pair of release pickers sits at the top. Choosing a pair shows one diff for
  that span, instead of the release-by-release timeline.
- A "Show: All changes / Behaviour only" toggle sits at the top as well.

### 6.3 Frameworks tab

A new top-level tab, **Frameworks**, between Rules and Licences.

**Landing view:** one card per framework. Each card shows the framework's display name, its
current release and rule count, a row of pills for every imported release (the current one
highlighted and labelled "current"), and a **Compare releases** button.

**Compare view:** the same sidebar-plus-main layout as the Rules view.

- Sidebar:
  - Framework picker.
  - From and To release pickers. They default to the previous release → current release. To
    must be later than From.
  - "Kind of change" checkboxes with counts: Behaviour, Scope and Wording ticked; References only
    unticked, so rules whose only change is renumbering don't bury the real changes.
  - "Only rules that…" checkboxes: "have my custom changes" and "are in my selection". These are
    the builder's suggestions, so the maintainer has not specifically approved them; see
    section 9.
  - Section filter, plus the framework's existing applicability filters (for example ISM
    classification levels and Essential Eight) where they apply.
- Main area:
  - Summary tiles: rules added (green), rules removed (red), rules changed, and rules unchanged
    (hidden).
  - A search box over the changed rules, plus Expand all / Collapse all.
  - Three groups in the existing section-header style: **Added**, **Removed**, **Changed**.
    Rows read like the main table (title, id, kind tags). Removed rules' titles are struck
    through.
  - Expanding a changed row shows the same field-by-field diff as a History card, then two links:
    **Open rule** and **Full history**. Expanding an added or removed row shows that rule's details
    as of the release it exists in.
- The framework, the release pair and the filters are kept in the URL, like the Rules view's
  filters, so a comparison can be bookmarked or shared.

### 6.4 Custom-changes notice

This extends the existing "written for an older release" note on overlaid rules (custom
overlays design, section 2). User-facing text never says "overlay".

- **Changed in a field the custom changes touch** (warning style):
  > **Your custom changes to this rule were written for Mar 2026.** The rule has since been
  > updated in a field your custom changes touch (Check · Windows). See what changed →
- **Changed only in other fields** (muted style): same opening sentence, then "The rule has since
  been updated, but not in any field your custom changes touch. See what changed →".
- **No change since** (muted style): "…written for Mar 2026. The rule hasn't changed since, so
  they can be marked as up to date." (Marking means updating the release recorded in the overlay
  file. That stays a maintainer edit in the repo.)
- "See what changed" opens the History tab in "compare any two" mode: the custom changes' release
  → current release, showing every changed field, with the fields the custom changes touch shown
  first.
- "Fields the custom changes touch" means the rule field paths under the overlay file's `fields`.
  Overlay files use the same field names as rules (`remediation.Windows`, `references`, ...), so
  the match is direct. A field changed upstream counts as touched when its path equals, contains
  or sits inside an overlaid path. Ignored fields are never reported as changed.
- **Recorded release older than the stored history** (for example, custom changes written
  against an mSCP release before 27.0): the notice says "…written for <release>, which is older
  than the releases kept here", and "See what changed" compares from the earliest stored
  release, with that stated at the top of the diff.
- **Recorded release missing from the history for another reason** (a typo, a release never
  imported): the existing "written for an older release" note shows unchanged, with no diff link.

### 6.5 Rules view

Unchanged, apart from data now loading from the current release folder. Browse, filters, counts,
selection and Generate never see older releases.

## 7. Delivery

This is too large for one change. Ship it as milestones, each committed and pushed on its own and
each leaving the app working:

1. Per-release storage, manifest change, and per-format importer structure. Existing data is
   migrated into the new layout with no visible change in the app.
2. Import mSCP 27.1 and the three older ISM editions.
3. Diff and categorisation logic, plus build-time history index and history files (with Vitest
   coverage).
4. Rule History tab.
5. Frameworks tab: landing and compare view.
6. Custom-changes notice.

The writing-plans step turns these into an implementation plan at
`docs/plans/2026-11-10-release-history-plan.md`. The plan's progress log records each milestone as
the repo's CLAUDE.md requires. Every milestone that touches the UI gets Playwright screenshots at
about 375px and desktop width, read before the milestone is called done.

## 8. Decided by the maintainer

- One folder per release, listed in the manifest. Not git history.
- Comparisons always run on our normalised format, never on raw upstream data.
- One global ignore list, not one per framework. Ignoring a parent field ignores its children.
- The change kinds and their fields (section 5.2).
- One importer per upstream format, kept so that old releases can be re-imported.
- mSCP history starts at 27.0. ISM imports the last 12 months of editions.
- Rule history uses the single-timeline layout (mockup B), with "no change" stretches folded.
- Frameworks tab with a landing overview and a compare view, as mocked up.
- User-facing wording is "custom changes", never "overlay".
- Exporting a comparison is a later feature.
- Browsing shows only the current release. An older-release toggle may come later.

## 9. Left to the builder (calls made during design, open to review)

- Exact manifest, source lock and history file field names and formats.
- Putting `section_path` under References rather than giving it its own kind.
- The "Only rules that… have my custom changes / are in my selection" filters in the compare
  view. These were proposed in the mockup and not objected to, but not explicitly requested. Drop
  them if they complicate milestone 5.
- Friendly release names (for example "Sep 2026" for `v2026.09.4`, "27.1" for `release_27.1`):
  where they're defined (a manifest field set by the importer is the likely answer).
- How a release-to-release diff is presented for deeply nested structures, within the rules in
  section 6.1.
- Whether the "Compare any two" mode in the History tab and the compare view share one component.
- History file granularity. One file per rule is the starting point. It adds about 1,500 small
  files to the published site per build, well within GitHub Pages limits. Grouping per section is
  fine if the deploy or build time says otherwise.

## Progress log

- 2026-11-10: Design written, reviewed by a builder check, and approved by the maintainer.
