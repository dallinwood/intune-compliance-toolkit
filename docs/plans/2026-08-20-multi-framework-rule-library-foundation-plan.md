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
- **`baselines/` flattens to one directory** once real content exists,
  since a rule no longer belongs to one framework/product/version. See the
  `id` section below for the full reasoning and what implementing this
  requires of `tools/generate_manifest.py`.
- **Git history is left as-is.** The 12 removed files' CIS-sourced text
  remains recoverable from prior commits (removing them from HEAD doesn't
  unpublish that history) - a deliberate choice not to run a history
  rewrite now, revisited only if it becomes a real problem later, not
  forgotten in the meantime.

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

### `id` is toolkit-generated, not a framework's own numbering

In v1, `id` was the source framework's own section/rule number (e.g.
`"4.11.15.3.1"`). That doesn't work once a rule can map to several
frameworks at once - there's no longer one framework whose numbering the
rule "is." `id` is now a plain identifier this project assigns itself:
a string holding a positive integer with no leading zero (`"1"`, `"12"`,
`"347"`), unique across the whole rule library regardless of framework,
platform, or authoring mode. Every framework-specific number a rule
satisfies lives only in that mapping's `framework_mappings[].control_id` -
never in the rule's own top-level `id`.

Allocating the next `id` is deterministic, not a tracked counter file:
scan every rule file's `id` for the current maximum and add one. No extra
state to keep in sync or let drift.

`references/schema.md`'s file-naming convention originally assumed `id`
was a specific framework's own number, which is how a filename could name
"the" benchmark it came from. That assumption no longer holds; the
implementation settled on `rule_<id>_<short-title-slug>.json` (e.g.
`rule_12_ensure-something.json` - see Task 6 and the naming-convention fix
recorded in the Progress log) so a filename stays human-scannable and
produces a valid variable-name prefix without implying single-framework
ownership.

**Decided (not by this plan's own implementation - by the project owner,
after this plan landed): `baselines/` flattens to one directory.** The
surrounding `baselines/<family>/<product>/<version>/` folder layout - a
structure that meant "this is CIS's ruleset for this product/version" -
no longer means anything once a rule can map to several frameworks and
isn't owned by any one of them. `baselines/` becomes a single flat
directory of rule files (e.g. `baselines/rules/<filename>.json`), with all
filtering and browsing done via `framework_mappings`/`policy_classification`
fields, never folder location. `specs/` keeps its existing
`<framework>/<product>/<version>/<rule-id>.json` layout unchanged - a
spec genuinely is produced while processing one specific framework's
content, so that hierarchy still means something there.

This decision is recorded here for whichever of sub-projects 2/3 first
authors real content under the new schema to implement - it wasn't acted
on by this (already-completed and reviewed) plan, since `baselines/` is
still empty and no code currently depends on where rules will eventually
live. Implementing it will require revisiting `tools/generate_manifest.py`'s
`folder_entry()`, which currently asserts a rule folder sits exactly three
levels under `baselines_root` (`family/product/version`) and raises
`ValueError` otherwise - a flat single directory violates that assumption,
and the whole "one manifest entry per ruleset" concept the manifest exists
for becomes close to degenerate once there's only one directory (the web
UI could plausibly just fetch one `_index.json` directly without a manifest
enumerating folders at all). Sub-project 2 should treat "does `_manifest.json`
still need to exist, and in what shape" as part of its own design, not
assume the current shape carries over unchanged.

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

Two cross-field invariants the schema states in its own field descriptions
but nothing currently enforces: `id` uniqueness across the whole rule
library, and consistency between `source_license.framework` and the
frameworks actually listed in `framework_mappings`.
`tools/validate_rules.py`'s `convention_errors()` is the established home
for schema-can't-express checks like these - worth adding there once
sub-project 2 is producing real rules to check.

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
- `tools/rule_extraction.py` (from the prior Phase 1 pipeline) still extracts
  v1-shaped fields (`profile_applicability`, `cis_controls`, `grid_id`,
  source-verbatim prose) that have no home in schema v2. It breaks no test
  today and this plan doesn't touch it, but whichever of sub-project 2/3
  builds real extraction tooling should explicitly decide its fate (retire
  it, or adapt it) rather than rediscover it as dead code.

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

### Known consequences for `webui/` (tracked, not fixed by this plan)

This plan deliberately didn't touch `webui/` (that's sub-project 4), but two of its changes have real, currently-latent effects there, caught by the final whole-branch review:

- **`webui/e2e/smoke.spec.ts` is now red.** All 5 Playwright specs depend on the real CIS rule content Task 5 removed (they search for specific real rule titles and assert on specific facet values). This isn't caught by `pytest` and wasn't tracked anywhere until now. Whoever next needs a working e2e suite - most likely sub-project 2, once it re-populates `baselines/` with real content - should either give the specs synthetic fixture data independent of any specific rule's real title/content, or explicitly skip them while `baselines/` is empty.
- **`webui/src/data/ruleRows.ts`, `webui/src/components/rules/RuleTable.tsx`, and `webui/src/logic/ruleFilters.ts` still read the now-removed `profile_applicability` index field non-defensively.** With zero rules today this never executes, so nothing crashes yet - but the first real v2 rule indexed by sub-project 2 will crash the browser the moment `webui/` tries to render it, unless that coupling is fixed first. This is an explicit prerequisite for sub-project 2 (or must be sequenced after sub-project 4's UI rework, if that's done first) - not something to silently discover later.

