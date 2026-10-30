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
  "description": "mSCP and Windows rules that support ISM-1622.",  // optional
  "links": [
    {
      "relation": "supports",                        // supports | related
      "from": [ { "kind": "rule", "id": "mscp.a", "release": "release_27.0" },
                { "kind": "rule", "id": "mscp.b", "release": "release_27.0" } ],
      "to":   [ { "kind": "rule", "id": "asd_ism.ism-1622", "release": "v2026.09.4" } ],
      "note": "Covers the PowerShell part only."     // optional, string or null
    }
  ]
}
```

- **Many to many:** `from` and `to` are non-empty lists. A link entry expands to every
  `(from, to)` pair, so "mSCP rules 3, 5 and 11 support ISM-ABC" is one entry.
- **Direction:** for `supports`, `from` supports `to`. For `related` the direction carries no
  meaning.
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
  It is written as compact JSON and never committed.
- **Shape:**

```jsonc
{
  "schema_version": 1,
  "by_rule": {
    "asd_ism.ism-1622": [
      { "rule": "mscp.a", "relation": "supports", "direction": "incoming",
        "mapping": "powershell-constrained-language", "note": "...",
        "release": "release_27.0", "self_release": "v2026.09.4" }
    ],
    "mscp.a": [
      { "rule": "asd_ism.ism-1622", "relation": "supports", "direction": "outgoing", ... }
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

> Note: the display described below (the "Mapped rules" section and link items) is replaced by
> `docs/plans/2026-10-30-mapped-rules-tab-design.md`. Loading and navigation still apply.

- **Loading:** `_mappings/_index.json` is fetched with the library and parsed defensively.
  - A missing or broken index produces a warning in the existing notice area and no mappings; it
    never breaks the app.
  - Index entries whose rule does not exist in the loaded library are ignored.
- **Display:** the rule detail panel gets a "Mapped rules" section, placed after Benchmarks and
  before References, and shown only when the rule has links. Links are grouped by wording from
  this rule's side:

| relation | outgoing (this rule is `from`) | incoming (this rule is `to`) |
|---|---|---|
| supports | Supports | Supported by |
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
- 2026-10-27: Review fixes for `a5da82c` (`fix: harden rule mapping validation, titles and tests`). The validator reports a non-string `kind` or `relation` instead of crashing; the publish step skips mapping files with an unsafe name, invalid UTF-8 or CRLF (as CI does) and writes the index as compact JSON; mapped rule titles show the organization-defined value like the table; the open-rule reveal waits for the table to catch up and runs again on every link click, including one to the rule already open. Every e2e test starts from an empty mapping index, and the mapping fixtures (Python and e2e) take the library's current releases from the manifest, with deliberately old releases for the stale cases.
- 2026-10-30: Replaced the `implements` and `partially_implements` relations with one `supports` relation ("Supports" / "Supported by"), because a rule often covers only part of a control and "supports" leaves the reader to confirm the fit; the note says which part. `related` is unchanged. `schema_version` stays 1 because no real mapping data existed yet (`fd5e350 refactor: replace implements relations with supports`).
- 2026-10-30: Added the first real mappings (`feat: map mSCP rules to the ASD ISM controls they support`). Subagents reviewed all 350 mSCP rules against about 765 candidate ISM controls (every control in the hardening, system access, media, system management, enterprise mobility, ITE, cryptography, networking and data transfer guidelines, plus keyword matches elsewhere). 62 confident `supports` links are in `baselines/_mappings/rules/mscp-to-asd-ism-<guideline area>.json`. The 92 uncertain candidates, with each one's reasoning and open question, are in the review queue `docs/mappings/mscp-to-asd-ism-review.json`, together with three questions that cut across many items (Macs as ISM "mobile devices", APFS/FileVault as ASD-approved cryptography, and attestation-only rules), for a later research pass and then the maintainer. Consistency calls made while merging: disabling a feature supports ISM-0380 (unneeded functionality disabled) whatever the organisation decides is unneeded, and the note says so; everything on ISM-1059 waits for the cryptography question; device time sync supports ISM-0988.
- 2026-10-30: Applied the maintainer's answers (`fix: drop local logging from centrally logged ISM mappings`). Local logging is not central logging, and mSCP has no log forwarding rule, so the 3 links to ISM-1895 and ISM-1976 were removed and every queued "centrally logged" candidate was rejected (59 confident links remain). The cross-cutting questions are answered in the review queue: Mac laptops are ISM mobile devices (the ISM glossary names laptop computers), FileVault/APFS counts as ASD-approved cryptography (AES-XTS-256, NIAP FDE cPP validation), and only rules with a check or fix are mapped for now.
- 2026-10-30: Research pass on the review queue (`feat: add researched mSCP to ASD ISM mappings`). Two agents researched the 84 open items against primary sources (Apple's device-management schema and platform guides, cyber.gov.au), and a third proposed enterprise mobility candidates now that Mac laptops count as mobile devices. Every proposed mapping was read at merge; debatable ones and conflicts between agents went to the maintainer, and rules relying on deprecated Apple payloads (pathBlackList, mount-controls, removed deferral and Rapid Security Response keys) were rejected consistently. 54 new links (113 in total, adding enterprise mobility and system management files); the queue now holds 57 mapped, 35 rejected and 23 needs_maintainer items, each with its research comment.
- 2026-10-30: The mapped rules display moved from a section in the rule details to a "Mapped rules" tab, grouped by source with filters, hover summaries and in-place details (`docs/plans/2026-10-30-mapped-rules-tab-design.md`; last commit `1ec3f71 feat: add hover summaries and in-place details to mapped rules`).
