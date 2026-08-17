# Intune Compliance Toolkit — Web UI (MVP Plan)

## Context

The repo currently holds a growing library of per-rule CIS compliance JSON
files under `baselines/<family>/<product>/<version>/*.json` (macOS 26 Tahoe
and Windows 11 today, more benchmarks to be added over time), each validated
against `baselines/_rule.schema.json` and summarized by an auto-generated
`_index.json` per folder. This is currently a pure Python/JSON authoring
toolkit with no consumer-facing product — the rules exist, but there's no way
for an admin to browse them, pick which ones they want to enforce, or turn a
selection into something Intune can actually ingest.

The goal of this plan is a static, serverless web UI (hosted as a GitHub
Page from this repo) that lets an admin browse/filter the rule library,
select and configure the rules they want, save that selection locally,
export/import it as a portable file, and generate Intune-ready custom
compliance bundles (discovery script + rules JSON) for Windows and macOS —
correctly chunked to respect Intune's hard limits per policy. Direct
upload to Intune via Graph API and a live compliance dashboard are explicitly
deferred to later phases; this plan scopes the MVP only, with those noted
briefly at the end for future sessions to pick up.

This is a plan-only session — no code is written yet. It is meant to be
committed and iterated on across future sessions.

## Confirmed decisions

- **Stack**: React + TypeScript + Vite, in a new top-level `webui/` folder,
  fully decoupled from the Python toolchain (own `package.json`, own
  `node_modules`, no runtime dependency either direction).
- **MVP scope**: download-only. Generated bundles are packaged as a `.zip`
  the admin downloads and uploads to Intune themselves. Direct Microsoft
  Graph API upload (Entra app registration, MSAL.js, admin consent) is
  **Phase 2**, not built now.
- **Deployment**: GitHub Actions builds on push and deploys to GitHub Pages
  via `actions/deploy-pages`. No compiled output is committed to the repo.
- **Package manager/runtime**: Bun, not npm/Node - the dev machine this was
  built on has Bun but no Node.js/npm installed at all. Bun is a drop-in,
  Node-compatible runtime and package manager, so this doesn't change
  anything architecturally, but every command in this doc (`bun install`,
  `bun run dev`/`build`/`test`) assumes Bun, and CI should use
  `oven-sh/setup-bun` rather than `actions/setup-node`.
- **Manual-but-scriptable rules**: "automatable" is a single computed fact —
  does the rule have a scripted audit method with a non-empty
  `output_check`? — independent of CIS's own `assessment_status` label.
  This is computed once, at index-generation time in `tools/generate_index.py`
  (not client-side), so `_index.json`'s `assessment_status` field itself
  becomes the computed value and the UI/generator can filter and gate on it
  directly from the index, with no full-rule fetch required. CIS's original
  label is preserved alongside it under a new field so it isn't lost. See
  "Index generation rework" below. (Verified against real data:
  `cis_macos26_2.1.1.1.json` is source-labeled `assessment_status: "Manual"`
  yet has a fully verified scripted check — under the new rule it indexes as
  `"Automated"`.)

## Reference: Intune custom compliance mechanics

