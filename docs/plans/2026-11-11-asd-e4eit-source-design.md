# Design: ASD Essentials for enterprise IT (E4EIT) as a third rule source

Date: 2026-11-11
Status: Draft, not yet reviewed by the maintainer

## 1. Intent

The library has two rule sources today: NIST mSCP and the ASD Information Security Manual
(`docs/plans/2026-10-22-asd-ism-source-design.md`). This design adds a third: ASD's
**Essentials for enterprise IT** (E4EIT), published as the "Assessment evidence guide for
enterprise IT". E4EIT is a short, outcome-focused framework: 58 **actions**, grouped under
the principles that ASD's ISM also uses (GOV-01, PRO-13, ...), each scoped to one or more
**domains** (user devices, identity services, boundary services, ...) with a **priority
phase** per domain, and each with "not effective / partially effective / fully effective"
indicators that an assessor uses to judge it.

Like ISM, E4EIT is imported raw from ASD's OSCAL, through a deterministic one-command
importer, kept per release (`docs/plans/2026-11-10-release-history-design.md`), and every
E4EIT rule is manual: it flows to the manual attestation report. ASD also publishes a
first-party mapping from each action to ISM controls (including the Essential Eight
controls). That mapping is imported into the existing rule mapping format
(`docs/plans/2026-10-27-rule-mappings-design.md`), so an E4EIT action shows the ISM controls
ASD names for it, and each of those ISM controls shows the action back.

## 2. Goals, non-goals, anti-goals

### Goals

- Import every E4EIT action (58 in `v2026.10.15`) as a rule under
  `baselines/asd_e4eit/releases/<tag>/`, listed in the manifest, through
  `python tools/import_asd_e4eit.py --tag <tag>` and `--offline`, like the ISM importer.
- Make domains and priority phases filterable in the Benchmark facet.
- Keep each action's assessment indicators with the rule, so the attestation report and the
  detail panel carry what an assessor needs.
- Import ASD's E4EIT to ISM and E4EIT to Essential Eight mappings as rule mappings against
  the existing `asd_ism` source, regenerated with every import, never hand-edited.
- Keep ASD's other cross-framework references (NIST CSF 2.0, NIST SP 800-171r3, AEMO AESCSF
  v2, MITRE ATT&CK techniques) on each rule as `references`.
- Comply with CC BY 4.0 attribution for ASD content, as for ISM.
- Share code with the ISM importer where it is genuinely common.

### Non-goals (for now)

- A standalone Essential Eight source (section 9.3).
- Importing NIST CSF 2.0, SP 800-171r3 or AESCSF as sources. Their ids appear only as
  references.
- Per-domain assessment records (judging an action separately for each domain it applies
  to). That is a reporting concern for the attestation report rethink (ISM design,
  section 13), not a rule-shape concern (section 6.2).
- Checks for E4EIT actions. Every E4EIT rule is `manual` / `no_check`.
- Vendoring the XML and YAML copies, the per-domain resolved catalogs, or the PDF release
  asset (section 4).

### Anti-goals (failure even if it technically works)

- Any E4EIT rule text, attribute or mapping that did not come from ASD's OSCAL or from
  deterministic derivation in this repo's code. No AI-written content in rule or mapping
  files.
- The generated ISM mapping file edited by hand, or drifting from its upstream file
  without a test failing.
- 212 near-identical rules (one per action and domain) in the rule list.
- Any change to existing mSCP or ISM output. The shared-code refactor (Task 1 of the plan) must
  leave every committed release byte-identical.

## 3. Facts about the E4EIT OSCAL release that shape this design

All verified on 2026-11-11 against the GitHub release `v2026.10.15`:

