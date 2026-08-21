# Rule JSON Schema Reference

Field-by-field reference for this project's per-rule JSON files. Read the parent `SKILL.md` first for the *why* behind these choices - this file is the *what*.

## File naming and location

One file per rule, named `rule_<id>_<short-title-slug>.json` (e.g. `rule_12_ensure-example-setting-is-configured.json`) - `id` is the rule's own toolkit-assigned identifier (see "Top level" below), not any framework's numbering, since one rule can map to several frameworks at once. The title slug is a lowercased, hyphenated shortening of `title`, kept short enough to stay scannable; it exists for humans browsing a folder listing and carries no meaning the JSON itself doesn't already state - the filename is never authoritative, `id` inside the file is. The literal `rule_` prefix isn't decoration: the filename is also the source of every variable-name prefix in the rule's `check_command`s (see "Variable naming" below), and an identifier may not begin with a digit in either PowerShell or bash, which a bare `<id>_...` name would. JSON only, no YAML.

**Don't assume a fixed output folder.** The rule files' storage location is a project decision, not part of this schema, and it can change over time. If you need to find existing rules to use as reference examples, search the repo for files matching the naming pattern above rather than assuming a specific directory.

**A leading underscore marks a generated/meta artifact, not a rule.** Any folder holding rule files may also have an `_index.json`, produced by `tools/generate_index.py` - a lightweight per-folder manifest (id/title/status/framework_mappings/policy_classification/organization-defined marker/variables per rule) for tools that need to query many rules without opening every file. Never hand-author or hand-edit it, and don't count it when validating/searching rule files - regenerate it (`python tools/generate_index.py <path>`) after adding, removing, or editing rules in a folder. `baselines/_rule.schema.json` (the machine-checkable version of this doc, see `SKILL.md`'s "Validation" section) follows the same underscore convention and lives at the root of `baselines/` rather than alongside this file - it's a runtime dependency of the project's own tooling (`tools/validate_rules.py`, the pytest suite, the pre-write hook), not documentation for Claude, so it belongs with the data it validates rather than under `.claude/`.

## Top level

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

### Why `recommended_state` survives even though `recommended_state_mode` and `pass_criterion` didn't

For manual-only rules with no `output_check` at all, `recommended_state` is the *only* place the target value is recorded - nothing to be redundant with. For scripted rules, `recommended_state` is the human-facing label for the target value and `output_check.value` is the raw technical value the script actually compares - these are usually two different encodings of the same fact, not two copies of it (e.g. `"Block"` vs `0`, `"Disabled"` vs `0`, `"Enabled"` vs `1`). The one case where they do coincide exactly (an audit-policy rule where both are literally `"Success"`) is a real, acknowledged exception - some settings have no separate raw encoding layer, so the label *is* the check value there.

## `audit`

```json
"audit": {
  "methods": [ /* one entry per audit method the source describes */ ]
}
```

Each method:

| Field | Notes |
|---|---|
| `method_name` | This method's name - the source framework's own name for `licensed_adaptation` rules, or this toolkit's own name for `independent` rules (e.g. `"Graphical Method"`, `"Terminal Method"`, `"Registry Check"`, `"Console Navigation"`, a specific CLI tool name). |
| `type` | `"manual"` or `"scripted"`. |
| `description` | The method's intro prose from source. |
| `notes` | Optional array of strings - callouts that belong to *this specific method*, not the rule as a whole (verbatim from the source for `licensed_adaptation` rules, freshly authored for `independent` rules). |
| `example` | Optional string - a worked example block, verbatim from the source for `licensed_adaptation` rules or freshly authored for `independent` rules. |
| `steps` | Present only for `type: "scripted"` methods. See below. |

A `type: "manual"` method has no `steps` - just `method_name`, `type`, `description`, optionally `notes`.

### `steps` (scripted methods only)

Array, even when there's only one entry - keeps the shape uniform whether a method has 1 command or several.

