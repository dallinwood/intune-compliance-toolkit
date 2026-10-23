# Design: ASD ISM as a second rule source, on a source-agnostic rule schema

Date: 2026-10-22
Status: Approved 2026-10-23

## 1. Intent

The toolkit has one rule source today, the NIST macOS Security Compliance
Project (see `2026-10-20-mscp-source-design.md`). The maintainer always
intended more sources. This design adds the second one: the Australian
Signals Directorate's Information Security Manual (ASD ISM), and in doing so
turns the rule schema from "mSCP-shaped" into one shared format that mSCP,
ISM and future sources (Windows, Microsoft 365, network, procedural) all
fit without source-specific keys.

ISM controls are mostly governance, process and design requirements. Very
few can be checked by an Intune compliance script today (the toolkit only
generates macOS scripts, and ISM's technical controls lean towards Windows
and Microsoft Office). That is expected. The value now is having the whole
ISM in the same rule list as mSCP, selectable and filterable, with
everything flowing to the manual attestation report, so the library is
ready for checks to be added later.

## 2. Goals, non-goals, anti-goals

### Goals

- Import every ISM **control** (1,143 in the September 2026 ISM) from
  ASD's OSCAL catalog as rules, through a deterministic, one-command
  importer like `tools/import_mscp.py`.
- ISM rules appear in the same rule list as mSCP rules. The existing Source
  filter shows or hides them.
- One rule schema (v4) shared by all sources. mSCP is restructured to it.
- Capture as much of ISM's data as possible in source-agnostic fields:
  statement, section hierarchy, guidance prose, classification and
  Essential Eight applicability, per-control revision and updated date.
- Comply with CC BY 4.0 attribution for ASD content.

### Non-goals (for now)

- ISM **principles** (49, e.g. GOV-01) and the "Cyber security terminology"
  group. Controls only.
- Any AI enrichment: no inferred target platform, control type,
  "Intune-checkable" verdict, mSCP cross-links, or drafted check scripts.
  ISM is imported raw.
