# intune-compliance-toolkit

## Licensing

This repository's own code is licensed under AGPL-3.0 (see `LICENSE`).

The macOS rule content in `sources/mscp/` and `baselines/mscp/` comes from
the [NIST macOS Security Compliance Project](https://github.com/usnistgov/macos_security),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
This project has modified it (converted to a normalized format). The
upstream licence text is vendored in `sources/mscp/upstream/LICENSE.md`.
See `NOTICE` for the full attribution.

## Web UI

The web UI in `webui/` browses the imported rules and generates Intune custom
compliance bundles (a `-discovery.sh` script and a `-rules.json` file).
Requires [Bun](https://bun.sh).

- `cd webui && bun install && bun run dev` starts the dev server.
- `bun run build` produces a static site in `webui/dist`.

## Deploying bundles in Intune

1. In Intune, go to Endpoint security > Device compliance > Scripts > Add >
   macOS and add each generated `-discovery.sh`. Set "Run this script using
   the logged on credentials" to No, because the checks assume root.
2. Create a custom compliance policy that uses that script and its
   `-rules.json`.

See Microsoft Learn, [Create discovery scripts for custom compliance policy
in Microsoft Intune](https://learn.microsoft.com/en-us/intune/device-security/compliance/create-custom-script).

## Known limitations / test before production

- The generated scripts have not yet been run on a real Mac (macOS's
  `/bin/bash` 3.2 and `/bin/zsh`). Test on a pilot device first.
- The base64 check `system_settings_loginwindow_loginwindowtext_enable` follows
  mSCP 1.x encoding (value plus a newline) and needs on-device confirmation.
- Upstream mSCP `release_27.0` rule `system_settings_critical_update_install_enforce`
  has a malformed macOS 26 check (newlines collapsed), so it reports
  non-compliant on macOS 26 until upstream fixes it.
- A device whose macOS version cannot be read reports every rule
  non-compliant, by design.

## Updating the mSCP rules

Requires Python 3.10 or newer.

1. `python -m pip install -r requirements-dev.txt` (includes `requirements.txt`)
2. `python tools/import_mscp.py --tag <release tag>`
3. Review `git diff sources/mscp/` and `git diff baselines/`.
4. `python -m pytest`
5. Commit the result.
