# Design: an `instructions` language for plain-English checks and fixes

Date: 2026-11-20
Status: Approved 2026-11-20, not yet implemented. Follows CIS plan Task 8.

## Intent

Checks and remediation steps declare a script language (`bash`, `powershell`, `zsh`,
`python`). The CIS ComplianceAsCode import stores CaC's audit procedures, which are plain-English
steps with commands quoted in them, as `language: bash` with no script, so the UI shows a "Bash"
pill on something that is not a bash script (maintainer, 2026-11-20). Some checks and fixes will
always be written guidance, a process or manual steps, and the data should say so.

## Design

- **New language value `instructions`**, valid for checks (`target_check.language`) and
  remediation steps (`remediation_step.language`) in `baselines/_rule.schema.json`, and in the
  web UI's language type and overlay shape. Shown as an "Instructions" pill.
- **Meaning:** plain-English guidance, never a script. The schema enforces it: an `instructions`
  check entry has `shell: null`, no `shell_file` and `result: null`; an `instructions`
  remediation step has `shell: null` and no `shell_file`. The text lives in `additional_info`
  and the UI renders it as prose (with its own code blocks, if any), not as a script.
- **Nothing runs it:** script generation (macOS only today) treats an `instructions` check as
  having no check, so such a rule is never generated or counted as automatable; the display gate
  for ODVs treats `additional_info` with the strict rules, as it does today.
- **No schema version bump:** adding an allowed value leaves all existing data valid (as with the
  `openscap` manual reason).
- **CIS ComplianceAsCode import** (`tools/cac_normalize.py`), then both CIS releases
  regenerated:
  - The audit (`check.Linux`) uses `language: "instructions"` with the OCIL text in
    `additional_info` as today.
  - If none of a recommendation's linked CaC rules has an audit procedure, `check` is `null`
    (no Check section), instead of an entry saying "No audit procedure in ComplianceAsCode".
  - Remediation steps with a CaC bash fix stay `language: "bash"`. A step for a linked rule
    without a fix becomes `language: "instructions"` with the existing "No fix in
    ComplianceAsCode (rule `<id>`)." text.
- **Other sources:** unchanged. Overlays may use `instructions` like any other language.

## Testing

- Schema: `instructions` accepted with no script and no result; rejected with a `shell`,
  `shell_file` or `result`.
- CaC normalize: audit language, `check: null` when no linked rule has OCIL, instructions step
  for a rule without a fix; both CIS releases regenerate and validate.
- Web UI: language label "Instructions"; a rule with an `instructions` check is not
  automatable and not generated; Playwright and screenshots at about 375px and desktop width of
  a CIS rule's Check and Fix sections (`.claude/CLAUDE.md`).

## Progress log

(none yet)