- Checks for ISM controls. Every ISM rule is manual.
- Importing ASD's profile files (`ISM_*-baseline_profile.json`, resolved
  catalogs). The catalog carries the same applicability as control
  properties (ASD's README says so explicitly).
- Restructuring `check`, `odv` and `remediation` to be target-keyed (see
  section 5.3).

### Anti-goals (failure even if it technically works)

- Any ISM rule text or attribute that did not come from ASD's catalog (or
  from deterministic derivation in this repo's code). No AI-written content
  in rule files.
- Any change to mSCP rule **values**. mSCP is restructured, but every
  title, discussion, check, ODV, reference, benchmark membership and
  severity must survive unchanged; a generated bundle for a given mSCP
  selection must be byte-identical before and after the restructure.
- Source-specific keys in the shared schema (for example an
  `essential_eight` or `classification` field that only ISM fills).
- Hand-edited generated JSON. Generated files are only ever regenerated.
- Unstable rule ids. Saved selections and exports must keep matching.

## 3. Facts about the ISM OSCAL catalog that shape this design

All verified on 2026-10-22 against release `v2026.09.4`:

- **Where it lives.** ASD publishes ISM OSCAL on cyber.gov.au
  (https://www.cyber.gov.au/ism/oscal/v2026.09.4, the authoritative copy)
  and mirrors it to GitHub
  (https://github.com/AustralianCyberSecurityCentre/ism-oscal, tags such as
  `v2026.09.4`). The two copies of `ISM_catalog.json` for this release are
  byte-identical (same SHA-256). The maintainer chose the GitHub tags, which
  give pinned tags and commit SHAs like the mSCP import.
- **Release.** `v2026.09.4`, published 2026-09-03, catalog metadata
  version `2026.09.4`, based on the September 2026 ISM.
- **Licence.** The GitHub repo has no LICENSE file. Its `README.md` states
  (c) Commonwealth of Australia, CC BY 4.0, excluding the Coat of Arms and
  the ASD logo (neither appears in the catalog JSON), plus a disclaimer.
  The README is the licence evidence and is vendored with the catalog.
- **Shape.** `catalog.groups` nest exactly three levels above every
  control: guideline (25, e.g. "Guidelines for system hardening") > section
  (71, e.g. "User application hardening") > topic (459, e.g. "Office
  productivity suites"). Controls have no nested controls, no `links`, no
  `params`.
- **Counts.** 1,192 entries: 1,143 with `class: ISM-control` and 49 with
  `class: ISM-principle`. The 1,143 control ids match the 1,143 `ISM-xxxx`
  ids in ASD's "System security plan annex template (September 2026).xlsx".
- **Control fields.** `id` (e.g. `ism-1667`), a placeholder `title`
  (`"Control: ism-1667"`), exactly one part, `statement`, holding the
  control text. Props (namespace `https://cyber.gov.au/ns/ism/oscal/3.0`
  except `sort-id`):
  - `sort-id`: document order.
  - `revision`: string, e.g. `"0"`, `"7"` (1,143 controls).
  - `updated`: string in `Mon-YY` form, e.g. `"Sep-21"` (1,143 controls).
  - `applicability`, repeated: `NC`, `OS`, `P`, `S`, `TS` (non-classified,
    OFFICIAL: Sensitive, PROTECTED, SECRET, TOP SECRET).
  - `essential-eight-applicability`, repeated: `ML1`, `ML2`, `ML3`
    (256 occurrences).
  - `label` only appears on principles.
- **Prose.** Every topic group (480 at depth 3) and most section groups
  (70 of 76 at depth 2) have one `overview` part in Markdown (headings such
  as `# Context`, paragraphs, links). Links look like `[text](#<uuid>)`;
  all 503 of them resolve to `back-matter.resources` entries (255), which
  carry a `title` and `rlinks[].href`.

## 4. Decisions made with the maintainer

- Rule ids stay `<source>.<upstream rule id>`. The ISM source is named
  `asd_ism`, so ids look like `asd_ism.ism-1667`. (Source name is my call.)
- **Applicability is restructured** (section 5.1) into a list of scopes,
  each naming a `target` and `version` (either may be `null`) and the
  benchmarks the rule belongs to in that scope.
- **`target` replaces "platform"** as the word for what a rule applies to,
  because future sources cover things that aren't operating systems
  (Microsoft 365, network devices, procedures).
- **The top-level `platform` field is removed.** A rule's targets come from
  its applicability, so one rule can cover several targets.
- **`section_path`** is added to every rule, holding the upstream grouping
  names verbatim, outermost first. The index's `section` becomes
  `section_path[0]` for every source, replacing mSCP's derive-from-folder
  logic in `section_of()`.
- **Per-rule upstream revision and updated date** are captured as
  `source.upstream_revision` and `source.upstream_updated`, present on every
  rule and `null` when the source doesn't provide them (mSCP). They show in
  the rule detail panel only when non-null and are not in the index.
- **Filtering on null.** Rules with a `null` target or version do not match
  a specific target/version filter. The Target and Version filters each get
  a "None" option that selects (or, with nothing else selected, isolates)
  rules whose target/version is `null`.
- **mSCP is restructured to v4**, and the mSCP importer emits v4 directly.

## 5. Schema v4

`baselines/_rule.schema.json`, `_index.schema.json` and
`_manifest.schema.json` move to `schema_version: 4`. The webui types in
`webui/src/types/library.ts` mirror them, as today.

### 5.1 Rule file

```jsonc
{
  "schema_version": 4,
  "id": "asd_ism.ism-1667",                      // ^[a-z0-9_]+\.[a-z0-9_-]+$
  "title": "Microsoft Office is blocked from creating child processes.",
  "discussion": "...",
  "discussion_format": "markdown",               // "asciidoc" | "markdown"
  "section_path": [
    "Guidelines for system hardening",
    "User application hardening",
    "Office productivity suites"
  ],
  "source": {
    "name": "asd_ism",                           // ^[a-z0-9_]+$
    "release_tag": "v2026.09.4",
    "commit_sha": "<40 hex>",
    "upstream_rule_id": "ism-1667",
    "upstream_path": "ISM_catalog.json",
    "upstream_url": "https://github.com/AustralianCyberSecurityCentre/ism-oscal/blob/<sha>/ISM_catalog.json",
    "upstream_revision": "0",                    // string | null
    "upstream_updated": "Sep-21",                // string | null, verbatim
    "license": { "name": "CC BY 4.0", "url": "https://creativecommons.org/licenses/by/4.0/",
                 "rights_holder": "Commonwealth of Australia (Australian Signals Directorate)",
                 "modified": true }
  },
  "assessment": { "status": "manual", "manual_reason": "no_check" },
  "architecture": null,
  "applicability": [
    {
      "target": null,                            // string | null
      "version": null,                           // string | null; non-null requires non-null target
      "benchmarks": [
        { "name": "ism_non_classified", "severity": null },
        { "name": "ism_official_sensitive", "severity": null },
        { "name": "ism_protected", "severity": null },
        { "name": "ism_secret", "severity": null },
        { "name": "ism_top_secret", "severity": null },
        { "name": "e8_ml2", "severity": null },
        { "name": "e8_ml3", "severity": null }
      ]
    }
  ],
  "tags": [],
  "references": {},
  "check": null,
  "odv": null,
  "remediation": null
}
```

The same mSCP rule (`audit_acls_folders_configure`) in v4:

```jsonc
{
  "schema_version": 4,
  "id": "mscp.audit_acls_folders_configure",
  "title": "...", "discussion": "...",
  "discussion_format": "asciidoc",
  "section_path": ["audit"],
  "source": { "name": "mscp", ..., "upstream_revision": null, "upstream_updated": null, ... },
  "applicability": [
    { "target": "macOS", "version": "15.0", "benchmarks": [{ "name": "cis_lvl1", "severity": null }, ...] },
    { "target": "macOS", "version": "26.0", "benchmarks": [...] },
    { "target": "macOS", "version": "27.0", "benchmarks": [...] }
  ],
  // assessment, architecture, tags, references, check, odv, remediation unchanged from v3
}
```

Field-by-field change from v3:

| Field | v3 | v4 |
|---|---|---|
| `schema_version` | `3` | `4` |
| `id` | `^mscp\.` | any `<source>.<rule id>` |
| `platform` | `"macOS"` | **removed** (targets live in `applicability`) |
| `discussion_format` | n/a | **new**, `"asciidoc"` (mSCP) or `"markdown"` (ISM). See 5.4 |
| `section_path` | n/a (index-only `section` from folder) | **new**, verbatim upstream grouping names |
| `source.name` | `"mscp"` | any source name |
| `source.upstream_revision`, `source.upstream_updated` | n/a | **new**, nullable |
| `applicability` | `{ "<version>": [benchmarks] }` | `[{ target, version, benchmarks }]` |
| `remediation` | object | object **or `null`** |
| everything else | unchanged | unchanged |

Constraints on `applicability`:

- Entries are unique by `(target, version)` and emitted in a fixed sort
  order (target, then version using the existing version comparison, nulls
  first) so output is byte-stable.
- `version` non-null requires `target` non-null.
- `benchmarks` may be empty (a rule that applies to a version without
  belonging to any benchmark there). Benchmark order within an entry is the
  upstream order for mSCP (unchanged) and the fixed order shown above for
  ISM.
- Version strings are free text per target. The v3 `^\d+\.\d+` pattern is
  dropped from the shared schema. The mSCP importer still validates that
  its macOS versions match it.

### 5.2 Index and manifest

`_index.json` entries: `id`, `title`, `file`, `section` (= `section_path[0]`,
any non-empty single line, no longer `^[a-z0-9_]+$`), `assessment`,
`architecture`, `applicability` (same v4 list shape), `tags`, `has_odv`.
`platform` is removed; the UI derives targets from `applicability`. The
upstream revision/updated date are not in the index.

`_manifest.json` gains an `asd_ism` source entry with the same fields as
the mSCP entry (`name`, `display_name` "ASD Information Security Manual",
`release_tag`, `commit_sha`, `retrieved_date`, `repository_url`, `license`,
`index_path` `asd_ism/_index.json`, `rule_count`).

### 5.3 `check`, `odv`, `remediation` stay as they are

`check.by_version` and `remediation.by_version` are still keyed by bare
version (`"15.0"`), and `remediation` still carries Apple-specific
`mobileconfig_info` / `ddm_info`. That has the same "which platform is
27.0?" ambiguity the applicability change fixes. It is deliberately left
alone in v4: only mSCP has checks today, and the shape a Windows check
needs (PowerShell, different result types) is not known yet. When a second
source with checks arrives, `check` and `remediation` get the same
target-scoped treatment. Until then, a rule's `check` is understood to
apply to its `macOS` target.

### 5.4 `discussion_format`

mSCP discussions are AsciiDoc-flavoured (`_MUST_`, `[source,bash]`); ISM
prose is Markdown (`# Context`, `[text](url)`). The UI needs to know which
renderer to use. `discussion_format` says so explicitly instead of the UI
switching on the source name. (My call; it adds one more key to every mSCP
file, alongside the other v4 additions.)

## 6. ASD ISM importer

### 6.1 Layout

```
sources/asd_ism/upstream/ISM_catalog.json   byte-for-byte from the tag
sources/asd_ism/upstream/README.md          licence and disclaimer evidence
sources/asd_ism/source.json                 tag, commit_sha, retrieved_date, repository_url
baselines/asd_ism/_index.json
baselines/asd_ism/rules/ism-1667.json       one file per control
```

### 6.2 Command

`python tools/import_asd_ism.py --tag v2026.09.4` (required, no "latest"),
plus `--offline` to regenerate from the vendored copy, mirroring
`import_mscp.py`. Fetching uses the standard library only (raw files or tag
tarball from GitHub; tag to commit SHA via the GitHub API, dereferencing
annotated tags). No new Python dependency: the catalog is JSON. Reuse the
existing shared helpers (`json_output.py`, `directory_swap.py`,
`validate_library.py`) and extract further shared code from the mSCP
importer where it is genuinely common; the builder decides how far.

### 6.3 Normalization rules

For every catalog entry with `class: ISM-control`:

| v4 field | From |
|---|---|
| `id` | `asd_ism.` + control `id` |
| `title` | the first paragraph of the `statement` part's prose (the OSCAL `title` is a placeholder). Revised 2026-10-23: 40 statements are a lead-in sentence plus a Markdown list, so the title is the text before the first blank line |
| `discussion` | the overview prose of the control's **topic** group (depth 3), with `(#uuid)` links rewritten to the back-matter resource's first `rlinks[].href`. When the statement has more than one paragraph, the full statement comes first, then a blank line, then the overview, so no statement text is lost |
| `discussion_format` | `"markdown"` |
| `section_path` | titles of the three ancestor groups, outermost first |
| `source.upstream_revision`, `.upstream_updated` | `revision`, `updated` props, verbatim strings |
| `applicability` | one entry, `target: null`, `version: null`; benchmarks from `applicability` props (`NC` -> `ism_non_classified`, `OS` -> `ism_official_sensitive`, `P` -> `ism_protected`, `S` -> `ism_secret`, `TS` -> `ism_top_secret`) then `essential-eight-applicability` props (`ML1` -> `e8_ml1`, `ML2` -> `e8_ml2`, `ML3` -> `e8_ml3`), in that fixed order, `severity: null` |
| `assessment` | `{ status: "manual", manual_reason: "no_check" }` |
| `architecture`, `check`, `odv`, `remediation` | `null` |
| `tags` | `[]` |
| `references` | `{}` |

(My call: topic overview as the discussion. It is the prose closest to the
control. The section-level overview is broader context shared by many
topics and is not duplicated into every rule.)

Entries with `class: ISM-principle` are skipped. The terminology group has
no controls and is skipped naturally.

### 6.4 Fail loudly

As with mSCP, unknown is an error, not a skip (non-zero exit, no partial
output): an unknown `class`; a control without exactly one `statement`
part; a prop name outside `sort-id`, `revision`, `updated`,
`applicability`, `essential-eight-applicability`; an applicability value
outside the known sets; a missing `revision` or `updated`; a `(#uuid)` link
with no matching back-matter resource or no `rlinks`; a control whose topic
group has no overview; a control not exactly three groups deep; duplicate
ids; a schema violation in any output file. Output is byte-stable (sorted
keys, fixed indentation, LF endings).

## 7. mSCP restructure

- `tools/mscp_normalize.py` emits v4: `applicability` as a list with
  `target: "macOS"`, one entry per upstream version. A rule with no
  upstream versions (`os_firewall_log_enable` and `os_gatekeeper_rearm` in
  `release_27.0`, both automated) gets a single entry
  `{ target: "macOS", version: null, benchmarks: [] }`, so it keeps its
  macOS target (maintainer's decision). In the Version filter it falls
  under "None". The generator keeps today's behaviour for these two rules:
  it refuses to script them ("mSCP does not map this rule to any macOS
  version", `webui/src/logic/checkPlan.ts`). (Corrected 2026-10-23: the
  first draft wrongly said the generator already runs them on every
  version.); `section_path: [<folder>]` (the same folder
  `section_of()` reads today, now stored in the rule); `discussion_format:
  "asciidoc"`; `source.upstream_revision` / `upstream_updated` `null`; no
  `platform`.
- Re-run `python tools/import_mscp.py --offline` to
  regenerate `baselines/mscp/`. The diff must be structural only.
- Prove "values unchanged" with a test: for every mSCP rule, converting the
  v3 file to v4 by the rules above gives exactly the regenerated v4 file
  (one-off check against the committed v3 data, run before the v3 files
  are replaced).
- Python tests for the importer are updated to v4.

## 8. Web UI changes

- **Types and loaders** (`types/library.ts`, `types/rule-row.ts`,
  `data/ruleRows.ts`, `data/ruleDetail.ts`): v4 shapes. `RuleRow.platform`
  becomes the list of targets (with `null` for none); `osVersions` becomes
  versions per target.
- **Filters** (`FilterSidebar.tsx`, `logic/ruleFilters.ts`): the existing
  Platform facet becomes **Target**; the OS version facet becomes
  **Version**, labelled with its target (e.g. "macOS 27.0") so versions
  from different targets never merge. Both offer **None** for `null`.
  Benchmarks stay scoped to the selected target/version. Rules with a null
  target/version do not match a specific target/version selection.
- **Rule table**: rows show targets/versions; an ISM row shows "None" (or
  similar) where an mSCP row shows its macOS versions. Table grouping by
  `section` now includes the 23 ISM guideline names that hold controls
  (corrected 2026-10-23: 26 top-level groups minus the framework,
  principles and terminology groups).
- **Rule detail panel**: `section_path` as a breadcrumb; upstream revision
  and updated date when non-null; `discussion` rendered by
  `discussion_format` (a Markdown path alongside the existing AsciiDoc-ish
  parser in `logic/discussionMarkup.ts`, enough for headings, paragraphs,
  lists and links; external links open safely); remediation section hidden
  when `null`.
- **Generator** (`logic/checkPlan.ts` and anything else reading
  applicability): reads the `target: "macOS"` entries. Behaviour unchanged;
  verified by the byte-identical bundle requirement in section 2.
- **Attestation report**: left as it is (maintainer's decision). ISM rules
  are manual and flow into it like any other manual rule. The only change
  is the attribution line at its end, which today hard-codes NIST mSCP: it
  must name each source whose rules appear in the report, because CC BY 4.0
  requires crediting ASD when ISM text is reproduced. A redesign is
  deferred (section 13).
- **Vocabulary** (`baselines/_vocabulary.json`, hand-edited): rename
  `platforms` to `targets`; rename `os_versions` to `versions`, keyed by
  `"<target> <version>"` (e.g. term `"macOS 27.0"`, label "macOS 27") so
  versions of different targets can never collide (my call; a one-off
  hand edit of the existing entries); add labels for source `asd_ism`; benchmark labels
  ("ISM NC" ... "ISM TOP SECRET", "Essential Eight ML1" ... "ML3"); reword
  the `no_check` description so it isn't mSCP-specific. mSCP section labels
  (`audit` -> "Auditing") keep working because `section_path[0]` for mSCP
  is still the folder name.
- **Export/import of selections**: ids are unchanged, so existing exports
  still match.
- Per the repo's CLAUDE.md, every rendering change is checked with
  `bun run test:e2e` plus ad hoc Playwright screenshots at about 375px and
  desktop width, looked at before calling it done.

## 9. Licensing and attribution

- ASD content in `sources/asd_ism/` and `baselines/asd_ism/` stays under
  CC BY 4.0, modified (normalized format, link rewriting, derived ids).
- `NOTICE` and README gain an ASD ISM entry: (c) Commonwealth of Australia,
  CC BY 4.0, source link, modified by this project, disclaimer reference.
- The UI footer credit lists ASD ISM with its release tag next to mSCP.
- Each ISM rule carries `source.license`.

## 10. Updating to a new ISM release

1. `python tools/import_asd_ism.py --tag <new tag>`
2. Review `git diff sources/asd_ism/` and `git diff baselines/asd_ism/`.
   Changed `upstream_revision` values show which controls ASD revised.
3. Run Python, Vitest and Playwright tests.
4. Commit (`feat: import ASD ISM <tag>`) and push.

## 11. Delivery phases

Each ends with passing tests and its own commit(s), with progress logged in
the matching plan document:

1. **Schema v4 and mSCP restructure**: schemas, mSCP importer, regenerated
   `baselines/mscp/`, the values-unchanged test, webui types/loaders/
   filters/generator adapted so the UI looks and behaves as before (no ISM
   yet). Byte-identical bundle check.
2. **ASD ISM importer and data**: vendored upstream, lock file, importer,
   `baselines/asd_ism/`, manifest entry, Python tests. The `asd_ism`
   manifest entry must not reach `main` before phase 3 lands (GitHub
   Pages deploys from `main`; pushing the feature branch is fine):
   without phase 3,
   ISM rows can't be filtered by benchmark, show mSCP-specific "no macOS
   version" text, render Markdown through the AsciiDoc path, and are
   credited only to NIST in the attestation report.
3. **UI for the new fields**: Target/Version facets with None, breadcrumb,
   revision/updated display, Markdown discussion, null remediation,
   vocabulary entries, attestation report attribution per source,
   Playwright screenshots. Prerequisite found in the phase 1 review:
   every benchmark path in the UI (`logic/applicability.ts`,
   `data/ruleRows.ts`, `logic/ruleFilters.ts`, `benchmarkSummary`) goes
   through version keys, so benchmarks on an entry with a null version
   (every ISM rule) are unreachable in the facet, the filter and the table
   summary. Give unversioned entries a handle the benchmark paths use, and
   generalize both "No macOS version listed" sites (`RuleTable.tsx`,
   `RuleCheckSection.tsx`, which also prints mSCP-specific text).
   Further gaps seen once ISM data loaded (phase 2 review, 2026-10-23);
   all must be closed before `asd_ism` reaches `main`:
   - **Table render cost.** The 1,493-row table is not virtualized; first
     render takes 1.3 to 4.3s in dev, and Playwright had to drop to
     `workers: 1` (`webui/playwright.config.ts`) because parallel specs
     timed out. Virtualize or paginate the table, then restore parallel
     workers.
   - **Per-rule credit line** (`RuleDetailPanel.tsx`) hard-codes "NIST
     mSCP", so every ISM rule reads "From NIST mSCP v2026.09.4". This is
     a CC BY attribution error on ASD text; take the credit from the
     rule's `source` / manifest entry.
   - **Footer** (`AttributionFooter.tsx`) says "macOS rules from the ASD
     Information Security Manual"; the "macOS rules" wording must come
     from the source, not be fixed.
   - **Tags facet** shows only struck-through mSCP tags when filtered to
     ASD ISM (ISM rules have no tags); hide or explain an empty facet.
   - **Search** strips only the `mscp.` id prefix (`ruleFilters.ts`), so
     searching "asd" or "ism" matches every ISM row by its id; strip any
     `<source>.` prefix.
   - **Source labels**: the Source facet shows "ASD ISM" beside the raw
     code "mscp"; add an mSCP label to the vocabulary.
4. **Attribution**: NOTICE, README, footer.

No AI is used to convert content, so there is no per-rule delegation to
agents. Implementation tasks may still be handed to subagents per the
implementation plan.

## 12. Left to the builder

- How much importer code to share between `import_mscp.py` and
  `import_asd_ism.py`.
- Exact visual treatment of targets/versions in the table, the None option
  labels, and the breadcrumb.
- Markdown renderer details within the constraints in section 8.
- Rule file ordering within the index (must be stable).

## 13. Later (not in this work)

- **Rethink the manual attestation report.** It was first built in the
  August 2026 MVP (`beb7d96`) and adapted to mSCP on 2026-10-21
  (`65f6081`). It is a flat Markdown list, which suits a handful of
  mSCP manual rules but not hundreds of ISM controls. The maintainer is
  considering rebuilding it as something like a dashboard. Inputs for that
  work:
  - ASD's "System security plan annex template" (in
    `baseline-references/asd-ism/`) is the format ISM assessors already
    use. Its 15 descriptive columns (Guideline, Section, Topic,
    Identifier, Revision, Updated, NC/OS/P/S/TS, ML1-3, Description) all
    map onto v4 fields; its assessor columns (Responsibility,
    Implementation Status/Source, Assessment Outcome/Comments) have
    ASD-defined value lists.
  - The review screen fetches every selected rule file individually to
    build the report, so a full ISM selection means about 1,143 requests.
- **Target-scoped `check` and `remediation`** when a second source with
  checks arrives (section 5.3).
- **Shared importer CLI.** `tools/import_asd_ism.py` and
  `tools/import_mscp.py` carry about 100 near-identical lines
  (`import_offline`, `import_tag`, argument parsing, change summary,
  `main`, manifest entry). Extract a shared helper when a third source is
  added.
- **ISM normalizer hardening for future releases** (none of these occur in
  `v2026.09.4`): Markdown links in the titled form `[x](#uuid "title")` or
  a bare `(#uuid)` are neither rewritten nor rejected; `split_statement`
  splits on `\n\n` only, so CRLF prose would put a whole list in the
  title. Reject `\r` in prose and widen the link pattern if a release
  needs it.
- **Small test and cleanup items**: `tools/mscp_fetch.py` keeps an
  otherwise-unused `import urllib.request` only because a test patches it
  there; `tools/github_fetch.py` has no direct unit tests (both fetchers
  exercise it); `libraryData.test.ts` could assert that non-mSCP sources
  have no ODVs.

## Progress log

- 2026-10-22: Design drafted from the brainstorming session (no code yet).
- 2026-10-23: Design approved by the maintainer; implementation plan next.
- 2026-10-23: Phase 1 (schema v4 and mSCP restructure) done, per `docs/plans/2026-10-23-rule-schema-v4-plan.md`: `8b1dabe` feat: move the rule library and mSCP importer to schema v4; `6d8a9e5` refactor: read schema v4 applicability in the web UI; `1fc6660` test: read schema v4 applicability in the e2e smoke spec; `9bfe529` refactor: tidy target naming left over from the schema v4 move. mSCP values were unchanged, bundles byte-identical, and the UI visually identical. The review found a phase 3 prerequisite (benchmarks on null-version entries can't be reached in the UI) and a sequencing rule for the phase 2 manifest entry; both are recorded in section 11.
- 2026-10-23: Phase 2 (ASD ISM import) done, per `docs/plans/2026-10-23-asd-ism-import-plan.md`: `945c0c7`, `934005d`, `536cb3e`, `6ff7712`, `704b436`. 1,143 ISM controls from `v2026.09.4` load in the web UI next to the 350 mSCP rules. The UI gaps found are added to section 11 (phase 3) and the deferred hardening to section 13. The guideline count in section 8 is corrected to 23.
