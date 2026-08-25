# Independent-authoring workflow: spec production + clean-room handoff

## Context

This is sub-project 2 from `docs/plans/2026-08-20-multi-framework-rule-library-foundation-plan.md`'s Sequencing section: the actual tooling and workflow for producing `independent`-mode rule content, plus re-creating the 12 CIS-mapped rules that were removed from `baselines/` when schema v2 landed.

The foundation plan defined the schema shapes (`baselines/_rule.schema.json`'s `authoring_mode`, `specs/_control_spec.schema.json`) but didn't build the workflow for actually using them, and left two gaps unresolved: the spec file-naming convention has a chicken-and-egg problem (named by a rule `id` that doesn't exist until after the rule is authored from the spec), and `baselines/`'s flat-directory decision was recorded but never implemented.

## Decisions already made (this session's Q&A)

- **First batch:** re-derive specs for the same 12 rules removed in the foundation plan (7 CIS Windows 11 v5.0.0, 5 CIS macOS Tahoe v1.1.0) - a natural like-for-like migration and a large enough proving batch.
- **Both infra gaps get fixed now**, not deferred: the spec-naming convention and the `baselines/` flattening, since the clean agent can't save a real rule without either.
- **Handoff target:** a fresh Claude Code session in this same repo, with no prior exposure to `baseline-references/` or any git history containing CIS text.
- **`_manifest.json`/`generate_manifest.py` are retired**, not kept in a degenerate single-entry form - the "discover multiple ruleset folders" problem they solved doesn't exist once `baselines/` is one flat folder. `webui/src/data/manifest.ts` fetching `baselines/rules/_index.json` directly is a note for sub-project 4, not done here.

## A. Spec schema additions

`specs/_control_spec.schema.json` gains two required fields, mirroring `baselines/_rule.schema.json`'s `policy_classification` shape so a spec carries everything the content-authoring step needs without inferring or guessing:

```json
"control_surface": "device_config_profile",
"management_channels": ["intune_settings_catalog"]
```

- `control_surface`: same enum as the rule schema's (`device_config_profile` | `device_compliance_check` | `server_infrastructure_config` | `process_administrative`).
- `management_channels`: same shape as the rule schema's (open string array, e.g. `intune_settings_catalog`, `group_policy`).

`platform` (singular, already in the spec schema) maps to the rule's `policy_classification.platforms` as a one-element array (`[platform]`) - a spec is produced against one specific platform's mechanism, since `mechanism.identifier` is platform-specific; a control needing both Windows and macOS mechanisms is naturally two separate spec files, not one spec with two platforms.

## B. `baselines/` flattens; the manifest is retired

- Rule files live at `baselines/rules/<filename>.json` - one flat folder. `tools/generate_index.py` needs no code change: its folder-discovery already works on any folder depth (it groups by "any folder that directly holds rule files," never assuming three levels).
- `tools/generate_manifest.py`, `baselines/_manifest.json`, and `tests/test_generate_manifest.py` are deleted outright.
- `baselines/_metadata.schema.json` and the `_metadata.json`-generation tooling (`tools/generate_metadata.py`, `tools/validate_metadata.py`) are untouched - they're a from a prior, still-relevant project (benchmark section-heading metadata) and orthogonal to the manifest's "which folders exist" job.

## C. Three distinct workflows, not one

The `compliance-benchmark-json` skill's current "Workflow for adding a rule" conflates two things schema v2 requires to stay separate. It becomes three workflow sections:

1. **Producing a spec** (`independent`-mode content; this project's job whenever a rule maps to a restrictively-licensed framework like CIS). Locate the source section, extract *only* mechanism facts into the spec's `mechanism` block (registry path/CSP URI/etc. - Microsoft's or Apple's own public facts, not the framework's expression), fill `applicability_tags`/`rationale_tags` from the fixed vocabularies, fill `policy_classification`-equivalent fields, list `framework_mapping_refs`. Then - and only then, having captured the facts - close the source and write `description_intent`/`rationale_intent` from your own understanding of the underlying security concept, never by transcribing or paraphrasing the source's sentences, structure, or examples. Save to `specs/<framework>/<product>/<version>/<control_id>.json` (the framework's own control ID, since a toolkit rule `id` doesn't exist yet).
2. **Authoring rule content from a spec** (the clean-room step; a fresh session with zero exposure to any source framework's text does this). Read *only* the spec file(s) for one rule - never `baseline-references/`, never this plan's CIS-specific design rationale, never git history. Write `title`/`description`/`rationale`/`impact`/`default_value`, engineer `check_command`/`output_check` from the spec's `mechanism` facts (ordinary technical engineering against Microsoft's/Apple's own public documentation - no framework exposure needed for this part either), set `authoring_mode: "independent"`. Allocate the next `id` (scan `baselines/rules/*.json` for the current maximum `id`, add one), save as `baselines/rules/rule_<id>_<title-slug>.json`, validate with `tools/validate_rules.py`, regenerate `baselines/rules/_index.json`.
3. **Extracting a `licensed_adaptation` rule directly from source** (ISM/Essential Eight - sub-project 3's job, not built here). This is close to today's existing "Workflow for adding a rule," since that content is allowed to be source-faithful with attribution. Left as a placeholder pointer to sub-project 3 in this pass - not designed in detail here, since ISM/E8 source acquisition hasn't happened yet.

A short **handoff note** at the top of `SKILL.md` tells a fresh session: if you were only given spec files and asked to author rules, read workflow (2) only - skip (1) and (3) entirely, and do not open `baseline-references/` under any circumstance.

## D. This project's own deliverable

Build A-C, then produce 12 real spec files (workflow 1, run by this session/its subagents, which already have prior exposure to the CIS source and are therefore the right actors for this step) covering the same rules the foundation plan removed. The clean-room handoff itself (workflow 2, run in a genuinely fresh session) is explicitly **not** part of this project's own execution - it's the next session's job, using the specs this project produces as its input. This project's "done" state is: 12 validated, committed spec files, ready to hand off.

## Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the spec-schema additions, the `baselines/` flattening (with `generate_manifest.py` retired), the three-workflow skill restructuring, and 12 real, validated spec files for the CIS Windows 11/macOS rules the foundation plan removed.

**Architecture:** Same JSON-Schema-plus-Python-tooling architecture as the foundation plan. No new frameworks. The 12 specs are content-authoring work, not code - produced by reading the real CIS source markdown still on disk at `baseline-references/cis-benchmarks/` (gitignored, never committed) and writing fact-only + independently-worded spec files.

**Tech Stack:** Python 3, `jsonschema`, `pytest` (unchanged from the foundation plan).

**Spec:** This document's sections A-D above.

## Global Constraints

- `additionalProperties: false` stays true on every object in the spec schema - the two new fields are added to the existing `required` list, not left optional.
- No framework-identifying branding outside `framework_mappings`/`framework_mapping_refs` - unchanged from the foundation plan.
- Every spec's `description_intent`/`rationale_intent` must be independently worded - never a transcription or close paraphrase of the CIS source text, even with different words. This is the single most important constraint in this document; every spec gets an adversarial review for it before being considered done.
- Follow this repo's `.claude/CLAUDE.md`: commit after each verified task, push to `rework`, add a Progress log entry to this plan doc as work lands.

---

### Task 1: Spec schema additions

**Files:**
- Modify: `specs/_control_spec.schema.json`
- Modify: `tests/test_control_spec_schema.py`

**Interfaces:**
- Produces: `control_surface` (enum, required) and `management_channels` (array of strings, required) on every control spec, matching the rule schema's `policyClassification` enum/shape.

- [ ] Add `control_surface` (`{"enum": ["device_config_profile", "device_compliance_check", "server_infrastructure_config", "process_administrative"]}`) and `management_channels` (`{"type": "array", "items": {"type": "string", "minLength": 1}}`) to the schema's top-level `required` list and `properties`.
- [ ] Update `tests/test_control_spec_schema.py`'s `MINIMAL_VALID_SPEC` fixture to include both fields (e.g. `"control_surface": "device_config_profile"`, `"management_channels": ["intune_settings_catalog"]`).
- [ ] Add a test asserting `control_surface` must be one of the fixed enum values (an invalid value like `"made_up_surface"` is rejected).
- [ ] Add a test asserting both new fields are required (a spec missing either fails validation).
- [ ] Run `python -m pytest tests/test_control_spec_schema.py -v` - confirm the existing 6 tests plus the new ones all pass.
- [ ] Commit: `feat: add control_surface/management_channels to the control spec schema`.

### Task 2: Flatten `baselines/`, retire the manifest

**Files:**
- Delete: `tools/generate_manifest.py`, `baselines/_manifest.json`, `tests/test_generate_manifest.py`
- Create: `baselines/rules/` (the directory comes into existence with the first file placed in it - no empty-directory placeholder needed)

**Interfaces:**
- Consumes: nothing new - `tools/generate_index.py`'s existing folder-discovery already works unmodified on a single flat folder.
- Produces: no manifest exists anymore; the only discovery path for rule content is `baselines/rules/_index.json` once rules exist there.

- [ ] Delete `tools/generate_manifest.py`, `baselines/_manifest.json`, `tests/test_generate_manifest.py`.
- [ ] Grep the repo for any other reference to `generate_manifest`, `_manifest.json`, or `MANIFEST_PATH`. Fix any hook or doc reference found under `tools/`, `tests/`, or `.claude/skills/` (check `.claude/settings.json` for anything invoking `generate_manifest.py`). For `webui/` specifically: check `scripts/copy-baselines.mjs` and `webui/src/data/manifest.ts` for a hardcoded reference to `_manifest.json` - don't fix either (out of scope, sub-project 4's job), but add one sentence to the foundation plan doc's existing "Known consequences for `webui/`" section (`docs/plans/2026-08-20-multi-framework-rule-library-foundation-plan.md`) noting that `_manifest.json` no longer exists at all now, not just empty, so anything in `webui/` that fetches it will 404 rather than get `{"baselines": []}`.
- [ ] Run `python -m pytest -v` (full suite) - confirm nothing else broke. `baselines/rules/` doesn't need to exist yet for this task; it's created naturally by Task 4+'s first spec-derived rule, not this task.
- [ ] Commit: `feat: retire generate_manifest.py - baselines/ is one flat folder now, not multiple rulesets`.

### Task 3: Restructure the skill into three workflows

**Files:**
- Modify: `.claude/skills/compliance-benchmark-json/SKILL.md`
- Modify: `.claude/skills/compliance-benchmark-json/references/schema.md`

**Interfaces:** none (documentation only).

- [ ] Update `SKILL.md`'s YAML frontmatter `description` field to also mention control-spec authoring and content-authoring-from-a-spec, not just "convert a benchmark into JSON" - otherwise a fresh session handed only spec files and asked to author rule content has no reason to discover this skill at all. Keep it one sentence added to the existing description, not a rewrite.
- [ ] At the top of `SKILL.md`, right after the `## Purpose` section, add a new `## Which workflow applies to you` section: a short routing paragraph. If you were handed spec files only and asked to author rule content from them, go straight to "Workflow: authoring rule content from a spec" below and read nothing else in this document - do not open `baseline-references/` or any file describing a specific CIS/ISM/Essential Eight rule's real content under any circumstance.
- [ ] Retitle the current "Workflow for adding a rule" section to "Workflow: producing a spec (`independent`-mode content)" and rewrite its 7 steps for producing a spec instead of a rule: locate the source section; extract mechanism facts only into the spec's `mechanism` block; fill `applicability_tags`/`rationale_tags`/`control_surface`/`management_channels`/`framework_mapping_refs`; close the source and write `description_intent`/`rationale_intent` independently (state explicitly: never by transcribing or paraphrasing the source's sentences, structure, or examples - if you find yourself needing the source open while writing these two fields, stop and close it first); validate with `tools/validate_specs.py`; save to `specs/<framework>/<product>/<version>/<control_id>.json`.
- [ ] Add a new "Workflow: authoring rule content from a spec" section: read the spec file(s) for one rule; write `title`/`description`/`rationale`/`impact`/`default_value` from the spec's intent fields, in your own words; engineer `check_command`/`output_check` from `mechanism`; set `authoring_mode: "independent"`, copy `framework_mapping_refs` into `framework_mappings`, build `policy_classification` from the spec's `platform`/`control_surface`/`management_channels`; allocate the next `id` (scan `baselines/rules/*.json` for the current max `id`, add one - note: `baselines/rules/` may not exist yet for the very first rule, in which case start at `id: "1"`); save as `baselines/rules/rule_<id>_<title-slug>.json`; validate with `tools/validate_rules.py`; regenerate `baselines/rules/_index.json` via `tools/generate_index.py baselines/rules`.
- [ ] Add a short "Workflow: extracting a `licensed_adaptation` rule directly from source" section as a placeholder pointing at sub-project 3 (not designed in detail yet - ISM/Essential Eight source acquisition hasn't happened) - close to today's original workflow, since that content is allowed to be source-faithful with attribution.
- [ ] Update `references/schema.md`'s file-naming section to describe both filename conventions in context: `specs/<framework>/<product>/<version>/<control_id>.json` for specs, `baselines/rules/rule_<id>_<short-title-slug>.json` for rules (already correct from the foundation plan - just relocate the sentence to mention the new folder).
- [ ] Read the fully rewritten `SKILL.md`/`schema.md` end to end for internal consistency (the same self-review discipline the foundation plan's final review had to apply after the fact - do it inline this time).
- [ ] Commit: `docs: split compliance-benchmark-json into spec-production, content-authoring, and licensed-adaptation workflows`.

### Tasks 4-9: Produce the 12 specs

Six tasks of 2 specs each (Windows 11 rules paired, macOS rules paired + one group of 1), each independently reviewed for the one property that matters most here: **no source expression survived, even paraphrased.**

Source: `baseline-references/cis-benchmarks/CIS_Microsoft_Intune_for_Windows_11_Benchmark_v5.0.0.md` and `CIS_Apple_macOS_26_Tahoe_Benchmark_v1.1.0.md` (gitignored, on disk).

Original rule → CIS section, for locating the source (the removed rule files themselves are only in git history now, at commit `8efe956~1` if a worked example is needed to confirm a section's location, but the source markdown is the primary source to read from):

| Task | Rules (CIS section → old file, for reference only) |
|---|---|
| 4 | 1.1, 106.1.1 |
| 5 | 4.10.24.1, 4.11.15.3.1 |
| 6 | 4.11.48.1, 4.11.7.2.1 |
| 7 | 6.7 (Windows), 1.6 (macOS) |
| 8 | 2.1.1.1, 2.1.1.4 (macOS) |
| 9 | 2.12.2, 2.3.3.4 (macOS) |

- [ ] For each pair: follow `SKILL.md`'s "Workflow: producing a spec" section exactly. Save both specs.
- [ ] Run `python -m pytest tests/test_control_spec_schema.py -v` plus `python tools/validate_specs.py specs` after each pair - confirm both validate.
- [ ] Self-check each spec's `description_intent`/`rationale_intent` against the source section one more time before committing: would a reader familiar with the CIS wording recognize a specific sentence, clause order, or distinctive phrase carried over? If yes, rewrite it structurally differently, not just with synonyms.
- [ ] Commit each pair: `feat: add control spec for <framework> <control_id>, <control_id>`.

### Final task: adversarial copyright-safety review of all 12 specs

- [ ] Dispatch a review (fresh eyes, ideally a subagent that reads only the 12 committed spec files plus the real CIS source markdown, told explicitly to try to find any surviving transcription/close paraphrase) against every `description_intent`/`rationale_intent` in all 12 specs. Treat any finding the same way the foundation plan's final review treated leaked text: fix before calling this project done, not after.
- [ ] Run the full test suite once more (`python -m pytest -v`) to confirm nothing regressed across all prior tasks.

## Progress log

- **2026-08-25** - Task 2 done: deleted `tools/generate_manifest.py`, `baselines/_manifest.json`, and `tests/test_generate_manifest.py`; left `tools/generate_index.py` untouched (its folder-discovery already works on a flat folder); added a note to the foundation plan's "Known consequences for `webui/`" section about `_manifest.json` no longer existing at all. Full `pytest` suite still passes (74 passed, 4 skipped). Commit `e7839bb feat: retire generate_manifest.py - baselines/ is one flat folder now, not multiple rulesets`.
- **2026-08-25** - Task 3 done: split `.claude/skills/compliance-benchmark-json/SKILL.md`'s single "Workflow for adding a rule" into three routed workflows - "Workflow: producing a spec (`independent`-mode content)", a new "Workflow: authoring rule content from a spec" (the step a session with only spec files, never the benchmark source, must be able to follow on its own), and a placeholder "Workflow: extracting a `licensed_adaptation` rule directly from source" for sub-project 3. Added a "Which workflow applies to you" routing section (explicitly forbidding opening `baseline-references/` for the spec-only case) and updated `references/schema.md`'s file-naming section to document both the spec and rule filename conventions. `pytest` still passes (74 passed, 4 skipped; docs-only change). Commit `f27e6d8 docs: split compliance-benchmark-json into spec-production, content-authoring, and licensed-adaptation workflows`.
- **2026-08-25** - Task 3 follow-up: an advisor review of the first pass found the content-authoring-from-a-spec workflow silently dropped several schema-required fields (`recommended_state`, `remediation`, `assessment_status`, `references`, `additional_information`) while telling the reader to skip the rest of the document, dropped the old workflow's `check_command_verified: false` honesty norm entirely, and left a source-premised instruction ("the source states a target") in the one Validation section that workflow is routed to. Fixed all three: added steps deriving `recommended_state`/`remediation` from the spec's `mechanism` block, restored the `check_command_verified: false` norm, added the `independent`-mode analog to the Validation bullet, and named `references/schema.md` explicitly as safe required reading. `pytest` still passes (74 passed, 4 skipped). Commit `e6b32bc docs: close required-field, verification-honesty, and source-premised gaps in the spec-authoring workflow`.
