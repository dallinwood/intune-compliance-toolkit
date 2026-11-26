# Check and remediation type filters - design

Status: approved 2026-11-26 (in conversation).

## Intent

In the rules view, filter rules by the kind of check they have (for example
every rule with a PowerShell check) and, separately, by the kind of
remediation (for example every rule with a configuration profile). The two
filters are independent of each other.

## Goals

- Two new filter groups in the rules sidebar, "Check" and "Remediation",
  each a multi-select facet like Target or Tags.
- A group lists only options that occur in the rules in view (the framework
  page's rules, or every rule on the all-rules page). It never offers an
  option no rule in view has. Options other filters make unreachable fade out
  and a group with nothing to offer is hidden, as every facet already does.
- A third group, "Organization values" (requested alongside), with "Has
  values to set" and "No values to set", from the index's existing `has_odv`.
  Same rules: only options present in the rules in view.
- Kept in the URL like the other filters, cleared by Clear filters, and
  cleared by "Go to this rule" when they would hide the target rule.

## Non-goals

- Filtering by check or remediation per target or per version.
- Any change to the rule files themselves or to the importers' upstream data.

## Approaches

1. **Two derived fields on each index entry (chosen).** The index entry
   already carries `has_odv`, derived from the rule. Add
   `check_types` and `remediation_types`, each a sorted list of distinct
   values. The table never loads full rule files, so the filter must come
   from the index.
2. Load every rule file in the browser. Rejected: about 5,000 requests to
   draw one sidebar.
3. A separate side file per release. Rejected: a second file to keep in step
   with the index for no gain over two fields.

## Design

- `check_types`: the distinct `language` of every check item of every
  target (`bash`, `powershell`, `zsh`, `python`, `registry`, `ansible`,
  `goss`, `instructions`). Empty for a rule without a check.
- `remediation_types`: the distinct `language` of every remediation step plus
  the distinct `kind` of every payload (`mobileconfig`, `ddm`). Empty for a
  rule without a remediation.
- Both are written by `index_entry()` in `tools/library_output.py`, required
  by `_index.schema.json`, and added to every committed index (every release
  of every source) by rebuilding each entry from its committed rule file. No
  upstream re-import; rule files are untouched. The index schema version
  stays 7: the fields are additive and every committed index gains them in
  the same commit.
- Labels reuse the UI's existing names: PowerShell, Bash, zsh, Python,
  Registry, Ansible, goss, Instructions, Configuration profile, DDM
  declaration. An unknown payload kind shows as its code.
- URL parameters `check` and `fix`, repeated per value, like `tag`, and
  `odv` (`yes` / `no`) for Organization values.

## Overlays (builder's call)

Overlays change full rules (check, remediation) but the index only holds the
two derived lists, so an index-level overlay recomputes them like `has_odv`:

- A `check` or `remediation` overlay value adds every language (and payload
  kind) it names to the list, since a plain value merges and a list appends.
- A top-level `$replace` of `check` or `remediation` sets the list to exactly
  what the replacement names.
- A `$replace` nested deeper (one target's steps, say) can only be added to
  the list, not subtracted, because the index does not know the other
  targets' contents. Cost if wrong: a rule could still match a type it no
  longer has. No committed overlay does this; all five only add.

The rule is implemented in both `tools/overlays.py` and
`webui/src/logic/overlays.ts` and pinned by the shared fixture
`tests/fixtures/overlays/cases.json`.
