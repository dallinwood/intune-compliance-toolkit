# Design: open a release's changes straight from the Frameworks tab

Date: 2026-11-12
Status: Implemented 2026-11-12 (the calls in section 8 were made without the maintainer and still await review)

## 1. Intent

The maintainer's request, in their words:

> On the frameworks page, it would be good to be able to press on each Framework release,
> and be taken straight to the comparison for it. Instead of having the Compare releases
> button (and greying it out for frameworks with only 1 release), if I press the 'Jun 2026'
> release for 'ASD Information Security Manual' it will automatically open up the comparison
> view between that release and the release before it, so you can see what changed. When in
> the compare view, you can then change the compare to be between different releases (like
> we already can). If someone clicks on the first release for a framework, it should still
> take them to the same view as the other releases, but it's effectively compared against an
> empty release, so everything in the first release is added / new.

Today each card on the Frameworks tab (`webui/src/components/frameworks/FrameworkCards.tsx`)
lists its releases as inert pills, plus one "Compare releases" button that opens the
previous-to-current comparison and is disabled for a framework with one release (NIST SP
800-53 and ASD E4EIT today). This design makes every pill a link to "what changed in this
release", removes the button, and adds an **empty release** baseline so the first release
(and a single-release framework) opens the same view with every rule listed as added.

## 2. Goals, non-goals, anti-goals

### Goals

- Each release pill opens the comparison from the release before it to that release.
- The first release of any framework opens a comparison from an empty release: every rule in
  it is in Added; Removed, Changed and Unchanged are 0.
- The empty release is part of the address, so the view can be shared and survives reload.
- In the comparison, the From select offers the empty release; the Framework select lists
  every framework, including single-release ones.
- Pills are real links (middle-click and copy link work) and are keyboard and screen-reader
  accessible.

### Non-goals (for now)

- A per-release summary on the card (counts of added or changed rules).
- Comparing across frameworks.
- Any change to a rule's History tab ("Compare any two" there keeps real releases only).

### Anti-goals (failure even if it technically works)

- A disabled or dead control on any card.
- An empty-release address that silently shows a different range.
- Breaking existing comparison addresses (`?framework=asd_ism&from=<tag>&to=<tag>`) or the
  existing comparison e2e tests (other than the one that pressed the removed button).

## 3. Facts that shape this design

- The comparison address: `/frameworks?framework=<source>&from=<tag>&to=<tag>`, parsed into
  `compareFrom` and `compareTo` by `webui/src/state/urlState.ts`. A missing or invalid range
  falls back to previous-to-current in `resolvedRange` inside `ReleaseComparisonView.tsx`.
- Opening a comparison is `useFilterStore.showComparison(framework, from, to)`; leaving it is
  `closeComparison`. `startsHistoryEntry` makes opening and closing a comparison a history
  entry, so Back returns to the cards.
- `FrameworksView.tsx` shows the cards unless the framework has two or more releases.
- `compareReleases(index, fromTag, toTag)` in `webui/src/logic/historyIndex.ts` throws for an
  unknown tag or a From not before To. Each rule's `versions` array holds `null` for releases
  without it, so "absent everywhere before" is already the representation of "added".
- A history index is published for every source, single-release ones included
  (`scripts/copy-baselines.mjs`).
- `ComparisonSidebar.tsx`: the Framework select lists only sources with two or more releases;
  From lists every release but the last; To lists releases after From.
- Release tags match `^[A-Za-z0-9_-][A-Za-z0-9._-]*` (manifest schema); real tags today look
  like `release_27.1`, `v2026.09.4`, `v1.6.0`, `v2026.10.15`.
- `webui/e2e/frameworks.spec.ts` presses the "Compare releases" button in one test and reads
  the pills as `getByRole('list', { name: 'Releases' }).getByRole('listitem')`.

## 4. The empty release

- **Address:** `from=empty`. Example: `/frameworks?framework=nist_800_53&from=empty&to=v1.6.0`.
  `EMPTY_RELEASE_TAG = 'empty'` in a new `webui/src/logic/releaseRange.ts`. If a source ever
  has a real release tagged `empty`, the real release wins and that source has no empty
  baseline (section 8).
- **Meaning:** a release containing no rules. `compareReleases` treats it as a From position
  before the first release, where every rule is `null`. Every rule present in To is added;
  nothing is removed, changed or unchanged.
- **Labels:** the From option and the heading call it "Empty release". The heading reads
  "<display name>: Empty release to <To label>", and below it one line:
  "Compared with an empty release, so every rule in <To label> is listed as added."
- **Counts:** the four tiles work as now: Added equals the rules in To, the other three show 0.
  The kind-of-change counts are all 0 (they count changed rules only); the group stays shown.