- **Where it lives.** ASD publishes E4EIT OSCAL on cyber.gov.au
  (https://www.cyber.gov.au/e4eit/oscal, the authoritative copy, per the repo README) and
  mirrors it to GitHub (https://github.com/AustralianCyberSecurityCentre/e4eit-oscal). The
  mirror has one tag, `v2026.10.15`, a lightweight tag on commit
  `1cd32b96310e2dd166b5d51ce64f414a4613025d`. The GitHub release was published
  2026-10-15T00:46:37Z and says it is "based on 15 Oct 2026 version of the Assessment
  evidence guide for enterprise IT and OSCAL version 1.2.3". Its only release asset is a PDF.
- **Files at the tag** (each in JSON, XML and YAML): `E4EIT_catalog`, one
  `E4EIT_<domain>-domain_profile` and one `E4EIT_<domain>-domain_resolved-catalog` for each
  of the 8 domains, and `E4EIT_mapping-collection`; plus `README.md`. No LICENSE file.
  SHA-256 of `E4EIT_catalog.json`: `29b602fbbce89d83f9dffd6e6f99d32d1929b563a967f62b2c1cb52891fdb7d2`;
  of `E4EIT_mapping-collection.json`:
  `34fe6d00e88b2352cf70f8c88e63c01ceb70a8f614d27aef0c2fa4d740ce7ae8`.
- **Licence.** The GitHub API reports no licence because there is no LICENSE file. The
  README carries the licence, in the same words as the ISM OSCAL README: "(c) Commonwealth
  of Australia 2026. With the exception of the Coat of Arms, the Australian Signals
  Directorate logo and where otherwise stated, all material presented in this publication
  is provided under a Creative Commons Attribution 4.0 International licence", plus a
  disclaimer (general nature, not legal advice, no liability). Neither the Coat of Arms nor
  the logo appears in the JSON. **This is CC BY 4.0, the same terms as the ISM import. It is
  not a blocker.** The README is vendored as the licence evidence, as for ISM.
- **Catalog shape.** `catalog.groups` nest exactly two levels above every control:
  - 5 **function** groups (`GOV` "Govern principles", `IDE` "Identify principles", `PRO`
    "Protect principles", `DET` "Detect principles", `RES` "Respond principles"), with no
    parts;
  - 32 **principle** groups (`class: essentials-principle`, title such as
    `"PRO-13 - Identity, credential and access management"`), each with exactly one
    `overview` part (prop `label: Principle`) holding one sentence of prose;
  - 58 **controls**, one per action, ids such as `IT.PRO-13.1` (all match
    `^IT\.[A-Z]{3}-\d{2}\.\d+$`). The OSCAL `title` is a placeholder equal to the id.
    No `class`, no `params`, no nested controls.
- **Control fields.**
  - Props: `sort-id`, and `domain` (namespace `https://www.cyber.gov.au/ns/essentials/oscal/1.0`),
    repeated once per domain the action applies to. 212 domain props in all: 21 actions
    have 1 domain, 2 have 2, 8 have 4, 7 have 5 and 20 have 6.
  - Parts: exactly two, both `name: statement`:
    - `class: essentials-action` (prop `label: Action`): the action text, one paragraph,
      80 to 264 characters, no links.
    - `class: indicators-of-good-practice`, titled "Indicators of Good Practice", holding
      three `indicator-group` items titled "Not effective", "Partially effective" and
      "Fully effective", each a list of indicator statements (160, 174 and 195 in all).
  - Links: 38 controls have `rel: mitigated-technique` links (108 in all) to back-matter
    resources that point at MITRE ATT&CK v19 technique pages
    (`https://attack.mitre.org/versions/v19/techniques/T1078/`).
  - No revision or updated-date props.
- **Domains and priority phases.** Each control's `domain` props agree exactly with the
  `include-controls` list of the matching domain profile (checked for all 8). The profile is
  the only place a domain's description and **priority phase** live (profile metadata props
  `domain`, `domain-description`, `domain-priority-phase`). Phase belongs to the domain, not
  the action:

  | Domain (`domain` value) | Phase | Actions |
  |---|---|---|
  | `boundary-services` | `phase-1` | 37 |
  | `identity-services` | `phase-1` | 35 |
  | `critical-processes-and-services` | `phase-2` | 37 |
  | `privileged-environments` | `phase-2` | 35 |
  | `business-systems` | `phase-3` | 27 |
  | `governance-and-culture` | `phase-3` | 9 |
  | `user-devices` | `phase-3` | 20 |
  | `visibility-and-response` | `phase-3` | 12 |

  Taking each action's phases as the phases of its domains, 37 actions fall in phase 1, 37
  in phase 2 and 48 in phase 3. The profiles use `merge: as-is` and no `modify`, so the
  resolved catalogs add nothing the catalog plus profiles don't already say.
- **Mapping collection** (`E4EIT_mapping-collection.json`). Title "Assessment evidence
  guide for enterprise IT - Potential Evidence Sources OSCAL Control Mapping". Provenance:
  `method: human`, `matching-rationale: functional`, `status: complete`. ASD's description:
  references to other frameworks "indicate where supporting evidence of that action's
  effectiveness may exist (if an organisation has adopted that framework already). The list
  is not intended to define the controls required to meet the intent of the actions."
  Five mappings, every map one source to one target, every `relationship` is
  `intersects-with`, every endpoint `type: control`:

  | `mapping-description` | Target | Maps | Actions | Targets |
  |---|---|---|---|---|
  | `E4EIT to ISM (excl. E8)` | ISM catalog `v2026.09.4` | 156 | 52 | 104 ISM controls |
  | `E4EIT to E8` | "ASD's Essential Eight 02 Oct 2024", but the target ids are ISM control ids and the resource link is the ISM `v2026.09.4` catalog | 169 | 35 | 118 ISM controls |
  | `E4EIT to CSF` | NIST CSF 2.0 | 205 | 58 | 70 |
  | `E4EIT to 800-171r3` | NIST SP 800-171r3 | 179 | 58 | 64 |
  | `E4EIT to AESCSF` | AEMO AESCSF v2 | 183 | 58 | 117 |

  All 222 ISM control ids in the first two mappings exist in our committed ISM `v2026.09.4`.
  Every E8 target is an ISM control that our ISM import already marks with `e8_ml1`, `e8_ml2`
  or `e8_ml3`; no ISM (excl. E8) target is. The two mappings share no pair. Every action has
  at least one ISM or E8 link.

## 4. Upstream and vendoring

- **Pinned source:** the GitHub mirror, by tag and commit SHA, like ISM. The maintainer chose
  the GitHub mirror for ISM because tags give pinned commit SHAs; the same reasoning holds.
- **Vendored per release**, byte for byte, into `sources/asd_e4eit/releases/<tag>/upstream/`:
  `README.md`, `E4EIT_catalog.json`, `E4EIT_mapping-collection.json`, and every
  `E4EIT_*-domain_profile.json` at the commit (8 today, about 8 KB each). About 775 KB per
  release.
- The fetcher finds the profile files by listing the repository root at the commit (GitHub
  contents API), so a new domain in a future release is vendored and then rejected by name
  in the normalizer, instead of being silently missed.
- **Not vendored:** XML and YAML copies (same content), resolved catalogs (derivable, see
  section 3), and the PDF release asset.
- Lock file `sources/asd_e4eit/releases/<tag>/source.json`, same shape as ISM's, with
  `importer_format: "asd-e4eit-oscal-1"`. User agent `intune-compliance-toolkit-asd-e4eit-import`.

## 5. Naming

- **Source name:** `asd_e4eit`. Display name: `ASD Essentials for enterprise IT`. Vocabulary
  source label: `ASD E4EIT`.
- **Rule ids:** `asd_e4eit.` + the OSCAL control id, lowercased, dots kept:
  `IT.PRO-13.1` becomes `asd_e4eit.it.pro-13.1`. Rule file `rules/it.pro-13.1.json`.
  `source.upstream_rule_id` keeps the verbatim `IT.PRO-13.1`, which the detail panel's
  credit line already shows.
  - Today's rule id pattern (`^[a-z0-9_]+\.[a-z0-9_-]+$` in `_rule.schema.json` and
    `_index.schema.json`) allowed no dot after the source prefix. The NIST SP 800-53 plan
    already widened it (final-review fix) to `^[a-z0-9_]+\.[a-z0-9_-]+(\.[a-z0-9_-]+)*$`
    (written with the files' `(?![\s\S])` end anchor): dots allowed between non-empty
    segments, the first dot still separating the source. Every existing file stays valid and no output
    changes, so `schema_version` stays 5 and no release has to be re-imported. All code that
    reads a source from an id already splits on the **first** dot (`upstreamRuleId` in
    `webui/src/logic/ruleDisplay.ts`); the table's open-row lookup already uses
    `CSS.escape`. Searching `IT.PRO-13.1` or `pro-13.1` matches, because search lowercases
    the needle and compares it to the id after the source prefix.
  - The importer fails loudly on an upstream id that is not `^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$`
    or whose lowercased form collides with another.
  - NIST SP 800-53 enhancement ids (`ac-2.1`) have the same dot problem. The concurrent
    NIST 800-53 design (`docs/plans/2026-11-11-nist-800-53-*`) should use the same widening;
    if it lands a different rule for dotted ids first, this source follows that rule instead.
- **Benchmark names**, all `severity: null`, in this fixed order within the one
  applicability entry: the three phases, then the eight domains in phase order and then
  alphabetical order:

  | Benchmark | From | Vocabulary label |
  |---|---|---|
  | `e4eit_phase_1` | any domain with `phase-1` | `E4EIT priority phase 1` |
  | `e4eit_phase_2` | any domain with `phase-2` | `E4EIT priority phase 2` |
  | `e4eit_phase_3` | any domain with `phase-3` | `E4EIT priority phase 3` |
  | `e4eit_boundary_services` | `boundary-services` | `E4EIT Boundary services` |
  | `e4eit_identity_services` | `identity-services` | `E4EIT Identity services` |
  | `e4eit_critical_processes_and_services` | `critical-processes-and-services` | `E4EIT Critical processes and services` |
  | `e4eit_privileged_environments` | `privileged-environments` | `E4EIT Privileged environments` |
  | `e4eit_business_systems` | `business-systems` | `E4EIT Business systems` |
  | `e4eit_governance_and_culture` | `governance-and-culture` | `E4EIT Governance and culture` |
  | `e4eit_user_devices` | `user-devices` | `E4EIT User devices` |
  | `e4eit_visibility_and_response` | `visibility-and-response` | `E4EIT Visibility and response` |

  The labels are the domain names from each profile's title ("Assessment evidence guide for
  enterprise IT - User devices OSCAL Profile"), hand-written into `baselines/_vocabulary.json`
  like the ISM labels. The domain-to-benchmark table is a constant in the normalizer; an
  unknown domain or phase fails the import, so a new one is a deliberate code and
  vocabulary change. The phase a domain sits in is **not** a constant: it is read from the
  profiles on every import, so a phase change shows as a Scope change in release history.
- **Release label:** `Oct 2026` for `v2026.10.15`, from the ISM importer's `release_label`
  (same tag format), moved to a shared module.

## 6. Normalization

### 6.1 Rule fields

For every control in the catalog:

| v5 field | From |
|---|---|
| `id` | `asd_e4eit.` + lowercased control `id` |
| `title` | the `essentials-action` statement prose, verbatim. It must be one paragraph (no `\n\n`) |
| `discussion` | Markdown, built as below |
| `discussion_format` | `"markdown"` |
| `section_path` | `[<function group title>, <principle group title>]`, for example `["Protect principles", "PRO-13 - Identity, credential and access management"]` |
| `source.upstream_rule_id` | the OSCAL id, verbatim |
| `source.upstream_path` | `"E4EIT_catalog.json"` |
| `source.upstream_url` | `https://github.com/AustralianCyberSecurityCentre/e4eit-oscal/blob/<sha>/E4EIT_catalog.json` |
| `source.upstream_revision`, `.upstream_updated` | `null` (E4EIT has no per-action revision) |
| `source.license` | the ISM licence block (same rights holder and terms) |
| `applicability` | one entry, `target: null`, `version: null`, benchmarks per section 5 |
| `assessment` | `{ "status": "manual", "manual_reason": "no_check" }` |
| `references` | section 6.3 |
| `architecture`, `check`, `odv`, `remediation` | `null` |
| `tags` | `[]` |

The discussion, with every text taken verbatim from the catalog:

```markdown
# Principle

<principle overview prose>

# Indicators of Good Practice

Not effective:
- <indicator>
- <indicator>

Partially effective:
- <indicator>

Fully effective:
- <indicator>
```

The headings are the overview part's `label` prop ("Principle") and the indicators part's
`title`; each list is introduced by its indicator group's `title` and a colon. Groups keep
upstream order. Indicator ids (`IT.PRO-13.1.NE-1`) are not shown. The web UI's Markdown
reader gains `# ` headings for this (section 8); no ISM discussion has a `#` line today, so
ISM rendering does not change.

### 6.2 One rule per action, domains as benchmarks

The catalog holds each action once, with one `domain` prop per domain. CISO Assistant
instead repeats each action under every domain it applies to (domain > principle > action),
which would give 212 rules here. This design keeps **one rule per action**:

- It matches ASD's own identity: the catalog, the profiles and the mapping collection all
  name actions by one id (`IT.PRO-13.1`). Release history matches rules by id, and mappings
  link by id. Per-domain copies would need invented ids and would multiply the 325 ISM
  mapping pairs by up to six.
- Filtering by domain still answers "what applies to user devices": tick
  `E4EIT User devices` in the Benchmark facet (20 rules). The domain profiles are ASD's
  equivalent of ISM's classification baselines, which our ISM import also turns into
  benchmarks.
- ASD notes that effectiveness "must also be considered in context of each individual domain".
  That is about recording an assessment per domain, which the attestation report does not
  do for any source yet. It belongs to the attestation report rethink, which can expand an
  E4EIT rule into one assessment row per domain benchmark at report time.

### 6.3 References

Each rule's `references` holds the identifiers ASD links to, with keys in mSCP's style
(organisation, then framework), values sorted and de-duplicated:

```jsonc
{
  "aemo": { "aescsf_v2": ["ACCESS-1b", "ACCESS-1c"] },
  "mitre": { "attack_v19": ["T1078", "T1110"] },
  "nist": { "800-171r3": ["03.01.01"], "csf_2.0": ["GV.OC-01", "GV.RR-01"] }
}
```

- `nist.800-171r3` uses the same key and id format as mSCP's references, so the two line up.
- MITRE technique ids come from the back-matter resource each `mitigated-technique` link points
  at: the `T\d+(\.\d+)?` path segment of its `attack.mitre.org/versions/v<N>/techniques/...`
  href, under key `attack_v<N>`. A resource that does not match that shape fails the import.
- Keys with no ids are left out; a rule with none of them gets `{}`.
- The ISM and E8 maps are **not** copied into `references`: they become live rule mappings
  (section 7), which the Mapped rules tab shows from both sides.
- Copying only identifiers (not CSF, 800-171 or AESCSF text) is what ASD's CC BY material
  already does; it adds no third-party text to the repo.

### 6.4 Fail loudly

As for ISM: unknown is an error, not a skip. The import exits non-zero and writes no partial
output on:

- a group not exactly two levels above a control, a group without a title, a principle group
  whose `class` is not `essentials-principle`, or a principle group without exactly one
  `overview` part with prose;
- an unknown control key (allowed: `id`, `title`, `props`, `links`, `parts`), a control
  `class`, `params` or nested controls;
- an unsafe or colliding id (section 5);
- a prop other than `sort-id` and `domain`, a `domain` prop in another namespace, an unknown
  domain, or a control with no domain;
- parts other than exactly one `essentials-action` statement (one non-empty paragraph) and
  one `indicators-of-good-practice` statement holding exactly the three known groups, each
  with at least one indicator with prose;
- a `\r` anywhere in prose, or a `](#...)` link in prose that does not resolve to a
  back-matter resource (the ISM link rewriter is reused; no E4EIT prose has links today);
- a link with a `rel` other than `mitigated-technique`, or a technique resource of the wrong
  shape;
- a missing profile for a catalog domain, a profile for an unknown domain, a phase outside
  `phase-1` to `phase-3`, or a profile's control list that differs from the catalog's
  `domain` props;
- in the mapping collection: an unknown `mapping-description`, a `relationship` other than
  `intersects-with`, an endpoint `type` other than `control`, a source id that is not an
  action, or a duplicate pair;
- a schema violation in any output file.

Output is byte-stable (`tools/json_output.write_json`, index sorted by id).

## 7. ASD's ISM and Essential Eight mapping

### 7.1 What is imported

The `E4EIT to ISM (excl. E8)` and `E4EIT to E8` maps both target ISM control ids that exist
in our `asd_ism` source, so they are a first-party ASD mapping between two of our sources.
They become one generated mapping file in the existing format,
`baselines/_mappings/rules/asd-e4eit-to-asd-ism.json`:

```jsonc
{
  "schema_version": 1,
  "id": "asd-e4eit-to-asd-ism",
  "description": "Generated by tools/import_asd_e4eit.py from ASD's E4EIT mapping collection v2026.10.15 (Potential Evidence Sources). Do not edit by hand.",
  "links": [
    {
      "relation": "related",
      "from": [{ "kind": "rule", "id": "asd_e4eit.it.gov-01.1", "release": "v2026.10.15" }],
      "to": [
        { "kind": "rule", "id": "asd_ism.ism-1997", "release": "v2026.09.4" },
        { "kind": "rule", "id": "asd_ism.ism-1998", "release": "v2026.09.4" }
      ],
      "note": "ASD lists these ISM controls as potential evidence sources for this action (E4EIT to ISM, excluding Essential Eight)."
    }
  ]
}
```

- One link entry per action per ASD mapping, its `to` list sorted by id: 87 entries (52 ISM,
  35 E8), 325 pairs. Entries sorted by action id, ISM before E8. The E8 entries' note reads
  "... (E4EIT to Essential Eight)." so the Mapped rules tab tells them apart.
- **Relation `related`.** ASD's relationship is `intersects-with`, which is symmetric and
  partial; our `related` is the undirected relation. See section 11 for the `supports`
  alternative.
- **Releases.** The E4EIT side carries the E4EIT release tag. The ISM side carries the ISM
  release named by the mapping's target resource (`.../ism/oscal/v2026.09.4/...`), not
  whatever ISM release is current. When ISM moves on, the existing stale-release note and
  warning appear on these links, which is correct: ASD mapped against `v2026.09.4`.
- **Checks at import:** the named ISM release must be one we have imported, and every
  target id must exist in it; otherwise the import fails and names the missing ids.

### 7.2 Where the file is written

The mapping is written by the E4EIT importer, from the **current** E4EIT release's vendored
mapping collection, after every successful import (`--tag` or `--offline`). It is never
written from an older release. It lives beside the hand-written mapping files, so the
existing validator (`tools/mappings.py`), publish step and UI pick it up unchanged. A
committed-data test regenerates it and compares bytes, which is what stops hand edits.

`tools/release_import.SourceImporter` already has an optional `after_import(sources_dir,
baselines_dir)` callback (added by the NIST SP 800-53 plan, widened to take `sources_dir`
in its final-review fix) that `run_cli` calls once after all requested releases are
imported. E4EIT sets it to its mapping writer; the mSCP and NIST importers set theirs to the
mSCP to 800-53 generator. An importer that needs several generators passes one function
that calls them in turn.

Known consequence: the mapping validator requires every endpoint rule to exist in the
committed library. If a later ISM release removes one of the 222 mapped controls and becomes
current, CI fails until either ASD publishes an updated E4EIT mapping (re-import E4EIT) or
the maintainer decides how to handle it. This is the same constraint the hand-written
mappings live under.

### 7.3 Essential Eight

ASD labels the second map "E4EIT to E8", but every target is an ISM control, and our ISM
import already carries Essential Eight maturity levels on those controls as the `e8_ml1`,
`e8_ml2` and `e8_ml3` benchmarks. So the E8 map needs no E8 source: it links E4EIT actions to
the ISM controls that make up the Essential Eight, and the ISM side's benchmarks say which
maturity levels each belongs to. A standalone Essential Eight source is recorded as an option
only (section 9.3).

## 8. Web UI touch points

The UI is data-driven by the manifest and vocabulary (no code mentions `asd_ism` outside
tests), so the changes are small:

- **Vocabulary** (`baselines/_vocabulary.json`, hand-edited): source label `ASD E4EIT`, and
  the 11 benchmark labels from section 5 with `metadata: ["benchmark"]`, phases first.
- **Markdown headings:** `parseMarkdownDiscussion` in `webui/src/logic/discussionMarkup.ts`
  treats a line starting `# ` (one or more `#` then a space) as the existing `heading` block.
  No ISM discussion has such a line.
- **Rule ids with dots:** no UI code change expected (section 5); covered by tests.
- **Source credit, footer, attestation report attribution, Frameworks tab card, release
  label:** already per source from the manifest; verify on screenshots, change nothing unless
  something renders wrong.
- **History tab:** hidden while E4EIT has one release (existing behaviour).
- **Mapped rules tab:** shows the ISM controls on an E4EIT rule and the E4EIT action on an
  ISM control, from the generated mapping file, with no code change.
- **Counts:** e2e expectations move from 1,495 to 1,553 rules.
- Per `.claude/CLAUDE.md`: `bun run test:e2e` and Playwright screenshots at about 375px and
  about 1280px of the rules list filtered to ASD E4EIT, an E4EIT detail panel (discussion
  with headings and indicator lists, references), its Mapped rules tab, an ISM rule's Mapped
  rules tab showing the action, and the Frameworks landing card. Each screenshot is read
  before the change is called done.

## 9. Licensing, attribution, and options not taken

### 9.1 Licence and attribution

- ASD content in `sources/asd_e4eit/` and `baselines/asd_e4eit/`, and the generated mapping
  file, stays under CC BY 4.0, modified (normalized format, composed discussion, derived ids,
  phases derived from domains).
- `NOTICE` gains an E4EIT entry mirroring the ISM entry: project URL (mirror, plus the
  cyber.gov.au authoritative copy), release, CC BY 4.0, the copyright notice quoted from the
  vendored README ("(c) Commonwealth of Australia 2026 ..."), what was modified, and ASD's
  disclaimer.
- `README.md` gains an attribution paragraph and an "Updating the ASD E4EIT rules" section
  mirroring the ISM ones.
- Each rule carries `source.license`; the manifest entry carries the same block.

### 9.2 Not a blocker

The licence was checked because the GitHub API reports none. The README's terms are CC BY
4.0 with the same exceptions as the ISM README, so nothing here waits on the maintainer.

### 9.3 Standalone Essential Eight source (option, not built)

ASD publishes the Essential Eight inside the ISM OSCAL (the `ISM_E8_ML*` baseline profiles)
and our ISM rules already carry E8 maturity levels as benchmarks; filtering ISM by
`Essential Eight ML2` gives the E8 ML2 control set today. A separate E8 source would
duplicate those controls as second rules. If the maintainer later wants E8 as its own
framework card, the cheaper route is a "view" over ISM's E8 benchmarks, not a new importer.

## 10. Updating to a new E4EIT release

1. `python tools/import_asd_e4eit.py --tag <new tag>`. This also rewrites
   `baselines/_mappings/rules/asd-e4eit-to-asd-ism.json` from the new release.
2. Review `git diff sources/asd_e4eit/ baselines/asd_e4eit/ baselines/_mappings/`.
3. If the import fails on an unknown domain, phase, part or mapping, decide with the
   maintainer whether it is the same format (extend the constants) or a new importer format.
4. Run the Python, Vitest and Playwright suites; commit `feat: import ASD E4EIT <tag>`.

## 11. Decisions made without the maintainer

Each is a default chosen so the work can proceed; each is easy to revisit before
implementation starts.

| Decision | Alternative not taken |
|---|---|
| Source name `asd_e4eit`, display name "ASD Essentials for enterprise IT", label "ASD E4EIT". | `asd_essentials` (broader, but ASD may publish other "Essentials" sets, for example for OT). |
| One rule per action (58), domains as benchmarks (section 6.2). | One rule per action and domain (212), as CISO Assistant does, with invented per-domain ids. |
| Priority phases as derived benchmarks: an action is in every phase of its domains. | Phase only in the domain labels (static, would go stale if ASD moves a domain), or only the earliest phase. |
| Rule ids keep the upstream dots (`asd_e4eit.it.pro-13.1`) by widening the id pattern without a schema version bump. | Replace dots with hyphens (`it-pro-13-1`) and leave the schema alone; ids would no longer read like ASD's and searching `PRO-13.1` would fail. |
| `section_path` is function > principle, as the catalog nests it. | Domain first, as CISO Assistant does; impossible without one rule per domain. |
| Indicators of good practice go into the Markdown discussion, with a small heading addition to the Markdown reader. | A new structured field for indicators (a schema change for one source), or plain paragraphs with no headings. |
| CSF 2.0, 800-171r3, AESCSF and MITRE ATT&CK ids go into `references`. | Dropping them, or adding those frameworks as sources. |
| ISM and E8 maps become one generated mapping file with relation `related`. | `supports` from the ISM control to the action, since ASD calls them "potential evidence sources"; rejected because ASD's own relationship is the symmetric `intersects-with`. |
| The generated mapping file lives in `baselines/_mappings/rules/` beside hand-written ones, guarded by a regeneration test. | A separate `baselines/_mappings/generated/` folder, which would need publish-step and validator changes. |
| ISM endpoints carry the ISM release ASD mapped against (`v2026.09.4`), not the current ISM release. | Stamping the current ISM release, which would hide that ASD's mapping may be out of date. |
| Vendor the catalog, the 8 profiles, the mapping collection and the README; discover profiles from the repo listing. | Vendor everything including XML, YAML and resolved catalogs; or a fixed profile list. |
| Pin the GitHub mirror by tag and SHA, as for ISM. | Fetch from cyber.gov.au (authoritative, but no pinned commits). |
| Share ISM code (licence block, strict JSON reading, release label, link rewriting, pinned file download) through a new shared module; keep the normalizer separate. | Copy the ISM importer and edit it; or merge both into one generic "ASD OSCAL" normalizer (the two catalogs are shaped too differently). |
| No standalone Essential Eight source (section 9.3). | Build one from the ISM E8 profiles. |
| Domain descriptions are not stored. | Put them in the discussion of every action (repetitive) or in a vocabulary description field. |

## 12. Test strategy

- **Normalizer unit tests** (`tests/test_asd_e4eit_normalize.py`) against a small
  hand-written fixture set in `tests/fixtures/asd_e4eit/`: a catalog with two function
  groups, three principles and four actions (one with one domain, one with domains in two
  phases, one with MITRE links, one with every indicator group), two or three profiles, and
  a mapping collection with one map of each kind. Tests cover every field in section 6.1,
  the discussion text exactly, benchmark order, references, the mapping file, and one test
  per fail-loudly case in section 6.4.
- **Shared-code refactor:** the existing ISM and mSCP regeneration tests
  (`test_committed_release_matches_regeneration`) prove byte-identical output; new unit
  tests for the moved helpers (the `after_import` hook is already tested).
- **Schema:** `tests/test_library_schema.py` already accepts `asd_e4eit.it.pro-13.1` and
  rejects `asd_e4eit.it..pro` and a trailing dot.
- **Fetcher and CLI** tests with a fake opener, as for ISM.
- **Committed data:** E4EIT joins `IMPORTERS_BY_NAME` so every stored release is
  regenerated and compared; the vendored README contains `Creative Commons Attribution 4.0`;
  58 rules; every rule has at least one domain and one phase benchmark; the generated
  mapping file equals its regeneration from the current release; `tools/mappings.py` reports
  no errors.
- **Web:** Vitest for the Markdown heading; e2e for the new count, searching `IT.PRO-13.1`,
  the phase 1 benchmark filter (37 rules), the Mapped rules tab from both sides, and an
  E4EIT rule in the manual attestation report with ASD credit; screenshots per section 8.

## 13. Later (not in this work)

- Per-domain assessment rows in the attestation report rethink (section 6.2).
- A Frameworks-level "Essential Eight" view over ISM benchmarks (section 9.3).
- If ASD starts publishing more E4EIT tags, add the earlier ones with `--tag` (they become
  history, never current).

## Progress log

- 2026-11-11: Design drafted from the upstream release and the existing ISM, release
  history and mappings designs (no code yet). Not yet reviewed by the maintainer.