A later change (sub-project 2's `baselines/` flattening) added a third, related consequence:

- **`scripts/copy-baselines.mjs` and `webui/src/data/manifest.ts` still hardcode a fetch/copy of `baselines/_manifest.json`.** Sub-project 2 retired that file outright (it no longer exists in any form, not even an empty `{"baselines": []}`), so this is no longer a valid-empty-response case - it's a 404, and whoever picks up sub-project 4's UI rework needs to replace this fetch with direct `_index.json` discovery rather than just handling an empty manifest.

Deferred, not part of any of the four: bulk ISM ingestion beyond the pilot
slice. The licensing review's git-history question (whether to rewrite
history to fully unpublish CIS text that was in prior commits, since
removing the files from HEAD doesn't do that) has been decided, not just
deferred - see "Decisions already made" above: left as-is for now.

## Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship schema v2 (`baselines/_rule.schema.json`), the independent-authoring spec schema (`specs/_control_spec.schema.json`), updated `tools/generate_index.py`/`tools/generate_manifest.py`, updated `compliance-benchmark-json` skill docs/examples, a dual-licence note in `README.md`, and removal of the 12 existing CIS rule files from `baselines/` (per "Decisions already made" above).

**Architecture:** Same JSON-Schema-plus-Python-tooling architecture already in this repo (`baselines/_rule.schema.json` validated by `tools/validate_rules.py` via `jsonschema`, indexed by `tools/generate_index.py`/`tools/generate_manifest.py`, exercised by `pytest`). No new frameworks or dependencies.

**Tech Stack:** Python 3, `jsonschema`, `pytest` (already in `requirements.txt`/`requirements-dev.txt`).

**Spec:** This document's "Schema v2", "Independent-authoring pipeline: the fact-only spec", and "Tooling impact" sections above.

## Global Constraints

- `additionalProperties: false` on every object in both schemas - no undocumented fields slip through.
- No framework-identifying branding outside `framework_mappings`/`source_license`/`framework_mapping_refs` - see "Decisions already made" above. Bundled skill examples use `"framework": "example"`, never a real framework name, so nobody mistakes a fixture for real mapping data.
- Dates are `YYYY-MM-DD` strings throughout (`checked_date`, `retrieved_date`).
- Every task ends with `pytest` green before its commit.
- Follow this repo's `.claude/CLAUDE.md`: commit after each verified task with a `type: summary` message plus `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, push to the current branch (`rework`) right after, and add a Progress log entry (below) as work lands.

---

### Task 1: Rule schema v2

**Files:**
- Modify: `baselines/_rule.schema.json` (full rewrite)
- Modify: `tests/test_rule_schema.py` (full rewrite of fixtures/assertions)

**Interfaces:**
- Produces: the v2 rule shape every later task assumes - `id` (a toolkit-assigned positive-integer string, pattern `^[1-9][0-9]*$`, never a framework's own number), `framework_mappings[]` (`framework`, `framework_product`, `framework_version`, `control_id`, `framework_level[]`, `checked_date`), `authoring_mode` (`"independent"` | `"licensed_adaptation"`), `source_license` (required iff `authoring_mode == "licensed_adaptation"`), `policy_classification` (`control_surface`, `platforms[]`, `management_channels[]`). `audit.methods[].steps[]` no longer has `original_command` - `check_command` is always this project's own engineering, never a preserved original. `output_check[].value_source` is `"rule_defined" | "organization_defined"` (renamed from `"benchmark"`, since a value can be rule-defined without being any one benchmark's). `remediation`/`references`/`default_value`/`additional_information`/`minimum_os_csp`/`recommended_state` are unchanged from v1.

- [ ] **Step 1: Rewrite `tests/test_rule_schema.py`'s fixture and tests for the v2 shape**

Replace the file's contents with:

```python
import copy
import json
from pathlib import Path

import jsonschema
import pytest

from tools.validate_rules import (
    convention_errors,
    file_slug,
    find_rule_files,
    load_schema,
    schema_errors,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINES_DIR = REPO_ROOT / "baselines"
EXAMPLES_DIR = REPO_ROOT / ".claude" / "skills" / "compliance-benchmark-json" / "references" / "examples"

MINIMAL_VALID_RULE = {
    "id": "12",
    "title": "Ensure Something",
    "assessment_status": "Automated",
    "authoring_mode": "independent",
    "framework_mappings": [
        {
            "framework": "example",
            "framework_product": "example_product",
            "framework_version": "1.0.0",
            "control_id": "1.1",
            "framework_level": ["Level 1"],
            "checked_date": "2026-08-20",
        }
    ],
    "policy_classification": {
        "control_surface": "device_config_profile",
        "platforms": ["windows_11"],
        "management_channels": ["intune_settings_catalog"],
    },
    "recommended_state": "Disabled",
    "description": "...",
    "rationale": "...",
    "impact": "...",
    "audit": {
        "methods": [
            {
                "method_name": "Terminal Method",
                "type": "scripted",
                "description": "...",
                "steps": [
                    {
                        "step_role": "compliance_check",
                        "check_command": "test_12_status=1",
                        "check_command_verified": True,
                        "output_description": "...",
                        "output_check": [
                            {
                                "variable": "test_12_status",
                                "data_type": "integer",
                                "operator": "eq",
                                "value": 1,
                                "value_source": "rule_defined",
                            }
                        ],
                    }
                ],
            }
        ]
    },
    "remediation": {"methods": [{"method_name": "x", "type": "manual_steps", "description": "..."}]},
    "default_value": None,
    "references": [],
    "additional_information": None,
}


@pytest.fixture(scope="module")
def validator():
    return jsonschema.Draft202012Validator(load_schema())


def test_minimal_valid_rule_matches_schema(validator):
    assert schema_errors(MINIMAL_VALID_RULE, validator) == []


def test_organization_defined_value_source_requires_null_value(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    output_check = rule["audit"]["methods"][0]["steps"][0]["output_check"][0]
    output_check["value_source"] = "organization_defined"
    output_check["value"] = 5

    assert schema_errors(rule, validator) != []


def test_lookup_step_requires_empty_output_check(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["audit"]["methods"][0]["steps"][0]["step_role"] = "lookup"

    assert schema_errors(rule, validator) != []


def test_manual_method_forbids_steps(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["audit"]["methods"][0]["type"] = "manual"

    assert schema_errors(rule, validator) != []


def test_schema_file_is_itself_valid():
    jsonschema.Draft202012Validator.check_schema(load_schema())


def test_framework_mappings_requires_at_least_one_entry(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["framework_mappings"] = []

    assert schema_errors(rule, validator) != []


def test_licensed_adaptation_requires_source_license(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["authoring_mode"] = "licensed_adaptation"

    assert schema_errors(rule, validator) != []


def test_licensed_adaptation_with_source_license_is_valid(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["authoring_mode"] = "licensed_adaptation"
    rule["source_license"] = {
        "framework": "example",
        "license_name": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "rights_holder": "Example Rights Holder",
        "source_url": "https://example.invalid/source",
        "retrieved_date": "2026-08-20",
        "modified": True,
    }

    assert schema_errors(rule, validator) == []


def test_independent_mode_forbids_source_license(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["source_license"] = {
        "framework": "example",
        "license_name": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "rights_holder": "Example Rights Holder",
        "source_url": "https://example.invalid/source",
        "retrieved_date": "2026-08-20",
        "modified": True,
    }

    assert schema_errors(rule, validator) != []


def test_framework_level_accepts_multiple_cumulative_levels(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["framework_mappings"][0]["framework_level"] = ["Maturity Level 1", "Maturity Level 2"]

    assert schema_errors(rule, validator) == []


def test_id_rejects_a_framework_shaped_value(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["id"] = "4.11.15.3.1"  # a framework's own dotted numbering, not a toolkit id

    assert schema_errors(rule, validator) != []


def test_id_accepts_a_plain_toolkit_assigned_integer(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["id"] = "347"

    assert schema_errors(rule, validator) == []


def test_audit_step_has_no_original_command_field(validator):
    rule = copy.deepcopy(MINIMAL_VALID_RULE)
    rule["audit"]["methods"][0]["steps"][0]["original_command"] = None

    assert schema_errors(rule, validator) != []


@pytest.mark.parametrize("rule_path", find_rule_files(BASELINES_DIR), ids=lambda p: p.name)
def test_baseline_rule_matches_schema(rule_path, validator):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))

    assert schema_errors(rule, validator) == []


@pytest.mark.parametrize("rule_path", find_rule_files(BASELINES_DIR), ids=lambda p: p.name)
def test_baseline_rule_follows_variable_conventions(rule_path):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))

    assert convention_errors(rule, file_slug(rule_path)) == []


@pytest.mark.parametrize("example_path", sorted(EXAMPLES_DIR.glob("*.json")), ids=lambda p: p.name)
def test_bundled_example_matches_schema(example_path, validator):
    rule = json.loads(example_path.read_text(encoding="utf-8"))

    assert schema_errors(rule, validator) == []
```

- [ ] **Step 2: Run the tests to confirm they fail against the current (v1) schema**

Run: `python -m pytest tests/test_rule_schema.py -v`
Expected: FAIL - `MINIMAL_VALID_RULE` is missing v1-required `benchmark`/`profile_applicability` and has v1-unknown `authoring_mode`/`framework_mappings`/`policy_classification`, so `additionalProperties: false` and missing-required-field errors fire. (The two parametrized tests over `BASELINES_DIR`/`EXAMPLES_DIR` still pass at this point since v1 files still validate against the still-v1 schema - that's expected and fine.)

- [ ] **Step 3: Rewrite `baselines/_rule.schema.json`**

Replace the file's contents with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://intune-compliance-toolkit/schemas/rule.schema.json",
  "title": "Compliance rule",
  "description": "Machine-checkable version of references/schema.md. Any change to this file that isn't specific to one rule's content must be mirrored in schema.md and the bundled examples in the same pass - see SKILL.md's 'Keeping examples and this doc in sync'.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id", "title", "assessment_status", "authoring_mode", "framework_mappings",
    "policy_classification", "recommended_state", "description", "rationale",
    "impact", "audit", "remediation", "default_value", "references",
    "additional_information"
  ],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[1-9][0-9]*$",
      "description": "A toolkit-assigned identifier, unique across the whole rule library - never a framework's own numbering (that lives in framework_mappings[].control_id). Allocated by scanning every rule's id for the current maximum and adding one, not a tracked counter file."
    },
    "title": { "type": "string", "minLength": 1 },
    "assessment_status": { "enum": ["Automated", "Manual"] },
    "authoring_mode": { "enum": ["independent", "licensed_adaptation"] },
    "framework_mappings": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/frameworkMapping" }
    },
    "source_license": { "$ref": "#/$defs/sourceLicense" },
    "policy_classification": { "$ref": "#/$defs/policyClassification" },
    "recommended_state": { "type": ["string", "null"] },
    "description": { "type": "string", "minLength": 1 },
    "rationale": { "type": "string", "minLength": 1 },
    "impact": { "type": "string", "minLength": 1 },
    "audit": {
      "type": "object",
      "additionalProperties": false,
      "required": ["methods"],
      "properties": {
        "methods": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/auditMethod" }
        }
      }
    },
    "remediation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["methods"],
      "properties": {
        "methods": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/remediationMethod" }
        }
      }
    },
    "default_value": { "type": ["string", "null"] },
    "references": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    },
    "minimum_os_csp": { "type": ["string", "null"] },
    "additional_information": {
      "type": ["string", "object", "null"]
    }
  },
  "allOf": [
    {
      "if": { "properties": { "authoring_mode": { "const": "licensed_adaptation" } }, "required": ["authoring_mode"] },
      "then": { "required": ["source_license"] }
    },
    {
      "if": { "properties": { "authoring_mode": { "const": "independent" } }, "required": ["authoring_mode"] },
      "then": { "not": { "required": ["source_license"] } }
    }
  ],
  "$defs": {
    "frameworkMapping": {
      "type": "object",
      "additionalProperties": false,
      "required": ["framework", "framework_product", "framework_version", "control_id", "framework_level", "checked_date"],
      "properties": {
        "framework": { "type": "string", "minLength": 1 },
        "framework_product": { "type": ["string", "null"] },
        "framework_version": { "type": "string", "minLength": 1 },
        "control_id": { "type": "string", "minLength": 1 },
        "framework_level": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 }
        },
        "checked_date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" }
      }
    },
    "sourceLicense": {
      "type": "object",
      "additionalProperties": false,
      "required": ["framework", "license_name", "license_url", "rights_holder", "source_url", "retrieved_date", "modified"],
      "properties": {
        "framework": { "type": "string", "minLength": 1 },
        "license_name": { "type": "string", "minLength": 1 },
        "license_url": { "type": "string", "minLength": 1 },
        "rights_holder": { "type": "string", "minLength": 1 },
        "source_url": { "type": "string", "minLength": 1 },
        "retrieved_date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
        "modified": { "const": true }
      }
    },
    "policyClassification": {
      "type": "object",
      "additionalProperties": false,
      "required": ["control_surface", "platforms", "management_channels"],
      "properties": {
        "control_surface": {
          "enum": ["device_config_profile", "device_compliance_check", "server_infrastructure_config", "process_administrative"]
        },
        "platforms": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        },
        "management_channels": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 }
        }
      }
    },
    "auditMethod": {
      "type": "object",
      "additionalProperties": false,
      "required": ["method_name", "type", "description"],
      "properties": {
        "method_name": { "type": "string", "minLength": 1 },
        "type": { "enum": ["manual", "scripted"] },
        "description": { "type": "string", "minLength": 1 },
        "notes": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 }
        },
        "example": { "type": "string", "minLength": 1 },
        "steps": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/auditStep" }
        }
      },
      "allOf": [
        {
          "if": { "properties": { "type": { "const": "scripted" } } },
          "then": { "required": ["steps"] }
        },
        {
          "if": { "properties": { "type": { "const": "manual" } } },
          "then": { "not": { "required": ["steps"] } }
        }
      ]
    },
    "auditStep": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "step_role", "check_command",
        "check_command_verified", "output_description", "output_check"
      ],
      "properties": {
        "step_role": { "enum": ["compliance_check", "lookup"] },
        "check_command": { "type": "string", "minLength": 1 },
        "check_command_verified": { "type": "boolean" },
        "output_description": { "type": "string", "minLength": 1 },
        "check_command_notes": { "type": "string", "minLength": 1 },
        "output_check": {
          "type": "array",
          "items": { "$ref": "#/$defs/outputCheck" }
        }
      },
      "allOf": [
        {
          "if": { "properties": { "step_role": { "const": "lookup" } } },
          "then": {
            "properties": { "output_check": { "maxItems": 0 } }
          }
        }
      ]
    },
    "outputCheck": {
      "type": "object",
      "additionalProperties": false,
      "required": ["variable", "data_type", "operator", "value", "value_source"],
      "properties": {
        "variable": { "type": "string", "minLength": 1 },
        "data_type": { "enum": ["boolean", "integer", "string"] },
        "operator": { "enum": ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "like"] },
        "value": { "type": ["string", "number", "boolean", "null"] },
        "value_source": { "enum": ["rule_defined", "organization_defined"] }
      },
      "allOf": [
        {
          "if": { "properties": { "value_source": { "const": "organization_defined" } } },
          "then": { "properties": { "value": { "const": null } } }
        }
      ]
    },
    "remediationMethod": {
      "type": "object",
      "additionalProperties": false,
      "required": ["method_name", "type", "description"],
      "properties": {
        "method_name": { "type": "string", "minLength": 1 },
        "type": { "enum": ["configuration_profile", "manual_steps", "scripted"] },
        "description": { "type": "string", "minLength": 1 },
        "config_keys": {
          "type": "array",
          "items": { "type": "object", "minProperties": 1 }
        },
        "steps": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/remediationStep" }
        },
        "example": { "type": "string", "minLength": 1 },
        "notes": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 }
        }
      }
    },
    "remediationStep": {
      "type": "object",
      "additionalProperties": false,
      "required": ["command"],
      "properties": {
        "command": { "type": "string", "minLength": 1 },
        "expected_output": { "type": "string", "minLength": 1 },
        "result_note": { "type": "string", "minLength": 1 },
        "purpose": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to confirm they now pass**

Run: `python -m pytest tests/test_rule_schema.py -v`
Expected: PASS - all tests, including the two parametrized ones (now covering zero files, since `baselines/` and `EXAMPLES_DIR` still hold v1-shaped content that Task 5/6 haven't touched yet... note: at this exact point in the plan, the parametrized `test_baseline_rule_matches_schema`/`test_bundled_example_matches_schema` tests WILL fail, because the 12 real files and 8 bundled examples are still v1-shaped and the schema is now v2. This is expected and resolved by Tasks 5 and 6 respectively - don't try to make this task's tests fully green in isolation; run `python -m pytest tests/test_rule_schema.py -v -k "not baseline_rule and not bundled_example"` instead to confirm just this task's own new/changed tests pass, and note the two known-red parametrized tests in the commit message.

- [ ] **Step 5: Commit**

```bash
git add baselines/_rule.schema.json tests/test_rule_schema.py
git commit -m "$(cat <<'EOF'
feat: rule schema v2 (framework_mappings, authoring_mode, policy_classification)

Replaces the single benchmark object and CIS-namespaced extended_attributes
with a framework_mappings array (so one rule can cross-reference multiple
frameworks), an authoring_mode + source_license pair (so rule content
records whether it was independently authored or adapted from an openly
licensed source), and a policy_classification taxonomy (control surface,
platforms, management channels) for browsing beyond Intune. id is now a
toolkit-assigned integer, never a framework's own numbering; audit steps
no longer carry original_command, since check_command is always this
project's own engineering; output_check.value_source's "benchmark" value
is renamed to "rule_defined" to match.

Known red until Tasks 5/6 land: test_baseline_rule_matches_schema and
test_bundled_example_matches_schema still cover v1-shaped files.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 2: Independent-authoring control spec schema

**Files:**
- Create: `specs/_control_spec.schema.json`
- Create: `tools/validate_specs.py`
- Create: `tests/test_control_spec_schema.py`

**Interfaces:**
- Consumes: nothing from Task 1 (independent artifact type).
- Produces: `load_schema()`/`schema_errors()` in `tools/validate_specs.py`, mirroring `tools/validate_rules.py`'s functions of the same name, for sub-project 2 to build on. The spec shape: `mechanism` (`type`, `identifier`, `data_type`, `secure_value`, `current_default`), `platform`, `applicability_tags[]`, `rationale_tags[]` (fixed enum), `description_intent`, `rationale_intent`, `framework_mapping_refs[]` (`framework`, `control_id`, `framework_version`, `framework_level[]`, `checked_date`).

- [ ] **Step 1: Write the failing test**

Create `tests/test_control_spec_schema.py`:

```python
import copy

import jsonschema
import pytest

from tools.validate_specs import load_schema, schema_errors

MINIMAL_VALID_SPEC = {
    "mechanism": {
        "type": "registry_value",
        "identifier": "HKLM:\\SOFTWARE\\Example\\Setting",
        "data_type": "integer",
        "secure_value": 1,
        "current_default": 0,
    },
    "platform": "windows_11",
    "applicability_tags": ["enterprise"],
    "rationale_tags": ["reduces_attack_surface"],
    "description_intent": "Plain-English statement of what the control requires, written independently of any source framework's own wording.",
    "rationale_intent": "Plain-English statement of the underlying security concern, written independently.",
    "framework_mapping_refs": [
        {
            "framework": "example",
            "control_id": "1.1",
            "framework_version": "1.0.0",
            "framework_level": ["Level 1"],
            "checked_date": "2026-08-20",
        }
    ],
}


@pytest.fixture(scope="module")
def validator():
    return jsonschema.Draft202012Validator(load_schema())


def test_minimal_valid_spec_matches_schema(validator):
    assert schema_errors(MINIMAL_VALID_SPEC, validator) == []


def test_schema_file_is_itself_valid():
    jsonschema.Draft202012Validator.check_schema(load_schema())


def test_rationale_tags_must_be_from_the_fixed_vocabulary(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["rationale_tags"] = ["made_up_tag_not_in_vocabulary"]

    assert schema_errors(spec, validator) != []


def test_rationale_tags_requires_at_least_one_entry(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["rationale_tags"] = []

    assert schema_errors(spec, validator) != []


def test_framework_mapping_refs_requires_at_least_one_entry(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["framework_mapping_refs"] = []

    assert schema_errors(spec, validator) != []


def test_no_free_text_field_beyond_the_two_intent_fields(validator):
    spec = copy.deepcopy(MINIMAL_VALID_SPEC)
    spec["notes"] = "a free-text field that must not be allowed to exist"

    assert schema_errors(spec, validator) != []
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_control_spec_schema.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'tools.validate_specs'` (the module doesn't exist yet).

- [ ] **Step 3: Create `tools/validate_specs.py`**

```python
"""Validate control spec JSON files against specs/_control_spec.schema.json.

A control spec is the fact-only intermediate artifact the independent-
authoring pipeline (sub-project 2) produces: mechanism facts, a fixed
rationale vocabulary, and the spec author's own independently-written
statement of intent. It holds no source framework's own copyrightable
expression by construction - see docs/plans/2026-08-20-multi-framework-
rule-library-foundation-plan.md.
"""

import json
import sys
from pathlib import Path

import jsonschema

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "specs" / "_control_spec.schema.json"


def load_schema():
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def find_spec_files(root_dir):
    root_dir = Path(root_dir)
    if root_dir.is_file():
        return [] if root_dir.name.startswith("_") else [root_dir]
    return sorted(
        path for path in root_dir.rglob("*.json")
        if not path.name.startswith("_")
    )


def schema_errors(spec, validator):
    return [f"{error.json_path}: {error.message}" for error in validator.iter_errors(spec)]


def validate_spec_file(spec_path, validator):
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    return schema_errors(spec, validator)


def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "specs"
    validator = jsonschema.Draft202012Validator(load_schema())

    spec_files = find_spec_files(root_dir)
    if not spec_files:
        print(f"No spec files found under {root_dir}")
        return 0

    failed = False
    for spec_path in spec_files:
        errors = validate_spec_file(spec_path, validator)
        if errors:
            failed = True
            print(f"FAIL {spec_path}")
            for error in errors:
                print(f"  - {error}")

    if not failed:
        print(f"OK - {len(spec_files)} spec file(s) valid under {root_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Create `specs/_control_spec.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://intune-compliance-toolkit/schemas/control-spec.schema.json",
  "title": "Independent-authoring control spec",
  "description": "Fact-only specification consumed by the content-authoring step of the independent-authoring pipeline. Holds no source framework's own copyrightable expression by construction: mechanism facts (a fact, not expression), a fixed rationale vocabulary, and the spec author's own independently-written statement of intent - never a paraphrase of a source framework's specific wording. additionalProperties: false everywhere in this schema is deliberate: it is the mechanism that keeps a stray free-text field from becoming a smuggled paraphrase.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "mechanism", "platform", "applicability_tags", "rationale_tags",
    "description_intent", "rationale_intent", "framework_mapping_refs"
  ],
  "properties": {
    "mechanism": { "$ref": "#/$defs/mechanism" },
    "platform": { "type": "string", "minLength": 1 },
    "applicability_tags": {
      "type": "array",
      "items": {
        "enum": [
          "enterprise", "small_business", "high_security",
          "regulated_environment", "byod", "shared_device", "remote_workforce"
        ]
      }
    },
    "rationale_tags": {
      "type": "array",
      "minItems": 1,
      "items": {
        "enum": [
          "reduces_attack_surface", "enforces_least_privilege",
          "prevents_credential_exposure", "prevents_unauthorized_access",
          "ensures_auditability", "prevents_data_exfiltration",
          "reduces_persistence_risk", "enforces_secure_defaults",
          "maintains_patch_currency", "prevents_privilege_escalation"
        ]
      }
    },
    "description_intent": { "type": "string", "minLength": 1 },
    "rationale_intent": { "type": "string", "minLength": 1 },
    "framework_mapping_refs": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/frameworkMappingRef" }
    }
  },
  "$defs": {
    "mechanism": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "identifier", "data_type", "secure_value", "current_default"],
      "properties": {
        "type": {
          "enum": [
            "registry_value", "csp_uri", "plist_key", "gpo_setting",
            "command_output", "file_permission", "service_state",
            "account_policy", "process_attestation", "other_structured"
          ]
        },
        "identifier": { "type": "string", "minLength": 1 },
        "data_type": { "enum": ["boolean", "integer", "string"] },
        "secure_value": { "type": ["string", "number", "boolean"] },
        "current_default": { "type": ["string", "number", "boolean", "null"] }
      }
    },
    "frameworkMappingRef": {
      "type": "object",
      "additionalProperties": false,
      "required": ["framework", "control_id", "framework_version", "framework_level", "checked_date"],
      "properties": {
        "framework": { "type": "string", "minLength": 1 },
        "control_id": { "type": "string", "minLength": 1 },
        "framework_version": { "type": "string", "minLength": 1 },
        "framework_level": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 }
        },
        "checked_date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" }
      }
    }
  }
}
```

`applicability_tags`/`rationale_tags` are first-pass vocabularies - extend the enum list when a real spec needs a value that isn't there yet; never add a free-text escape hatch instead.

- [ ] **Step 5: Run to verify it passes**

Run: `python -m pytest tests/test_control_spec_schema.py -v`
Expected: PASS - all 6 tests.

- [ ] **Step 6: Commit**

```bash
git add specs/_control_spec.schema.json tools/validate_specs.py tests/test_control_spec_schema.py
git commit -m "$(cat <<'EOF'
feat: independent-authoring control spec schema

