# CIS content licensing review

**Date:** 2026-08-20
**Status:** Findings recorded, no remediation implemented yet.
**Not legal advice.** This document records a technical/factual review of what
the repo currently contains and how it maps onto CIS's published terms. The
ToU-vs-CC question in particular is not resolved here and should be settled
with CIS directly or with counsel before treating any option below as final.

## The core problem, in one sentence

This is a **public** GitHub repo (`dallinwood/intune-compliance-toolkit`)
licensed **AGPL-3.0**, and the committed rule JSON reproduces substantial
portions of CIS's own copyrighted text (and, per CIS's non-member Terms of
Use, arguably any "derivative work" and any "posting on a website" at all) -
so the AGPL license is purporting to grant re-use/relicensing rights over CIS
content that we don't hold and can't sublicense.

Sources consulted:
- [CIS Terms of Use for Non-Member CIS Products](https://www.cisecurity.org/terms-of-use-for-non-member-cis-products)
- [CC BY-NC-SA 4.0 legal code](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode)

## What's already fine

- `*.pdf` and `baseline-references/` (the source markdown converted from the
  PDFs) are gitignored - the raw benchmark document itself is never
  distributed.
- Registry paths, Settings Catalog paths, MDM CSP URIs, and the
  `learn.microsoft.com` reference links are Microsoft's own public facts and
  documentation, not CIS's expression - no issue there.
- Where the tooling clearly adds original work beyond what CIS wrote (e.g. a
  `check_command_notes` explaining "CIS only describes the registry paths,
  not a script" - see `baselines/cis/windows_11/v5.0.0/cis_intune_win11_1.1.json`),
  that's original expression, not CIS's.

## What's a real concern

The per-rule JSON reproduces CIS's own written prose, near-verbatim, in
several required fields:

| Field | Example | Issue |
|---|---|---|
| `description`, `rationale`, `impact`, `default_value` | every rule | CIS's own explanatory prose, copied essentially verbatim |
| `audit.methods[].original_command` | `baselines/cis/macos_26_tahoe/v1.1.0/cis_macos26_2.1.1.1.json` | literal verbatim copy of CIS's audit script - the clearest cut-and-dried copy |
| `extended_attributes.cis.grid_id`, `cis_controls[].control_title` | every rule | CIS's own internal ID/mapping taxonomy, reproduced wholesale rather than cited |
| `audit.methods[].description`, `remediation.methods[].description`, `method_name`, `output_description` | most rules | often paraphrased-but-close narration of CIS's audit/remediation procedure |
| `title` | every rule | CIS's own recommendation title text |

This isn't confined to `baselines/`: the skill's example files under
`.claude/skills/compliance-benchmark-json/references/examples/*.json` (e.g.
`single-scripted-check.json`) use real CIS rule text as illustrations, and
the generated `_index.json` / manifest output duplicate `title` again. All of
it is tracked and public.

## The two license layers - and why we don't need to resolve which one governs

CIS's non-member Terms of Use (contractual) says non-members may not post
any "Non-Member CIS Product" on a website or create "any derivative work
based directly on" one - full stop, regardless of attribution. Separately,
CIS also releases the Benchmark PDFs under CC BY-NC-SA 4.0, which *does*
permit adaptation, but only if the adaptation is (a) attributed, (b)
non-commercial, and (c) shared under CC BY-NC-SA or a "compatible" license -
and AGPL is not on CC's compatible-license list, so relicensing an adaptation
as AGPL breaks ShareAlike even under the more permissive reading.

Which document actually controls (or whether they're meant to layer) is not
resolved here. The useful property is that we don't have to resolve it: the
fix that's correct under the strict ToU reading (no CIS content in a public
repo at all) is a strict subset of what's correct under the permissive CC
reading (adapted CIS content republished under CC BY-NC-SA, attributed). So
the recommendation below leads with the stricter fix.

## Recommended fix: keep CIS narrative text out of the distributed repo entirely

Extend the pattern already used for the PDFs. Split each rule into:

- **Toolkit-authored fields** (public, AGPL, in `baselines/`): `id`,
  `benchmark`, `profile_applicability`, `recommended_state`,
  `audit.methods[].steps[].check_command` (our own scripting), `remediation`
  config keys/steps, `references`, `variables` - the functional automation
  logic that's original work.
- **Benchmark-sourced narrative fields** (`title`, `description`,
  `rationale`, `impact`, `default_value`, `original_command`, `grid_id`,
  `cis_controls[].control_title`): moved into a gitignored sidecar file per
  rule (e.g. `cis_intune_win11_1.1.cis-text.json`), populated by each user
  from their own licensed copy of the Benchmark - the same "bring your own
  copyrighted source" pattern already used for the PDF. Merged at load time;
  `scripts/copy-baselines.mjs` and the web UI need a defined empty state when
  the sidecar is absent so the tool stays functional without it.
- The `cis_controls` mapping specifically is easiest handled as a short
  citation (e.g. `"CIS Controls v8: 4.8"`) rather than reproducing
  `control_title` text.

This requires a schema change (the sidecar fields are currently
required/non-nullable in `baselines/_rule.schema.json`), and touches four
locations, not just `baselines/`: the skill's example files,
`.claude/skills/compliance-benchmark-json/references/schema.md`, and the
generated `_index.json` / manifest output.

## Open decisions (not made yet)

- **Published git history.** Stripping HEAD doesn't unpublish the CIS prose
  already sitting in the repo's existing commits. At the current rule count
  (~12 files) this is a cheap history rewrite; it won't be once the dataset
  grows. Needs an explicit decision before any history-rewriting operation
  is run.
- **Commercial use.** If this toolkit is ever used in a paid client
  engagement, CC's NonCommercial clause (and probably CIS's ToU) is
  implicated independent of anything in the repo itself.
- **CIS SecureSuite membership.** Membership may loosen redistribution or
  derivative-work rights, but the member terms haven't been reviewed - worth
  asking CIS directly if broader distribution is the goal.

## Status

No remediation has been implemented as of this writing. This document
records the findings so the decision and follow-up work can be picked up
later without re-deriving the analysis.
