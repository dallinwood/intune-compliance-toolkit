# Design: maintainer-authored custom overlays on imported rules

Date: 2026-10-23
Status: Approved 2026-10-23

## 1. Intent

Imported rules (NIST mSCP, ASD ISM, and later sources) are regenerated
from upstream on every release and must never be hand-edited. The
maintainer still needs to add knowledge upstream doesn't have. For
example:
- a check for ISM-1622 ("PowerShell is configured to use Constrained
  Language Mode");
- a missing description;
- extra references.

These additions must survive every re-import.

An **overlay** is a small JSON file, written by the maintainer, that
targets one or more imported rules by id and adds or replaces fields on
them. The web UI loads the overlays and applies them to the raw rules as
they are displayed. The repo's imported data is never changed by an
overlay.

## 2. Goals, non-goals, anti-goals

### Goals

- Overlays live in their own folder, separate from imported data, and are
  published with the site.
- One overlay can target many rules across sources (for example an mSCP
  rule and an ISM rule that the same content applies to).
- Any rule field can be overlaid. The merge rules are:
  - lists append;
  - single values replace;
  - objects merge key by key;
  - an explicit wrapper (`$replace`, `$append`, `$merge`) overrides the
    default.
- Each target records the source release the overlay was written
  against. When the loaded rule comes from a different release, the
  overlaid content shows a "written for an older release" note.
- Overlaid fields carry a small **Custom** tag in the rule detail panel.
  Otherwise the overlaid data simply is the rule's data in every view:
  table, filters, counts, detail panel and generated bundles.
- A new upstream import needs no overlay changes, unless upstream
  removes or renames a targeted rule.

### Non-goals (for now)

- Script generation for overlaid checks, including Windows and
  PowerShell bundles. An overlay may carry a `check`, but making the
  generator use it for non-macOS targets is separate later work.
- User-authored overlays in the browser. Overlays are maintainer files
  in the repo only.
- A row badge, filter or other table-level indicator of overlaid rules
  (maintainer chose the light touch).

### Anti-goals

- Writing overlay content into `baselines/` or `sources/`, or any merge
  step that changes imported data in the repo.
- An overlay error that breaks the whole UI. A bad overlay is skipped
  with a visible warning; the raw rules still display.
- Silently showing overlaid content as if upstream wrote it. Every
  overlaid field is tagged.

## 3. Overlay files

### 3.1 Location and publishing

- **Source location:** `overlays/<name>.json` at the repo root, hand
  edited.
- **Publishing:** `scripts/copy-baselines.mjs` (renamed or extended) also
  copies `overlays/` to `webui/public/overlays/`, and writes
  `webui/public/overlays/_manifest.json`. The manifest lists the overlay
  file names in sorted order, because a static site cannot list a
  directory. It is generated at build time and never committed; the
  maintainer only writes the overlay files themselves.
- **Missing folder:** if `overlays/` is missing or empty, the manifest is
  an empty list and the UI behaves exactly as today.

### 3.2 Format

```jsonc
{
  "schema_version": 1,
  "id": "powershell-constrained-language-mode",   // unique; ^[a-z0-9][a-z0-9-]*$
  "description": "Adds guidance for PowerShell Constrained Language Mode.",  // optional, shown nowhere yet
  "targets": [
    { "rule": "asd_ism.ism-1622", "release": "v2026.09.4" }
  ],
  "fields": {
    "discussion": { "$replace": "Constrained Language Mode limits ..." },
    "references": { "microsoft": ["https://learn.microsoft.com/..."] },
    "tags": ["powershell"]
  }
}
```

- **`targets`:** a non-empty list.
  - `rule` is a full rule id (`<source>.<upstream id>`).
  - `release` is the source's `release_tag` the overlay was written
    against, compared with the loaded rule's `source.release_tag`.
- **`fields`:** the overlay content, keyed by v4 rule field names. It
  applies identically to every target.
- **Different content per rule** means separate overlay files.

### 3.3 Merge semantics

The overlay is applied to a rule object (the full rule file, or an index
entry; see section 4). For each key in `fields`:

| Overlay value | Upstream value | Result |
|---|---|---|
| list | list or absent | upstream entries, then overlay entries (append) |
| string, number, boolean, `null` | anything | overlay value (replace) |
| object (not a wrapper) | object or absent | merged key by key, recursively, by these same rules |
| `{ "$replace": v }` | anything | `v` |
| `{ "$append": [..] }` | list or absent | append (explicit) |
| `{ "$merge": {..} }` | object or absent | key-by-key merge (explicit) |

- **Wrapper objects** have exactly one key, and it starts with `$`. An
  object with any other `$` key is invalid.
- **Type mismatches** are invalid. For example, `$append` onto a string,
  or a list overlaid onto an object.
- **Append and duplicates:** appending does not de-duplicate. Whatever is
  written is what you get.
- **Several overlays on one rule** apply in manifest order, which is file
  name order, so the later one wins for single values. Both the UI and
  the Python check use this order. (My call; final.)
- **Protected fields:** `id`, `source`, `file` and `schema_version` may
  not be overlaid. An overlay that sets any of them is invalid (a CI
  failure, and skipped in the UI), because changing them would break
  selection keys and target lookup.
- **No derived assessment:** adding a `check` does not change
  `assessment`. A rule stays manual until the overlay also sets
  `assessment` (maintainer decision). This keeps an overlaid ISM-1622
  check from moving the rule out of the attestation report and blocking
  generation while non-macOS generation does not exist.

### 3.4 Validation

There are two layers. Neither one blocks the raw data.

- **CI** (`python -m pytest`, new `tests/test_overlays.py`) checks every
  `overlays/*.json`:
  - **Structure:** the file shape (section 3.2) is valid and `id`s are
    unique.
  - **Targets:** every `rule` exists in the committed library. A missing
    target is a test failure, because it is how an upstream removal or
    rename surfaces.
  - **Merge result:** merging onto each target and validating against the
    rule schema succeeds, after unknown keys are dropped. The overlaid
    index entry for each target also validates against the index schema.
  - **Unknown keys:** a key that isn't a v4 rule field (top-level or
    nested where the schema closes objects) is printed as a **warning**
    and is not a failure.
  - **Collisions:** two overlays setting the same single-value field on
    the same rule produce a warning.
