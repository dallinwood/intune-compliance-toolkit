# Design: per-target checks and remediation (schema v5), and ASD Blueprint overlays

Date: 2026-10-26
Status: Approved 2026-10-26 (maintainer answers in this session)

## 1. Intent

A rule can apply to several targets, but `check` and `remediation` can
only describe one. They are `{ default, by_version }` keyed by bare
version, which is implicitly macOS (design 2026-10-22, section 5.3). Some
rules, especially ASD ISM controls, need a macOS check and a Windows
check in the same rule. Schema v5 keys checks and remediation by target.

With that in place, the first real overlays add ASD's Blueprint for
Secure Cloud PowerShell remediation scripts to the ISM controls they
implement.

## 2. Goals, non-goals, anti-goals

### Goals

- `check` and `remediation` are maps keyed by target. A rule may have
  entries for any number of targets.
- Remediation is a list of steps, so several scripts can apply to one
  target, and an overlay can add a step by appending.
- Apple-only remediation keys (`mobileconfig_info`,
  `mobileconfig_by_version`, `ddm_info`) become a general `payloads` list
  tagged by kind.
- mSCP is restructured to v5 with **values unchanged**, proved the same
  way as the v3-to-v4 move: an independent conversion of the committed
  v4 files compared to the regenerated v5 files.
- The macOS generator behaves exactly as before. Bundles are
  byte-identical for any mSCP selection.
- The UI shows one Check block and one Remediation block per target.
- Overlays add the Blueprint scripts to ISM-1621, ISM-1654, ISM-1655,
  ISM-1542 and ISM-1674.

### Non-goals

- Generating Windows (PowerShell) discovery scripts or Intune rules from
  Windows checks. Out of scope by maintainer decision. The generator
  keeps reading only `check["macOS"]`.
- The 16 generic Blueprint registry scripts that match no specific ISM
  control (maintainer decision: leave them out).
- Changing any rule's `assessment`. Overlaid ISM rules stay manual.

### Anti-goals

- Any change to mSCP values, bundle bytes, or how a macOS rule displays,
  other than the per-target block layout.
- Source-specific or platform-specific top-level keys.

## 3. Schema v5

`schema_version` is 5 in the rule, index and manifest files. Only
`check` and `remediation` change; every other field is as in v4.

```jsonc
"check": {                              // object keyed by target, or null
  "macOS": {
    "language": "bash",                 // "bash" | "powershell" | "zsh" | "python" (enum, extend when needed)
    "default": { "shell": "...", "result": { "type": "integer", "value": 0 }, "additional_info": null },  // or null
    "by_version": { "15.0": { ... } }   // same check_entry shape as v4
  }
},
"remediation": {                        // object keyed by target, or null
  "macOS": {
    "steps": [
      { "name": null, "language": "bash", "shell": "...", "additional_info": null, "versions": null }
    ],
    "payloads": [
      { "kind": "mobileconfig", "versions": null, "data": { ... } },
      { "kind": "ddm", "versions": null, "data": { ... } }
    ]
  }
}
```

- **Targets.** Target keys are non-empty strings matching the
  `applicability` target names (`macOS`, `Windows`, ...). There is no
  `null` key: a check or remediation always belongs to a target.
- **Check semantics** are unchanged within a target: `default` plus
  `by_version` overrides.
- **Step `versions`:**
  - `null` means the step applies to every version of the target.
  - A list means only those versions.
  - Steps are independent. All steps whose versions match apply, in list
    order.
  - A step may have `name` (`string | null`), shown as its heading.
  - A step with `shell: null` and non-null `additional_info` is a
    text-only instruction.
- **Payload `kind`** is a free string. mSCP uses `mobileconfig` and
  `ddm`. `data` is any JSON object or array. `versions` works as for
  steps.

### 3.1 mSCP conversion (importer and proof)

- **`check`:** non-null becomes `{ "macOS": { "language": "bash",
  "default": ..., "by_version": ... } }`.
