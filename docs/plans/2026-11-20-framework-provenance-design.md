# Design: official and community framework labels

Date: 2026-11-20
Status: Implemented 2026-11-20

## Intent

The library now holds frameworks published by the organisation that owns them (NIST, ASD) and
frameworks built by independent open source projects from someone else's benchmark (CIS
benchmarks from ComplianceAsCode, later ansible-lockdown). The maintainer wants each framework
labelled so users can tell them apart, and the official ones listed first.

## Definitions

- **Official:** published by the organisation that owns the framework. Today: NIST SP 800-53
  (`nist_800_53`), NIST mSCP (`mscp`, NIST's own project), ASD ISM (`asd_ism`), ASD E4EIT
  (`asd_e4eit`).
- **Community:** an independent open source project's implementation of another body's
  framework. Today: `cis_rhel9`, `cis_ubuntu2404` (ComplianceAsCode); later the ansible-lockdown
  Windows sources.

## Design

- **Data (maintainer's choice):** a source-level field `provenance`, `"official"` or
  `"community"`, on each source entry in `baselines/_manifest.json` (beside `display_name` and
  `license`; not per release). Required by `baselines/_manifest.schema.json`.
- **Origin:** each importer declares it on its `SourceImporter` (`tools/release_import.py`), the
  same way it declares `display_name` and `license`, and `publish_release` writes it with the
  other source fields. No hand edits to the manifest.
- **Existing sources:** filled in by re-running each importer offline for its current release
  (`--offline --release <tag>`), which rewrites only the source-level fields and that release.
- **Web UI:**
  - A small "Official" or "Community" badge next to the framework title on the Frameworks home
    cards and on the framework page heading.
  - The Frameworks home lists official frameworks first, then a separator with a "Community"
    heading, then community frameworks. Order within each group is unchanged.
  - Other framework lists (rules sidebar source filter, "Linked to" filter) are unchanged.
- **Testing:** schema rejects a missing or unknown `provenance`; the committed-library tests
  confirm every source has one; Vitest for the grouping; Playwright plus screenshots at about
  375px and desktop width for the badge and separator (`.claude/CLAUDE.md`).

## Calls made without the maintainer

- mSCP counts as Official (it is NIST's own project).
- The filters keep their current order.

## Progress log

- 2026-11-20: Task 1 done. `SourceImporter.provenance` (and `BenchmarkSpec.provenance` for CaC benchmarks) is written on each manifest source entry; the schema requires it. Existing sources were filled by re-running each importer offline for its current release. Commit: feat: record whether each framework is official or community.
- 2026-11-20: Task 2 done. The Frameworks home lists official cards first, then a "Community" separator heading and the community cards (the official group needs no heading); each card and the framework page title carry an Official or Community badge (not the all-rules view). Grouping is the pure `groupByProvenance`; Vitest and a new `e2e/provenance.spec.ts` cover it, with screenshots checked at 375px and 1440px in light and dark. Commit: feat: label frameworks official or community and list official ones first.