Source: https://www.ssmacadmin.com/posts/2026-08-02-macos-custom-compliance-intune/
(corrects gaps in Microsoft's own docs — worth re-checking at implementation
time in case Microsoft's docs are fixed by then).

- A platform-specific discovery script (bash for macOS, PowerShell for
  Windows) must emit a **single-line JSON object** on stdout: unquoted
  booleans/numbers, quoted strings, UTF-8 no BOM, exit 0 on success.
- A sibling **compliance rules JSON** is uploaded alongside it:
  `{"Rules": [{SettingName, Operator, DataType, Operand, MoreInfoUrl,
  RemediationStrings: [{Language, Title, Description}]}, ...]}`.
  `SettingName` must exactly, case-sensitively match a JSON key emitted by
  the script.
- **Hard limits per policy**: max 100 rules, max 100 KB rules-JSON, max 1 MB
  script, max 1 MB script output, 10-minute execution timeout, exactly one
  script per policy. This is why generated bundles must be chunked.

This repo's schema already lines up with this mechanism almost exactly:
`output_check.variable` → `SettingName`, `operator`/`value`/`data_type` →
`Operator`/`Operand`/`DataType`.

## Repo layout for the new app

```
webui/                              # new, self-contained package (Bun)
├── package.json / tsconfig.json / vite.config.ts / index.html
├── public/                         # static assets only (favicon etc.)
├── src/
│   ├── main.tsx / App.tsx
│   ├── types/                      # rule.ts, index-manifest.ts, selection.ts
│   ├── data/                       # manifest.ts, ruleIndex.ts, ruleDetail.ts
│   │                                 (fetch + in-memory cache, no library)
│   ├── state/                      # filterStore.ts, selectionStore.ts (Zustand),
│   │                                 persistence.ts (localStorage read/write)
│   ├── logic/                      # NOT "lib/" - the repo's root .gitignore
│   │   │                             already ignores any folder literally named
│   │   │                             lib/ (Python venv convention), which
│   │   │                             silently swallowed this in practice
│   │   ├── naturalId.ts            # dotted-id comparator + top-level-section extraction
│   │   ├── chunking.ts             # grouping/packing algorithm (pure, unit-tested)
│   │   ├── operatorMap.ts          # eq/ne/gt/gte/lt/lte/contains/like -> Intune Operator
│   │   ├── scriptGen/{bash,powershell}.ts
│   │   ├── rulesJsonGen.ts         # builds the sibling Rules[] JSON per chunk
│   │   ├── zipBundle.ts            # fflate wrapper -> downloadable .zip
│   │   └── exportImport.ts         # settings-file (de)serialization + validation
│   └── components/                 # layout, filters, rules, selection, generate
└── (Vitest tests colocated, e.g. naturalId.test.ts next to naturalId.ts)
scripts/copy-baselines.mjs          # prebuild: copies ../baselines -> webui/public/baselines
tools/generate_manifest.py          # new sibling to generate_index.py
.github/workflows/deploy-pages.yml  # new
```

`webui/` never depends on Python at runtime; the only coupling is a
build-time copy of `baselines/` into the built site (see below).

## Index generation rework (`tools/generate_index.py`)

Today `rule_summary()` copies `assessment_status` straight from the rule
JSON — CIS's own "Automated"/"Manual" label. That label reflects CIS's
judgment about the benchmark check in general, not whether *this repo* has
actually engineered a working scripted check for it — real data already
diverges (`cis_macos26_2.1.1.1.json` is labeled "Manual" but has a fully
verified scripted `output_check`). Since the whole point of the index is to
let the UI filter/gate on automatability without opening every rule file,
the index needs to report the fact that actually matters: can this repo
generate a script for it.

Change `rule_summary()` to compute, not copy:

```python
def is_automated(rule):
    """True if at least one scripted audit method has a real compliance
    check attached - i.e. this repo can generate a script for it,
    regardless of what the benchmark itself calls the assessment method.
    """
    return any(
        method.get("type") == "scripted"
        and any(step.get("output_check") for step in method.get("steps", []))
        for method in rule.get("audit", {}).get("methods", [])
    )
```

- `_index.json`'s `assessment_status` field becomes `"Automated"` /
  `"Manual"` based on `is_automated(rule)` — this is what the UI's
  automatable filter and the chunking algorithm's eligibility check both
  read directly, with **no full-rule fetch needed** to know whether a rule
  can go into a generated script.
- Add a new `source_assessment_status` field carrying the original,
  unmodified label from the rule JSON, so CIS's own classification isn't
  lost — the UI can still show it as a secondary/informational badge
  straight from the index, without fetching the full rule for it.
- This changes the meaning of an existing, already-consumed field name.
  Update `tools/generate_index.py`'s module docstring and
  `tests/test_generate_index.py` to assert the new computed semantics
  (including a case built from the real Manual+scripted example proving
  the override), and regenerate every committed `_index.json` in the same
  change so nothing in the repo is left stale.
- Downstream effect: the "Manual-but-scriptable" eligibility check in the
  chunking algorithm (see below) can now short-circuit off
  `_index.json.assessment_status == "Automated"` before ever fetching full
  rule JSON — full JSON is still fetched for `GENERATABLE` selections to
  build the actual script/rules-JSON content, but the eligibility split
  itself is index-only.

## Runtime discovery of baseline data (no server, no directory listing)

- **New `tools/generate_manifest.py`**, reusing `find_rule_folders()` from
  `tools/generate_index.py`, writes a repo-root `baselines/_manifest.json`
  listing every `{family, product, version, platform, indexPath, ruleCount}`
  combination — deterministic/byte-identical on reruns, same discipline as
  `_index.json`. `family`/`product`/`version` are **folder slugs**
  (`macos_26_tahoe`, `v1.1.0`), not the human-readable `benchmark.product`
  string — slugs are what reconstruct a fetch URL and what the
  selection/export schema keys on. `platform` is copied from the folder's
  rules purely for display/filtering.
- **Getting `baselines/` into the built site**: `scripts/copy-baselines.mjs`
  (Node's built-in `fs.cp`, zero dependencies - runs fine under Bun too)
  copies `../baselines/` into `webui/public/baselines/`. `webui/package.json`'s
  `dev`/`build` scripts chain it explicitly (`bun run copy-baselines && vite`
  / `... && tsc -b && vite build`) rather than relying on npm's implicit
  `pre<script>` lifecycle convention, so it runs the same way under any
  runner. That copied folder is gitignored.
- **Base path**: GitHub Pages serves this as a project site
  (`/intune-compliance-toolkit/`), so `vite.config.ts` sets that as `base`,
  and all fetches build URLs from `import.meta.env.BASE_URL`.
- **CI freshness gate**: the Pages workflow runs
  `python tools/generate_index.py && python tools/generate_manifest.py`
  followed by `git diff --exit-code baselines/` before building — if someone
  edited a rule file without regenerating the index/manifest, the build
  fails loudly instead of shipping a stale UI.

## State management and dependencies (kept minimal, each justified)

| Need | Choice | Why |
|---|---|---|
| Filter + selection state | **Zustand** (~1KB) | Selector-based subscriptions so toggling a filter or a single row's checkbox doesn't re-render the whole rule table once the corpus grows past a handful of rules. Plain Context would need hand-rolled memoization to match this. |
| Zip download | **fflate** (~8KB) | Browsers have no native zip API; needed to ship "script + rules JSON (+ manual-attestation report)" as one download instead of separate browser downloads per file. |
| Styling | **Tailwind CSS** (build-time only, no runtime JS shipped) | Utility classes for a compact, information-dense table/filter UI without hand-building a spacing/color system. |
| Data fetching/caching | None (no React Query) | Static JSON, fetched once per session into a plain `Map` cache in `src/data/*.ts`. Adding a data-fetching library for `fetch` + `Map` isn't justified. |
| Routing | None | Two views (browse / generate-review) held as a Zustand UI-state slice, not URL routes. |

## Component / screen breakdown

- **`AppShell`** — header (selection count, Export/Import/Generate buttons),
  `FilterSidebar`, main area switching between `RuleTable` and
  `GenerateReviewScreen`.
- **`FilterSidebar`** — facets derived from loaded data (never hardcoded):
  product, version, platform, profile_applicability (multi-select of
  whatever free-text values are actually present), and an **automatable**
  filter reading `_index.json`'s (now-computed) `assessment_status` field
  directly — no full-rule fetch needed to filter by it.
  `source_assessment_status` (CIS's original label) is available from the
  same index entry as a separate, independent filter/badge.
- **`RuleTable`** — grouped by product → version → top-level CIS section
  (first dot-segment of `id`, via `naturalId.ts`'s numeric-aware comparator
  — **not** `_index.json`'s plain string sort, which misorders ids like
  `2.12.2` vs `2.1.1.1`, or `106.1.1` vs `1.6`). Each row: checkbox, id,
  title, computed `assessment_status` badge (automatable or not),
  `source_assessment_status` as a secondary chip when it differs from the
  computed value, profile chips, "org value required" indicator (from
  `_index.json`), a static expand indicator. Clicking anywhere on the row
  (other than the checkbox, or any future button/link) toggles expand —
  the indicator isn't a separate click target.
- **`RuleDetailPanel`** — on first expand, lazily fetches the full per-rule
  JSON (cached after). Shows description/rationale/`extended_attributes.cis`
  (only available here, not indexed), then `AuditMethodList` and
  `RemediationMethodList`: every method (audit and remediation) renders as
  a collapsed, independently-expandable card showing its full detail (the
  check command, `output_description`, and a human-readable pass/fail
  criterion per `output_check` via `describeOutputCheck()` — e.g.
  "`cis_macos26_1_6_days` is at least `30`" — for audit; description,
  `config_keys`, and steps for remediation). Generated scripts only ever
  run a **scripted** audit method, never a manual one and never any
  remediation method, so selection is scoped accordingly: a manual audit
  method's card has no selection control at all (just a "not used in
  generated scripts" label); a scripted audit method is used automatically
  with no control when it's the *only* scripted method; a selector (radio,
  restricted to the scripted cards) appears only when a rule has 2+
  scripted methods, so the admin can pick which one's check feeds
  generation — resolved via `effectiveAuditMethodIndex()` (see below).
  Remediation methods never get a selection control under any
  circumstance — they're informational-only. `OrgDefinedValueInput` renders
  a typed input (checkbox/number/text per `data_type`) for every
  `output_check` with `value_source: "organization_defined"` on the
  *effective* scripted method. A step whose `check_command_verified` is
  `false` gets a visible warning badge — real data already contains
  unverified commands.
- **`SelectionToolbar`** — live selected count, Export/Import/Generate/Clear.
- **`ExportImportControls`** — export serializes selection state to the
  settings JSON and downloads it; import validates `schemaVersion` + each
  rule ref against the currently loaded manifest/index, reporting (not
  silently dropping) any ref that no longer resolves.
- **`GenerateReviewScreen`** — fetches full JSON for every selected
  automatable rule, runs the chunking algorithm, shows the resulting bundle
  plan (platform → section → chunk, with rule/setting counts and measured
  byte size) plus a preview of the `ManualAttestationReport` (rules selected
  but not automatable). Blocks download with a visible validation error
  until every required organization-defined value is filled in. "Download
  bundle (.zip)" triggers `zipBundle.ts`.

## Data model — localStorage and export/import file (same schema)

References rules by identity only — **never embeds rule content**:

```ts
interface SettingsFileV1 {
  schemaVersion: 1;
  generatedAt: string;            // informational only
  selections: RuleSelection[];
}

interface RuleSelection {
  ref: { family: string; product: string; version: string; file: string; id: string };
  enabled: boolean;
  // null = no explicit choice; resolved via effectiveAuditMethodIndex(),
  // which defaults to the rule's first scripted method. Only ever
  // non-null when a rule has 2+ scripted methods and the admin picked
  // one. No remediation-method selection exists - remediation is
  // informational only and never feeds a generated script.
  selectedAuditMethodIndex: number | null;
  organizationDefinedValues: Record<string, string | number | boolean>; // keyed by output_check.variable
}
```

localStorage stores this under one key, debounce-written on every mutation.
Export downloads the same JSON pretty-printed. `schemaVersion` is a plain
integer so a future version (e.g. Phase 2 upload metadata) can add a
migration path without breaking already-exported files.

## Grouping / chunking algorithm

**Eligibility** — the coarse split is index-only, no full-rule fetch needed:

```
GENERATABLE         := enabled selections where index.assessment_status == "Automated"
MANUAL_ATTESTATION  := enabled selections where index.assessment_status == "Manual"
```

Full rule JSON is still fetched for every `GENERATABLE` selection before
packing (to build the real script/rules-JSON content), and at that point the
generator re-derives eligibility from the rule's *effective* audit method
specifically (a rule can have more than one method; the index's
`is_automated()` checks "any method," but generation must use whichever
scripted method is actually effective for that selection — see
`effectiveAuditMethodIndex()` under "Component / screen breakdown," shared
between the detail panel and this check):

```
hasScriptedMethod(rule, selectedAuditMethodIndex):
    effectiveIndex = effectiveAuditMethodIndex(rule.audit.methods, selectedAuditMethodIndex)
    if effectiveIndex is null: return false
    method = rule.audit.methods[effectiveIndex]
    return any(step.output_check is non-empty for step in method.steps)
```

`effectiveAuditMethodIndex` already guarantees the resolved method (if any)
is scripted, so this can only be false when the rule has no scripted method
at all — in which case the selection moves to `MANUAL_ATTESTATION` at this
point instead. The index's "Automated" only means "a script is possible
somewhere in this rule," not that a specific method is guaranteed scripted,
so this re-check is still required.

**Packing** (operates on `GENERATABLE` only):

```
group by platform := rule.benchmark.platform
for each platform:
    group by topLevelSection := naturalFirstSegment(rule.id)     # "106.1.1" -> "106"
    sort sections by numeric value
    for each section (rules sorted by naturalIdCompare):
        chunks = []; current = []
        for rule in rules:
            if outputCheckCount(rule) > MAX_RULES_PER_CHUNK:
                HARD ERROR: "<id> alone exceeds the per-chunk cap"
            candidate = current + [rule]
            rulesJson = buildRulesJsonArray(candidate)             # real objects, not estimated
            bytes = utf8ByteLength(JSON.stringify(rulesJson))
            if outputCheckCount(candidate) > MAX_RULES_PER_CHUNK or bytes > MAX_BYTES_PER_CHUNK:
                chunks.push(current); current = [rule]
            else:
                current = candidate
        if current: chunks.push(current)
        # only label "Part 1/2/..." if more than one chunk resulted
# different top-level sections are NEVER combined into one chunk, even with spare room
```

- Capacity is counted in emitted `Rules[]`/`SettingName` entries
  (`outputCheckCount`), not in number of rule files — one rule can contribute
  more than one `output_check`.
- `MAX_RULES_PER_CHUNK = 90`, `MAX_BYTES_PER_CHUNK = 90 * 1024` — ~10%
  headroom under Intune's hard 100-rule / 100 KB limits.
- Before finalizing a chunk, assert no two `output_check.variable` values
  collide (cross-rule collision data already collected by `_index.json`'s
  `variables[]`) — Intune requires unique `SettingName` per policy.
- `naturalId.ts`'s comparator must be used everywhere ordering/grouping
  matters (table grouping, chunker, manual-attestation report) — never the
  index's raw string sort.

## Script / compliance-JSON generation

- **Bash (macOS)**: each selected step's `check_command` is emitted
  **verbatim, unindented, at top level**, in original step order (lookup
  steps before their dependent compliance-check steps) — required because
  real `check_command`s already contain heredocs (`<< 'EOS' ... EOS`) whose
  terminator must sit at column 0; wrapping in a function/subshell risks
  breaking that. Each block is preceded by a `# --- <id>: <title> ---`
  comment, with an added `# WARNING: unverified check_command` comment where
  `check_command_verified` is false. After all checks run, the script hand-
  builds the single-line JSON via `printf` (booleans/integers unquoted,
  strings JSON-escaped and quoted) — no `jq` dependency, since it isn't
  guaranteed present on managed Macs. Scripts always `exit 0` on success
  (non-zero is reserved for script failure, not a non-compliant result).
- **PowerShell (Windows)**: same verbatim, ordered concatenation, then an
  `[ordered]` hashtable of `variable -> value` piped through
  `ConvertTo-Json -Compress` for correctly-typed, guaranteed single-line
  output.
- **Compliance rules JSON**: one `Rules[]` entry per `output_check`:
  `SettingName` = `variable`, `Operand` = `value` (or the user's
  `organizationDefinedValues` entry), `MoreInfoUrl` = `rule.references[0]`
  if present, `RemediationStrings` = `[{Language: "en_US", Title: rule.title,
  Description: rule.description}]`.
- **Operator mapping** (`operatorMap.ts`): `eq→IsEquals`, `ne→NotEquals`,
  `gt→GreaterThan`, `gte→GreaterEquals`, `lt→LessThan`, `lte→LessEquals`.
  `contains`/`like` have no direct Intune operator — fallback: evaluate the
  substring/pattern match **inside the discovery script** and emit a
  boolean, then map to `DataType: "Boolean"`, `Operator: "IsEquals"`,
  `Operand: true`. `data_type` maps `boolean→Boolean`, `integer→Int64`,
  `string→String`. Flagged to re-verify against Microsoft's live
  Operator/DataType enum at implementation time, since this whole mechanism
  is compensating for gaps in Microsoft's own docs.

## Milestones

1. **Index rework + manifest tooling + read-only browser** — rework
   `tools/generate_index.py`'s `assessment_status` computation (see "Index
   generation rework" above) and regenerate all committed `_index.json`
   files, add `generate_manifest.py`, `copy-baselines.mjs`, and the `webui/`
   scaffold with `RuleTable`/`FilterSidebar` reading manifest + indexes with
   natural-id grouping and the computed automatable filter. No selection
   yet. The Python index change should land first since the UI's filter
   design and the chunking algorithm's eligibility split both depend on it.
2. **Row-expand detail + selection state** — `RuleDetailPanel` +
   `AuditMethodList`/`RemediationMethodList` + `OrgDefinedValueInput`,
   Zustand `selectionStore` + localStorage persistence.
3. **Export / import** — `exportImport.ts` + `ExportImportControls`,
   including unresolvable-ref reporting on import.
4. **Generate / download bundles** — `naturalId.ts`, `chunking.ts`,
   `operatorMap.ts`, `rulesJsonGen.ts`, `scriptGen/{bash,powershell}.ts`,
   `zipBundle.ts`, `GenerateReviewScreen`. Highest-risk milestone (heredoc-
   safe concatenation, real byte-size measurement) — its unit tests land in
   the same PR, not after.
5. **Polish** — empty/loading/error states, compact visual pass,
   accessibility on checkboxes/expand controls, responsive layout.
6. **CI + Pages deploy** — `.github/workflows/deploy-pages.yml` (freshness
   check → build → deploy on push to main) plus a PR-triggered
   test+build-only job.

Each milestone is expected to land as its own session/PR with its `logic/`
unit tests included.

## Testing / verification

- **Unit (Vitest)**: `naturalId.ts` against the real mixed-depth id set
  (`1.6`, `2.1.1.1`, `2.12.2`, `106.1.1`); `chunking.ts` (section isolation,
  output-check-count vs rule-count, oversized-single-rule hard error,
  real-byte-size threshold splitting via `TextEncoder`); `operatorMap.ts`
  including the `contains`/`like` fallback; `exportImport.ts` (round-trip,
  schemaVersion validation, unresolvable-ref reporting); `scriptGen/*`
  golden tests against the two real sample rules already in the repo
  (the heredoc case and the lookup→compliance-check dependency case), plus
  a `bash -n <generated-script>` syntax-check step in CI; `rulesJsonGen.ts`
  (`Rules[]` shape, `SettingName` uniqueness, `Operand` typing).
- **Manual browser verification**: visual/layout polish, zip download and
  file-import behavior, and an end-to-end pass selecting a handful of real
  rules → generate → eyeball the resulting `.sh`/`.ps1`/`.json`.
- **Python-side**: update `tests/test_generate_index.py` to assert
  `assessment_status` reflects `is_automated(rule)` rather than the source
  label — including a case mirroring the real `cis_macos26_2.1.1.1.json`
  (source-labeled "Manual", scripted check present, must index as
  "Automated") and its inverse (source-labeled "Automated" but no scripted
  method with a non-empty `output_check`, must index as "Manual") — plus
  a case asserting `source_assessment_status` always carries the untouched
  original label through unchanged. Add `tests/test_generate_manifest.py`,
  mirroring the existing style (byte-identical rerun, correct
  folder/platform/product/version extraction, deterministic sorted output).

## Critical files to reuse / build on

- `tools/generate_index.py` (`find_rule_folders`, `looks_like_rule_file`,
  duck-typing convention) — reused by the new `generate_manifest.py`.
- `baselines/_rule.schema.json` — authoritative shape for `types/rule.ts`.
- `baselines/cis/macos_26_tahoe/v1.1.0/cis_macos26_2.1.1.1.json` — heredoc
  concatenation case, Manual+scripted case.
- `baselines/cis/windows_11/v5.0.0/cis_intune_win11_1.1.json` — lookup →
  compliance_check dependency case, unverified-command case.
- `tests/test_generate_index.py` — style/pattern to mirror for the new
  manifest generator's tests.

## Future phases (not designed in depth — pick up in a later session)

- **Phase 2 — Direct Graph API upload**: `chunking.ts`, `rulesJsonGen.ts`,
  and `scriptGen/*` should stay decoupled from the download/zip transport
  (they return in-memory strings/objects) so a Graph upload path can call
  the same generation logic and `POST` instead of zipping. Requires an
  Entra ID app registration, MSAL.js auth, and admin consent for
  compliance-policy Graph scopes — none of that exists yet.
- **Future — live Intune dashboard**: reading real compliance state via
  Graph API (interactive admin login) or manual CSV import, cached to
  localStorage to avoid hammering Graph API limits, showing compliance
  status for a connected environment. Should reuse the
  `family/product/version/file/id` ref shape from the MVP's selection
  schema as the join key against live Intune data, rather than inventing a
  second identity scheme.

## Progress log

Kept up to date per `CLAUDE.md` - every session touching this plan adds an
entry here, not just the session that wrote it.

- **2026-08-17** - Plan written and committed. (`28beafb` docs: add web UI
  MVP plan)
- **2026-08-17** - Reworked `tools/generate_index.py` so `_index.json`'s
  `assessment_status` is computed from actual scriptability (a scripted
  audit method with a non-empty `output_check`) instead of copied from
  CIS's own label; added `source_assessment_status` to preserve the
  original label. Regenerated all committed `_index.json` files.
  (`432235f` fix: derive index assessment_status from scriptability, not
  the CIS label)
- **2026-08-17** - Added `tools/generate_manifest.py`, generating
  `baselines/_manifest.json` so the static site can discover benchmark
  folders without directory listing. (`1c27974` feat: add baselines
  manifest generator)
- **2026-08-17** - Scaffolded `webui/` (Milestone 1): React + TypeScript +
  Vite + Tailwind v4, built/run with **Bun** (this machine has no
  Node.js/npm - see "Confirmed decisions"). Read-only rule browser: fetches
  the manifest and indexes, groups product → version → CIS section with a
  tested natural-id comparator, filters by product/version/platform/
  profile/automatability. Discovered and fixed a naming collision: the
  repo's root `.gitignore` already ignores any folder literally named
  `lib/` (Python venv convention), so the planned `lib/` folder was renamed
  to `logic/` throughout. (`0f2c684` feat: scaffold webui rule browser
  (Milestone 1))
- **2026-08-17** - Milestone 2: row-expand now lazily fetches the full rule
  JSON and shows description/rationale, audit/remediation method detail,
  scripted check commands (flagged when unverified), organization-defined
  value inputs, and references. Added a Zustand `selectionStore` persisted
  to `localStorage` (same ref-based schema intended for the future export
  file), plus a live selected-count/clear-selection control in the header.
  (`c88d4cc` feat: add row-expand rule detail and selection state
  (Milestone 2))
- **2026-08-17** - Added `CLAUDE.md` instructing all future sessions to keep
  this progress log current, and backfilled it for everything above.
  (`84eb839` docs: add CLAUDE.md and backfill plan progress log)
- **2026-08-17** - UI fixes requested after using Milestone 2: (1) a row now
  expands on a click anywhere in it, not just a tiny chevron; (2) replaced
  the radio-button audit/remediation pickers with per-method collapsible
  cards - manual audit methods and all remediation methods are view-only
  (never selectable, since generated scripts only ever run one scripted
  audit method), a selector appears only when a rule has 2+ scripted audit
  methods; (3) every method card, expanded, now shows the check command (or
  remediation steps/config), `output_description`, and a human-readable
  pass/fail line per `output_check` (new `describeOutputCheck()`), so
  Windows and macOS rules render consistently instead of the ad hoc
  difference Milestone 2 had. Added `logic/auditMethods.ts`
  (`effectiveAuditMethodIndex()`, shared between the detail panel and the
  future chunking eligibility check) and `logic/outputCheckText.ts`, both
  unit-tested. Simplified the selection schema: dropped
  `selectedRemediationMethodIndex` entirely (remediation is never used for
  generation) and made `selectedAuditMethodIndex` nullable (defaults to
  "use the first scripted method" via `effectiveAuditMethodIndex()`, since
  a bare selection entry has no rule content to compute a real default
  from). (`237fd28` fix: click-to-expand rows, replace method radio buttons
  with detail cards)
- **2026-08-17** - Visual follow-up after seeing the method cards rendered:
  the check command and its pass/fail criteria were sharing one gray box
  with no separation. Gave the command its own bordered block with a
  "Command" header and dark code styling, distinct from a separate panel
  below holding `output_description` and the checks. Replaced the
  bullet-list prose rendering of each `output_check` with a compact
  `variable` / operator-symbol / `value` badge row (new
  `OutputCheckRow.tsx`), since the operator set is small and fixed (`=`,
  `≠`, `>`, `≥`, `<`, `≤`, `contains`, `matches`) - added
  `operatorSymbol()`/`formatCheckValue()` to `logic/outputCheckText.ts`
  (unit-tested) for it. `describeOutputCheck()`'s full sentence is kept as
  the row's hover tooltip. Applied the same command/config styling to
  `RemediationMethodCard` for consistency. (`3ebede1` fix: separate command
  block from checks, badge-style pass/fail criteria)