Adds the fact-only spec shape the independent-authoring pipeline
(sub-project 2) will produce and consume: mechanism facts, fixed
applicability/rationale vocabularies, and two independently-written intent
fields the content-authoring step writes final rule prose from.
additionalProperties: false throughout is what keeps a stray free-text
field from becoming a smuggled paraphrase of a source framework's wording.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 3: `tools/generate_index.py` for v2

**Files:**
- Modify: `tools/generate_index.py`
- Modify: `tests/test_generate_index.py`

**Interfaces:**
- Consumes: v2 rule shape from Task 1 (`framework_mappings`, `policy_classification`).
- Produces: `rule_summary()` now returns `framework_mappings`/`policy_classification` keys instead of `benchmark`; `looks_like_rule_file()` duck-types on `{"id", "title", "framework_mappings"}`.

- [ ] **Step 1: Update `tests/test_generate_index.py`'s fixture and assertions**

In `tests/test_generate_index.py`, replace the `MINIMAL_RULE` dict (lines 13-54) with:

```python
MINIMAL_RULE = {
    "id": "1.1",
    "title": "Ensure Something",
    "assessment_status": "Automated",
    "authoring_mode": "independent",
    "framework_mappings": [
        {
            "framework": "example",
            "framework_product": "example_product",
            "framework_version": "1.0.0",
            "control_id": "1.1",
            "framework_level": ["Level 1"],
            "checked_date": "2026-08-20",
        }
    ],
    "policy_classification": {
        "control_surface": "device_config_profile",
        "platforms": ["windows_11"],
        "management_channels": ["intune_settings_catalog"],
    },
    "recommended_state": "Disabled",
    "description": "long prose that should not end up in the index",
    "rationale": "more prose",
    "impact": "more prose",
    "audit": {
        "methods": [
            {
                "method_name": "Terminal Method",
                "type": "scripted",
                "description": "...",
                "steps": [
                    {
                        "step_role": "compliance_check",
                        "check_command": "$test_rule_a_status = 1",
                        "check_command_verified": True,
                        "output_description": "...",
                        "output_check": [
                            {
                                "variable": "test_rule_a_status",
                                "data_type": "integer",
                                "operator": "eq",
                                "value": 1,
                                "value_source": "rule_defined",
                            }
                        ],
                    }
                ],
            }
        ]
    },
    "remediation": {"methods": [{"method_name": "x", "type": "manual_steps", "description": "..."}]},
    "default_value": None,
    "references": [],
    "additional_information": None,
}
```

