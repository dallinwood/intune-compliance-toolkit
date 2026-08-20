# Multi-framework rule library: foundation (schema, taxonomy, authoring model)

## Context

The toolkit currently authors one rule JSON per CIS Benchmark recommendation,
scoped to Intune-managed devices. The goal is to broaden it into a general
security policy/rule library that:

- Combines rules sourced from multiple frameworks (CIS, the Australian
  Signals Directorate's Information Security Manual (ISM), and Essential
  Eight), each rule cross-referencing every framework control it satisfies
  (framework name, product/scope, version, control ID, date last checked).
- Lets a user browse and filter the full library by policy type (endpoint
  config, server/infrastructure config, process/administrative policy) and
  platform, not just Intune - with the existing Intune-focused view becoming
  a filtered projection of the same underlying data, not a separate source.
- Keeps every framework's own copyrighted wording out of the repo. A prior
  review (`docs/2026-08-20-cis-content-licensing-review.md`) found CIS's
  terms of use and its CC BY-NC-SA-licensed PDF both prohibit what the repo
  had been doing (reproducing CIS's own prose in committed, public,
  AGPL-licensed rule files). ISM and Essential Eight, by contrast, are
  published by the Commonwealth of Australia under CC BY 4.0 (verified
  against the licence's own legal code, plus two independent searches of
  cyber.gov.au's stated terms) - attribution-only, no ShareAlike or
  non-commercial restriction - so they don't carry the same constraint.

This is the first of four sub-projects (see "Sequencing" below). It defines
the schema, taxonomy, and authoring-process changes everything else builds
on, and removes the 12 existing CIS rule files from `baselines/` since
their content doesn't conform to the new authoring model. It does not
itself ingest ISM/Essential Eight content, rebuild the web UI, or re-author
replacements for the removed CIS rules - that's sub-project 2.

## Decisions already made

- **No dual schema, no legacy grandfathering.** There is exactly one
  `_rule.schema.json` going forward, and it's the v2 shape described below.
  The 12 existing CIS rule files don't get a preserved legacy schema to keep
  validating against - their structure already did its job informing what
  v2 needs to capture, but their content (CIS's own prose, in fields the
  new authoring model doesn't allow for `independent`-mode rules) doesn't
  carry forward. They come out of `baselines/` when v2 lands; re-creating
  them is sub-project 2's job (the independent-authoring pipeline), not
  this one. `baselines/` legitimately holds zero rules in the interim - at
  12 rules total, that's an acceptable gap, not a regression worth
  engineering around.
- **ISM and Essential Eight use direct extraction with attribution**, not
  the independent-authoring pipeline CIS content requires. Their CC BY 4.0
  licence permits adaptation and relicensing (including under this repo's
  AGPL licence) provided attribution and modification are indicated -
  materially different from CIS's terms.
- **Naming convention: no framework-identifying branding outside a rule's
  own mapping list.** A rule's `title`/`description`/`rationale`/etc. never
  says which framework prompted it. The *only* place a specific framework
  name appears on a rule is its `framework_mappings` list (framework, scope,
  version, control ID, date checked) - plain identifiers, not prose. This
  applies to internal engineering material too: this document and future
  commit messages/progress-log entries describe pipelines by what they do
  ("the independent-authoring pipeline," "the licensed-adaptation
  pipeline"), not by narrating a specific framework's copyright terms as the
  reason. Where a design choice genuinely depends on which framework's
  licence drove it (e.g. explaining why CIS content needs a different
  pipeline than ISM content), it's fine to say so plainly in prose like this
  paragraph - the constraint is on branding and on treating "worked around
  a specific framework's copyright" as the narrative, not on ever naming a
  framework as a fact.
- **"Independent authorship," not "clean room."** Functionally the same
  process (a fact-only specification, then content authored from the spec
  alone by someone/something with no exposure to the source text) but named
  for what it does, not for the legal doctrine behind it.

## Schema v2

### Versioning

`baselines/_rule.schema.json` is replaced in place with the v2 shape below
- one schema, no `schemaVersion` dispatch, no parallel v1 file.
`tools/validate_rules.py` needs no schema-selection logic as a result: every
rule file in `baselines/` validates against the one current schema.

The 12 existing CIS rule files are removed from `baselines/` as part of
this change (see "Decisions already made"). `tools/verify_extraction.py`'s
job - checking deterministic extraction stayed faithful to CIS's source
text - has no remaining corpus to run against once those files are gone, so
it's retired rather than kept scoped to an empty set. The same fidelity
question is legitimate for the licensed-adaptation pipeline (sub-project 3,
ISM/Essential Eight) - being faithful to the source is exactly what
attribution requires there - so this logic may get a second life adapted
to that pipeline rather than being deleted outright; that's sub-project 3's
call, not this one's.

### `framework_mappings` (replaces the singular `benchmark` object)

An array, since one rule commonly satisfies more than one framework's
control:

```json
"framework_mappings": [
  {
    "framework": "cis",
    "framework_product": "windows_11",
    "framework_version": "5.0.0",
    "control_id": "18.9.31.2",
    "framework_level": ["Level 1"],
    "checked_date": "2026-08-20"
  },
  {
    "framework": "essential_eight",
    "framework_product": null,
    "framework_version": "2023-11",
    "control_id": "PatchApps-1",
    "framework_level": ["Maturity Level 1", "Maturity Level 2"],
    "checked_date": "2026-08-20"
  }
]
```

- `framework_product` is `null` where the framework has no product axis
  (ISM and Essential Eight are organised by topic/strategy, not by product).
- `framework_level`: a required array of strings, e.g. `["Level 1"]` for a
  CIS profile/Implementation Group, or `["Maturity Level 1", "Maturity
  Level 2"]` for an Essential Eight control. It's an array not merely
  because a rule can cover more than one distinct control, but because a
  *single* mapping entry (one `control_id`) can legitimately carry more
  than one level for cumulative tiering models: Essential Eight's maturity
  levels are cumulative, so a control that satisfies Maturity Level 2 also
  satisfies Maturity Level 1 for that same control, and both belong on the
  one mapping entry, not split across two. An empty array is valid for a
  framework whose controls don't carry a tiering concept at all. This is a
  short, standard classification label - a factual system-of-organisation
  name, not descriptive prose - same category as a control ID, so it's
  fine on the same terms.
- No citation, title, or descriptive text field beyond `framework_level` -
  identifiers only. A secondary taxonomy within a framework (e.g. CIS
  Controls v8) is just another entry with its own `framework`/`control_id`,
  not a special field on the primary one.
- `checked_date` records when this specific mapping was last verified
  against the framework's currently published text, independent of when the
  rule's own content was last touched.

This is also what lets the web UI (sub-project 4) show, for a selected
rule, something like "Aligns with: CIS Windows 11 v5.0.0 (Level 1) ·
Essential Eight (Maturity Level 2)" - composed directly from
`framework`/`framework_version`/`framework_level` with one simple display
template, no framework-specific rendering logic needed.

### `authoring_mode`

Every v2 rule declares how its `title`/`description`/`rationale`/`impact`/
`default_value`/audit-and-remediation prose was produced:

- **`independent`** - authored by the toolkit itself, with no exposure to
  any single mapped framework's own wording during the authoring step
  proper (see "Independent-authoring pipeline" below). Always legally safe
  regardless of which frameworks the rule maps to.
- **`licensed_adaptation`** - adapted from one specific framework's own
  openly-licensed published text (ISM/Essential Eight today). Requires a
  `source_license` block:

```json
"source_license": {
  "framework": "ism",
  "license_name": "CC BY 4.0",
  "license_url": "https://creativecommons.org/licenses/by/4.0/",
  "rights_holder": "Commonwealth of Australia",
  "source_url": "https://www.cyber.gov.au/...",
  "retrieved_date": "2026-08-20",
  "modified": true
}
```

**Decision rule when a rule maps to more than one framework:** choose
`authoring_mode` based on the most restrictive framework it touches, not by
splitting the content. A rule that maps to both CIS and ISM is authored
`independent` (CIS's terms govern), even though the ISM mapping alone would
have permitted `licensed_adaptation`. `independent` is always a safe choice
for any rule; `licensed_adaptation` is only for content that used nothing
but a CC BY 4.0 (or similarly permissive) source.

CC BY 4.0's Section 3(a) (verified against the licence's own legal code)
requires that the attribution/licence notice actually reach anyone who sees
the adapted material, not just exist somewhere in a JSON file - so the web
UI must render `source_license` on the rule detail view for any
`licensed_adaptation` rule, not merely carry it as inert metadata.

### `policy_classification`

Three independent facets, so filters compose instead of needing one
combined enum per combination:

```json
"policy_classification": {
  "control_surface": "device_config_profile",
  "platforms": ["windows_11"],
  "management_channels": ["intune_settings_catalog", "group_policy"]
}
```

- `control_surface`: `device_config_profile` | `device_compliance_check` |
  `server_infrastructure_config` | `process_administrative`
- `platforms`: open string list, e.g. `windows_11`, `windows_server_2022`,
  `macos`, `linux`, `network_device`, `organization_wide`
- `management_channels`: open string list, e.g. `intune_settings_catalog`,
  `intune_compliance_policy`, `group_policy`, `registry`, `macos_profile`,
  `manual_process`

The Intune-scoped view (sub-project 4) becomes: rules whose
`management_channels` intersects `{intune_settings_catalog,
intune_compliance_policy}` - a filter over the combined library, not a
separately maintained list.

## Independent-authoring pipeline: the fact-only spec

For `independent`-mode rules, content is produced in two steps, deliberately
separated so the second step never has to touch the source framework's own
text:

1. **Spec authoring.** Produces a spec file capturing the control as facts
   plus the author's own independently-written explanation of intent -
   never a paraphrase of the source framework's specific sentences, phrasing,
   or examples. Copyright protects expression, not the underlying fact or
   idea, so an independently-articulated explanation of the same underlying
   security concept is fine; following the source's sentence structure,
   ordering, or distinctive phrasing is not, even if the words are changed.
   Committed publicly - by construction it holds no framework's copyrightable
   expression, so (unlike the abandoned sidecar-file idea in the CIS
   licensing review) it needs no gitignoring.
2. **Content authoring.** A separate authoring pass, with no exposure to the
   source framework's own text, writes the rule's final `title`/
   `description`/`rationale`/`impact`/`default_value`/audit and remediation
   content from the spec alone.

Spec shape (new schema, e.g. `specs/_control_spec.schema.json`,
`additionalProperties: false`):

```json
{
  "mechanism": {
    "type": "registry_value",
    "identifier": "HKLM:\\SOFTWARE\\Policies\\...\\SomeSetting",
    "data_type": "integer",
    "secure_value": "1",
    "current_default": "0"
  },
  "platform": "windows_11",
  "applicability_tags": ["enterprise", "high_security"],
  "rationale_tags": ["reduces_attack_surface", "enforces_least_privilege"],
  "description_intent": "Plain-English, independently-written statement of what the control requires and why, for the content-authoring step to write from.",
  "rationale_intent": "Plain-English, independently-written statement of the underlying security concern.",
  "framework_mapping_refs": [
    { "framework": "cis", "control_id": "18.9.31.2", "framework_version": "5.0.0", "framework_level": ["Level 1"], "checked_date": "2026-08-20" }
  ]
}
```

- `mechanism.type`: `registry_value` | `csp_uri` | `plist_key` |
  `gpo_setting` | `command_output` | `file_permission` | `service_state` |
  `account_policy` | `process_attestation` | `other_structured`. The
  identifier/path/URI itself is a fact (Microsoft's or Apple's own public
  documentation), not the framework's expression.
- `rationale_tags` are drawn from a fixed vocabulary defined by this
  project, independent of any framework's own categorisation - a controlled
  vocabulary, not free text, so tagging stays consistent and searchable
  across rules.
- `description_intent`/`rationale_intent` are free text, but written
  independently by whoever authors the spec, not copied or paraphrased from
  the source. This is the field that lets the content-authoring step
  produce a good, specific description without ever seeing the source
  itself.
- Specs live under `specs/<framework>/<product>/<version>/<rule-id>.json`,
  mirroring `baselines/`'s layout, and are committed alongside the rules
  they produced - an auditable record of what each rule's content was
  authored from.

## Tooling impact (to work out in the implementation plan, flagged here so it isn't missed)

- `tools/generate_index.py`'s `looks_like_rule_file` duck-types on
  `{"id", "title", "benchmark"}`; v2 rules have `framework_mappings`
  instead of `benchmark`, so this key set needs updating or it silently
  stops indexing every rule.
- `tools/generate_manifest.py`'s `folder_entry` reads
  `first_rule["benchmark"]["platform"]` for the manifest's `platform` field;
  needs an equivalent read from `policy_classification.platforms`.
- `.claude/skills/compliance-benchmark-json/references/schema.md` and its
  bundled examples get updated in place to teach the v2 shape only - no
  split needed, since there's only one schema now. This also closes an item
  the licensing review flagged separately: some bundled examples (e.g.
  `single-scripted-check.json`) use real CIS rule text as illustrations:
  those get replaced with v2-shaped examples that don't source from any
  framework's actual text.
- The repo's `LICENSE`/`README` need a short note that AGPL covers the
  toolkit's own code, schema, and independently-authored rule content, while
  `licensed_adaptation` rule content is additionally under CC BY 4.0
  (Commonwealth of Australia) - two licence layers on different files, not
  a conflict, but worth stating explicitly so a downstream user of the repo
  isn't misled into thinking everything is uniformly AGPL-only.

## Sequencing (sub-projects; each gets its own design/plan cycle)

1. **This project** - schema v2, taxonomy, authoring model, and removing
   the 12 existing CIS rule files from `baselines/` (their content doesn't
   carry forward; see "Decisions already made").
2. Independent-authoring pipeline tooling for CIS-mapped content (spec
   extraction + the content-authoring handoff) - covers both new rules and
   re-creating replacements for the 12 rules removed in step 1.
   `baselines/` has no CIS-mapped rules between step 1 landing and this
   step delivering replacements.
3. Licensed-adaptation pipeline for ISM/Essential Eight: source acquisition,
   deterministic extraction (adapted from the existing CIS Phase 1
   pipeline), attribution metadata. Essential Eight is small enough to
   ingest in full; ISM is roughly 1,107 controls, so this phase builds the
   pipeline plus a pilot slice, leaving bulk ingestion as its own later
   content project.
4. Web UI rework: a unified rule library view (filter by framework,
   `policy_classification`, platform; per-framework-aware ID sort, since
   `4.11.49`, `ISM-1546`, and an Essential Eight strategy+maturity-level
   identifier don't share one ordering), with the current Intune-specific
   screens becoming a filtered projection of the same data.

Deferred, not part of any of the four: bulk ISM ingestion beyond the pilot
slice, and the still-open question from the licensing review about
whether git history needs rewriting to fully unpublish CIS text that was
in prior commits (removing the files from HEAD in step 1 doesn't do that -
same caveat the review already recorded).

## Progress log

(none yet - entries land here as work against this plan is completed)
