# intune-compliance-toolkit

## Licensing

This repository's own code is licensed under AGPL-3.0 (see `LICENSE`).

The macOS rule content in `sources/mscp/` and `baselines/mscp/` comes from
the [NIST macOS Security Compliance Project](https://github.com/usnistgov/macos_security),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
This project has modified it (converted to a normalized format). The
upstream licence text is vendored in `sources/mscp/upstream/LICENSE.md`.

## Updating the mSCP rules

Requires Python 3.10 or newer.

1. `python -m pip install -r requirements.txt`
2. `python tools/import_mscp.py --tag <release tag>`
3. Review `git diff sources/mscp/` and `git diff baselines/`.
4. `python -m pytest`
5. Commit the result.