Then update `test_index_omits_prose_fields_and_captures_variables` (originally lines 98-109) to assert on the new key set:

```python
def test_index_omits_prose_fields_and_captures_variables(tmp_path):
    folder = tmp_path / "benchmark" / "v1"
    folder.mkdir(parents=True)
    write_rule(folder, "1.1", "rule_a.json")

    index = build_index(list(folder.glob("*.json")))

    entry = index["rules"][0]
    assert entry["variables"] == ["test_rule_a_status"]
    assert entry["framework_mappings"] == MINIMAL_RULE["framework_mappings"]
    assert entry["policy_classification"] == MINIMAL_RULE["policy_classification"]
    assert "description" not in entry
    assert "rationale" not in entry
```

Leave every other test in the file unchanged - they exercise `assessment_status`/`requires_organization_defined_value`/sort order/determinism, none of which read `benchmark`.

- [ ] **Step 2: Run to verify the new/changed tests fail**

Run: `python -m pytest tests/test_generate_index.py -v`
Expected: FAIL on `test_index_omits_prose_fields_and_captures_variables` (current `rule_summary()` doesn't emit `framework_mappings`/`policy_classification`) and on every other test that calls `write_rule`/`build_index` with the new `MINIMAL_RULE` shape, because `looks_like_rule_file`'s `REQUIRED_RULE_KEYS = {"id", "title", "benchmark"}` no longer matches (`benchmark` is gone), so `find_rule_folders` silently finds nothing.

- [ ] **Step 3: Update `tools/generate_index.py`**

In `tools/generate_index.py`, change:

```python
REQUIRED_RULE_KEYS = {"id", "title", "benchmark"}
```

to:

```python
REQUIRED_RULE_KEYS = {"id", "title", "framework_mappings"}
```

And change `rule_summary()` (currently):

```python
def rule_summary(rule_path):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))
    return {
        "file": rule_path.name,
        "id": rule.get("id"),
        "title": rule.get("title"),
        "assessment_status": "Automated" if is_automated(rule) else "Manual",
        "source_assessment_status": rule.get("assessment_status"),
        "benchmark": rule.get("benchmark"),
        "profile_applicability": rule.get("profile_applicability"),
        "recommended_state": rule.get("recommended_state"),
        "requires_organization_defined_value": requires_organization_defined_value(rule),
        "variables": rule_variables(rule),
    }
```

to:

```python
def rule_summary(rule_path):
    rule = json.loads(rule_path.read_text(encoding="utf-8"))
    return {
        "file": rule_path.name,
        "id": rule.get("id"),
        "title": rule.get("title"),
        "assessment_status": "Automated" if is_automated(rule) else "Manual",
        "source_assessment_status": rule.get("assessment_status"),
        "framework_mappings": rule.get("framework_mappings"),
        "policy_classification": rule.get("policy_classification"),
        "recommended_state": rule.get("recommended_state"),
        "requires_organization_defined_value": requires_organization_defined_value(rule),
        "variables": rule_variables(rule),
    }
```

- [ ] **Step 4: Run to verify tests pass**

Run: `python -m pytest tests/test_generate_index.py -v -k "not test_committed_index_matches_its_folder"`
Expected: PASS - all tests except the one excluded above.

`test_committed_index_matches_its_folder` is expected to still be RED at this point, for a reason outside this task's own change: it parametrizes over the 2 real `_index.json` files still committed under `baselines/` (still v1-shaped - Task 5 hasn't run yet), and rebuilds each using the `looks_like_rule_file()` this step just changed. Since the real v1 files have no `framework_mappings` key, they no longer duck-type as rule files at all, so the rebuilt index is empty while the committed one still lists the old rules - a mismatch. This isn't a regression to fix here; it resolves itself once Task 5 removes those 12 files (at which point the test collects zero parametrized cases and passes vacuously). Confirm this specific test is red for that reason (not some other cause) by running `python -m pytest tests/test_generate_index.py::test_committed_index_matches_its_folder -v` and reading the diff in the failure output - it should show the committed file's real rule entries against an empty rebuilt `{"rules": []}`.

