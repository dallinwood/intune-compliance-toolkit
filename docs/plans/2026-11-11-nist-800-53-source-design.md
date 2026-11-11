# Design: NIST SP 800-53 Rev. 5 as a third rule source, and a generated mSCP mapping

Date: 2026-11-11
Status: Draft, written without the maintainer (see section 13 for the calls made)

## 1. Intent

The library has two sources: the NIST macOS Security Compliance Project (mSCP) and the ASD
Information Security Manual (ISM). This design adds a third, the NIST SP 800-53 Rev. 5 control
catalog, imported from NIST's own OSCAL so it can be re-imported and updated the same way as ISM
(`2026-10-22-asd-ism-source-design.md`) and kept per release (`2026-11-10-release-history-design.md`).

800-53 is the framework mSCP itself cites: 290 of the 352 rules in the current mSCP release
(`release_27.1`) list the 800-53 controls they relate to in `references.nist["800-53r5"]`. Once
800-53 is in the library, those citations can become real links between rules. The last part of
this work generates that mapping mechanically. The maintainer's instruction for it: "stick to the
facts for now, just a mapping". No judgment is added; each link says only that mSCP cites the
control.

## 2. Goals, non-goals, anti-goals

### Goals

- Import every current (not withdrawn) 800-53 control and control enhancement from NIST's OSCAL
  catalog as rules, through the existing per-release importer framework (`tools/release_import.py`).
- 800-53 rules appear in the Rules view next to mSCP and ISM rules, filterable by source, family
  and the SP 800-53B baselines (Low, Moderate, High, Privacy).
