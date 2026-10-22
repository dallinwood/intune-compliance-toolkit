# Term Vocabulary File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every friendly display name out of TypeScript into a hand-edited `baselines/_vocabulary.json`, with term grouping and descriptive metadata, so new or renamed mSCP terms need a JSON edit only.

**Architecture:** A JSON file alongside `_manifest.json` holds named vocabularies (`benchmarks`, `os_versions`, `sections`, `tags`, `manual_reasons`). Each vocabulary is an ordered list of entries `{ label, terms, metadata?, description? }`. A JSON Schema plus the Python library validator check it. The web UI fetches it at runtime alongside the manifest and builds a lookup. Every place that displays a code word asks the lookup for the label (falling back to the raw code), and filters operate on group keys so grouped terms behave as one. Generated scripts and Intune rules keep using raw mSCP data.

**Tech Stack:** As Plan 2: React 19, TypeScript, zustand, Vitest, Playwright, Bun; Python 3.10+ validator with jsonschema.

**Spec (agreed with the maintainer in chat, 2026-10-22):**
- No friendly text stays in TypeScript.
- Raw codes display unchanged unless the file maps them.
- Grouping: one entry may list several terms, which the UI treats as one term (one filter option under the entry label, matching rules using any of the terms; rows and details show the label).
- Metadata is free-form descriptive tags, validated but not used by the UI yet.
- Lookups and grouping work per vocabulary (the same code word can mean different things in different vocabularies).
- Changing terms must not need a TypeScript change.

## Global Constraints

- **File:** `baselines/_vocabulary.json`, hand-edited, never written by the importer.
- **Schema:** `baselines/_vocabulary.schema.json`, JSON Schema draft 2020-12, `additionalProperties: false` throughout.
  - Top level: `{ "schema_version": 1, "vocabularies": { ... } }`. Vocabulary keys allowed: `benchmarks`, `os_versions`, `sections`, `tags`, `manual_reasons`, each optional.
  - Entry: `label` (non-empty string), `terms` (array of unique non-empty strings, `minItems: 1`), optional `metadata` (array of unique non-empty strings), optional `description` (non-empty string).
  - String patterns end with `(?![\s\S])` instead of `$` (repo convention).
- **Uniqueness:** a term may appear in at most one entry per vocabulary. Enforced by the Python validator and by the UI loader; the UI ignores the later duplicate and warns.
- **Fallbacks:**
  - Unlisted code: shows the raw code. Its group key is the raw code itself.
  - Missing or invalid vocabulary file: the UI still loads with raw codes and shows a small, non-blocking warning.
- **Display order:**
  - Within a vocabulary, listed entries come first in file order, then unlisted codes sorted alphabetically.
  - Exception: macOS versions keep numeric newest-first order. That is data semantics, not a label.
- **Manual-reason text:**
  - The manual-reason badge shows `Manual - <label>`. Its tooltip is the entry's description, or the raw code.
  - The manual-attestation Markdown uses the entry's description, or `mSCP manual reason: <code>.` when none exists.
  - The check's `additional_info` is still appended.
- **Generation unaffected:** discovery scripts, Intune Rules JSON, SettingNames and file names use raw data only.
- **Seed content:** names the UI shows today. Copy the exact current strings from the TypeScript being removed (`webui/src/logic/benchmarkLabels.ts`, `webui/src/logic/ruleDisplay.ts`, `webui/src/logic/manualAttestationReport.ts`).

  | Vocabulary | Entries |
  |---|---|
  | `benchmarks` | 5 entries, metadata `["benchmark"]` |
  | `os_versions` | `27.0`, `26.0`, `15.0` labelled `macOS 27` / `macOS 26` / `macOS 15`, metadata `["platform"]` |
  | `sections` | 7 entries in the current `SECTION_ORDER` order |
  | `manual_reasons` | 6 entries with the current suffix as label and the current attestation sentences as description |
  | `tags` | empty list |

- **Commits:** `type: summary`, no `Co-Authored-By` or AI attribution line. Implementers commit only; the controller pushes after review. No em dash characters (U+2014).

## Review Focus

