# Rule JSON Schema Reference

Field-by-field reference for this project's per-rule JSON files. Read the parent `SKILL.md` first for the *why* behind these choices - this file is the *what*.

## File naming and location

One file per rule, named `<benchmark-slug>_<platform-slug>_<rule-id>.json` (e.g. the initial CIS macOS and Intune rules used `cis_macos26_2.3.3.4.json`, `cis_intune_win11_4.11.15.3.1.json` - the `cis_` prefix reflects that specific source, not a fixed convention; a non-CIS source should use its own slug instead). JSON only, no YAML.

**Don't assume a fixed output folder.** The rule files' storage location is a project decision, not part of this schema, and it can change over time. If you need to find existing rules to use as reference examples, search the repo for files matching the naming pattern above rather than assuming a specific directory.

## Top level

| Field | Type | Notes |
|---|---|---|
| `id` | string | The benchmark's own section/rule number, verbatim (e.g. `"4.11.15.3.1"`, `"106.1.1"`). Always a string - some IDs aren't semantically numeric. |
| `title` | string | The recommendation title, without a trailing status tag like `(Automated)`/`(Manual)`. |
| `assessment_status` | `"Automated"` \| `"Manual"` | The tag the benchmark itself gives the rule, if it uses this convention. Does **not** always agree with whether a scripted check exists - see the iCloud Keychain example below. |
| `benchmark` | object | `{ product, version, platform }` - identifies which benchmark document and which platform this rule targets. No `source_file` path (removed - product/version already identifies it, and file paths move). |
| `profile_applicability` | array of strings | Raw strings from source, e.g. `["Level 1"]`, `["Level 1 (L1)"]`, `["BitLocker (BL)"]`. Don't parse profile codes out - keep them as the source wrote them, since not every benchmark follows the same code scheme. |
| `recommended_state` | string \| null | The benchmark's own label for the target value (e.g. `"Block"`, `"Disabled"`, `"Success"`). `null` when the rule is organization-defined with no fixed target, or when the source never phrases a single recommended value. **Not redundant** with `output_check.value` even when a check exists - see below. |
| `description`, `rationale`, `impact` | string | Verbatim source prose. Multi-paragraph text uses `\n\n` between paragraphs; embedded bullet lists use `\n- ` per item, in the same string. Any source note/callout that appeared under the same heading gets folded into this same string. |
| `audit` | object | See below. |
| `remediation` | object | See below. Out of scope for the `check_command`/`output_check` redesign - remediation steps still use an older `command` / `expected_output` / `purpose` shape, since remediation is an action, not a compliance check. |
| `default_value` | string \| null | The source's stated default, when given. |
| `references` | array of strings | URLs only. `[]` if none (never `null`). Cross-reference metadata that shows up inside a source reference list but isn't actually a URL (a control-mapping ID, a minimum-platform-version note, etc.) should be pulled into its own field instead of left in this array. |
| `grid_id`, `minimum_os_csp` | string \| null | Metadata specific to the CIS Intune-for-Windows benchmark (a CIS tracking ID and a minimum-CSP-version note), extracted out of the References list when present. Treat these as an example of "pull benchmark-specific metadata into its own named field" rather than as universal fields every benchmark will populate - a different source may have different reference-list metadata worth extracting the same way, under different field names. |
| `additional_information` | string \| object \| null | Free text, or a light structure when the source itself is structured. Only present when the source has an equivalent section. |
| `cis_controls` | array | See "A note on benchmark-specific fields" in `SKILL.md` - this maps to CIS's own Controls v7/v8 framework specifically and may not apply to non-CIS sources. |

### Why `recommended_state` survives even though `recommended_state_mode` and `pass_criterion` didn't

For manual-only rules with no `output_check` at all, `recommended_state` is the *only* place the target value is recorded - nothing to be redundant with. For scripted rules, `recommended_state` is the benchmark's human-facing label and `output_check.value` is the raw technical value the script actually compares - these are usually two different encodings of the same fact, not two copies of it (e.g. `"Block"` vs `0`, `"Disabled"` vs `0`, `"Enabled"` vs `1`). The one case where they do coincide exactly (an audit-policy rule where both are literally `"Success"`) is a real, acknowledged exception - some settings have no separate raw encoding layer, so the label *is* the check value there.

## `audit`

```json
"audit": {
  "methods": [ /* one entry per audit method the source describes */ ]
}
```

Each method:

| Field | Notes |
|---|---|
| `method_name` | The source's own name for the method (e.g. `"Graphical Method"`, `"Terminal Method"`, `"Registry Check"`, `"Console Navigation"`, a specific CLI tool name). |
| `type` | `"manual"` or `"scripted"`. |
| `description` | The method's intro prose from source. |
| `notes` | Optional array of strings - verbatim source callouts that belong to *this specific method*, not the rule as a whole. |
| `example` | Optional string - a worked example block from source, kept verbatim. |
| `steps` | Present only for `type: "scripted"` methods. See below. |

A `type: "manual"` method has no `steps` - just `method_name`, `type`, `description`, optionally `notes`.

### `steps` (scripted methods only)

Array, even when there's only one entry - keeps the shape uniform whether a method has 1 command or several.