- **The UI** runs the same structural and type checks at load. It uses
  a hand-written check of the overlay shape and the merge type rules, not
  a JSON Schema library (no new dependency); full rule-schema validation
  is CI's job:
  - an overlay that fails is skipped entirely, with a warning in the
    existing notice area (as for a broken vocabulary file);
  - an unknown key is ignored;
  - a missing target rule is ignored for that target only.

## 4. Applying overlays in the web UI

- **Load order:** at startup, after the manifest and indexes, fetch
  `overlays/_manifest.json` and each listed file in parallel. Overlay
  files are small; the total is expected to stay in the kilobytes.
- **Index entries:** each overlay is applied to the matching index
  entries before rows are built. Table, filters, counts, URL state and
  search therefore see overlaid values, for the fields an index entry
  has: title, assessment, applicability, section_path, tags and so on.
  These index fields are copies of the rule fields in the same shape, so
  the same merge applies. Only the derived fields are recomputed after
  merging: `section = section_path[0]` and `has_odv = odv !== null`
  (using the overlaid `odv` when the overlay sets one).
- **Rule detail:** when a rule file is fetched, the same overlays are
  applied to the full rule, so the detail panel, the generator input and
  the attestation report all see the overlaid rule.
- **Provenance:** the applier returns the merged rule plus a provenance
  map, `fieldPath -> { overlayId, release, stale }`, recorded at the
  top-level field (for example `discussion`, `references`). `stale` is
  `target.release !== the rule's release`. The rule's release is the
  manifest source's `release_tag` for index rows and the rule's
  `source.release_tag` in the detail panel (they are equal). Release tags
  are compared as plain strings.
- **Display:**
  - Every detail-panel section whose field is in the provenance map gets
    a small **Custom** tag next to its heading (and for `title`, next to
    the title).
  - Overlaid fields with no section of their own in the panel (for
    example `tags`, `architecture`) are listed in one line, "Custom:
    tags, architecture", so every overlaid field is visibly tagged.
  - Each stale overlay on the rule gets its own note line at the top of
    the panel: "Custom content ({overlay id}) was written for {source
    label} {overlay release}; this rule is from {current release}.
    Review it for accuracy."
  - Nothing changes in the table.
- **Purity:** the merge function is a pure, unit-tested module
  (`webui/src/logic/overlays.ts`). The Python CI check has its own small
  copy of the merge rules (`tools/overlays.py`), tested against shared
  fixture cases in `tests/fixtures/overlays/` so the two cannot drift.

## 5. Effect on existing behaviour

- **No overlays:** identical to today.
- **Overlaid assessment or check:** an overlay that changes `assessment`
  or adds a `check` changes what the generator does for macOS rules,
  because it sees the overlaid rule. For non-macOS checks the generator
  is unchanged (non-goal). An overlaid automated rule on a non-macOS
  target is reported by the existing "cannot generate" path, not crashed
  on.
- **Saved selections and URL state** are keyed by rule id and are
  unaffected.

## 6. Left to the builder

- The exact Custom tag and stale note styling, within "small" and
  consistent with existing badges.
- Whether the copy script is extended or a sibling script is added.
- The internal shape of the provenance map, beyond section 4.

## Progress log

- 2026-10-23: Design drafted from the brainstorming session (no code yet).
- 2026-10-23: Builder-check answers folded in (protected fields, no derived assessment, index recompute, Custom line, per-overlay stale notes); approved by the maintainer.