- [ ] **Step 5: Commit**

```bash
git add tools/generate_index.py tests/test_generate_index.py
git commit -m "$(cat <<'EOF'
feat: generate_index.py indexes framework_mappings/policy_classification

Duck-typing and the per-rule index summary follow schema v2's field names
(framework_mappings replaces benchmark; policy_classification is newly
indexed) so a v2 rule is recognized and its filter-relevant metadata
actually reaches _index.json.

Known red until Task 5 lands: test_committed_index_matches_its_folder,
since the still-committed v1 _index.json files no longer duck-type as
rule files under the new REQUIRED_RULE_KEYS.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 4: `tools/generate_manifest.py` for v2, and tolerate zero folders

**Files:**
- Modify: `tools/generate_manifest.py`
- Modify: `tests/test_generate_manifest.py`

**Interfaces:**
- Consumes: v2 rule shape from Task 1 (`policy_classification.platforms`).
- Produces: `folder_entry()` reads `platform` from `policy_classification.platforms[0]` instead of `benchmark.platform`; `main()` writes an empty manifest (`{"schemaVersion": 1, "baselines": []}`) instead of aborting when there are zero rule folders, since that's the real state Task 5 puts the repo into.

- [ ] **Step 1: Update `tests/test_generate_manifest.py`'s fixture and `write_rule` helper**

Replace the `MINIMAL_RULE` dict and `write_rule` function (lines 9-56) with:

```python
MINIMAL_RULE = {
    "id": "1.1",
    "title": "Ensure Something",
    "assessment_status": "Automated",
    "authoring_mode": "independent",
    "framework_mappings": [
        {
            "framework": "example",
            "framework_product": "example_product",
            "framework_version": "1.0.0",
            "control_id": "1.1",
            "framework_level": ["Level 1"],
            "checked_date": "2026-08-20",
        }
    ],
    "policy_classification": {
        "control_surface": "device_config_profile",
        "platforms": ["Test Platform"],
        "management_channels": ["intune_settings_catalog"],
    },
    "recommended_state": "Disabled",
    "description": "prose",
    "rationale": "prose",
    "impact": "prose",
    "audit": {
        "methods": [
            {
                "method_name": "Terminal Method",
                "type": "scripted",
                "description": "...",
                "steps": [
                    {
                        "step_role": "compliance_check",
                        "check_command": "$test_rule_a_status = 1",
                        "check_command_verified": True,
                        "output_description": "...",
                        "output_check": [
                            {
                                "variable": "test_rule_a_status",
                                "data_type": "integer",
                                "operator": "eq",
                                "value": 1,
                                "value_source": "rule_defined",
                            }
                        ],
                    }
                ],
            }
        ]
    },
    "remediation": {"methods": [{"method_name": "x", "type": "manual_steps", "description": "..."}]},
    "default_value": None,
    "references": [],
    "additional_information": None,
}


def write_rule(path, rule_id, filename, platform="Test Platform"):
    rule = copy.deepcopy(MINIMAL_RULE)
    rule["id"] = rule_id
    rule["policy_classification"]["platforms"] = [platform]
    (path / filename).write_text(json.dumps(rule), encoding="utf-8")
```

Add `import copy` to the file's existing imports (`json`, `pathlib.Path`, `pytest`).

Add a new test for the empty-manifest behavior:

```python
def test_write_manifest_handles_zero_folders(tmp_path):
    manifest_path = tmp_path / "_manifest.json"

    written_path = write_manifest({}, baselines_root=tmp_path, manifest_path=manifest_path)

    assert json.loads(written_path.read_text(encoding="utf-8")) == {"schemaVersion": 1, "baselines": []}
```

Every other test in the file (`test_build_manifest_lists_family_product_version_platform_and_count`, `test_build_manifest_includes_metadata_path_when_metadata_json_exists`, `test_build_manifest_is_sorted_by_family_product_version`, `test_build_manifest_rejects_folder_not_exactly_family_product_version`, `test_write_manifest_is_deterministic`, `test_committed_manifest_matches_repo_baselines`) is unchanged.

- [ ] **Step 2: Run to verify the new/changed tests fail**

Run: `python -m pytest tests/test_generate_manifest.py -v`
Expected: FAIL - the `platform` assertions fail because `folder_entry()` still reads `benchmark.platform` (now absent, so `None`), and `test_write_manifest_handles_zero_folders` fails because `main()`'s early-return-on-empty behavior means `write_manifest` was never reached in that path (it currently would still run fine standalone, actually - re-check: `write_manifest` itself has no empty-folders guard, only `main()` does. So this specific test may already pass. Verify by running it in isolation before assuming; either way, run the whole file and fix whatever's red.)

- [ ] **Step 3: Update `tools/generate_manifest.py`**

Change `folder_entry()`'s platform line from:

```python
    first_rule = json.loads(rule_files[0].read_text(encoding="utf-8"))
    platform = first_rule.get("benchmark", {}).get("platform")
```

to:

```python
    first_rule = json.loads(rule_files[0].read_text(encoding="utf-8"))
    platforms = (first_rule.get("policy_classification") or {}).get("platforms") or []
    platform = platforms[0] if platforms else None
```

Change `main()` from:

```python
def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else BASELINES_DIR
    folders = find_rule_folders(root_dir)

    if not folders:
        print(f"No rule files found under {root_dir}")
        return 1

    manifest_path = write_manifest(folders, baselines_root=root_dir, manifest_path=MANIFEST_PATH)
    print(f"{manifest_path} <- {len(folders)} folder(s)")
    return 0
```

to:

```python
def main():
    root_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else BASELINES_DIR
    folders = find_rule_folders(root_dir)

    manifest_path = write_manifest(folders, baselines_root=root_dir, manifest_path=MANIFEST_PATH)
    print(f"{manifest_path} <- {len(folders)} folder(s)")
    return 0