- **Remediation steps:**
  - If `remediation.by_version` is empty, the v4 `default` fix becomes
    one step with `versions: null`, provided it has a `shell` or
    `additional_info`. A v4 default of `{ shell: null, additional_info:
    null }` produces no step.
  - If `by_version` is non-empty, the default step gets `versions` = the
    rule's listed macOS versions without a `by_version` entry, ascending.
    That list is `null` if the rule lists no versions.
  - Each `by_version[v]` fix becomes a step with `versions: [v]`. Steps
    are ordered default first, then by ascending version.
  - Step `name` is `null` and `language` is `"bash"`.
- **Remediation payloads:**
  - `mobileconfig_info` becomes `{ kind: "mobileconfig", versions,
    data }`. `versions` is `null` when `mobileconfig_by_version` is empty.
    Otherwise it is the rule's listed macOS versions without a
    `mobileconfig_by_version` entry, ascending, exactly like the default
    step (`null` if the rule lists no versions; no payload if that list is
    empty). (Amended 2026-10-26: `null` here made a default profile claim
    versions that have their own.)
  - Each `mobileconfig_by_version[v]` becomes `{ kind: "mobileconfig",
    versions: [v], data }`.
  - `ddm_info` becomes `{ kind: "ddm", versions: null, data }`.
  - Order: mobileconfig (default), mobileconfig per ascending
    version, then ddm.
- **`remediation` is `null`** when the result has no steps and no
  payloads. Otherwise it is `{ "macOS": { steps, payloads } }`.

### 3.2 Overlays

- **Merge contract unchanged.** Adding a Windows entry is a normal object
  merge onto the target-keyed map, or onto `null`, which merges as absent.
  Appending a step is a normal list append.
- **Updates:** the overlay field tables, the UI shape checks, the shared
  fixture cases, and `FIELD_KINDS` / `INDEX_OVERLAY_FIELDS`.
- **Existing overlay tests** that used the v4 check shape move to v5.

## 4. Web UI and generator

- **Generator:** `logic/checkPlan.ts` and its helpers read
  `rule.check?.[GENERATED_TARGET]`. A rule with checks only for other
  targets is handled as "no macOS check", through the existing problem
  path. Bundles are byte-identical.
- **Detail panel:**
  - **Check:** one block per target, headed by the target's vocabulary
    label and the language, e.g. "Windows · PowerShell". Inside it, the
    existing default and per-version layout is unchanged.
  - **Remediation:** one block per target. Steps are listed in order with
    their name (if any) and versions (if not all). Payloads are listed by
    kind, with their versions.
  - **Single target:** when a rule has one target, the target heading
    still shows, so the layout is the same for every rule.
  - **Custom tags** work per top-level field as today.
- **The "No macOS version listed" warning** keeps its current condition
  (a macOS applicability entry with no version).

## 5. Blueprint overlays

- **Source:** ASD-Blueprint/ASD-Blueprint-for-Secure-Cloud at commit
  `a6e1e5f95e6051f23d2e7d1148c8fd57a6614000`, files under
  `static/content/files/config-scripts/`.
- **Licence:**
  - The site is CC BY 4.0, (c) Commonwealth of Australia 2023.
  - **The scripts themselves are Microsoft code under the MIT licence**
    (their headers say so), and third-party content is excluded from
    ASD's grant.
  - Each script is copied byte for byte, header included, into the
    overlay step's `shell`.
  - `NOTICE` gains a section with Microsoft's MIT copyright and licence
    text, crediting the Blueprint as the place they were obtained.
  - The overlay's `references` carries the Blueprint page URL.