- Capture the control statement with its parameters, the discussion (NIST's "guidance" part),
  the related controls and the cited publications, all from the catalog.
- Generate a `supports` mapping from each mSCP rule to the 800-53 controls it cites, regenerated
  whenever mSCP or 800-53 is imported, with citations that do not resolve reported, not dropped.
- Credit NIST and state the content's public-domain status in NOTICE, README and the UI.

### Non-goals (for now)

- SP 800-53A assessment objectives and methods (`assessment-objective`, `assessment-method`
  parts). They are in the same catalog and roughly double its size; they belong with a future
  rethink of the manual attestation report.
- Withdrawn controls as rules (section 5.5).
- Older oscal-content releases. Only `v1.6.0` is imported now; the release history design already
  supports adding more later.
- SP 800-53 Rev. 4, SP 800-171, CSF or any other catalog in the oscal-content repository.
- Checks for 800-53 controls. Every 800-53 rule is manual.
- Any judgment in the generated mapping: no confidence levels, no "partial" notes, no extra links
  beyond mSCP's citations, no `related` links between 800-53 controls.

### Anti-goals (failure even if it technically works)

- Rule text or attributes that did not come from NIST's catalog or profiles, or from
  deterministic derivation in this repo's code. No AI-written content in rule or mapping files.
- A generated mapping link that mSCP does not cite, or an mSCP citation silently left out.
- Hand-edited generated JSON (rules or the generated mapping).
- Any change to mSCP or ISM rule files, or to the existing hand-written mappings.
- Unstable rule ids.

## 3. Facts about the upstream that shape this design

All checked on 2026-11-11 against https://github.com/usnistgov/oscal-content, release `v1.6.0`:

- **Release.** GitHub release `v1.6.0` "OSCAL Content 1.6.0 Release", published
  2026-10-22T22:59:02Z. The tag is annotated; it dereferences to commit
  `f0de6d8d8c059d374f15e0ae07508d82e370fc1d`. The release notes describe it as patches to
  "SP 800-53 v5.2.0", upgraded to OSCAL 1.2.3. The tag covers the whole repository (800-53,
  CSF, 800-172 and others), not 800-53 alone, so the tag and the 800-53 version differ.
- **Files** under `nist.gov/SP800-53/rev5/json/`:
  - `NIST_SP-800-53_rev5_catalog.json`, 10,448,237 bytes, SHA-256
    `64ca6b4161de51ab6af098a7d101d326f14c95e1abf721396cd8a049e8115eeb`. A `-min` variant
    (4.9 MB, no whitespace) holds the same content.
  - `NIST_SP-800-53_rev5_{LOW,MODERATE,HIGH,PRIVACY}-baseline_profile.json` (3 to 13 KB each),
    plus `-min` variants and resolved-profile catalogs (1.2 to 4.6 MB each).
- **Catalog metadata.** Title "Electronic (OSCAL) Version of NIST SP 800-53 Rev 5.2.0 Controls and
  SP 800-53A Rev 5.2.0 Assessment Procedures", `version` `5.2.0`, `oscal-version` `1.2.3`,
  `last-modified` 2026-10-22.
- **Shape.** `catalog.groups` holds 20 families (`class: family`, e.g. `ac` "Access Control",
  each with a `label` prop such as `AC`). Controls sit directly in a family; enhancements are
  nested one level inside their base control. Only the `pm` family has a group-level part (an
  `overview`).
- **Counts.** 1,196 entries: 324 base controls (`class: SP800-53`) and 872 enhancements
  (`class: SP800-53-enhancement`). 182 carry a `status: withdrawn` prop, leaving **1,014 current
  entries** (300 controls, 714 enhancements).
- **Ids and labels.** OSCAL ids are `ac-20` and `ac-20.1`; every id matches
  `^[a-z]{2}-\d+(\.\d+)?$`. Each entry has three `label` props: one with no class (`AC-20(1)`),
  one `zero-padded` (`AC-20(01)`) and one `sp800-53a`. The no-class label is exactly the form mSCP
  cites, and for all 1,196 entries it equals a mechanical conversion of the id (`ac-20.1` ->
  `AC-20(1)`).
- **Control keys.** `id`, `class`, `title`, `props`, `links`, `parts`, `params`, `controls`.
  Prop names: `label`, `sort-id` (zero-padded, e.g. `ac-02.10`), `implementation-level`
  (namespace `http://csrc.nist.gov/ns/rmf`, `organization` or `system`), `contributes-to-assurance`
  (same namespace), `status` (`withdrawn` only).
- **Parts.** Every current entry has exactly one `statement` and one `guidance` part, plus 800-53A
  `assessment-objective` and `assessment-method` parts. Statements are either one prose string or
  a tree of `item` parts, each with a `label` prop (`a.`, `1.`, `(a)`), up to three levels deep
  (732 flat, 225 one level, 40 two levels, 19 three levels). Guidance is Markdown-ish prose, 64 of
  them with more than one paragraph.
- **Parameters.** 1,600 params. Each has either a `label` (1,467) or a `select` (133, with
  `how-many` `one-or-more` or absent, meaning one). Statements and select choices reference them
  only as `{{ insert: param, <param id> }}` (2,948 occurrences, no other `{{` form). 138 inserted
  labels already start with "organization-defined" (aggregate params such as `ac-1_prm_1`); the
  other 941 are short ("frequency", "personnel or roles").
- **Links.** On controls: `related` (3,512, to other controls), `reference` (838, to back-matter
  resources), `required` (715, enhancement to base), and on withdrawn entries `incorporated-into`
  (166) and `moved-to` (34). In guidance prose, `[text](#target)` links point to a control id
  (341), a back-matter resource uuid (99), a statement part id such as `#cm-3_smt.f`, or a family
  id such as `#pe`. All 202 back-matter resources have a `title` and at least one `rlinks` href.
- **Withdrawn entries.** 180 have no parts; `cp-10.3` and `sc-19` have a one-line statement
  ("Addressed through tailoring.").
- **Baselines.** Each profile has one `imports` entry pointing at the catalog, with
  `include-controls[].with-ids` only (no `with-child-controls`, `matching`, `exclude-controls` or
  `modify`), and `merge: {as-is: true}`. Low lists 149 ids, Moderate 287, High 370, Privacy 96.
  None is withdrawn or unknown. 423 current entries are in at least one baseline; 591 are in none
  (the PM family, for example, is outside every baseline by design).
- **Licence.** The repository's `LICENSE.md`: as a work of the United States government the
  content is in the public domain in the US, and NIST waives copyright worldwide through CC0 1.0.
  CC0 asks that users "should not imply endorsement by the author". No attribution is required.
  `nist.gov/SP800-53/README.md` describes the rev5 files. There is no `rev5/README.md`.
- **mSCP citations.** Against this catalog, every citation in both stored mSCP releases resolves
  to a current entry: `release_27.0` has 285 citing rules, 660 citations, 137 distinct controls;
  `release_27.1` has 290 citing rules, 678 citations, 140 distinct controls. No citation is
  withdrawn, unknown, malformed or repeated within a rule. (The brief that started this work said
  292 of 350; the numbers above are the ones measured.)

## 4. Source naming and rule ids

- **Source name** `nist_800_53`, display name "NIST SP 800-53 Rev. 5", vocabulary label "NIST SP
  800-53". The revision is not in the source name (section 13, decision 1).
- **Rule id** `nist_800_53.<OSCAL id>`, verbatim: `nist_800_53.ac-20`, `nist_800_53.ac-20.1`.
  This keeps the ISM precedent ("rule ids stay `<source>.<upstream rule id>`") and is what NIST
  publishes as the id. Rule files are `rules/ac-20.1.json`.
- **Schema change.** The rule and index schemas allow `[a-z0-9_-]` after the source prefix, so a
  dot in an enhancement id fails validation today. The pattern widens to
  `^[a-z0-9_]+\.[a-z0-9_-][a-z0-9_.-]*(?![\s\S])` in `baselines/_rule.schema.json` and
  `baselines/_index.schema.json`. Every existing id still matches, no existing file changes, so
  `schema_version` does not change and no release needs re-importing. Code that reads rule ids
  already splits on the first dot only (`upstreamRuleId` in `webui/src/logic/ruleDisplay.ts`,
  `rule_id.split(".", 1)` in `tools/mappings.py`); the comment there saying "upstream ids never
  contain a dot" is corrected. File names with dots already pass every safe-segment check
  (`tools/file_references.py`, `scripts/copy-baselines.mjs`, `webui/src/logic/fileReferences.ts`).
- The importer still requires each id to match `^[a-z]{2}-\d+(\.\d+)?$`, so nothing that could
  form `..` or a path reaches a file name.
- **Labels.** `label_for_control_id("ac-20.1") == "AC-20(1)"` and its inverse
  `control_id_for_label` live in `tools/nist_800_53_normalize.py`. The importer fails if the
  derived label differs from the catalog's no-class `label` prop for any entry, so the derivation
  is proven against the data on every import. The mapping generator (section 9) uses the same
  functions, so it never needs the raw catalog.

## 5. Normalization

### 5.1 Field mapping

For every catalog entry without `status: withdrawn`:

| v5 field | From |
|---|---|
| `id` | `nist_800_53.` + OSCAL `id` |
| `title` | Base control: the OSCAL `title` ("Use of External Systems"). Enhancement: parent title, ` \| `, enhancement title ("Use of External Systems \| Limits on Authorized Use"), the way SP 800-53 prints enhancement headings. |
| `discussion` | Markdown, two blocks: `## Control` then the rendered statement (5.2), a blank line, `## Discussion` then the `guidance` prose with links rewritten (5.3). |
| `discussion_format` | `"markdown"` |
| `section_path` | `[<family title>, "<zero-padded label of the base control> <base control title>"]`, e.g. `["Access Control", "AC-20 Use of External Systems"]`, `["Access Control", "AC-02 Account Management"]`. Base controls and their enhancements share the second level. |
| `source.upstream_rule_id` | OSCAL `id` |
| `source.upstream_path` | `nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json` |
| `source.upstream_url` | `https://github.com/usnistgov/oscal-content/blob/<commit sha>/<upstream_path>` |
| `source.upstream_revision`, `source.upstream_updated` | `null` (the catalog has no per-control revision or date) |
| `source.license` | `{ "name": "CC0 1.0 (public domain)", "url": "https://creativecommons.org/publicdomain/zero/1.0/", "rights_holder": "National Institute of Standards and Technology", "modified": true }` |
| `assessment` | `{ "status": "manual", "manual_reason": "no_check" }` |
| `architecture`, `check`, `odv`, `remediation` | `null` |
| `applicability` | One entry, `target: null`, `version: null`, benchmarks from the profiles (5.4) |
| `tags` | `[]` |
| `references` | `{ "related_controls": [...], "publications": [...] }`: the no-class labels of the control's `related` links in upstream order (`"AC-2"`, `"CA-3"`), and the `title` of each back-matter resource named by a `reference` link, in upstream order. A key with an empty list is left out; a control with neither gets `{}`. |

`required`, `incorporated-into` and `moved-to` links are not carried over. The props
`implementation-level` and `contributes-to-assurance` are recognised and not carried over
(section 13, decision 8).

### 5.2 Statement rendering

- A statement with top-level `prose` starts with that prose as a paragraph.
- Its `item` parts become a Markdown list, one line per item: `- <label> <prose>`, where label is
  the item's `label` prop verbatim (`a.`, `1.`, `(a)`). Nested items are indented two spaces per
  level. Items keep upstream order.
- Every `{{ insert: param, <id> }}` is replaced, recursively for inserts inside select choices:
  - A param with a `label`: `[Assignment: organization-defined <label>]`, or
    `[Assignment: <label>]` when the label already starts with "organization-defined". This is how
    SP 800-53 prints parameters (section 13, decision 6).
  - A param with a `select`: `[Selection (one or more): <choice>; <choice>]` when `how-many` is
    `one-or-more`, `[Selection: <choice>; <choice>]` when it is absent. Choices are trimmed.
- Whitespace around an insert is kept as upstream wrote it.
- `odv` stays `null`. A rule's `odv` drives value substitution in generated scripts, which 800-53
  rules do not have, and one control can carry several parameters.

### 5.3 Guidance links

- `[text](#<back-matter uuid>)` becomes `[text](<first rlinks href>)`, as in ISM.
- `[text](#<any other catalog id>)` (a control, a statement part or a family) becomes plain
  `text`. The link text already names the control ("PM-1", "CM-3f").
- The importer collects every id in the catalog (groups, controls, parts, params) to tell the two
  apart. A `#target` that matches neither fails the import.

### 5.4 Baselines as benchmarks

The four profiles become benchmarks on the single applicability entry, in this fixed order, each
only if the profile lists the control, `severity: null`:

| Profile | Benchmark name | Vocabulary label |
|---|---|---|
| LOW | `nist_800_53_low` | 800-53 Low |
| MODERATE | `nist_800_53_moderate` | 800-53 Moderate |
| HIGH | `nist_800_53_high` | 800-53 High |
| PRIVACY | `nist_800_53_privacy` | 800-53 Privacy |

A control in no baseline gets `benchmarks: []`. mSCP has no benchmark with these names, so
nothing collides. The UI's existing benchmark facet, filter and table summary handle null-target
benchmarks since the ISM work.

### 5.5 Withdrawn controls

Withdrawn entries (182) are skipped: they have no statement or guidance (two have a one-line
note) and would add 182 empty rows. Because they are not rules, the release comparison already
shows a control withdrawn in a later release as "removed", which is what happened. A mapping
citation to a withdrawn control is reported as unresolved (section 9.4).

### 5.6 Fail loudly

Unknown is an error, not a skip (non-zero exit, no partial output), as for ISM:

- an unknown control key, control class, prop name, part name, link `rel` or group class;
- an id not matching `^[a-z]{2}-\d+(\.\d+)?$`, a duplicate id, or a derived label that differs
  from the no-class `label` prop;
- a current entry without exactly one `statement` and one `guidance` part;
- an item part without exactly one `label` prop, or a statement part nested deeper than three
  levels;
- a `{{ ... }}` that is not `{{ insert: param, <id> }}`, an insert naming an unknown param, a
  param with both or neither of `label` and `select`, an unknown `how-many`, or an insert cycle;
- a `[text](#target)` link that resolves to nothing;
- a `related` link to an unknown id, or a `reference` link to an unknown back-matter resource;
- a profile with anything other than one import of `include-controls[].with-ids`, or listing an
  id that is withdrawn or not in the catalog;
- a schema violation in any output file.

Output goes through `tools/json_output.write_json`; index entries are sorted by OSCAL `sort-id`
(so `ac-2` comes before `ac-10`), and a second `--offline` run changes nothing.

## 6. Importer

### 6.1 Layout

The vendored copy mirrors the upstream repository paths, because two of the files are both
called `README.md` / `LICENSE.md` at different levels:

```
sources/nist_800_53/releases/v1.6.0/source.json
sources/nist_800_53/releases/v1.6.0/upstream/LICENSE.md
sources/nist_800_53/releases/v1.6.0/upstream/nist.gov/SP800-53/README.md
sources/nist_800_53/releases/v1.6.0/upstream/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json
sources/nist_800_53/releases/v1.6.0/upstream/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_<LOW|MODERATE|HIGH|PRIVACY>-baseline_profile.json
baselines/nist_800_53/releases/v1.6.0/_index.json
baselines/nist_800_53/releases/v1.6.0/rules/<OSCAL id>.json
```

The full (pretty-printed) catalog is vendored, not the `-min` one, so `git diff` on a new release
shows readable line changes (section 13, decision 9). About 10.5 MB of upstream and roughly 4 MB
of normalized JSON per release.

### 6.2 Command

`python tools/import_nist_800_53.py --tag v1.6.0`, plus `--offline` and `--offline --release
<tag>`, through `release_import.run_cli`, exactly like the other two importers. Files are fetched
from `https://raw.githubusercontent.com/usnistgov/oscal-content/<commit sha>/<path>`, the tag is
resolved with `github_fetch.resolve_tag_commit` (it is annotated), and the published date comes
from `github_fetch.fetch_release_published_date`. Repository API path `usnistgov/oscal-content`,
user agent `intune-compliance-toolkit-nist-800-53-import`, importer format
`nist-800-53-rev5-oscal-1`. Standard library only; no new dependency.

### 6.3 Release label

Release labels are "Sep 2026" for ISM and "27.1" for mSCP: the tag is not part of the label, because
the UI always shows the tag beside it ("Current: Sep 2026 (v2026.09.4)"). For 800-53 the tag
(`v1.6.0`) is the content repository's version, not the 800-53 version, so the label is the
catalog's `metadata.version`, for example `5.2.0`. That needs the catalog, so
`SourceImporter.release_label` changes from `Callable[[str], str]` to `Callable[[str, Path], str]`
(tag, upstream directory). The mSCP and ISM labels ignore the directory and stay byte-identical.
Two content releases can carry the same 800-53 version and so the same label; the tag beside it
in the UI tells them apart. (An earlier draft used `5.2.0 (v1.6.0)`, which showed the tag twice.)

### 6.4 Updating to a new release

1. `python tools/import_nist_800_53.py --tag <new tag>` (this also regenerates the mSCP mapping,
   section 9.3).
2. Review `git diff sources/nist_800_53/ baselines/nist_800_53/ baselines/_mappings/
   docs/mappings/`.
3. Run the Python, Vitest and Playwright suites.
4. Commit (`feat: import NIST SP 800-53 <tag>`) and push.

## 7. Licence and attribution

- No attribution is legally required (public domain in the US, CC0 1.0 elsewhere), but the
  project credits it the same way as the other sources, because it is honest and the UI already
  credits every source.
- `NOTICE` gains a third-party entry: the oscal-content repository, the release, the commit, the
  public-domain and CC0 statement, where the vendored `LICENSE.md` is, what this project changed
  (normalized format, statement and parameter rendering, link rewriting, derived ids, section and
  title composition), and that NIST does not endorse this project.
- `README.md` Licensing gains a matching paragraph.
- Every rule and the manifest entry carry the licence block in 5.1. `modified` stays `true`.
- The UI footer's "Sources & licences" dialog lists sources from the manifest. Its sentence
  "licensed <name>, modified for this tool" reads oddly for public domain ("licensed CC0 1.0
  (public domain)"), so it becomes "under <name>, modified for this tool" for every source.

## 8. Web UI

Most of the UI is driven by the manifest and vocabulary, so 800-53 needs few code changes:

- **Vocabulary** (`baselines/_vocabulary.json`): source `nist_800_53` labelled "NIST SP 800-53";
  the four benchmark labels in 5.4.
- **Markdown reader** (`webui/src/logic/discussionMarkup.ts`, `parseMarkdownDiscussion`): add
  `## ` headings (the `heading` block kind already exists for AsciiDoc) and nested `- ` list items
  (two-space indentation per level, up to three levels). ISM discussions use neither, so they
  render as before; prove that with a Vitest case over a real ISM discussion.
- **Attribution sentence** (`AttributionFooter.tsx`): "licensed" becomes "under" (section 7).
- **Counts.** The current library grows from 1,495 to 2,509 rules (352 + 1,143 + 1,014). Every
  e2e and Vitest pin on the old total is updated; the per-source pins for mSCP and ISM are
  unchanged.
- **History and Frameworks.** With one stored release, the History tab stays hidden for 800-53
  rules (it shows only when a source has more than one release), and the Frameworks card shows a
  single release. The compare picker already lists only sources with two or more releases.
- **Mapped rules.** No code change. An 800-53 control cited by many mSCP rules (CM-7 is cited by
  77 rules in `release_27.1`, CM-7(1) by 75) gets a long "Supported by" group; the tab already has
  a filter.
- Per `.claude/CLAUDE.md`, every rendering change is checked with `bun run test:e2e` and
  Playwright screenshots at about 375px and desktop width, read before the work is called done.

## 9. The generated mSCP to 800-53 mapping

### 9.1 What is generated

One link per citing mSCP rule in the current mSCP release:

```jsonc
{
  "relation": "supports",
  "from": [{ "kind": "rule", "id": "mscp.os_gatekeeper_enable", "release": "release_27.1" }],
  "to": [
    { "kind": "rule", "id": "nist_800_53.cm-14", "release": "v1.6.0" },
    { "kind": "rule", "id": "nist_800_53.cm-5", "release": "v1.6.0" },
    { "kind": "rule", "id": "nist_800_53.si-7.1", "release": "v1.6.0" },
    ...
  ],
  "note": "Generated from mSCP's own references: mSCP lists this 800-53 control for this rule. Not reviewed by this project."
}
```

- Relation `supports`, direction mSCP rule -> 800-53 control, matching "mSCP rule supports the
  cited control".
- `to` follows mSCP's citation order, with repeats removed (and reported, 9.4).
- Both releases are the sources' current releases, so the generated file never triggers the
  validator's stale-release warning.
- Links are sorted by mSCP rule id. For `release_27.1` this gives 290 links and 678 pairs.

### 9.2 Where it lives

`baselines/_mappings/rules/mscp-to-nist-800-53.json`, mapping id `mscp-to-nist-800-53`, in the
same folder and format (schema version 1) as the hand-written mappings, so the validator, the
publish step and the UI need no change. Its `description` says it is generated, by which command,
from which releases, and must not be edited by hand. A test regenerates it and fails if the
committed bytes differ, which enforces that. (`tests/test_committed_library.py` currently
describes `_mappings` as "maintainer-written, never generated by an importer"; that comment is
updated to name the one generated file.)

### 9.3 How it is regenerated

- `tools/generate_mscp_nist_800_53_mapping.py` holds the logic and a CLI (`python
  tools/generate_mscp_nist_800_53_mapping.py`). It reads only the normalized library: the
  manifest, the current mSCP release's rules, and the current 800-53 release's index.
- `SourceImporter` gains an optional `after_import: Callable[[Path], None] | None` (default
  `None`), called once by `run_cli` with the baselines directory after every requested release
  imported successfully. `import_mscp` and `import_nist_800_53` set it to the generator, so both
  `--tag` and `--offline` imports keep the mapping current. ISM does not set it.
- If either source is missing from the manifest, the generator does nothing and says so.
- A failure in the generator after a successful import is reported and makes the command exit
  non-zero, but the imported releases stay published (same reasoning as the existing change
  summary).

### 9.4 Unresolved citations

A citation produces no link when it does not match `^[A-Z]{2}-\d+(\(\d+\))?$`
(`unrecognised_format`) or when the derived id is not a rule in the current 800-53 release
(`not_in_release`, which covers withdrawn and mistyped controls). A repeated citation within one
rule is `duplicate_citation`. Each case is:

- printed as a warning line naming the mSCP rule and the citation, and
- written to `docs/mappings/mscp-to-nist-800-53-unresolved.json`, generated alongside the
  mapping (`{ "schema_version": 1, "mscp_release": ..., "nist_800_53_release": ...,
  "unresolved": [{ "rule": ..., "citation": ..., "reason": ... }] }`, sorted by rule then
  citation). Today the list is empty. Committing it means a new mSCP or 800-53 release that
  breaks a citation shows up in review as a diff, without failing CI: the citations are upstream
  facts, not errors in this repo.

### 9.5 Coexisting with hand-written mappings

- The validator (`tools/mappings.py`) checks the generated file like any other. Its existing
  rules apply across files: a hand-written link repeating a generated pair, or giving it another
  relation or the opposite direction, is an error. The README says so: hand-written links between
  mSCP and 800-53 are for pairs mSCP does not cite.
- The README's "only mappings a reviewer can agree with without debate" rule gets one stated
  exception: the generated file records mSCP's claim, not this project's review, and its note
  says so on every link.
- The hand-written mSCP to ISM files are untouched.

## 10. Test strategy

- **Normalizer** (`tests/test_nist_800_53_normalize.py`) against a small hand-written fixture
  catalog and profiles (`tests/fixtures/nist_800_53/`): field mapping for a base control and an
  enhancement; a three-level statement; label and select params including a select choice that
  inserts a param and an "organization-defined" aggregate; each link kind in guidance; a withdrawn
  entry skipped; baselines in fixed order; `references`; one test per fail-loudly case in 5.6.
- **Label functions**: round trip for every current id in the committed data, and the inverse
  rejects malformed citations.
- **Fetcher and CLI** (`tests/test_nist_800_53_fetch.py`, `tests/test_import_nist_800_53.py`),
  with a fake opener as for ISM: pinned raw URLs and repository paths, lock contents, byte-stable
  offline import, the release label, untouched library on failure.
- **Committed data** (`tests/test_committed_library.py`): the importer is added to
  `IMPORTERS_BY_NAME`, so every stored release regenerates byte-identically; the vendored catalog
  has the SHA-256 in section 3; 1,014 rules; benchmark counts 149/287/370/96; no `](#` left in any
  discussion; no `{{` left in any discussion; `LICENSE.md` mentions CC0.
- **Generated mapping** (`tests/test_mscp_nist_800_53_mapping.py`): unit tests on fixture
  libraries for each unresolved reason, ordering and dedupe, and the skip when a source is
  missing; a committed-data test that regenerates the mapping and the unresolved report and
  compares bytes; `python tools/mappings.py` reports no errors and no warnings for it.
- **Release framework** (`tests/test_release_import.py`): `after_import` is called once after a
  successful run and not after a failed one; the changed `release_label` signature.
- **Web**: Vitest for the Markdown reader additions and the unchanged ISM rendering; e2e for the
  new totals, the 800-53 source and benchmark filters, an 800-53 rule's details (headings, nested
  statement list, an `[Assignment: ...]`, the credit line), and the mapped rules tab in both
  directions using the generated file; screenshots at about 375px and desktop width.
- Verification commands: `python -m pytest -W error`; from `webui/`: `bun run test`, `bun run
  lint`, `bun run build` (which runs `tsc -b`), `bun run test:e2e` with `bun run dev` running.

## 11. Delivery

Four tasks in `docs/plans/2026-11-11-nist-800-53-import-plan.md`, each committed and pushed on its
own. As with ISM, the `nist_800_53` manifest entry must not reach `main` before the UI task lands
(GitHub Pages deploys from `main`; pushing the feature branch is fine).

## 12. Later (not in this work)

- Search by the NIST label form (`AC-20(1)`), which users type more often than `ac-20.1`. Today
  search matches the id and title only.
- `implementation-level` (`organization` / `system`) as a filter. "System" controls are the ones
  a device check could ever cover, which matters for this project.
- 800-53A assessment objectives in the attestation report.
- Older oscal-content releases for history.
- A reviewed (judgment-based) mSCP to 800-53 mapping layer, if the maintainer wants more than
  mSCP's own claims.

## 13. Decisions made without the maintainer

Each was my call; the alternative is listed for review.

1. **Source name `nist_800_53`** (revision in the display name and importer format only).
   Alternative: `nist_800_53r5`, which would make a future Rev. 6 a separate source rather than a
   new release of this one.
2. **Rule id keeps the OSCAL id with its dot** (`nist_800_53.ac-20.1`), widening the id pattern
   without a schema version bump. Alternative: rewrite the dot (`ac-20_1`) and leave the schemas
   alone, at the cost of an id NIST never publishes.
3. **Enhancements are separate rules**, grouped under their base control in `section_path`.
   Alternative: nest enhancements inside the base control's rule, which mSCP's per-enhancement
   citations and the per-enhancement baselines argue against.
4. **Withdrawn controls are skipped.** Alternative: import them as rules marked withdrawn, with
   their "incorporated into" target, so they can be found by id.
5. **Enhancement titles are "<base title> | <enhancement title>"** and titles do not include the
   label. Alternatives: the bare enhancement title, or a title prefixed with `AC-20(1)`.
6. **Parameters render as `[Assignment: organization-defined <label>]` and `[Selection (one or
   more): ...]`**, SP 800-53's printed convention. Alternative: the OSCAL label verbatim
   (`[Assignment: frequency]`), or the parameter id.
7. **Discussion is "## Control" + statement, then "## Discussion" + guidance**, which needs
   headings and nested lists in the Markdown reader. Alternative: a flat list with composite
   labels (`a.1.`) and no headings, with no UI change.
8. **`implementation-level` and `contributes-to-assurance` are not captured.** Alternative: carry
   them as tags now.
9. **The full catalog is vendored, not the `-min` one.** Alternative: the `-min` file halves the
   repository growth per release (about 5.5 MB) but makes upstream diffs unreadable.
10. **800-53A assessment parts are dropped.**
11. **`references` holds `related_controls` and `publications`.** Alternative: `{}` as for ISM.
12. **Second-level sections use the zero-padded label** (`AC-02 Account Management`) so the
    existing alphabetical section sort orders them correctly. Alternative: the plain label with a
    numeric-aware sort in `webui/src/logic/sectionTree.ts`.
13. **Release label `5.2.0`** (the catalog version; the UI adds the tag), which needs the
    `release_label` signature change. Alternative: the tag alone (`v1.6.0`), with no framework change,
    which the UI would show twice.
14. **Only `v1.6.0` is imported.** Alternative: earlier oscal-content tags for history now.
15. **Licence block name "CC0 1.0 (public domain)"**, rights holder NIST, and the footer wording
    changes from "licensed" to "under" for all sources. Alternative: keep the wording and accept
    "licensed CC0 1.0 (public domain)".
16. **The generated mapping is one file in `baselines/_mappings/rules/`, guarded by a
    regenerate-and-compare test**, with no new key in the mapping format. Alternative: a separate
    generated folder or a `generated` flag in the format, which would need validator and publish
    changes.
17. **One link per mSCP rule** (all its citations in `to`) with a single fixed note. Alternative:
    one link per pair.
18. **The generator runs from both importers through a new `after_import` hook.** Alternative: a
    standalone command only, relying on the regenerate-and-compare test to catch a forgotten run.
19. **Unresolved citations are reported, not failed**, and kept in a committed report under
    `docs/mappings/`. Alternative: fail the import, or report only on the console.
20. **The generator does not skip pairs a maintainer has hand-written**; the validator flags the
    overlap. Alternative: let hand-written pairs take precedence and leave them out of the
    generated file.

## Progress log

- 2026-11-11: Design drafted from upstream checks of oscal-content `v1.6.0` (no code yet), with
  the decisions in section 13 made without the maintainer for later review.