```

(`write_manifest`/`build_manifest` already handle an empty `folders` dict correctly - `sorted(...)` over nothing is `[]` - so no change is needed there, only to `main()`'s guard.)

- [ ] **Step 4: Run to verify tests pass**

Run: `python -m pytest tests/test_generate_manifest.py -v -k "not test_committed_manifest_matches_repo_baselines"`
Expected: PASS - all tests except the one excluded above.

`test_committed_manifest_matches_repo_baselines` is expected to still be RED at this point, and not because of anything this task changed: Task 3 already changed `looks_like_rule_file()`'s duck-typing (`REQUIRED_RULE_KEYS` now requires `framework_mappings`), so `find_rule_folders(BASELINES_DIR)` - called by this very test - already finds zero folders, since the 12 real v1 files under `baselines/` don't have `framework_mappings` and haven't been removed yet (that's Task 5). The test rebuilds an empty manifest and compares it against the still-committed `_manifest.json`, which still lists the old 2 real entries - a mismatch that exists independent of this task's own changes and resolves once Task 5 regenerates `_manifest.json` to match. Confirm this by running `python -m pytest tests/test_generate_manifest.py::test_committed_manifest_matches_repo_baselines -v` and reading the diff - it should show the committed file's 2 real entries against a rebuilt `{"schemaVersion": 1, "baselines": []}`.

- [ ] **Step 5: Commit**

```bash
git add tools/generate_manifest.py tests/test_generate_manifest.py
git commit -m "$(cat <<'EOF'
feat: generate_manifest.py reads platform from policy_classification

folder_entry() derives the manifest's platform field from
policy_classification.platforms (schema v2) instead of the retired
benchmark.platform. main() now always writes the manifest, including the
empty-baselines case Task 5 is about to produce, instead of aborting
without writing anything.

Known red until Task 5 lands: test_committed_manifest_matches_repo_baselines
- a side effect of Task 3's looks_like_rule_file() change, not this task's,
since the real committed baseline files haven't been removed yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 5: Remove the 12 existing CIS rule files

**Files:**
- Delete: `baselines/cis/macos_26_tahoe/v1.1.0/cis_macos26_1.6.json`, `cis_macos26_2.1.1.1.json`, `cis_macos26_2.1.1.4.json`, `cis_macos26_2.12.2.json`, `cis_macos26_2.3.3.4.json`, `_index.json`, `_metadata.json`
- Delete: `baselines/cis/windows_11/v5.0.0/cis_intune_win11_1.1.json`, `cis_intune_win11_106.1.1.json`, `cis_intune_win11_4.10.24.1.json`, `cis_intune_win11_4.11.15.3.1.json`, `cis_intune_win11_4.11.48.1.json`, `cis_intune_win11_4.11.7.2.1.json`, `cis_intune_win11_6.7.json`, `_index.json`, `_metadata.json`
- Modify: `baselines/_manifest.json` (regenerated to the empty state)

**Interfaces:** none - this task only removes content and regenerates a derived artifact using Task 4's already-updated tooling.

- [ ] **Step 1: Remove the files**

```bash
git rm baselines/cis/macos_26_tahoe/v1.1.0/*.json baselines/cis/windows_11/v5.0.0/*.json
```

(This removes every file in both version folders, including their `_index.json`/`_metadata.json` - there is nothing else in either folder.)

- [ ] **Step 2: Regenerate `baselines/_manifest.json`**

Run: `python tools/generate_manifest.py`
Expected output: `baselines/_manifest.json <- 0 folder(s)`, and the file's contents become:

```json
{
  "schemaVersion": 1,
  "baselines": []
}
```

- [ ] **Step 3: Run the full test suite to confirm nothing else references the removed files**

Run: `python -m pytest -v -k "not test_bundled_example_matches_schema"`
Expected: PASS - every test that was known-red from Tasks 1/3/4 is now green: `tests/test_rule_schema.py::test_baseline_rule_matches_schema` and `test_baseline_rule_follows_variable_conventions` now collect zero parametrized cases (vacuously pass); `tests/test_generate_index.py::test_committed_index_matches_its_folder` likewise collects zero cases; `tests/test_generate_manifest.py::test_committed_manifest_matches_repo_baselines` now compares against the empty manifest and matches.

`tests/test_rule_schema.py::test_bundled_example_matches_schema` is excluded above because it's still red for a reason this task doesn't touch: the 8 bundled skill examples under `.claude/skills/compliance-benchmark-json/references/examples/` are still v1-shaped until Task 6 rewrites them. Confirm it's red for exactly that reason (not something this task broke) by running `python -m pytest tests/test_rule_schema.py -k test_bundled_example_matches_schema -v` and checking the failures are all in that examples directory, all `additionalProperties`/missing-required-field errors consistent with a v1-shaped file hitting the v2 schema.

- [ ] **Step 4: Mark `tools/verify_extraction.py` as retired**

It's a standalone acceptance script (not a pytest suite, not wired into any hook), and after this task it has zero rule files left to diff against - running it will just find nothing to check, which could read as "the parser is broken" rather than "there's nothing to compare against yet." Add a note to its module docstring (top of the file, after the existing text) making that explicit:

```python
Retired for now: the CIS rule corpus this compared against was removed
(see docs/plans/2026-08-20-multi-framework-rule-library-foundation-plan.md,
"Decisions already made"). Running this after that removal will find zero
rule files and have nothing to diff - that's expected, not a sign the
parser broke. The same fidelity-checking logic may get a second life
adapted to the licensed-adaptation pipeline (sub-project 3, ISM/Essential
Eight), where being faithful to the source is actually the goal.
"""
```

(Append this paragraph before the module docstring's closing `"""` - don't remove any of the existing text, which is still accurate background.)

- [ ] **Step 5: Commit**

