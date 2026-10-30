# intune-compliance-toolkit

## Licensing

This repository's own code is licensed under AGPL-3.0 (see `LICENSE`).

The macOS rule content in `sources/mscp/` and `baselines/mscp/` comes from
the [NIST macOS Security Compliance Project](https://github.com/usnistgov/macos_security),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
`sources/mscp/upstream/` is an unmodified copy of parts of it. This project
has modified the content in `baselines/mscp/` and in the discovery scripts
the web UI generates: the rules were converted to a normalized format, ODV
values are substituted, and checks are assembled into scripts. That content
remains licensed under CC BY 4.0 and is provided as-is, with the disclaimer
of warranties in section 5 of that licence. NIST does not endorse this
project. The upstream licence text is vendored in
`sources/mscp/upstream/LICENSE.md`.

The ASD rule content in `sources/asd_ism/` and `baselines/asd_ism/` comes from
the [Australian Signals Directorate (ASD) Information Security Manual](https://www.cyber.gov.au/ism/oscal),
published as OSCAL, licensed under CC BY 4.0. `sources/asd_ism/upstream/` is an
unmodified copy of it, taken from the [ism-oscal mirror](https://github.com/AustralianCyberSecurityCentre/ism-oscal).
This project has modified the content in `baselines/asd_ism/`: it was converted
to a normalized rule format, links were rewritten, and each statement was split
into a title and a discussion. That content remains licensed under CC BY 4.0
and is provided as-is, with the disclaimer of warranties in section 5 of that
licence. ASD does not endorse this project. ASD's copyright notice and
disclaimer are in `sources/asd_ism/upstream/README.md`. See `NOTICE` for the
full attribution of both sources.

## Web UI

The web UI in `webui/` browses the imported rules and generates Intune custom
compliance bundles (a `-discovery.sh` script and a `-rules.json` file).
Requires [Bun](https://bun.sh).

- `cd webui && bun install && bun run dev` starts the dev server.
- The top tab bar lists the views, which are registered in
  `webui/src/views/viewRegistry.tsx` (one entry plus its component per view).
- `bun run build` produces a static site in `webui/dist`.
- The site's "Sources & licences" dialog lists the rule sources and every npm
  package bundled into the site, with each package's licence text.
- `bun run test` runs the unit tests. `bun run test:e2e` runs the Playwright
  tests against a running `bun run dev`.

## Publishing to GitHub Pages

`.github/workflows/deploy-pages.yml` builds and deploys the web UI on every
push to `main`. One-time manual step: in GitHub repository Settings > Pages,
set Source to GitHub Actions.

Workflow action versions are pinned by commit SHA; bump them deliberately.

## Deploying bundles in Intune

1. In Intune, go to Endpoint security > Device compliance > Scripts > Add >
   macOS and add each generated `-discovery.sh`. Set "Run this script using
   the logged on credentials" to No, because the checks assume root.
2. Create a custom compliance policy that uses that script and its
   `-rules.json`.
3. Also require a minimum macOS version with Intune's built-in compliance
   setting (see Known limitations).

See Microsoft Learn, [Create discovery scripts for custom compliance policy
in Microsoft Intune](https://learn.microsoft.com/en-us/intune/device-security/compliance/create-custom-script).

## Known limitations

- A rule reports compliant **without** running its check on a macOS version it
  does not list. That includes versions older than the imported library
  covers: with `release_27.0` (macOS 15, 26 and 27), a macOS 14 device passes
  every rule. Pair these policies with Intune's built-in minimum OS version
  compliance setting so such devices are caught.
- The generated scripts have not yet been run on a real Mac (macOS's
  `/bin/bash` 3.2 and `/bin/zsh`). Work through the checklist below on a
  pilot device first.
- The base64 check `system_settings_loginwindow_loginwindowtext_enable` follows
  mSCP 1.x encoding (value plus a newline) and needs on-device confirmation.
- Upstream mSCP `release_27.0` rule `system_settings_critical_update_install_enforce`
  has a malformed macOS 26 check (newlines collapsed), so it reports
  non-compliant on macOS 26 until upstream fixes it.
- A device whose macOS version cannot be read reports every rule
  non-compliant, by design.
- On macOS 15, upstream `system_settings_softwareupdate_current` uses a
  hard-coded 30-day window, so the organization value you enter only applies
  on macOS 26 and later.

## Before production: test on a real Mac

- Run one generated `-discovery.sh` as root with the system `/bin/bash`
  (3.2), and confirm each check runs under `/bin/zsh`.
- Confirm the printed JSON stays valid when a check's output contains a `"`,
  a `\`, a control character, and bytes that are not valid UTF-8.
- Check `system_settings_loginwindow_loginwindowtext_enable` (base64 expected
  value) against a device with the login window text set.
- Check `system_settings_softwareupdate_current` on a device that is up to
  date and on one that is not.
- Run a user-scoped check with nobody logged in.
- Time the largest generated chunk and keep it well inside Intune's 10-minute
  limit for macOS discovery scripts.
- mSCP's own `run_scan` calls `mcxrefresh` for the current user before
  running checks. The generated discovery script deliberately does not,
  because it is read-only. Verify that user-scoped managed-preference checks
  still see the profile values Intune delivered.

## Updating the mSCP rules

Requires Python 3.10 or newer.

1. `python -m pip install -r requirements-dev.txt` (includes `requirements.txt`)
2. `python tools/import_mscp.py --tag <release tag>`
3. Review `git diff sources/mscp/` and `git diff baselines/`.
4. `python -m pytest`
5. `cd webui && bun run test`, then `bun run test:e2e` with `bun run dev`
   running.
6. Commit the result.

## Updating the ASD ISM rules

Requires Python 3.10 or newer.

1. `python -m pip install -r requirements-dev.txt` (includes `requirements.txt`)
2. `python tools/import_asd_ism.py --tag <release tag>`, for example
   `--tag v2026.09.4`. To regenerate `baselines/asd_ism/` from the vendored
   copy in `sources/asd_ism/upstream/` without fetching, use `--offline`.
3. Review `git diff sources/asd_ism/` and `git diff baselines/asd_ism/`.
4. `python -m pytest -W error`
5. `cd webui && bun run test`, then `bun run test:e2e` with `bun run dev`
   running.
6. Commit the result.

## Writing overlays

An overlay adds knowledge upstream doesn't have (a check, a better
description, extra references) to imported rules without editing
`baselines/`, so it survives every re-import. The web UI applies overlays
as it shows rules, and tags every overlaid field **Custom** in the rule
details.

Put each overlay in its own `baselines/_overlays/rules/<name>.json`:

```json
{
  "schema_version": 1,
  "id": "powershell-constrained-language-mode",
  "description": "Adds guidance for PowerShell Constrained Language Mode.",
  "targets": [
    { "rule": "asd_ism.ism-1622", "release": "v2026.09.4" }
  ],
  "fields": {
    "discussion": { "$replace": "Constrained Language Mode limits PowerShell to a safe subset of the language." },
    "references": { "microsoft": ["https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_language_modes"] },
    "tags": ["powershell"],
    "check": {
      "Windows": {
        "language": "powershell",
        "default": {
          "shell": "$ExecutionContext.SessionState.LanguageMode",
          "result": { "type": "string", "value": "ConstrainedLanguage" },
          "additional_info": null
        },
        "by_version": {}
      }
    }
  }
}
```

`check` and `remediation` are keyed by target (`macOS`, `Windows`, ...),
so a rule can carry a check and fixes for several targets. A remediation
target holds a list of `steps` (each with `name`, `language`, `shell`,
`additional_info` and `versions`, where `versions: null` means every
version) and a list of `payloads`. To add a fix script, give the target's
`steps` a list, which appends:

```json
"remediation": {
  "Windows": {
    "steps": [
      { "name": "Example", "language": "powershell", "shell": "...", "additional_info": null, "versions": null }
    ],
    "payloads": []
  }
}
```

Long scripts and payloads can live in their own files instead of JSON
strings:

- **Scripts:** a check entry (`default` or a `by_version` value) or a
  step takes exactly one of `shell` (inline, or `null`) and `shell_file`,
  a repo-root path such as
  `baselines/_overlays/scripts/BlockCerts.ps1`. The extension must match
  the language: `.ps1` for `powershell`, `.sh` for `bash` and `zsh`, `.py`
  for `python`. A check entry takes its target's `language`.
- **Payloads:** a payload takes exactly one of `data` (inline JSON) and
  `data_file`, for example
  `baselines/_overlays/payloads/Firewall.mobileconfig`. Allowed
  extensions: text `.mobileconfig`, `.plist`, `.json`, `.xml`, `.reg`,
  `.admx`, `.adml`; binary `.pol`, `.intunewin`. A `.json` file must parse
  as JSON. `kind` stays free text.
- Every path starts with `baselines/`, and each segment after it uses
  only letters, digits, `.`, `_` and `-` and does not start with `.` (so
  no `..`, `%`, `?`, `#` or spaces). Extensions are lowercase. The file
  must exist.
- Text files (scripts included) must be UTF-8 with LF line endings; a
  script must not be empty, and a check script file cannot use `$ODV` yet
  (inline that check). `.gitattributes` marks the binary types as binary.
- To switch an existing entry between inline and file (`shell` and
  `shell_file`, or `data` and `data_file`), `$replace` that entry: a merge
  cannot remove a key, so a plain merge would leave both and be rejected.
- Overlays keep their files in `baselines/_overlays/scripts/` and
  `baselines/_overlays/payloads/` (the overlay files themselves are in
  `baselines/_overlays/rules/`, the same layout as a source folder). The site
  serves them from its own `baselines/` copy: the details show a script or text payload as it is,
  binary payloads as a download link, and the generator reads script
  files before it builds a bundle, so a bundle is the same as with an
  inline script.

- `id` is unique and matches `^[a-z0-9][a-z0-9-]*$`.
- `targets` lists full rule ids (`<source>.<upstream id>`). `release` is
  the source's `release_tag` you wrote the overlay against; when the
  library moves to another release, the details show a note asking you to
  review the overlay.
- `fields` uses the rule field names from `baselines/_rule.schema.json`
  and applies the same way to every target. Different content per rule
  means separate files. `id`, `source`, `file` and `schema_version` cannot
  be overlaid.

Merge rules, applied field by field:

- A list appends to the upstream list (duplicates are kept).
- A string, number, boolean or `null` replaces the upstream value.
- An object merges key by key, by these same rules.
- A wrapper overrides the default: `{ "$replace": value }`,
  `{ "$append": [...] }` or `{ "$merge": {...} }`. A wrapper has exactly
  one key.
- An upstream `null` counts as absent, at any depth: an object merges
  onto it as onto `{}` and a list appends to it as to `[]`. That is how the
  example above fills in ISM-1622's `check: null`. Give the whole shape
  of a new target (`language`, `default` with `shell`, `result` and
  `additional_info`, plus `by_version`; or `steps` and `payloads` for a
  remediation), since a half-filled check or remediation is rejected.
- A type mismatch is an error, for example appending to a string. Keys
  named `__proto__`, `constructor` or `prototype` are not allowed.
- Several overlays on one rule apply in file name order; the later file
  wins for single values.
- Adding a `check` does not change `assessment`: an ISM control stays
  "Manual - no check" in the table and the attestation report until the
  overlay also sets `assessment` (for example
  `{ "status": "automated", "manual_reason": null }`).

The repo ships five overlays, `baselines/_overlays/rules/asd-blueprint-*.json`, that add ASD
Blueprint for Secure Cloud PowerShell remediation scripts to ISM-1542, ISM-1621,
ISM-1654, ISM-1655 and ISM-1674, one script per control (source and credit in `NOTICE`).
Each also appends a Windows target to the control's `applicability`, so these controls show the
Windows icon in the web UI and appear under the Target filter's Windows option.

Publishing is automatic: `bun run dev` and `bun run build` copy
`baselines/_overlays/` (`rules/`, `scripts/`, `payloads/`) into the site and generate
`_overlays/_index.json` there: each overlay's targets, the fields an index entry
carries (title, tags, assessment, applicability, section, architecture, and a
marker for odv) and a lookup from rule to overlays. A file that is not a valid
overlay is left out of the index with a line in the build log. Don't write or
commit an index yourself.

The app reads only that index at startup, so the table, search and filters
show overlaid titles and tags straight away. An overlay's own file is fetched
(once) when you open a rule it targets, and the details, the generator and
the export all use the merged rule.

Check overlays with `python -m pytest -W error tests/test_overlays.py` (or
`python tools/overlays.py` for a plain list of problems). A bad shape, a
protected field, a type mismatch, a target rule missing from `baselines/`,
a merged rule that breaks the rule schema, or a `shell_file` or `data_file`
that is missing or breaks the rules above fails; an unknown field name or
two overlays setting the same value is reported as a warning.

In the web UI an overlay that does not fit a rule is skipped for that rule
alone, with a warning (in the "Custom content problems" notice when the
table cannot take it, or a line in the rule's details when its full file
cannot be merged); the other overlays still apply. CI is what guarantees
every overlay fits every target, so this is a safety net. An overlaid
field carries a **Custom** tag in the rule details (fields with no section
of their own are listed on a `Custom:` line), and an overlay written for an
older release shows a note asking you to review it.

## Mapping rules

A mapping links rules that overlap, across any sources: for example the mSCP
rules that together implement a broad ISM control. Mappings are kept apart
from the imported data, so every re-import keeps them. The rule details show
each link from both sides in a "Mapped rules" section, and clicking a mapped
rule opens it (the search is set to its id and its details open; a filter
that would hide it is cleared, and the URL holds the opened rule, so the link
can be shared).

Put each mapping file in `baselines/_mappings/rules/<name>.json` (UTF-8, LF,
and a file name of letters, digits, `.`, `_` and `-`):

```json
{
  "schema_version": 1,
  "id": "powershell-constrained-language",
  "description": "mSCP rules that implement ISM-1622.",
  "links": [
    {
      "relation": "implements",
      "from": [
        { "kind": "rule", "id": "mscp.os_gatekeeper_enable", "release": "release_27.0" },
        { "kind": "rule", "id": "mscp.os_dictation_disable", "release": "release_27.0" }
      ],
      "to": [{ "kind": "rule", "id": "asd_ism.ism-1622", "release": "v2026.09.4" }],
      "note": "Covers the PowerShell part only."
    }
  ]
}
```

- `id` is unique across files and matches `^[a-z0-9][a-z0-9-]*$`;
  `description` is optional.
- `relation` is `implements`, `partially_implements` or `related`. For the
  first two, `from` implements `to`; `related` has no direction. The details
  word each link from the rule being viewed: "Implements" or "Implemented
  by", "Partially implements" or "Partially implemented by", and "Related".
- `from` and `to` are non-empty lists, and a link stands for every
  `(from, to)` pair, so "mSCP rules 3, 5 and 11 implement ISM-ABC" is one
  link. `note` is optional (a string or `null`) and applies to every pair.
- Each endpoint is `{ "kind": "rule", "id": "<source>.<upstream id>",
  "release": "<release_tag>" }`. `release` is the source release you checked
  the link against; when the library moves to another release, the details
  show a note on that link asking you to review it.
- A rule cannot link to itself, and a pair of rules is linked once: the same
  pair twice, with two relations, or in both directions of `implements` or
  `partially_implements`, anywhere across the files, is an error.

Check mappings with `python -m pytest -W error tests/test_mappings.py` (or
`python tools/mappings.py` for a plain list of problems). An unknown key, a
bad or reused `id`, an empty `from` or `to`, an unknown `relation` or `kind`,
a rule missing from `baselines/`, a self-link, a pair defined twice or with
conflicting relations or directions, or a file that is not UTF-8 or LF fails;
a `release` other than the library's current one is a warning. The deploy
workflow runs these tests.

Publishing is automatic: `bun run dev` and `bun run build` generate
`_mappings/_index.json` in the site's `baselines/` copy, listing every pair
under both of its rules (an empty index when there are no mappings). A file
that is not a valid mapping is left out with a line in the build log. Don't
write or commit an index yourself. The app reads that one index at startup;
if it cannot, the "Mapping problems" notice says so and the rest of the app
works as usual.

## Product and licence catalog

The catalog records which products and features each licence includes,
independent of the rule library. It lives in `catalog/`, beside `baselines/`:

The Products tab uses the workloads in Microsoft's Enterprise comparison and
documented product families for services outside it, not subscription bundles
such as Enterprise Mobility + Security. See [Product grouping](docs/catalog-grouping.md)
for the source-backed categories and the rules for adding products to them.

```
catalog/
  vendors.json                    every vendor, one list
  products/<vendor>/<slug>.json   one per product or feature
  licences/<vendor>/<slug>.json   one per licence
```

All files are UTF-8 with LF line endings, one JSON document per file, and a
file name of letters, digits, `.`, `_` and `-`. The file name is the id's slug
and the folder is the id's vendor, so `microsoft.entra-id` is
`products/microsoft/entra-id.json`.

- **Vendor** (`vendors.json`): `{ "schema_version": 1, "vendors": [{ "id",
  "title", "url" }] }`.
- **Product** (a feature is a product with a `parent`): `schema_version`, `id`
  (`<vendor>.<slug>`), `title`, `vendor`, `parent` (a product id or `null`),
  `requires` (a requirement or `null`), `category`, `description`, `links` (`[{ "title", "url" }]`)
  and `targets` (platform names). Products describe capabilities only: licensing
  tiers such as "Plan 1" and "Plan 2" are licences, not product fields.
- **Licence**: `schema_version`, `id`, `title`, `vendor`, `family`, `kind`
  (`subscription` or `add_on`), `requires` (licence ids), `description`,
  `links`, `includes` and `review`. Each `includes` entry names a `type`
  (`product` or `licence`), a `target` id, `availability` (`included` or
  `add_on`) and `note`; a product entry also has `capacity` (a string or `null`)
  for an amount that varies by licence while the product stays the same, such as
  "100 GB mailbox + up to 1.5 TB archive". A version with a different feature
  set is a separate product, not a capacity. Product and licence ids are separate
  namespaces; `type` resolves which one an entry names. A tier is a licence that includes the
  product and the features that tier grants; a higher tier includes the lower
  tier's licence (Entra ID P2 includes Entra ID P1), and a suite includes the
  tier licences it comes with (E3 includes Entra ID P1). Every licence must
  grant at least one product as `included`, directly or through an included
  licence.
  `review` holds notes for the maintainer; they are reported as warnings and
  never fail validation.

`parent` means "is a built-in part of", not "must buy this first" or "can only
be obtained through this bundle". It does not automatically grant every child
it has: licence inclusions alone determine entitlements.
Independently available products are not children of the suites that include
them. Bundles such as suites are licences, not parent products.
`requires` says what something needs. On a product it
names the products it needs to work, a technical dependency (Entra ID
Governance needs Entra ID). On a licence it names the licences that must be
bought first, the licensing prerequisite (Entra ID Governance needs Entra ID
P1). A licence requirement is met by that licence or by any licence that
includes it as `included`, directly or through nesting, so a requirement names
the tier (`microsoft.entra-id-p1`), not every suite that contains it. A requirement is an id, `{ "all_of": [...] }` (every member) or
`{ "any_of": [...] }` (at least one member). A group has two or more members,
and groups nest:

```json
"requires": {
  "all_of": [
    "microsoft.intune",
    { "any_of": ["microsoft.entra-id", "microsoft.entra-external-id"] }
  ]
}
```

An unknown id, a product or licence that requires itself, or a group nested
directly in a group of the same kind is an error. A chain of requirements that
leads back to where it started is a warning.

For example, a subscription can offer a bundle separately:

```json
{
  "type": "licence",
  "target": "microsoft.entra-suite",
  "availability": "add_on",
  "note": null
}
```

An included licence contributes its included products.
An add-on licence exposes its included entitlements as add-ons, not included
benefits. Optional add-ons advertised by that nested licence do not propagate
into the enclosing subscription. Nested licence routes provide the displayed
"via" links; the old hand-written `package` field is not supported.
An inclusion cycle, self-inclusion, missing target, or a licence that grants
no product is an error. Requirements are prerequisites, not inclusions: requiring
a licence does not grant its contents.

The generated catalog index uses schema version 3. Source documents still use
schema version 1 and must match the current JSON schemas; old `product` /
`package` inclusion fields must be migrated to typed `target` entries.

Validate the catalog (CI runs the same checks in `tests/test_catalog.py`):

```
python -m tools.catalog            # validates catalog/
python -m tools.catalog <dir>      # validates another catalog folder
```

It exits 1 when there are errors and prints warnings without failing.
