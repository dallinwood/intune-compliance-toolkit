# Design: several checks per platform

Date: 2026-11-20
Status: Approved 2026-11-20, not yet implemented. Prerequisite for the Windows CIS (ansible-lockdown) design.

## Intent

A rule's `check` holds one entry per platform (`check[target]` = one language, a default and
per-version variants), while `remediation[target].steps` is already a list of steps, each with
its own language. The maintainer wants checks to work the same way (2026-11-20): a rule can show,
for one platform, a PowerShell check, a registry check, the original Ansible or goss test, a
Python check, and so on, side by side. All frameworks move to the new shape.

## Goals and non-goals

- Goal: `check[target]` is a list of check items; every source and every committed release uses
  it; behaviour of existing rules is unchanged (each becomes a one-item list).
- Goal: the toolkit picks the check it runs predictably when there are several.
- Non-goal: new languages (`ansible`, `goss`) and the Windows import; they come with the Windows
  design.
- Anti-goal: two shapes (single check and list) living side by side.

## Design

### Rule format (schema version 7)

`check` stays `null` or an object keyed by target, but each value becomes a non-empty array of
check items. A check item is today's `target_check` plus an optional `name`:

| Field | Meaning |
|---|---|
| `name` | short label for the item, e.g. "Registry check", "Original goss test"; `null` when the language says enough |
| `language`, `default`, `by_version` | exactly as today, including the `instructions` constraints |

The rule `schema_version` goes from 6 to 7 (`tools/library_output.SCHEMA_VERSION`, the index
schema follows it as before, and `webui/src/types/library.ts`). Every committed release of every
source is regenerated; a rule's existing check becomes a one-item list with `name: null`.

### Which check runs

Script generation (macOS only today) runs the **first** item, in list order, whose language the
generator supports for that target (`bash` or `zsh` on macOS). Importers put the item they want
run first. Items in other languages are shown, never run. The ODV substitution mode, the
supporting-check logic and the generated plan all use that chosen item, exactly as they use the
single check today. A rule counts as automatable in the UI when it has such an item; the stored
`assessment` is still set by each importer as today.

### Everything that reads checks

Python: the schema, every normalizer (`mscp`, `cac`; ASD and NIST emit `check: null`),
`tools/odv_placeholders.py` (all items' shells and `shell_file`s), `tools/file_references.py`
(every item's `shell_file`), `tools/overlays.py` and `tools/validate_library.py`.

Web UI: types, `checkPlan.ts` (choosing the item), `odv.ts` (mode from the chosen item),
`chunking.ts`, supporting checks, `manualAttestationReport.ts` (all items' `additional_info`),
`rulesJsonGen.ts`, `changeLabels.ts` and `ruleChanges.ts` (paths gain an item index; the label
names the item only when a rule has more than one, e.g. "Check 2 · Windows"), `overlays.ts` and
`overlayShape.ts`, and `RuleCheckSection.tsx`, which shows one selectable item per check (the
item's `name`, else its language label), the way the Remediation section shows steps.

### Overlays

`check` per target is a list: an overlay may `$replace` a target's list or `$append` items to it
(useful for adding a check of its own); `$merge` into a list stays invalid, as for any list. No
committed overlay sets `check`, so nothing is migrated. Overlaid rules keep getting the
placeholder and quoting checks in CI.

## Testing

- Python: schema accepts a list and rejects an empty list or a bare object; every normalizer
  emits lists; placeholder and file-reference checks cover every item; overlays `$append` a
  check item; the committed-library tests regenerate every release under schema 7.
- Web UI: choosing the first runnable item; change labels with one and with two items; Rule
  detail shows two check items for a rule given a second item by a route in an e2e spec (no
  committed rule has two yet); the existing mSCP generation e2e passes unchanged.
- Screenshots of a check section with one item and with two, at about 375px and desktop width.

## Progress log

(none yet)
