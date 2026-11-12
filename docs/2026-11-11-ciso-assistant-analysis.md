# CISO Assistant analysis: mappings, framework data, and UI ideas

**Date:** 2026-11-11
**Status:** Findings recorded. Nothing implemented yet.
**Subject:** [intuitem/ciso-assistant-community](https://github.com/intuitem/ciso-assistant-community),
read at commit `57b385a` (2026-11-10).

CISO Assistant is a GRC platform (Django backend, Svelte frontend) that ships
384 YAML "libraries": 322 frameworks and other catalogs, plus 62 mapping
files between frameworks. This review asks three questions:

1. How does it map between frameworks?
2. Where does its framework data come from, and can we import from it?
3. Which features or presentation ideas would suit our static web UI?

Paths below are relative to that repo. Claims marked *(not run)* come from
reading the code. Nothing in the repo was executed.

## Summary

- **Mappings:** each link is a directed, typed link between two requirement
  URNs, using the NIST OLIR relationship set (`equal`, `subset`, `superset`,
  `intersect`, `not_related`). An engine chains links through intermediate
  frameworks and turns source results into target results. Our design is
  already stronger on the data side: our links pin a release and can be read
  from both sides. Their inference rules and coverage derivation are worth
  borrowing.
- **Data:** most libraries are hand-made Excel workbooks converted to YAML.
  Only a few are built automatically from a publisher's machine-readable
  release. The YAML is easy to parse. The repo licenses it as AGPLv3, the same
  licence as ours, and each library names its original publisher in a
  free-text `copyright` field.
- **Best import candidates for us:**
  - NIST SP 800-53 rev5. mSCP rules already cite 800-53 controls (292 of 350
    rules in `release_27.0`), so importing it gives first-party mappings with
    no hand authoring.
  - ASD's Essentials for enterprise IT, plus its generated Essential Eight
    transition mapping.
  - CIS Benchmark Windows 11 (1,475 recommendation titles), as a skeleton for
    Windows coverage.
- **UI:** the best ideas are a coverage roll-up ("your selection supports N of
  M controls"), structured pre-generation checks, and a mapping-provenance
  display. Their audit and assessment features do not fit a static,
  backend-free UI.

## 1. How CISO Assistant maps between frameworks

### Data format

Each mapping library holds one `requirement_mapping_sets` entry with exactly
one source framework and one target framework (`backend/core/models.py:4873-4899`).
The links are listed under it (`models.py:4901-4977`):

```yaml
# backend/library/libraries/mapping-nist-csf-2.0-to-iso27001-2022.yaml (trimmed)
requirement_mapping_sets:
- urn: urn:intuitem:risk:req_mapping_set:nist-csf-2.0-to-iso27001-2022
  source_framework_urn: urn:intuitem:risk:framework:nist-csf-2.0
  target_framework_urn: urn:intuitem:risk:framework:iso27001-2022
  requirement_mappings:
  - source_requirement_urn: urn:intuitem:risk:req_node:nist-csf-2.0:gv.oc-02
    target_requirement_urn: urn:intuitem:risk:req_node:iso27001-2022:4.2
    relationship: equal              # subset | intersect | equal | superset | not_related
    rationale: semantic              # syntactic | semantic | functional
    annotation: Interested parties and their requirements
    strength_of_relationship: 9      # model says 0-10
```

- **Coverage is derived, not stored** (`models.py:4965-4970`). `equal` and
  `superset` count as **full** coverage. `subset` and `intersect` count as
  **partial**.
- **Endpoints are URNs** such as `urn:intuitem:risk:req_node:<framework>:<ref_id>`.
  The URN holds no release or version. A new edition of a framework gets a
  new framework URN (for example `iso27001-2013` and `iso27001-2022`), and
  "version-to-version" mapping files bridge the two editions.
- **Direction:** every set is directed. The docs say a reverse mapping "can be
  generated" with the relationship inverted (`product-docs/concepts/mappings.md:49`).
  No code in the repo does this.

### Runtime: applying a mapping

All of this is in `backend/core/mappings/engine.py`. You create an audit of
framework B with an audit of framework A as its baseline, and the engine works
out B's results.

- `map_audit_results` (lines 383-690) runs one hop.
  - Every link type except `not_related` copies applied controls, evidence and
    security exceptions to the target.
  - When several source requirements map to one target, those copies are
    combined (their union is taken).
  - Scores are copied only when the two frameworks' score scales are
    compatible, and they are rescaled when needed.
- The target **result** comes from a fact table (`LINK_FACTS`, lines 22-37,
  and `_result_from_facts`, 764-780). Each pair of (relationship, source
  result) asserts facts such as "all met", "some met" or "some unmet".
  - Only `equal` and `superset` links can make a target `compliant`.
  - `subset` and `intersect` cap a target at `partially_compliant`.
  - If the facts contradict each other, the most restrictive result wins.
  - The rule gives the same answer whatever order the links come in.
  - The design is written up in
    `documentation/architecture/decisions/mapping-inference-proven-facts.md`.
- **Provenance:** each inferred result stores a `mapping_inference` record
  (`models.py:11226`). It holds the path taken, the source assessments, and
  whether each source gave full or partial coverage. This lets a user see
  why a result was set.

### Chained (transitive) mappings

- The engine treats frameworks as nodes of a directed graph. It takes the
  direct mapping when one exists, and otherwise all shortest paths through
  intermediate frameworks (`all_paths_between`, lines 199-231).
- Path length defaults to 3 frameworks, meaning one intermediate framework,
  and can be set from 2 to 5 (`core/views.py:514-530`).
- Coverage weakens along a chain: if any hop is partial, the whole result is
  partial.
- **Likely bug** *(not run)*: `best_mapping_inferences` (lines 810-812) picks
  the "best" path with `len(tmp_inferences) > len(inferences)`.
  `map_audit_results` returns either `{}` or a dict whose only key is
  `requirement_assessments`, so the comparison is always 0 against 1. In
  practice the first non-empty path wins, not the path that maps the most
  requirements as `mappings.md:80` describes.

### Where the mapping content comes from

- There are 62 mapping files with roughly 85k links in total.
- The `provider` field shows a mix: intuitem's own work (13), SCF (8),
  ANSSI (8), Cisco (11), Adobe (7), NIST (4), ENISA (3) and others.
- The descriptions mention official crosswalks such as NIST OLIR and SCF. For
  example, CSF 2.0 to ISO 27001 was "curated against the requirement texts and
  cross-checked with the NIST OLIR references".
- About 90% of links are `intersect`, so most links can only ever give a
  partial result.
- Tooling in `tools/mapping_builder/`:
  - `semantic_mapper.py` uses an LLM (Ollama).
  - `sbert_mapper.py` uses sentence embeddings.
  - `prepare_review.py` produces Excel or HTML for human review.
  - `tools/prepare_mapping_v2.py` writes an Excel skeleton from two
    frameworks, ready for hand authoring.
- The automated mappers only produce `equal` and `intersect` links.

### Validation

Validation is weaker than ours:

- `tools/check_library_v2.py:735-749` checks only the `relationship` and
  `rationale` values against their allowed lists.
- Nothing checks that requirement URNs exist, that strength values are in
  range, or that a pair isn't duplicated.
- Strength values are on mixed scales. The model allows 0-10, but some files
  use 50 or 90 (for example `mapping-recyf-and-iso27001-2022.yaml`). The
  import uses `objects.create`, which skips the validator.
- One ITIL file puts free French text in `rationale`, outside the allowed
  values.
- In `backend/library/utils.py` (`RequirementMappingImporter.load`), a missing
  requirement URN is logged, and then the code goes on to use a variable that
  was never set *(not run)*.

### Compared with our design (`docs/plans/2026-10-27-rule-mappings-design.md`)

| Aspect | CISO Assistant | Ours |
|---|---|---|
| Endpoint identity | URN, no release | `{kind, id, release}` |
| Direction | One-way only, no inverse generated | Viewable from both sides |
| Relationship types | 5 OLIR types plus strength and rationale | `supports`, `related`, plus a free-text note |
| Validation | Allowed-value checks only | Endpoints resolve, duplicates, conflicting pairs, CI |
| Chaining | Yes, shortest path through intermediate frameworks | No |
| Result inference | Fact table, provenance recorded | N/A (no assessments) |

**What to take from it:**

- Keep `supports` and `related`. We moved off `implements` and
  `partially_implements` on 2026-10-30 because a rule usually covers only part
  of a control. CISO Assistant's own data supports that call: 90% of their
  links ended up as `intersect`.
- If we ever import third-party mappings (OLIR, CISO Assistant YAML), write a
  fixed translation table:
  - `equal`, `superset` and `subset` become `supports`, with the coverage
    level kept in the note.
  - `intersect` becomes `supports` or `related`. This needs review, because
    `intersect` is too weak to imply support on its own.
  - `not_related` is dropped.
- Add an optional `coverage: full | partial` field to our `supports` links only
  if the coverage roll-up in section 3 needs it. Today the free-text note does
  this job.
- Their LLM and embedding mappers suggest a cheaper way to start our next
  mapping pass (the open items in `docs/mappings/mscp-to-asd-ism-review.json`):
  use embeddings to pick candidate pairs first, then send only those to model
  review. Our last pass had subagents review 350 rules against about 765
  controls.
- Skip their strength numbers. Without a scale everyone follows, they add
  noise.

## 2. Where the framework data comes from, and whether we can import it

### Pipeline

- **Mostly manual:** a source PDF or spreadsheet becomes a hand-built Excel
  workbook, which `tools/convert_library_v2.py` turns into YAML in
  `backend/library/libraries/`. The source workbooks are committed: about 288
  `.xlsx` files under `tools/excel/<publisher>/`.
- **A few builders fetch from the publisher at a pinned version:**
  - `tools/build_asd_essentials.py` reads ASD's OSCAL from
    `AustralianCyberSecurityCentre/e4eit-oscal` at a pinned commit, checks it
    with SHA-256, and records the release (`v2026.10.15`).
  - `build_owasp_samm.py` reads `owaspsamm/core` at a pinned tag.
- **ASD ISM** (`asd-ism_09-26.yaml`) is built from ASD's annex Excel and PDF,
  which were downloaded by hand
  (`tools/excel/asd/tools/asd-ism_framework_builder.py`). It does not use
  OSCAL. Our OSCAL import is the better source for the ISM.
- There is no automated fetch for NIST, ISO or CIS content.

### YAML schema (framework libraries)

- **Top-level fields:** `urn`, `locale`, `ref_id`, `name`, `description`,
  `copyright`, `version` (an integer), `publication_date`, `provider`,
  `packager`, optional `translations` and `dependencies`, and `objects`.
- **The framework itself** sits under `objects.framework`. It has an optional
  `implementation_groups_definition` and a **flat** `requirement_nodes` list.
- **Each node** has `urn`, `assessable`, `depth`, `parent_urn` (left out at
  depth 1), `ref_id`, `name`, and optionally `description`, `annotation`,
  `implementation_groups`, `typical_evidence`, `reference_controls`,
  `threats`, `questions` and `translations`.

```yaml
# backend/library/libraries/cis-benchmark-windows-11.yaml (excerpt)
objects:
  framework:
    urn: urn:intuitem:risk:framework:cis-benchmark-windows-11
    implementation_groups_definition:
    - ref_id: A
      name: Automatic
    requirement_nodes:
    - urn: urn:intuitem:risk:req_node:cis-benchmark-windows-11:1.1.1
      assessable: true
      depth: 3
      parent_urn: urn:intuitem:risk:req_node:cis-benchmark-windows-11:1.1
      ref_id: 1.1.1
      name: Ensure 'Enforce password history' is set to '24 or more password(s)'
      implementation_groups:
      - A
```

### Licensing, as the repo states it

- `LICENSE.md`: everything outside `enterprise/` (and one MIT-licensed n8n
  folder) is AGPLv3. That includes `backend/library/libraries/`. The repo
  states no separate licence for the library data.
- Each library also has a free-text `copyright` field naming the original
  publisher. It is not machine-readable and the wording varies. An approximate
  tally across the 384 files:

  | `copyright` text | Approx. count |
  |---|---|
  | Government or vendor publisher named (NIST, BSI, ANSSI, EU, Cisco, Adobe, MITRE, ...) | 186 |
  | intuitem (their own content and mappings) | 62 |
  | A Creative Commons licence (BY, BY-SA, CC0) | 38 |
  | Etalab open licence (French government) | 21 |
  | ISO/IEC "outline only, purchase the standard" | 21 |
  | Blank | 17 |
  | SCF (CC BY-ND 4.0, or a link to SCF's terms) | 13 |
  | "© CIS Security" | 13 |
  | NIST "public information" | 13 |

- **The repo itself flags some content as not redistributable.** CIS Controls
  v8 and CSA CCM are listed under "Bring your own license" (`README.md:428`,
  `product-docs/configuration/libraries/special-cases/cis-controls-and-ccm.md`):
  users upload the publisher's spreadsheet themselves.
- **Libraries the repo does bundle that are relevant to us:**
  - 13 CIS Benchmark libraries, each with `copyright: © CIS Security`.
  - ISO standards, which are outlines only.
  - SCF, whose `copyright` field says CC BY-ND.
- Nothing in the repo indicates a CIS partnership or membership.

Our repo is also AGPL-3.0, so taking AGPLv3-licensed YAML from it is
compatible. When importing a library, carry its `copyright` text into our
`NOTICE` and the "Sources & licences" dialog, as we do for mSCP and ASD. Read
each library's `copyright` field before importing it. Where the field names a
specific licence (SCF's CC BY-ND, the ISO "purchase the standard" outlines),
that stated condition is worth respecting even though the repo-wide licence
is AGPLv3.

### Libraries relevant to us

| Library | What it is | Notes |
|---|---|---|
| `nist-sp-800-53-rev5.yaml` | NIST 800-53 rev5 | NIST "public information". **Highest value for us:** see below |
| `asd-essentials-enterprise-it.yaml` | ASD Essentials for enterprise IT | Built from ASD OSCAL, CC BY 4.0 |
| `mapping-essential-eight-2023-and-asd-essentials-enterprise-it.yaml` | E8 to Essentials mapping, 1,950 links | `provider: ASD`, generated by `build_asd_essentials.py` |
| `essential-eight-2023.yaml` | E8 Maturity Model, Nov 2023 | We already get E8 ML1-ML3 from the ISM, as `e8_ml1`, `e8_ml2` and `e8_ml3` applicability |
| `cis-benchmark-windows-11.yaml` | CIS Windows 11 v5.0.1, 1,475 nodes | Titles and an Automatic/Manual group only. No rationale, remediation, or registry paths |
| `cis-benchmark-microsoft-365.yaml` | CIS M365 | Titles-only skeleton, like Windows 11 |
| `nist-csf-2.0.yaml`, `nist-sp-800-171*` | NIST CSF 2.0, 800-171 | mSCP also cites 800-171r3 |
| `asd-ism_09-26.yaml` | ASD ISM Sep 2026 | **Skip:** our OSCAL import is the primary source and better |
| `mcsb-v1.yaml` | Microsoft cloud security benchmark | A 2023 snapshot and probably out of date |

There is **no** Apple, macOS, Intune or mSCP content in the repo.

### Recommendations for importing

1. **Add NIST SP 800-53 rev5 as a third source.** This gives the most value
   for the least work, because mappings come free:
   - Our normalized mSCP rules already carry
     `references.nist["800-53r5"]`, for example `AC-20` and `CM-7(1)`. That
     covers 292 of 350 rules in `release_27.0`.
   - A small generator can turn those references into `supports` links from
     mSCP rules to 800-53 controls. The links come from mSCP's first-party
     data, with no hand authoring.
   - The same approach works later for 800-171r3 and CMMC, which mSCP also
     cites.
   - **Source choice:** per our primary-source rule, take 800-53 from NIST's
     own OSCAL catalog if NIST publishes it in a form we can pin. I believe
     `usnistgov/oscal-content` has it, but I have not checked that this
     session. Our ASD importer already reads OSCAL. CISO Assistant's
     `nist-sp-800-53-rev5.yaml` is the fallback.
2. **Add ASD Essentials for enterprise IT from `e4eit-oscal`.** It is CC BY 4.0
   OSCAL from ASD, the same shape our ISM importer already handles. CISO
   Assistant's builder shows the pinning approach (a commit plus a SHA-256
   check). The E8 transition mapping it generates is a ready-made second
   mapping set.
3. **A generic CISO Assistant YAML importer is cheap** if we want breadth
   later, for example the CIS Windows 11 title skeleton as a coverage
   checklist for future Windows rules.
   - Minimum parsing: PyYAML `safe_load` (already pinned in
     `requirements.txt` for the mSCP import), then
     `objects.framework.requirement_nodes`, keeping `urn`,
     `ref_id`, `name`, `description`, `depth`, `parent_urn`, `assessable`,
     `implementation_groups` and `annotation`.
   - Pin by the repo commit hash plus the library's `version` and
     `publication_date`. That fits our existing per-release layout.
   - Traps:
     - `ref_id` is not unique across libraries, so namespace on `urn`.
     - Some top-level nodes have no `ref_id`.
     - `parent_urn` is missing at depth 1.
     - `copyright` is multi-line free text.
     - Inline `translations` blocks should be ignored.
     - The library `version` integer replaces content in place, under the
       same URN.

## 3. Features and presentation ideas

Some of their ideas we already have:

- Implementation groups match our benchmark and applicability filters.
- Library version handling matches our release history and Frameworks tab.
- A mapping table matches our Mapped rules tab.

The table below covers only ideas that would be new to us.

| Rank | Idea | CISO Assistant source | How it would work for us |
|---|---|---|---|
| 1 | **Coverage roll-up** | Full and partial coverage (`product-docs/concepts/mappings.md`). Section roll-ups (`product-docs/features/framework-report.md`) | For the current selection, show "supports N of M ISM controls at PROTECTED", split by guideline area, with small progress bars. This is pure logic over the mapping index we already have, and Vitest can test it. |
| 2 | **Structured pre-generation checks** ("x-rays") | `X-RAYS_QUALITY_CHECKS.md`: rule id, severity, occurrences | Extend the Generate screen's existing overlay-issue notes into a list of check rules. Each has an id and a severity (error, warning or info). Examples: a selected rule has no check, an overlay was written for an older release, a selected rule changed in the newest release, a selected rule has no mapping. |
| 3 | **Mapping provenance on hover or expand** | `mapping_inference` (`models.py:11226`) | On the Mapped rules tab and in coverage counts, show why a control counts: which selected rules support it, through which mapping file, and the note. |
| 4 | **Mapping authoring skeleton** | `tools/prepare_mapping_v2.py` | A script that writes a CSV or JSON skeleton of candidate pairs for two sources, ready for review. It would feed the review-queue workflow we already use. |
| 5 | **Command palette (Ctrl+K)** | `product-docs/features/command-palette.md` | Jump to any rule, control or framework by id or title. Cheap, but less valuable. |
| Later | Graph view of mappings | `frontend/src/routes/(app)/(internal)/experimental/mapping/` (a graph and table toggle, still experimental) | Only once there are 3 or more sources. Keep the table as the default. |
| Later | Chained mappings with an "inferred" badge | `engine.py` | Only once there are 3 or more sources (for example mSCP to 800-53 to ISM). Use the weakest-hop coverage rule. |

**Poor fits** (they need a backend or an assessment workflow): audits and
requirement assessments, applied controls and evidence, applying a mapping to
an audit (merging results), IAM and domains, multi-language catalog text, the
library store and signing, and risk matrices and threats. Their "preview
before apply" view is close to the release comparison we already have, so
there is nothing to add there.

## Suggested next steps

1. Decide whether to add NIST SP 800-53 rev5 as a source, with mSCP's
   references generating the mappings. If yes, write a design doc under
   `docs/plans/` first, and confirm NIST's OSCAL as the upstream.
2. Decide whether to add ASD Essentials for enterprise IT (OSCAL).
3. Build the coverage roll-up (UI rank 1). Built as the Coverage view in f752130
   ("feat: add a Coverage view rolling the selection up against mapped frameworks").
   It was useful with the 62 existing mSCP-to-ISM links, and more so after step 1.