| Field | Notes |
|---|---|
| `step_role` | `"compliance_check"` (this step's output is itself a pass/fail check) or `"lookup"` (this step's output only feeds the next step - e.g. resolving an identifier before reading the value at that location). A `"lookup"` step has `output_check: []`. |
| `check_command` | Your engineered version: captures one comparable result into a named variable. See SKILL.md's "Designing check_command" for the tweaks this typically involves. |
| `check_command_verified` | `true` if the tweak is a straightforward, high-confidence capture (e.g. a standard registry-property lookup, or removing redundant elevation and assigning to a variable); `false` if you can't be sure of the exact output format without running it (parsing a CLI's structured-report columns, parsing multi-line text with specific whitespace). |
| `output_description` | Follows the same provenance split as the rest of the rule (see `SKILL.md`'s "Content provenance and check_command engineering") - the named source framework's own wording for `licensed_adaptation` rules, or this toolkit's own authored explanation for `independent` rules. |
| `check_command_notes` | Optional. Your own explanation of a non-obvious engineering choice in `check_command` (e.g. why a particular flag or extraction approach was used). Only add this when there's something non-obvious to explain. |
| `output_check` | Array (always an array, even for one check - a single step can produce more than one comparable value). `[]` for lookup steps. |

Each `output_check` entry:

```json
{ "variable": "...", "data_type": "boolean|integer|string", "operator": "eq|ne|gt|gte|lt|lte|contains|like", "value": <target or null>, "value_source": "rule_defined" | "organization_defined" }
```

- `variable` must literally appear inside that step's `check_command` string - this is checked during validation.
- `value: null` + `value_source: "organization_defined"` together mean: this is genuinely checkable, but the pass/fail target has to come from whoever configures the policy, not from this rule's own fixed value.
- `operator: "contains"` shows up for "include" phrasing (e.g. audit-policy Success/Failure flags, where the actual state can hold more than the one required flag without failing compliance).

### Variable naming

Every variable a `check_command` assigns - every `output_check[].variable`, and any intermediate/lookup variable that only feeds a later step - must be prefixed with the rule's own file-slug: the rule's JSON filename without `.json`, lowercased, with every `.` and `-` replaced by `_`. E.g. rule file `rule_12_ensure-example-setting-is-configured.json` gives the prefix `rule_12_ensure_example_setting_is_configured_`. The rest of the name is `snake_case` and descriptive:

```
rule_12_ensure_example_setting_is_configured_retention
rule_12_ensure_example_setting_is_configured_timeout_seconds
```

This shape is identical for PowerShell (`$rule_12_ensure_example_setting_is_configured_retention`) and bash (`rule_12_ensure_example_setting_is_configured_retention`) - one naming convention for both interpreters, not two.

Both folds are load-bearing, and so is the filename's `rule_` prefix: a hyphen is not a legal character in a PowerShell or bash identifier, and neither interpreter accepts an identifier that starts with a digit - which is exactly what a slug derived from a bare `<id>_<title-slug>` filename would do. Keep the file-naming convention and this one in step; a filename that can't produce a legal identifier prefix can't satisfy this rule at all.

**Why:** the eventual generator concatenates the `check_command` of every rule a user selects into one discovery script per platform. A short, generic capture name (`$retention`, `$status`, `$output`) reads fine in isolation but collides the moment two selected rules both use it in the same generated script, silently corrupting whichever check runs second - a real bug caught in an early rule that captured to plain `$retention`. Prefixing with the file-slug costs nothing extra to guarantee, since that slug is already required to be globally unique by the file-naming convention above.

This applies to `audit.methods[].steps[].check_command` only - `remediation` doesn't capture to named variables under its current (older) schema.

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

Note the field names here are the *old* generation (`command`/`expected_output`/`purpose`), not `check_command`/`output_check` - remediation wasn't in scope when the audit section was redesigned. If a future session extends the same rigor to remediation, treat that as a deliberate schema change to discuss, not an oversight to silently "fix" mid-extraction.

## Worked examples of each shape

Bundled copies in `references/examples/` alongside this file - not live pointers into wherever the project currently keeps its rule files, so they won't break if that location moves. Each is a real, complete rule file illustrating one structural shape.

**Keep these in sync with the live ruleset.** "Not a live pointer" means these files are copied, not symlinked - it does NOT mean they're allowed to drift. Whenever a change touches schema, structure, or a documented convention (a field added/removed/renamed, a naming rule like the variable-prefixing convention below, a fidelity fix that changes how a field is populated), update every affected file under `references/examples/` in the same pass, and update this doc's prose to match. A stale example teaches the next session the wrong convention with more authority than prose alone, because it looks like proof by demonstration. The one thing that does NOT need to propagate here is an incidental edit to a live rule that isn't a convention change (e.g. a corrected typo transcribed from a source re-read) - only touch the example if the *shape* it's meant to illustrate changed.

All 8 are deliberately-invented illustrative content (`framework: "example"` throughout) - never real framework rule text - so they can be read, copied, and modified freely without touching anyone's licensed benchmark prose. Each still preserves the specific structural shape its filename names.

**`examples/single-scripted-check.json`** - one registry-property-lookup step; there's no runnable command to preserve from any source, since `check_command` is always this project's own engineering now.

**`examples/multiple-independent-steps.json`** - 3 steps in one method, each independently `check_command_verified: true`.

**`examples/sequential-dependency.json`** - step 1 (`step_role: "lookup"`) resolves an identifier; step 2's `check_command` references that identifier from step 1. Also shows `check_command_verified: false` used honestly - step 2's substitution logic has a genuine unresolved question about the identifier's exact format.

**`examples/organization-defined-single-value.json`** - tagged `assessment_status: "Manual"` despite having a runnable script-based check; `output_check.value_source: "organization_defined"` because the pass/fail target is "matches your organization's requirements," not a fixed value. Shows the tag and the schema fields are independent facts.

**`examples/organization-defined-multi-value.json`** - one step yields two `output_check` entries from a single command's multi-line output; a second step shows a `value_source: "rule_defined"` ceiling (a fixed maximum) that is explicitly *not* the same thing as the organization's actual desired value.

**`examples/include-semantics.json`** - `operator: "contains"` rather than `"eq"`, because the recommended state is "include Success" and a state of "Success and Failure" should still pass.

**`examples/manual-no-script-device-side.json`** and **`examples/manual-no-script-cloud-only.json`** - two different reasons a rule can have no `audit.methods[].steps` at all: the first because the device-side state genuinely can't be read by a script, the second because the setting is evaluated by a cloud service with no local registry/CSP backing to query. Note the second still has a populated `recommended_state` - the value exists, there's just nothing on the device to check it against.