- **Grouped benchmarks and filtering.** Grouping two benchmark codes must still never offer a zero-row version/benchmark combination. Filter state stores group keys, so a group whose member set changes in the file must not leave stale selections that hide everything.
- **The same code in two vocabularies** (`supplemental` as section, tag and manual reason) resolves per vocabulary.
- **Missing or malformed vocabulary file** gives raw codes plus a warning, never a broken app.
- **Generation output is byte-identical** before and after this change for the same selection.

---

### Task 1: Vocabulary file, validation and UI lookup

**Files:**
- Create: `baselines/_vocabulary.json`, `baselines/_vocabulary.schema.json`
- Modify: `tools/validate_library.py`, which validates `_vocabulary.json` when present: schema plus the per-vocabulary duplicate-term check. Add `"vocabulary"` to `load_schema`.
- Tests: `tests/test_library_schema.py` (or a new `tests/test_vocabulary.py`)
- Create: `webui/src/types/vocabulary.ts`, `webui/src/data/vocabulary.ts`, `webui/src/logic/vocabulary.ts` (+ test)
- Modify: every consumer of `benchmarkLabel`, `macosVersionLabel`, `sectionLabel`, `compareSections`, the manual-reason table and `benchmarkSummary`:
  - `FilterSidebar.tsx`, `RuleTable.tsx`, `RuleCheckSection.tsx`, `RuleRemediationSection.tsx`, `BundleGroupCard.tsx`
  - `logic/odv.ts` (quick-pick labels), `logic/ruleDisplay.ts`, `logic/ruleFilters.ts`, `logic/manualAttestationReport.ts`
  - `state/filterStore.ts`, `App.tsx`/`AppShell.tsx` (load and pass the vocabulary)
- Delete: the label tables. `compareVersionsDescending` stays (rename or move its module if the old name no longer fits).
- Modify: the affected tests and `webui/e2e/smoke.spec.ts`

**Interfaces:**
- `webui/src/logic/vocabulary.ts`:
  - `type VocabularyName = 'benchmarks' | 'os_versions' | 'sections' | 'tags' | 'manual_reasons'`
  - `buildVocabularyIndex(file: VocabularyFile | null): { index: VocabularyIndex; warnings: string[] }`
  - `termLabel(index, vocabulary, code): string`
  - `termGroupKey(index, vocabulary, code): string`. The group key is the entry's first term, or the code itself when unlisted.
  - `groupLabel(index, vocabulary, groupKey): string`
  - `termDescription(index, vocabulary, code): string | null`
  - `compareGroupKeys(index, vocabulary): (left: string, right: string) => number` (file order, then alphabetical)
- `webui/src/data/vocabulary.ts`: `fetchVocabulary(): Promise<{ file: VocabularyFile | null; warning: string | null }>`. It never rejects; a 404 or invalid JSON becomes `file: null` plus a warning.
- **Filtering:** filter state for benchmarks, sections, tags and macOS versions holds group keys. `matchesFilters` and the facet helpers map each row's raw codes through `termGroupKey` before comparing. All pure functions take the index as a parameter, so they stay testable without React.

- [ ] **Step 1: Write failing tests.**
  - Python: the seed file is valid; a duplicate term in one vocabulary is rejected; an unknown vocabulary key is rejected.
  - Vitest:
    - lookup and fallback;
    - a group of `cis_lvl1` + `cislevel1` gives one facet option that matches rows using either code;
    - `supplemental` resolving differently per vocabulary;
    - a duplicate term reports a warning;
    - `null` file gives raw codes;
    - ordering;
    - manual attestation text with and without a description;
    - version-scoped benchmark facet narrowing with a grouped benchmark;
    - a real-data test that `baselines/_vocabulary.json` parses and every seeded term exists in the library.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Remove every hard-coded friendly string listed above. A grep for `CIS Level`, `Operating system`, `Password policy` and `macOS ${` in `webui/src` (excluding tests) must find nothing.
- [ ] **Step 4: Verify.**
  - `bun run test`, `bun run lint`, `bun run build`
  - pytest with `-W error`
  - `bun run test:e2e` with a dev server
  - Generation output byte-identical: generate a bundle for a fixed selection before and after (scratch script) and diff.
  - Screenshots at about 375 and about 1280 of the table, the sidebar and a detail panel, read and checked.
- [ ] **Step 5: Commit** `feat: load display names from a vocabulary file`.

## Progress log

(none yet)
