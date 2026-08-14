---
name: compliance-benchmark-json
description: Converts security/compliance benchmark documents (CIS, DISA STIG, vendor hardening guides, or any similarly-structured benchmark - typically markdown converted from a source PDF) into this project's per-rule JSON schema, and answers questions about that schema. Use this skill whenever the user asks to add, extract, convert, or generate a rule/control from a benchmark into JSON, whenever they reference a benchmark section/rule number in the context of this repo, or whenever they ask about the meaning of a field in one of the existing rule JSON files (output_check, check_command, recommended_state, etc.). This encodes hard-won conventions from prior sessions - always follow it rather than inventing a new shape from scratch.
---

# Benchmark → JSON Rule Extraction

## Purpose

This project is building a machine-readable representation of security/compliance benchmark rules so a future wizard can let a user pick rules and auto-generate Intune custom-compliance discovery scripts (PowerShell for Windows, shell for macOS) - **without further AI involvement at generation time**. That last point drives most of the schema's shape: every fact a script generator would need has to be present as structured data, not prose a human (or another model) would have to interpret.

The schema was designed against CIS benchmarks for Apple macOS and Microsoft Intune for Windows, but is meant to generalize to other benchmark sources too (other CIS benchmarks, DISA STIGs, vendor-specific hardening guides, anything with the same basic rule shape: a title, applicability, description/rationale/impact, an audit procedure, and a remediation procedure). Don't assume the source is CIS, and don't hardcode CIS-specific filenames or paths anywhere - find the actual source document(s) and existing rule files by asking the user or searching the repo, since both may move or multiply over time.

A number of rules already exist as worked examples covering every structural variant this schema needs to handle - search the repo for existing rule JSON files (they follow the naming convention in `references/schema.md`) and skim 2-3 of the closest-matching ones before extracting something new. Don't assume they live in any particular folder - their location isn't fixed by this skill.

## The two hard constraints, in tension

1. **Source fidelity.** Every fact taken from the benchmark (`description`, `rationale`, `impact`, `original_command`, `output_description`, table contents, etc.) must be reproduced with the original wording, including any typos the benchmark itself contains (don't silently correct the source's grammar). The one normalization that IS applied: rejoining words that PDF-to-markdown conversion broke across a line break (e.g. two fragments that should read as one compound word). If you're not sure whether an oddity is a genuine source typo or a conversion artifact, check the raw source text around it rather than guessing.
2. **Automation-readiness.** Fields like `check_command` and `output_check` are engineered by you, not extracted - real technical judgment calls about how to make a check deterministic and machine-parseable.

These two must never blur together. A field either holds source text (verbatim) or holds your engineering (clearly not pretending to be source text). See `references/schema.md` for exactly which fields are which, and the "Where fidelity broke down before" section below for what happens when this rule is skipped.

## Workflow for adding a rule

1. **Locate the source document and the section within it.** If the user hasn't pointed you at a specific file, ask or search the repo for the relevant benchmark document. Grep the target ID/title - section numbers aren't always sequential with the document's heading levels (some benchmarks number a late section with far deeper nesting than its neighbors), so search by title text if the ID search comes up empty.
2. **Read the full section**, not just Audit/Remediation - also check for a `Default Value`, `References` (and whether any reference-list entries are actually cross-reference metadata - e.g. a control-mapping ID or a minimum-OS note - rather than a URL - pull those into their own fields), any "Additional Information"-type section, and any controls-mapping table at the end.
3. **Fill the schema** per `references/schema.md`. Work out, for each audit method, whether it's `manual` or `scripted`, and for scripted methods whether the benchmark gave a literal runnable command or only a location/description to confirm (e.g. a registry path, a UI setting).
4. **Engineer `check_command`.** This is the part that takes real thought - see "Designing check_command" below.
5. **Validate before showing the result.** Run the checks in "Validation" below. Every one of them has caught a real bug in earlier sessions - they are not busywork.
6. **Say what you're unsure of.** If you can't verify a command's exact output format without running it (e.g. a CLI's CSV column names, or whether a parser handles the source's exact whitespace), set `check_command_verified: false` and say so - don't present unverified syntax as settled.
7. **Save the output where the project's rule files actually live**, or ask if that's unclear. Don't default to any specific folder name from memory - the storage location for rule JSON files is a project decision that can change, not something this skill should assume.

## Designing check_command

The benchmark rarely gives you something directly usable by an automated compliance check. Your job is to turn what it does give you into a command that produces exactly one comparable value per check, while leaving a clear trail back to the original:

- **If the source gives a literal command**, put it verbatim in `original_command`, then write a modified version in `check_command` that captures the result into a named shell/PowerShell variable. Typical modifications: drop a bare `sudo` (the discovery script already runs elevated, so plain elevation is redundant - but keep a user-switching form like `sudo -u <username>` where it's selecting *which user's* context to read, not just requesting privilege), add a flag that changes the output format to something parseable (e.g. a CSV/report flag instead of a formatted table), or pipe through a text-processing tool to extract just the field you need.
- **If the source gives no command at all** (common for registry-backed or setting-based rules that only state a location and expected value) - `original_command` is `null`, and `check_command` is entirely your construction (e.g. a registry-read one-liner). This is fine and expected; just say so in `check_command_notes` so nobody mistakes it for something the source actually wrote.
- **If a step's result is only used to compute the next step** (e.g. a two-stage lookup - resolve an identifier, then read the value at that resolved location), keep them as separate entries in `steps` in order, and mark the first one `"step_role": "lookup"` with an empty `output_check: []`. Don't try to force a dependent lookup into one line - the ordering *is* the information.
- **If the benchmark's pass/fail language is "matches your organization's requirements"** rather than a fixed value, this is `value_source: "organization_defined"` with `value: null` - the check is still worth generating (the variable capture is real), but the comparison target has to come from whoever configures the policy, not from the benchmark. Don't invent a plausible-looking default value to fill the gap.
- **Never invent output text.** `output_description` must be the benchmark's own wording about what the output means (or, if the source gave nothing beyond a generic confirmation instruction, use that literal phrase - don't pad it out). Anything you add to explain the tweak - why a flag was added, why a value defaults to something when absent - goes in `check_command_notes`, a separate field, never blended into `output_description`.