- **Default range:** with no valid range in the address, two or more releases give
  previous-to-current as today; one release gives empty-to-current. An address naming
  `from=empty` with a valid To keeps it.

## 5. Behaviour

### 5.1 Framework cards

- The "Compare releases" button and the `ONLY_ONE_RELEASE` title are removed.
- Above the pills, one muted line: "Choose a release to see what changed in it."
- Each pill becomes an `<a>` inside its `<li>` (the list and its `aria-label="Releases"`
  stay). `href` is the comparison address from the previous release (or `empty` for the
  first) to that release. A plain left click calls
  `showComparison(source.name, previousTag, release.tag)` and prevents the default, as
  `ViewTabs` and the comparison's rule links already do; modified clicks fall through to the
  browser.
- Visible text stays "<label>" and "<label> · current". The accessible name extends it:
  "<label>, current release: see what changed" or "<label>: see what changed", and for the
  first release "<label>: see everything in it, compared with an empty release". The visible
  text comes first, so speech input that says the label still works.
- Pill styling keeps today's look (current filled, others outlined) and adds hover
  (`hover:bg-muted` on non-current, `hover:opacity-90` on current), a focus ring
  (`focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none`) and an
  underline on hover so it reads as a link. Pills keep wrapping at 375px.

### 5.2 Comparison view

- `FrameworksView` shows the comparison whenever `framework` names a known source.
- `ReleaseComparisonView` uses `resolveComparisonRange` (section 6) instead of its local
  `resolvedRange`, `releaseLabel` for both labels, and shows the empty-release line when
  From is empty.
- Sidebar Framework select lists every source; choosing one opens its default range
  (previous-to-current, or empty-to-current with one release).
- Sidebar From select: "Empty release" first, then every release except the last (for a
  single-release framework, "Empty release" is the only option). Choosing it keeps To.
  To lists every release after From (every release when From is empty), as now.

## 6. Interfaces (pure logic)

New `webui/src/logic/releaseRange.ts`:

```ts
export const EMPTY_RELEASE_TAG = 'empty'
export const EMPTY_RELEASE_LABEL = 'Empty release'

export interface ComparisonRange { fromTag: string; toTag: string }

// True when tag means the empty release for this list of real tags.
export function isEmptyRelease(releaseTags: readonly string[], tag: string): boolean

// The tag to compare a release against: the release before it, or EMPTY_RELEASE_TAG for the
// first. null when tag is not in the list.
export function previousReleaseTag(releaseTags: readonly string[], tag: string): string | null

// The range the address names when valid, otherwise the default (section 4). Throws on an
// empty list.
export function resolveComparisonRange(releaseTags: readonly string[], from: string | null, to: string | null): ComparisonRange

export function releaseLabel(releases: readonly { tag: string; label: string }[], tag: string): string

// The comparison's address, built with serializeUrlLocation and the default URL settings.
export function comparisonLocation(sourceName: string, range: ComparisonRange, basePath: string): string
```

`compareReleases` in `historyIndex.ts` accepts a From of `EMPTY_RELEASE_TAG` (when
`isEmptyRelease` holds for the index's tags): every rule's "before" is `null`. All other
inputs behave as today.

## 7. Test strategy

- Vitest: `releaseRange.test.ts` for every function (first and middle releases, empty with
  one or several releases, invalid addresses, the real-`empty`-tag collision); new cases in
  `historyIndex.test.ts` for the empty baseline (all present rules added, rules absent from
  To left out, the three other groups empty).
- Playwright: rewrite the one test that pressed "Compare releases"; add tests for a middle
  pill, the first pill, a single-release framework, the From select's empty option, the
  Framework select listing every source, and an empty-release address surviving reload.
- Ad hoc screenshots at about 375px and 1280px, light and dark: the cards, and an
  empty-release comparison.

## 8. Decisions made without the maintainer

| Decision | Alternative |
|---|---|
| The address says `from=empty`, readable and short. A real release tagged `empty` would win over it (no upstream uses such a tag). | A character no tag can hold (for example `from=~empty`, which the query encoder turns into `%7Eempty`), or a separate `baseline=empty` parameter. |
| The label is "Empty release", in the From select and the heading, with one explanatory line under the heading. | "Nothing", "Before <first label>", or "(none)". |
| A pill compares with the release immediately before it. | Always with the current release, or from it to the current one. |
| The Kind of change group stays in the sidebar for an empty-release comparison, with zero counts. | Hide it when From is empty. |
| Pills are links with an extended accessible name, plus one hint line on each card. | Buttons; or a visible "What changed" link beside each pill. |
| A single-release framework's address with no range opens empty-to-current. | Keep showing the cards for it until a second release is imported. |
| Added rules keep today's detail behaviour (shown as the newest release that has them), also for empty-release comparisons. | Show the To release's copy. |

## Progress log