```bash
git add baselines/_manifest.json tools/verify_extraction.py
git commit -m "$(cat <<'EOF'
feat: remove the 12 pre-v2 CIS rule files from baselines/

Their content doesn't fit schema v2's authoring model (see docs/plans/
2026-08-20-multi-framework-rule-library-foundation-plan.md's "Decisions
already made") - re-creating them through the independent-authoring
pipeline is sub-project 2's job. baselines/ legitimately holds zero rules
until that lands; _manifest.json is regenerated to reflect that.
tools/verify_extraction.py is marked retired since it has nothing left to
diff against.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 6: Update the `compliance-benchmark-json` skill for v2

**Files:**
- Modify: `.claude/skills/compliance-benchmark-json/references/schema.md`
- Modify: `.claude/skills/compliance-benchmark-json/SKILL.md`
- Modify: `.claude/skills/compliance-benchmark-json/references/examples/single-scripted-check.json`
- Modify: `.claude/skills/compliance-benchmark-json/references/examples/multiple-independent-steps.json`
- Modify: `.claude/skills/compliance-benchmark-json/references/examples/sequential-dependency.json`
- Modify: `.claude/skills/compliance-benchmark-json/references/examples/organization-defined-single-value.json`
- Modify: `.claude/skills/compliance-benchmark-json/references/examples/organization-defined-multi-value.json`
- Modify: `.claude/skills/compliance-benchmark-json/references/examples/include-semantics.json`
- Modify: `.claude/skills/compliance-benchmark-json/references/examples/manual-no-script-device-side.json`
- Modify: `.claude/skills/compliance-benchmark-json/references/examples/manual-no-script-cloud-only.json`

**Interfaces:** none - documentation and fixtures only. `tests/test_rule_schema.py::test_bundled_example_matches_schema` (from Task 1) is this task's test.

- [ ] **Step 1: Confirm the test is currently red for this reason**

Run: `python -m pytest tests/test_rule_schema.py -k test_bundled_example_matches_schema -v`
Expected: FAIL - all 8 bundled examples are still v1-shaped (`benchmark`, `extended_attributes.cis`, no `authoring_mode`/`policy_classification`).

- [ ] **Step 2: Rewrite `single-scripted-check.json` fully (worked example for this task's recipe)**

Replace its contents with:

```json
{
  "id": "1",
  "title": "Ensure Example Setting Is Configured To A Secure Value",
  "assessment_status": "Automated",
  "authoring_mode": "independent",
  "framework_mappings": [
    {
      "framework": "example",
      "framework_product": "example_windows",
      "framework_version": "1.0.0",
      "control_id": "1.1",
      "framework_level": ["Level 1"],
      "checked_date": "2026-08-20"
    }
  ],
  "policy_classification": {
    "control_surface": "device_config_profile",
    "platforms": ["windows_11"],
    "management_channels": ["intune_settings_catalog"]
  },
  "recommended_state": "Disabled",
  "description": "Illustrative example: a setting backed by a single registry value, with no runnable audit command given by the framework - only a location and expected value.",
  "rationale": "Illustrative example rationale text - not real source prose.",
  "impact": "Illustrative example impact text - not real source prose.",
  "audit": {
    "methods": [
      {
        "method_name": "Registry Check",
        "type": "scripted",
        "description": "Illustrative example audit method description.",
        "steps": [
          {
            "step_role": "compliance_check",
            "check_command": "$example_1_1_setting = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Example\\Setting' -Name 'ExampleValue' -ErrorAction SilentlyContinue).ExampleValue",
            "check_command_verified": true,
            "output_description": "Illustrative example output description.",
            "check_command_notes": "Illustrative example: a plain registry-property capture, engineered from the mechanism identity in the control spec - there is no 'original' command to explain a difference from.",
            "output_check": [
              {
                "variable": "example_1_1_setting",
                "data_type": "integer",
                "operator": "eq",
                "value": 0,
                "value_source": "rule_defined"
              }
            ]
          }
        ]
      }
    ]
  },
  "remediation": {
    "methods": [
      {
        "method_name": "Settings Catalog",
        "type": "configuration_profile",
        "description": "Illustrative example remediation description.",
        "config_keys": [
          {
            "settings_catalog_path": "Example > Category\\Example Setting",
            "value": "Disabled"
          }
        ]
      }
    ]
  },
  "default_value": "Enabled (illustrative example default).",
  "references": [
    "https://learn.microsoft.com/en-us/windows/win32/secauthn/ssp-aps-versus-ssps"
  ],
  "minimum_os_csp": null,
  "additional_information": null
}
```

- [ ] **Step 3: Apply the same recipe to the remaining 7 examples**

For each file below, apply this transformation (matching what Step 2 just did): set the root `id` to the file's assigned toolkit id from the table (a plain positive-integer string - distinct from any framework's own numbering); replace `benchmark` with `authoring_mode: "independent"` + a single-entry `framework_mappings` (`framework: "example"`, invented `framework_product`/`control_id` matching the file's original v1 id, `framework_version: "1.0.0"`, a plausible `framework_level`, `checked_date: "2026-08-20"`); add a `policy_classification` block (pick a plausible `control_surface`/`platforms`/`management_channels` for the platform the original example illustrated); delete `extended_attributes` entirely (its `cis_controls`/`grid_id` content doesn't carry forward); delete every `original_command` field (there's no more "original" to preserve - `check_command` is always this project's own engineering); rename every `output_check[].value_source` value of `"benchmark"` to `"rule_defined"`; replace every prose field (`title`, `description`, `rationale`, `impact`, `default_value`, and every `output_description`/`check_command_notes`) with clearly-invented illustrative text that preserves the original's structural shape - same number of methods/steps/output_checks, same `type`/`step_role`/`operator`/`value_source` values. Do not reuse any of the original file's specific wording, even paraphrased - invent new sentences.

| File | What structural shape it illustrates (keep this exactly) | New root `id` | Original v1 `id` → new `control_id` |
|---|---|---|---|
| `multiple-independent-steps.json` | 3 steps in one method, each independently `check_command_verified: true` | `2` | `4.10.24.1` → `1.2` |
| `sequential-dependency.json` | step 1 `step_role: "lookup"` (empty `output_check`) feeds step 2; step 2 is `check_command_verified: false` with a genuine unresolved-format note | `3` | `4.11.7.2.1` → `1.3` |
| `organization-defined-single-value.json` | `assessment_status: "Manual"` in the top-level tag despite a real scripted check existing; `output_check.value_source: "organization_defined"`, `value: null` | `4` | `4.11.15.3.1` → `1.4` |
| `organization-defined-multi-value.json` | one step yields two `output_check` entries; a second step has `value_source: "rule_defined"` (a fixed ceiling) explicitly distinct from the org-defined value | `5` | `4.11.48.1` → `1.5` |
| `include-semantics.json` | `operator: "contains"` (an "include X" pass condition, not exact-match) | `6` | `106.1.1` → `1.6` |
| `manual-no-script-device-side.json` | no `audit.methods[].steps` at all - device-side state genuinely unreadable by script | `7` | `6.7` → `1.7` |
| `manual-no-script-cloud-only.json` | no `audit.methods[].steps`, but `recommended_state` is still populated (cloud-evaluated setting, no local backing to query) | `8` | `1.1` (macOS) → `1.8` |

- [ ] **Step 4: Run to verify all 8 examples now pass**

Run: `python -m pytest tests/test_rule_schema.py -k test_bundled_example_matches_schema -v`
Expected: PASS - 8 passed.

- [ ] **Step 5: Rewrite `references/schema.md`'s top-level table and `extended_attributes` section**

Replace the "Top level" table (current lines 15-30) with:

```markdown
| Field | Type | Notes |
|---|---|---|
| `id` | string | A toolkit-assigned identifier (`"1"`, `"12"`, `"347"` - a positive integer, no leading zero), unique across the whole rule library, never a framework's own numbering - a framework's own control number belongs solely in that mapping's `framework_mappings[].control_id`. Allocated by scanning every rule's `id` for the current maximum and adding one, not a tracked counter file. |
| `title` | string | This toolkit's own title for the rule, without a trailing status tag like `(Automated)`/`(Manual)`. Never a specific framework's own title text - see "Authoring model" below. |
| `assessment_status` | `"Automated"` \| `"Manual"` | The tag the rule's own authoring process assigns. |
| `authoring_mode` | `"independent"` \| `"licensed_adaptation"` | See "Authoring model" below. |
| `framework_mappings` | array | Every framework control this rule satisfies - see "Framework mappings" below. At least one entry required. |
| `source_license` | object | Required when `authoring_mode` is `"licensed_adaptation"`, forbidden when `"independent"` - see "Authoring model" below. |
| `policy_classification` | object | `{ control_surface, platforms, management_channels }` - see "Policy classification" below. |
| `recommended_state` | string \| null | The target *value* this rule enforces (e.g. `"Block"`, `"Disabled"`, `"30 Days"`) - never the comparison itself. `null` only when genuinely organization-defined or truly unstated. Don't bake an operator/comparison into this string - that belongs in `output_check.operator`. |
| `description`, `rationale`, `impact` | string | This toolkit's own prose. For `independent`-mode rules: written from a control spec (see `specs/_control_spec.schema.json`) without reference to any source framework's own wording - see the foundation design doc for the fidelity-vs-paraphrase distinction. For `licensed_adaptation`-mode rules: adapted from the one framework named in `source_license`, with modification indicated per that licence's terms. |
| `audit` | object | See below - unchanged from before. |
| `remediation` | object | See below - unchanged from before. |
| `default_value` | string \| null | The stated default, when known. |
| `references` | array of strings | URLs only. `[]` if none (never `null`). |
| `minimum_os_csp` | string \| null | A minimum-OS/CSP-version note, when applicable. |
| `additional_information` | string \| object \| null | Free text, or a light structure, when there's something worth keeping that doesn't fit elsewhere. |

## Authoring model

Every rule declares `authoring_mode`:

- **`independent`** - this toolkit authored the rule's prose itself, from a control spec (`specs/_control_spec.schema.json`), with no exposure to any single mapped framework's own wording during that authoring step. Always the safe choice regardless of how many frameworks the rule maps to - use it whenever a rule touches a restrictively-licensed framework.
- **`licensed_adaptation`** - the rule's prose is adapted from one specific framework's own openly-licensed published text. Requires a `source_license` object: `{ framework, license_name, license_url, rights_holder, source_url, retrieved_date, modified: true }`. Only use this when the *entire* rule's content came from nothing but that one permissively-licensed source - if a rule also maps to a more restrictively-licensed framework, use `independent` instead, even though the permissive framework's mapping alone would have allowed `licensed_adaptation`.

## Framework mappings

```json
"framework_mappings": [
  {
    "framework": "cis",
    "framework_product": "windows_11",
    "framework_version": "5.0.0",
    "control_id": "18.9.31.2",
    "framework_level": ["Level 1"],
    "checked_date": "2026-08-20"
  }
]
```

- `framework_product`: `null` where the framework has no product axis.
- `framework_level`: an array - not just because a rule can cover more than one distinct control, but because a single mapping entry can carry more than one level under a cumulative tiering model (e.g. a control satisfying Essential Eight Maturity Level 2 also satisfies Maturity Level 1 for that same control - both belong on the one entry).
- No citation, title, or descriptive text field - identifiers only, ever. A secondary taxonomy within a framework (e.g. CIS Controls v8) is just another entry with its own `framework`/`control_id`, not a special field on the primary one.
- `checked_date`: when this specific mapping was last verified against the framework's currently published text.

## Policy classification

```json
"policy_classification": {
  "control_surface": "device_config_profile",
  "platforms": ["windows_11"],
  "management_channels": ["intune_settings_catalog", "group_policy"]
}
```