| Field | Notes |
|---|---|
| `step_role` | `"compliance_check"` (this step's output is itself a pass/fail check) or `"lookup"` (this step's output only feeds the next step - e.g. resolving an identifier before reading the value at that location). A `"lookup"` step has `output_check: []`. |
| `original_command` | The command **exactly as the source wrote it**, or `null` if the source gave no runnable command at all (common for setting/registry-backed rules that only state a location and expected value). Must match source byte-for-byte aside from PDF-linebreak-rejoining. |
| `check_command` | Your engineered version: captures one comparable result into a named variable. See SKILL.md's "Designing check_command" for the tweaks this typically involves. |
| `check_command_verified` | `true` if the tweak is a straightforward, high-confidence capture (e.g. a standard registry-property lookup, or removing redundant elevation and assigning to a variable); `false` if you can't be sure of the exact output format without running it (parsing a CLI's structured-report columns, parsing multi-line text with specific whitespace). |
| `output_description` | The benchmark's own text about what the output means / should be. Raw source wording - if the source gave nothing beyond a generic confirmation instruction, use that literal phrase rather than writing something more specific yourself. |
| `check_command_notes` | Optional. Your own explanation of *why* `check_command` differs from `original_command` (or why there's no `original_command` at all). Only add this when there's something non-obvious to explain - a near-verbatim variable capture doesn't need one. Never merge this reasoning into `output_description`. |
| `output_check` | Array (always an array, even for one check - a single step can produce more than one comparable value). `[]` for lookup steps. |

Each `output_check` entry:

```json
{ "variable": "...", "data_type": "boolean|integer|string", "operator": "eq|ne|gt|gte|lt|lte|contains|like", "value": <target or null>, "value_source": "benchmark" | "organization_defined" }
```

- `variable` must literally appear inside that step's `check_command` string - this is checked during validation.
- `value: null` + `value_source: "organization_defined"` together mean: this is genuinely checkable, but the pass/fail target has to come from whoever configures the policy, not from the benchmark.
- `operator: "contains"` shows up for "include" phrasing (e.g. audit-policy Success/Failure flags, where the actual state can hold more than the one required flag without failing compliance).

## `remediation`

Lighter schema, not (yet) redesigned to match `audit`'s steps shape:

```json
"remediation": {
  "methods": [
    {
      "method_name": "...",
      "type": "configuration_profile" | "manual_steps" | "scripted",
      "description": "...",
      "config_keys": [ { "payload_type": "...", "key": "...", "value": "..." } ],   // e.g. macOS profile-based
      // or, e.g. Windows:
      "config_keys": [ { "settings_catalog_path": "...", "value": "..." } ],
      // or, for a scripted remediation:
      "steps": [ { "command": "...", "expected_output": "...", "result_note": "...", "purpose": "..." } ],
      "notes": [ "..." ]
    }
  ]
}
```

Note the field names here are the *old* generation (`command`/`expected_output`/`purpose`), not `original_command`/`check_command`/`output_check` - remediation wasn't in scope when the audit section was redesigned. If a future session extends the same rigor to remediation, treat that as a deliberate schema change to discuss, not an oversight to silently "fix" mid-extraction.

## Worked examples of each shape

Frozen snapshots bundled in `references/examples/` alongside this file - not live pointers into wherever the project currently keeps its rule files, so they won't go stale if that location moves or the rules themselves get further edited. Each is a real, complete rule file illustrating one structural shape.

**`examples/single-scripted-check.json`** (LSASS SSP/AP) - one registry-property-lookup step, `original_command: null` since the source gave only a registry path, no runnable command.

**`examples/multiple-independent-steps.json`** (Remote Login) - 3 steps in one method, each mapping 1:1 to a separate command the source gave, each independently `check_command_verified: true`.

**`examples/sequential-dependency.json`** (Cortana Above Lock) - step 1 (`step_role: "lookup"`) resolves an identifier; step 2's `check_command` references that identifier from step 1. Also shows `check_command_verified: false` used honestly - step 2's substitution logic has a genuine unresolved question about the identifier's exact format.

**`examples/organization-defined-single-value.json`** (iCloud Keychain) - tagged `assessment_status: "Manual"` in source despite having a runnable script-based check; `output_check.value_source: "organization_defined"` because the pass/fail target is "matches your organization's requirements," not a fixed value. Shows the tag and the schema fields are independent facts.

**`examples/organization-defined-multi-value.json`** (Touch ID) - one step yields two `output_check` entries from a single command's multi-line output; a second step shows a `value_source: "benchmark"` ceiling (172800, the OS-enforced max) that is explicitly *not* the same thing as the organization's actual desired value.

**`examples/include-semantics.json`** (Audit Authentication Policy Change) - `operator: "contains"` rather than `"eq"`, because the recommended state is "include Success" and a state of "Success and Failure" should still pass.

**`examples/manual-no-script-device-side.json`** (Security Keys) and **`examples/manual-no-script-cloud-only.json`** (BitLocker Device Health) - two different reasons a rule can have no `audit.methods[].steps` at all: the first because the device-side state genuinely can't be read by a script, the second because the setting is evaluated by a cloud service with no local registry/CSP backing to query. Note the second still has a populated `recommended_state` - the value exists, there's just nothing on the device to check it against.
