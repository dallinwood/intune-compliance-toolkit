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
`sources/mscp/upstream/LICENSE.md`. See `NOTICE` for the full attribution.

## Web UI

The web UI in `webui/` browses the imported rules and generates Intune custom
compliance bundles (a `-discovery.sh` script and a `-rules.json` file).
Requires [Bun](https://bun.sh).

- `cd webui && bun install && bun run dev` starts the dev server.
- `bun run build` produces a static site in `webui/dist`.
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