- **Overlays** (each targets release `v2026.09.4`; each adds one Windows
  step with `name` set to the script name and `language: "powershell"`,
  plus a reference):
  1. `asd-blueprint-remove-legacy-features.json`, targeting
     `asd_ism.ism-1621`, `asd_ism.ism-1654` and `asd_ism.ism-1655`, with
     script `UserApplicationHardeningRemoveFeatures`. The one script
     removes PowerShell 2.0, .NET 3.5 and Internet Explorer.
  2. `asd-blueprint-office-ole-packages.json`, targeting
     `asd_ism.ism-1542`, with script
     `OfficeMacroHardeningPreventActivationOfOle`.
  3. `asd-blueprint-macro-trusted-publisher.json`, targeting
     `asd_ism.ism-1674`, with script `BlockCerts`.
- **Each step's `additional_info`** states the script's source and
  licence in one line, and for overlay 1 notes that the same script
  covers all three controls.
- **`assessment` is not overlaid**, so the rules stay manual.

## 6. Delivery

1. **Task 1: schema v5.**
   - The schemas, the mSCP importer and its regenerated data, the
     values-unchanged proof, the ISM importer (`null` stays `null`),
     overlay tooling (Python and TypeScript, cases, shape checks), the
     generator, the UI blocks, and the tests.
   - The bundle snapshot is byte-identical before and after.
2. **Task 2: Blueprint overlays.**
   - The three overlay files, the `NOTICE` and README updates, a CI
     overlay check pass, and e2e or screenshot confirmation that ISM-1621
     shows a Windows · PowerShell remediation tagged Custom.
3. **One review** over both tasks, then fixes, then push.

## 7. Script files (added 2026-10-26, maintainer decisions)

Long scripts can live in their own files, so they can be edited and
linted as real `.ps1` or `.sh` files, instead of being embedded as JSON
strings.

- **Reference key:**
  - A check entry (`default` or a `by_version` value) and a remediation
    step each take **exactly one** of `shell` (inline string or `null`)
    and `shell_file`.
  - `shell_file` is a repo-root-relative path that must start with
    `baselines/`, for example
    `baselines/_overlays/scripts/RequireSignOrSeal.ps1`.
  - The reference is a plain key rather than `$ref`, so `$` words stay
    reserved for overlay merge verbs.
  - `result`, `language`, `name`, `versions` and `additional_info` stay
    in the rule or overlay.
- **Layout:**
  - Each folder under `baselines/` may have a `scripts/` folder next to
    its `rules/`.
  - Overlays use `baselines/_overlays/scripts/`.
  - mSCP keeps its scripts inline, imported like for like. A future
    importer may write `baselines/<source>/scripts/`.
- **Validation** (CI, and the overlay tooling in both languages):
  - The file exists.
  - The path starts with `baselines/` and contains no `..` segment.
  - The extension matches the language: `.ps1` for `powershell`, `.sh`
    for `bash` and `zsh`, `.py` for `python`.
  - The file is LF.
  - Exactly one of `shell` and `shell_file` is present.
- **Web UI:**
  - When it renders a check or step that has `shell_file`, it fetches the
    published copy (`baselines/...` maps to the published `baselines/`
    folder) and shows it exactly like an inline script, with a loading
    state and a clear error line if the fetch fails.
  - The generator resolves every `shell_file` in the selection before it
    builds a bundle, so bundle contents are identical to inline scripts.
- **Blueprint overlays:** the three scripts move to
  `baselines/_overlays/scripts/<ScriptName>.ps1`, byte for byte (LF), and
  the overlays reference them.

- **Payload files** (added 2026-10-26, maintainer decision):
  - A remediation payload takes exactly one of `data` (inline JSON object
    or array) and `data_file`, a repo-root path starting `baselines/` with
    no `..` segment. Folder convention: `<folder>/payloads/`, for example
    `baselines/_overlays/payloads/`. mSCP keeps inline `data`.
  - Allowed extensions: text `.mobileconfig`, `.plist`, `.json`, `.xml`,
    `.reg`, `.admx`, `.adml`; binary `.pol`, `.intunewin`. Anything else
    is invalid. `kind` stays free text, not tied to the extension.
  - Text files must be LF and a `.json` file must parse. Binary files are
    exempt from the LF check and are marked `binary` in `.gitattributes`.
  - The web UI shows a text payload file's content (fetched like a script)
    with a download link, and a binary one as a download link only.
    Payloads are not bundled, so the generator does not read them.

