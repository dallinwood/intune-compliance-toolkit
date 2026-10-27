# Design: rule mappings (many-to-many, typed, viewable from both sides)

Date: 2026-10-27
Status: Approved 2026-10-27 (maintainer answers in this session)

## 1. Intent

Rules from different sources overlap. A broad ISM control such as "PowerShell is configured to use
Constrained Language Mode" may be covered by several specific mSCP or future Windows rules, and one
mSCP rule may help satisfy several ISM controls. Mappings record those relationships so one
baseline can complement another: specific rules are linked under a broad one instead of being
written into a single large policy or script.

This work builds the mapping mechanism only. No real mappings are authored yet.

## 2. Goals, non-goals, anti-goals

- **Goals:**
  - Many-to-many links between rules of any sources, with a type, viewable from both sides.
  - The data is hand-written by the maintainer, kept outside the imported data, and validated in CI.
  - The UI loads one small generated index at startup and looks up a rule's links with no
    further requests.
  - The format is extensible to endpoint kinds other than rules (benchmarks, sections) without
    migrating existing files.
- **Non-goals (for now):**
  - Filters on mappings.
  - Link indicators on table rows.
  - Generation or selection features that act on mappings.
  - Any real mapping content.
- **Anti-goals:**
  - Writing mapping data into `baselines/<source>/` or `sources/`.
  - The browser fetching every mapping file at startup.
  - A link that is silently one-directional in the UI.

## 3. Files

- **Location:** `baselines/_mappings/rules/<name>.json`, hand-written. It sits beside `_overlays/`
  and uses the same conventions: the `_` prefix marks the folder as internal, it holds a `rules/`
  subfolder, it is LF and UTF-8, and its file names follow the safe segment rule.
- **Format:**

```jsonc
{
  "schema_version": 1,
  "id": "powershell-constrained-language",          // unique across files, ^[a-z0-9][a-z0-9-]*$
  "description": "mSCP and Windows rules that implement ISM-1622.",  // optional
  "links": [
    {
      "relation": "implements",                      // implements | partially_implements | related
      "from": [ { "kind": "rule", "id": "mscp.a", "release": "release_27.0" },
                { "kind": "rule", "id": "mscp.b", "release": "release_27.0" } ],
      "to":   [ { "kind": "rule", "id": "asd_ism.ism-1622", "release": "v2026.09.4" } ],
      "note": "Covers the PowerShell part only."     // optional, string or null
    }
  ]
}
```

- **Many to many:** `from` and `to` are non-empty lists. A link entry expands to every
  `(from, to)` pair, so "mSCP rules 3, 5 and 11 implement ISM-ABC" is one entry.
- **Direction:** for `implements` and `partially_implements`, `from` implements `to`. For
  `related` the direction carries no meaning.
- **Endpoint kinds:** only `kind: "rule"` is valid now. New kinds are added later with their own
  `id` rules.
- **`release`:** the source release the endpoint was checked against (that source's
  `release_tag`). When it differs from the loaded release, the UI shows a "review for accuracy"
  note on that link, as overlays do.

## 4. Validation (CI, `tools/mappings.py` + `tests/test_mappings.py`)

**Errors** (each fails the tests):
- an unknown top-level key or link key;
- a bad `id`, or the same `id` used in two files;
- an empty `from` or `to`;
- an unknown `relation` or `kind`;
- an endpoint rule id that does not exist in the committed library;
- a self-link (the same rule on both sides);
- the same expanded pair defined twice anywhere;
- the same pair with two different relations, or with both directions of a directed relation;
- a file that is not LF or not UTF-8.

**Warnings** (not failures): an endpoint `release` that differs from the library's current
`release_tag` for that source.

The deploy workflow already runs the Python tests, so a bad mapping cannot be published.

## 5. Generated index (publish step)

- **Where:** `scripts/copy-baselines.mjs` writes `webui/public/baselines/_mappings/_index.json`.
  It is never committed.
- **Shape:**

```jsonc
{
  "schema_version": 1,
  "by_rule": {
    "asd_ism.ism-1622": [
      { "rule": "mscp.a", "relation": "implements", "direction": "incoming",
        "mapping": "powershell-constrained-language", "note": "...",
        "release": "release_27.0", "self_release": "v2026.09.4" }
    ],
    "mscp.a": [
      { "rule": "asd_ism.ism-1622", "relation": "implements", "direction": "outgoing", ... }
    ]
  }
}
```

- **Both directions:** every expanded pair is written under both of its rules, with
  `direction` `outgoing` (from this rule) or `incoming` (to this rule). `related` pairs use
  `related` in both directions.
- **Ordering:** entries are sorted by relation, then by rule id, so the output is byte-stable.
- **Invalid files:** a structurally invalid file is skipped with a log line. CI is the real gate.
- **Size:** each entry is about 150 bytes. 10,000 links (20,000 entries) come to roughly 3 MB raw
  and about 150 to 250 KB gzipped, which is acceptable for a startup fetch. If this ever grows far
  beyond that, the index can be split by source prefix without changing the authored files.

## 6. Web UI

- **Loading:** `_mappings/_index.json` is fetched with the library and parsed defensively.
  - A missing or broken index produces a warning in the existing notice area and no mappings; it
    never breaks the app.
  - Index entries whose rule does not exist in the loaded library are ignored.
- **Display:** the rule detail panel gets a "Mapped rules" section, placed after Benchmarks and
  before References, and shown only when the rule has links. Links are grouped by wording from
  this rule's side:

| relation | outgoing (this rule is `from`) | incoming (this rule is `to`) |
|---|---|---|
| implements | Implements | Implemented by |
| partially_implements | Partially implements | Partially implemented by |
| related | Related | Related |

- **Link items:** each item shows the other rule's source label, upstream id and title (from the
  loaded index rows), the optional note, and a stale-release note where one applies.
- **Navigation:** each item is a link that navigates to the other rule. It sets the search to that
  rule's id and opens its detail, using the existing URL state and search auto-expand. The exact
  mechanism is left to the builder, but it must work from either side and from a shared URL.

## 7. Delivery

One task:
- the format and README section;
- the Python validator with tests;
- index generation in the publish step;
- the UI loader and the "Mapped rules" section;
- tests, including round trips in both directions using fixture mappings in e2e through
  `page.route`, plus screenshots in light and dark mode.

Then one review, and push.

## Progress log

- 2026-10-27: Design written from the maintainer's answers (no code yet).
- 2026-10-27: Implemented sections 3-7 (`feat: add many-to-many rule mappings viewable from both sides`). `baselines/_mappings/rules/` holds only a `.gitkeep`; `tools/mappings.py` and `tests/test_mappings.py` check every section 4 error (fixtures in `tests/fixtures/mappings/`, CRLF and non-UTF-8 cases written at test time) and warn on a stale release; the publish step writes `_mappings/_index.json` through `webui/src/logic/mappingIndex.ts`. Navigation decision: a mapped rule is a link that sets the search to the other rule's upstream id, clears only the filters that would hide it, and opens its details through a new `rule=<full id>` URL parameter (kept until that rule is collapsed or a search is typed), moving to the page that holds it. The stale note checks both ends of a link, so it shows from either side.