- `control_surface`: `device_config_profile` | `device_compliance_check` | `server_infrastructure_config` | `process_administrative`
- `platforms`: e.g. `windows_11`, `windows_server_2022`, `macos`, `linux`, `network_device`, `organization_wide`
- `management_channels`: e.g. `intune_settings_catalog`, `intune_compliance_policy`, `group_policy`, `registry`, `macos_profile`, `manual_process`
```

Delete the old `extended_attributes` section (current lines 32-52) entirely - CIS Controls mappings and GRID IDs are now just `framework_mappings` entries (`framework: "cis_controls"`, `framework: "cis_grid"`, etc.), not a namespaced sub-object.

- [ ] **Step 6: Update `references/schema.md`'s file-naming convention and `audit`/`steps` sections**

Replace the "File naming and location" section's naming-convention sentence (current line 7):

> One file per rule, named `<benchmark-slug>_<platform-slug>_<rule-id>.json` (e.g. the initial CIS macOS and Intune rules used `cis_macos26_2.3.3.4.json`, `cis_intune_win11_4.11.15.3.1.json` - the `cis_` prefix reflects that specific source, not a fixed convention; a non-CIS source should use its own slug instead).

with:

> One file per rule, named `<id>_<short-title-slug>.json` (e.g. `12_ensure-example-setting-is-configured.json`) - `id` is the rule's own toolkit-assigned identifier (see "Top level" below), not any framework's numbering, since one rule can map to several frameworks at once. The title slug is a lowercased, hyphenated shortening of `title`, kept short enough to stay scannable; it exists for humans browsing a folder listing and carries no meaning the JSON itself doesn't already state - the filename is never authoritative, `id` inside the file is.

In the `steps` table (current "### `steps` (scripted methods only)" section), delete the `original_command` row entirely - `check_command` is always this project's own engineering now; there is no preserved "original" to diverge from or explain a difference against. Update the `check_command_notes` row's description from referencing "why `check_command` differs from `original_command`" to: "Optional. Your own explanation of a non-obvious engineering choice in `check_command` (e.g. why a particular flag or extraction approach was used). Only add this when there's something non-obvious to explain."

Update the `output_check` entry shape example (current line 96) from:

```
{ "variable": "...", "data_type": "boolean|integer|string", "operator": "eq|ne|gt|gte|lt|lte|contains|like", "value": <target or null>, "value_source": "benchmark" | "organization_defined" }
```

to:

```
{ "variable": "...", "data_type": "boolean|integer|string", "operator": "eq|ne|gt|gte|lt|lte|contains|like", "value": <target or null>, "value_source": "rule_defined" | "organization_defined" }
```

and its explanatory bullet below (current line 100) from "`value: null` + `value_source: "organization_defined"` together mean..." - keep that sentence, but where the surrounding prose refers to "the benchmark" as the source of a `rule_defined` value, say "this rule" instead (e.g. "the pass/fail target has to come from whoever configures the policy, not from this rule's own fixed value").

- [ ] **Step 7: Update `SKILL.md`'s "A note on benchmark-specific fields" section**

Replace that entire section (current lines 95-99) with:

```markdown
## Framework mappings and authoring mode

There is no per-family namespaced field anymore. Every framework a rule maps to - CIS, ISM, Essential Eight, CIS's own Controls taxonomy, anything else - is just another entry in `framework_mappings` (see `references/schema.md`). A rule's `title`/`description`/`rationale`/etc. never names which framework prompted it; the only place a framework name appears on a rule is that mapping list, as plain identifiers (framework, control ID, version, level, date checked) - never prose, never a title, never a citation string.

Every rule also declares `authoring_mode`. `licensed_adaptation` rules are adapted directly from one specific framework's own openly-licensed text (see that framework's `source_license` requirements in `references/schema.md`). `independent` rules are authored by this toolkit from a control spec (`specs/_control_spec.schema.json`) with no exposure to any mapped framework's own wording during that authoring step - use this mode whenever a rule touches a framework whose licence doesn't clearly permit adaptation, and it's always a safe default even for a permissively-licensed framework.
```

- [ ] **Step 8: Run the full skill-related test suite**

Run: `python -m pytest tests/test_rule_schema.py -v`
Expected: PASS - all tests, including all 8 bundled-example cases.

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/compliance-benchmark-json/
git commit -m "$(cat <<'EOF'
docs: update compliance-benchmark-json skill for schema v2

Rewrites schema.md's field reference (including the file-naming convention,
now <id>_<title-slug>.json since id is toolkit-assigned rather than any
one framework's number) and SKILL.md's benchmark-specific-fields section
for framework_mappings/authoring_mode/policy_classification, drops
original_command from the steps table, renames value_source's "benchmark"
to "rule_defined", and replaces all 8 bundled examples with schema-v2-shaped,
non-benchmark-sourced illustrative content (framework: "example" throughout)
- closing the licensing review's separate finding that these examples used
real CIS
rule text.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 7: Dual-licence note in `README.md`

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Add a licensing section to `README.md`**

Current full contents of `README.md` are just `# intune-compliance-toolkit`. Replace with:

```markdown
# intune-compliance-toolkit

## Licensing

This repository's own code, schemas, and independently-authored rule
content (`authoring_mode: "independent"`) are licensed under AGPL-3.0 (see
`LICENSE`).

Rule content marked `authoring_mode: "licensed_adaptation"` is adapted
from an openly-licensed third-party source - each such rule's
`source_license` field names the specific licence, rights holder, and
source URL. As of this writing that applies to content sourced from the
Australian Signals Directorate's Information Security Manual and Essential
Eight guidance, both released by the Commonwealth of Australia under CC BY
4.0. AGPL-3.0 governs this repository's own code and structure around that
adapted content; the adapted content itself remains subject to its
original CC BY 4.0 terms (attribution, indication of modification) as well.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: note the two licence layers rule content can carry

Independently-authored rule content and the toolkit's own code are AGPL;
content adapted from an openly-licensed source (ISM/Essential Eight, CC BY
4.0) additionally carries that source's own licence terms. Makes this
explicit so a downstream user of the repo isn't misled into thinking
everything is uniformly AGPL-only.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Final check: full suite

- [ ] Run: `python -m pytest -v`
- [ ] Expected: PASS, zero failures, zero errors.
- [ ] Add a Progress log entry below recording the date and the commit range this plan landed in.

## Progress log

- **2026-08-20** - Tasks 1-7 implemented and individually reviewed. Schema v2
  landed (`framework_mappings`/`authoring_mode`/`source_license`/
  `policy_classification`, integer `id`, no `original_command`,
  `value_source: "rule_defined"`), the independent-authoring control spec
  schema and its validator were added, `generate_index.py`/
  `generate_manifest.py` were migrated to the v2 fields, the 12 pre-v2 CIS
  rule files were removed and the manifest regenerated to the empty state,
  the `compliance-benchmark-json` skill's docs and all 8 bundled examples
  were rewritten for v2 with deliberately-invented content, and `README.md`
  gained the dual-licence note. Commits `378b984..428a5ac`:
  `2e51fe5 feat: rule schema v2`, `6744572 feat: independent-authoring
  control spec schema`, `dce7bdf feat: generate_index.py indexes
  framework_mappings/policy_classification`, `1f7d9bc feat:
  generate_manifest.py reads platform from policy_classification`,
  `8efe956 feat: remove the 12 pre-v2 CIS rule files from baselines/`,
  `94c1a08 docs: update compliance-benchmark-json skill for schema v2`,
  `95387d9 fix: remove residual real-source wording/constant from bundled
  examples`, `428a5ac docs: note the two licence layers rule content can
  carry`.
- **2026-08-21** - Final whole-branch review's single fix wave. Resolved the
  cross-task defect the per-task reviews couldn't see (the file-naming and
  variable-naming conventions were mutually unsatisfiable, now
  `rule_<id>_<title-slug>.json` with hyphen-folding in `file_slug()`, plus an
  end-to-end regression test), rewrote `SKILL.md`'s provenance framing so it
  no longer mandates verbatim reproduction of a source framework's wording,
  brought `schema.md`'s remaining v1-framed field descriptions onto the
  `authoring_mode` split, fixed stale docstrings, made
  `generate_index.py`/`generate_manifest.py` agree on zero folders being a
  valid state, and stopped `generate_manifest.py` writing the real manifest
  for a foreign scan root. Also recorded the tracked `webui/` consequences
  and the unenforced cross-field invariants above. Commit
  `784b6f8 fix: resolve final whole-branch review findings for schema v2`.
  Full suite green: 78 passed, 4 skipped (all four skips are empty
  parametrize sets over the deliberately-empty `baselines/`).
- **2026-08-21** - Closed the two items this document itself flagged as
  unresolved, by asking the project owner rather than assuming: `baselines/`
  will flatten to one directory (no repurposed `family/product/version`
  hierarchy), and git history is left as-is for now (not rewritten to
  unpublish the removed CIS text). No code changed - both were design-doc
  decisions recorded in "Decisions already made" and the `id` section, for
  sub-project 2/3 to act on. Docs-only commit, no new code.