## Progress log

- 2026-10-26: Design written from the maintainer's answers (no code yet).
- 2026-10-26: Task 1 done. Schemas, mSCP importer, overlay tooling and the regenerated libraries moved to v5 (`f3f6ac1` feat: key checks and remediation by target (schema v5)); the web UI shows one Check and one Remediation block per target and the generator reads only `check["macOS"]` (`87950b8` refactor: show checks and remediation per target in the web UI). An independent v4-to-v5 conversion found 0 differences across 352 mSCP files, ISM files changed only in `schema_version`, a second offline import changed nothing, and the bundle snapshot of every mSCP rule was byte-identical before and after. Decisions: a fix with no shell or text gives no step, a default fix every listed version overrides is dropped (neither occurs in mSCP today), check `by_version` keys use the applicability version pattern, and a rule with a named target but no remediation still shows "No remediation provided.". Visible changes beyond the target heading: steps are listed in ascending version order with their versions named (16 rules), and the unversioned profile payload no longer says "(versions without their own)" (13 rules), as section 3 defines `versions: null` as every version.
- 2026-10-26: Task 2 done. Three ASD Blueprint overlays (`overlays/asd-blueprint-*.json`) add a Windows PowerShell remediation step, copied byte for byte from the Blueprint at the pinned commit, to ISM-1621, 1654, 1655, 1542 and 1674; `NOTICE` carries Microsoft's MIT text and the README names the overlays; one e2e test covers the committed ISM-1621 overlay. Rules stay "Manual - no check" (`feat: add ASD Blueprint PowerShell remediation overlays for five ISM controls`).
- 2026-10-26: Overlays moved from `overlays/` to `baselines/_overlays/` (`refactor: move custom overlays under baselines/_overlays`). The source location is now `baselines/_overlays/<name>.json`, the publish step copies it with the baselines to `webui/public/baselines/_overlays/` and writes the manifest there (never into the repo), and the UI fetches `baselines/_overlays/_manifest.json`. Earlier entries and sections above describe the old path.
- 2026-10-26: Review fixes (`fix: keep mSCP default profiles scoped to versions without their own`). Section 3.1 amended: when a rule has per-version profiles, the default `mobileconfig_info` payload now lists the versions without their own (10 mSCP rules, e.g. `os_appleid_prompt_disable` now `["26.0", "27.0"]`) instead of `null`; the updated v4-to-v5 conversion still finds 0 differences across 352 files, a second offline import changed nothing and the bundle snapshot is unchanged. The UI lists remediation steps and payloads newest version first (all-version entries first), like the Check block; data order is unchanged. The check and remediation target maps need at least one target (`minProperties: 1`, mirrored in the UI shape checks), and the ISM-1621 e2e test asserts the "Windows · PowerShell" heading.
- 2026-10-26: Section 7 (script files referenced by `shell_file`) added from the maintainer's answers.
- 2026-10-26: Section 7 implemented (`feat: let checks, remediation steps and payloads reference files`). Check entries and steps take `shell` or `shell_file`, payloads `data` or `data_file`, checked by the schema, `tools/file_references.py` (existence, extension, LF, JSON) in CI and the overlay tooling, and the same path, extension and exactly-one rules in `webui/src/logic/fileReferences.ts`, pinned by shared cases. The details fetch referenced files from the published `baselines/` copy with loading and error lines; the generator resolves script files before classifying, and a file-backed check gives the same bundle as the inline one. The three Blueprint scripts moved byte for byte to `baselines/_overlays/scripts/`. Payload files were added to the section from a maintainer decision made during implementation.