## Validation

Before calling a rule finished, check all of these (a short Python snippet over `json.load()` covers most of it in seconds):

- File parses as JSON.
- Every `output_check[].variable` string literally appears in that step's `check_command`.
- Every non-null `original_command` matches the source document byte-for-byte (aside from the PDF-linebreak-rejoin normalization) - this has been the single most common regression when editing a file after the fact, because it's easy to "clean up" a command while touching something nearby.
- No leftover fields from earlier schema iterations: `notes` (top-level), `derived`, `pass_criterion`, `recommended_state_mode`, `interpreter`, `registry_check`, or a step using the old `command`/`expected_output` names instead of `original_command`/`check_command`/`output_description`. These were all deliberately removed - see "Fields that were tried and removed" below for why, so you don't re-add them.
- Absent-value convention is consistent: `null` for a missing scalar, `[]` for a missing list (never `null` for a list field like `references`).

## Where fidelity broke down before (read this before extracting your first rule)

Every one of these was caught by a second-pass review, meaning it shipped once already and had to be fixed:

- Merging a source note into the wrong field, or duplicating it in two places (once folded into prose, once in a since-removed top-level `notes` array).
- Writing a plausible-sounding `expected_output` / `purpose` string that was never actually in the source - e.g. inventing what a cloud-only compliance check's reasoning "must" be, or paraphrasing a two-sentence source instruction into one invented sentence.
- Silently correcting a source typo while transcribing it, then only noticing on the next review pass.
- Flattening a source's nested placeholder syntax (e.g. writing a simplified range where the benchmark literally used doubled brackets or delimiters).

None of these are exotic mistakes - they're the natural failure mode of moving fast through a lot of similar-looking text. The fix each time was the same: re-read the exact source paragraph immediately before finalizing a field, rather than trusting a summary written a few steps earlier.

## Fields that were tried and removed

These appeared in early iterations of this schema and were deliberately cut - if you're tempted to re-add something like them, read why they didn't survive:

- **`pass_criterion`** (top-level `"deterministic"` / `"organization_defined"`) - duplicated `output_check[].value_source`, which lives at the right granularity (per-check, not per-rule) and is the one an actual generator reads.
- **`recommended_state_mode`** (`"set"` / `"include"`) - duplicated `output_check[].operator` (`"eq"` vs `"contains"`). Kept `recommended_state` itself, though - see `references/schema.md` for why that one field is NOT redundant even though its sibling was.
- **`interpreter`** (`"zsh"` / `"powershell"` per method) - fully derivable from `benchmark.platform`; the target platform's own compliance mechanism fixes the scripting language anyway, so there's no actual choice being recorded.
- **`registry_check`** (a separate object shape for registry-only audits) - collapsed into the same `steps` shape everything else uses, so a consumer only has to handle one pattern instead of two.
- **`related_events`** (a structured `{event_id, description}` array, tried on the Audit Authentication Policy Change rule) - only one rule ever populated it. A structured field only earns its keep if a script generator can read it across many rules; a one-off array that no generator logic touches is just prose wearing a schema costume, and prose belongs in `description` (as a verbatim `\n- ` bullet list, same as any other source bullet list). If a genuinely recurring, cross-rule pattern like this shows up again (e.g. several rules all list associated event IDs), it's worth re-introducing as a proper shared field at that point - not before.

## Don't add a field for one rule

Before introducing a new structured key beyond the general schema, check whether it would appear in more than a handful of rules. A key that only ever holds data for a single rule can't be meaningfully consumed by an automated generator (there's no shared logic to write against it), so it doesn't earn the fidelity/automation split described above - it's just a bullet list with extra ceremony. Fold rule-specific structured-looking data (tables, ID lists, etc.) into the relevant prose field verbatim instead, and only promote it to a real field once the same shape recurs across multiple rules.

## A note on benchmark-specific fields

The schema includes a `cis_controls` field (mapping to CIS's own "CIS Controls" v7/v8 framework with Implementation Group markers). That framework is specific to CIS benchmarks. If you're extracting from a benchmark that maps to a different controls framework (e.g. NIST 800-53, a vendor's own numbering), don't force the data into `cis_controls`' shape - use a field name and structure that honestly reflects what that source provides (something like a generically-named `control_mappings` array with a `framework` field), or omit the field entirely if the source has no equivalent mapping. Check `references/schema.md` for the current shape before deciding.

## Further reading

`references/schema.md` has the full field-by-field reference with annotated pointers to existing rule files for every structural shape seen so far (single scripted check, multi-step with a dependency, organization-defined pass criteria, location-only checks with no source command, "include" vs "set" semantics, pure-manual rules with no script at all). Read it before extracting a rule whose shape doesn't obviously match one you've seen already.
