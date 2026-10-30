# Design: product and licence catalog (Products and Licences tabs)

Date: 2026-10-27
Status: Approved 2026-10-27

## 1. Intent

The toolkit maps security rules, but not what an organisation has to buy to apply them. This
work adds a vendor-neutral catalog of products, features and licences, with a mapping that
records which licence includes which product, feature or product plan. Two new tabs show it
from each side: the Licences tab shows what a licence includes, and the Products tab shows
which licences include a product or feature.

The first data set is Microsoft 365 Business and Microsoft 365 Enterprise, seeded once from the
m365maps feature matrix and cross-checked against Microsoft's official plan comparison PDFs.
After seeding, the maintainer owns and edits the data by hand.

## 2. Goals, non-goals, anti-goals

- **Goals:**
  - A list of products and features, each with at least a title and vendor, plus optional
    description, links and target platforms.
  - A list of licences by vendor, each referencing the products, features and plans it
    includes.
  - Licensing tiers (such as "Plan 1" and "Plan 2") are licences that include the features the
    tier grants, and suites include the tier licences. (Superseded 2026-10-30: tiers were
    originally product plans; see the progress log.)
  - Features are mappable on their own, so add-on features can be listed separately and, later,
    linked to rules such as ISM controls.
  - Vendor-neutral: nothing in the format or UI assumes Microsoft.
  - Validated in CI like the rule library.
  - Two user-friendly tabs, one per side of the mapping.
- **Non-goals (for now):**
  - Vendors other than Microsoft, and Microsoft licences other than Microsoft 365 Business and
    Microsoft 365 Enterprise (no Office 365, Frontline, Education, EMS, Windows or Agent 365).
  - Descriptions, knowledge-article curation or platform data beyond what the source rows
    directly give (see section 7).
  - Mapping products or features to rules. Ids are kept stable so the rule-mappings format can
    add a product endpoint kind later.
  - Pricing.
- **Anti-goals:**
  - Duplicated data. A fact lives in one file; anything shown from the other side comes from a
    generated index.
  - Any attribution, disclaimer or source field naming m365maps or the PDFs in the committed
    data or the UI. The data is the maintainer's from the moment it is seeded.
  - A committed importer that can rerun and overwrite the maintainer's hand edits.

## 3. Concepts

- **Vendor:** a company that sells products and licences.
- **Product:** a catalog entry for a product, service or feature. A feature is a product with a
  `parent` (such as "Access Reviews" under "Microsoft Entra ID"). Nesting can be several levels
  deep.
- **Tier:** a level of a product ("Plan 1", "Plan 2"). A tier is a licence, not part of the
  product, so the Products tab lists capabilities only and all licensing lives in licences.
- **Licence:** a purchasable subscription or add-on from one vendor. It lists what it includes.
- **Inclusion:** one entry in a licence's `includes` list, pointing at a product or another
  licence, with an availability.

## 4. Files

All hand-edited files are UTF-8 with LF line endings, use the safe file-name rule from
`tools/mappings.py`, and have one JSON document per file.

```
catalog/
  _vendor.schema.json
  _product.schema.json
  _licence.schema.json
  vendors.json                         # every vendor, one list
  products/<vendor>/<slug>.json        # one per product or feature
  licences/<vendor>/<slug>.json        # one per licence
```

`catalog/` sits at the repository root, beside `baselines/`, because it is not a rule source.
The validator and the publish step read it separately from the rule library.

### 4.1 `vendors.json`

```jsonc
{
  "schema_version": 1,
  "vendors": [
    { "id": "microsoft", "title": "Microsoft", "url": "https://www.microsoft.com" }
  ]
}
```

### 4.2 Product file

```jsonc
{
  "schema_version": 1,
  "id": "microsoft.entra-id",              // "<vendor id>.<slug>", unique, ^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$
  "title": "Microsoft Entra ID",
  "vendor": "microsoft",                   // must be a vendors.json id, and the id's prefix
  "parent": null,                          // a product id, or null for a top-level product
  "requires": null,                        // what it needs to work: an id, { "all_of": [...] } or { "any_of": [...] }, or null
  "category": "Identity & Access",         // free text grouping for top-level products, or null
  "description": null,                     // string or null
  "links": [                               // may be empty
    { "title": "Documentation", "url": "https://learn.microsoft.com/entra/fundamentals/whatis" }
  ],
  "targets": []                            // platform names, using the rule library's keys ("Windows", "macOS", "Linux", ...)
}
```

- The file name is the id's slug: `products/microsoft/entra-id.json`.
- Every feature is a full entry in its own file, with its own description, links and targets,
  linked to its product through `parent`.
- `requires` is a technical dependency between products (product ids only), never a licensing
  prerequisite; those belong on licences.
- Products have no plans. A tier such as Entra ID P1 is the licence `microsoft.entra-id-p1`,
  which includes `microsoft.entra-id` and the features P1 grants.
- `category` is meant for top-level products. A child inherits its top-level ancestor's category
  in the UI and leaves its own as null.

### 4.3 Licence file

```jsonc
{
  "schema_version": 1,
  "id": "microsoft.m365-e5",
  "title": "Microsoft 365 E5",
  "vendor": "microsoft",
  "family": "Microsoft 365 Enterprise",    // grouping shown in the UI
  "kind": "subscription",                  // subscription | add_on
  "requires": null,                        // licences to buy first: an id, { "all_of": [...] } or { "any_of": [...] }, or null
  "description": null,
  "links": [],
  "includes": [
    { "type": "licence", "target": "microsoft.entra-id-p2", "availability": "included", "note": null },
    { "type": "product", "target": "microsoft.access-reviews", "availability": "included", "note": null, "capacity": null },
    { "type": "product", "target": "microsoft.teams-premium", "availability": "add_on", "note": null, "capacity": null },
    { "type": "licence", "target": "microsoft.entra-suite", "availability": "add_on", "note": null },
    { "type": "licence", "target": "microsoft.exchange-online-plan-2", "availability": "included", "note": null }
  ],
  "review": []                             // maintainer worklist strings, removed once resolved
}
```

- **`type` and `target`** identify either a product or a licence. The two namespaces are
  independent: a product and a licence can have the same id without ambiguity.
- **Tiers are licences.** A full tier subscription includes the tier below it as a licence
  (Entra ID P2 includes Entra ID P1) plus what it adds. A step-up add-on (Entra ID P2 Step-up,
  Intune Plan 2) includes only what it adds, because its `requires` already guarantees the
  lower tier.
- **`requires`** names the tier licence. It is met by that licence or any licence that includes
  it as `included`, transitively, so prerequisite lists do not enumerate every suite.
- **`capacity`** (product entries only) records an amount that differs between licences while
  the product underneath is the same: Exchange Online (Plan 2) lists `microsoft.exchange-online`
  with "100 GB mailbox + up to 1.5 TB archive". The amount sits on the licence that grants the
  product, so a suite including that tier licence inherits it. A version with a different
  feature set is a separate product instead. If two nested licences give one product different
  capacities, the validator warns until the outer licence lists the product directly.
- **`availability`:**
  - `included`: comes with the licence.
  - `add_on`: can be bought separately, subject to that offer's prerequisites.
- **Bundles are licences**, not parent products. The former hand-written `package`
  field is removed. Nested licence provenance supplies the UI's "via" links.
- **What a licence includes in effect** is every directly listed product, plus the
  included entitlements of nested licences.
  An `add_on` edge makes those entitlements optional, not included. A nested licence's
  own optional offers are not inherited. Requirements never grant entitlements.
  Direct entries win over matching derived entries; the resolver preserves availability
  and provenance. A product's `parent` provides structural context, not an automatic
  licence entitlement or purchase prerequisite.
- **`review`** holds plain-language notes for the maintainer, for example "Official comparison
  shows Entra ID P2 as an add-on here; the matrix showed it as included." It never names the
  matrix site. The UI shows a small "Needs review" marker on a licence with notes.

## 5. Validation (CI: `tools/catalog.py` and `tests/test_catalog.py`)

Modelled on `tools/mappings.py`. **Errors** (each fails the tests):

- an unknown key, a missing required key, or a wrong type;
- a bad id format, a duplicate id, an id whose prefix is not its `vendor`, or a file name that
  does not match the id's slug and vendor folder;
- an unknown vendor;
- a `parent` that does not exist, belongs to another vendor, or forms a cycle;
- a licence inclusion whose target does not exist in the specified namespace, or an unknown
  `availability` (a `plan` or `custom_plan` field is rejected by the schema);
- a licence that grants no existing product as `included`, directly or through included
  licences;
- a licence including itself, or any indirect inclusion cycle;
- the same type and target listed twice in one licence;
- a licence `requires` id that is not a licence, or that points at itself;
- a product `requires` id that is not a product, or that points at the product itself;
- a requirement group with fewer than two members, an unknown operator, or a group nested
  directly in a group of the same operator (a requirement cycle is only a warning);
- a file that is not UTF-8 or not LF.

The deploy workflow already runs the Python tests, so an invalid catalog cannot be published.

## 6. Publish step and indexes

`scripts/copy-baselines.mjs` (or a sibling script it calls) copies `catalog/` to
`webui/public/catalog/` and writes two compact generated files, never committed:

- **`_index.json`:** generated schema version 3, with every vendor, product and licence,
  so the app makes one startup fetch for the catalog. Source documents retain version 1.
  If it grows a lot, per-file detail fetches can come later.
- **`by_product`** (inside the same index): for each product id, every licence that includes it,
  with availability and the nested licence it comes through, if any. This is the reverse
  side of the mapping, so product files never store their licences.

A shared TypeScript module builds the index, as `mappingIndex.ts` does, so the publish step and
the tests use the same code. A file the validator would reject is skipped with a log line.

## 7. Seed data (one-off)

This section records the original import, not the current authoring format.
The 2026-10-28 review replaced package ancestry with typed licence composition,
corrected independent product identities, and added standalone purchase offers.
Use section 4 and the catalog schemas for current edits; do not rerun an old
matrix import over the reviewed files.

- **Scope:** Microsoft 365 Business (Basic, Standard, Premium, and the Defender and Purview
  suites for Business Premium) and Microsoft 365 Enterprise (E3, E5, E7, Defender Suite,
  Purview Suite). That is 9 licences.
- **Products:** every matrix row included, as an add-on or as a package feature in at least one
  in-scope licence, plus its ancestors. Matrix rows that repeat under several groups share one
  id upstream and become one product.
- **Fields filled:** id, title, vendor, parent, category (from the matrix group), plans, the
  row's documentation link as `links[0]`, and `includes` entries. Description stays null and
  targets stay empty unless a row states a platform outright. No text is written by an LLM.
- **Plans:** where matrix cells for one product carry a plan level shared by several licences
  ("Plan 1", "Plan 2", "P1", "P2"), that level becomes a product plan and the licence references
  it. A quota attached to a level ("Plan 2 (100 GB)") keeps the shared plan and puts the quota
  ("100 GB") in the inclusion's `note`. A level seen in only one licence becomes a `custom_plan`
  with the cell text. Plan `features` lists are left empty for the maintainer.
  Licences list each feature directly, which matches the matrix exactly.
- **Availability:** matrix symbols map as ✔ to `included` and + and Δ to `add_on`. The ⊡
  mark (part of a package) is resolved by walking up the product's ancestors to the nearest one the
  same licence lists: `included` there makes it `included`, `add_on` there makes it `add_on` with
  that ancestor as `package`, and with no listed ancestor it is `add_on` with no package and a
  `review` note. Text cells are `included` with the text as the plan or custom plan. A cell's
  tooltip note goes into `note`.
- **Cross-check:** the official Enterprise and Business comparison PDFs mark each cell with a "●"
  text character, so a script reads them by position. PDF row names are matched to matrix rows,
  using a small model only where the names differ. Where the PDF covers a cell, the PDF value
  wins. Each disagreement or unmatched PDF row is written to that licence's `review` list.
- **Tooling:** the extraction scripts run from the session scratchpad and are not committed. The
  catalog files are the deliverable. A Sonnet review checks the result for obvious problems
  before it is committed.

## 8. Web UI

Two new entries in `webui/src/views/viewRegistry.tsx`, after Rules: **Licences**, then
**Products**. Both load the catalog index lazily the first time either tab opens. A missing or
broken index shows a warning in the notice area and never breaks the Rules tab. Selection is kept
in the URL, so a link opens the same licence or product.

- **Licences tab:**
  - Licences grouped by vendor, then family, in a list. Selecting one shows its title, kind,
    requirements, links, review marker, and its effective inclusions grouped by top-level
    product: features nested under their product, and availability as a badge (Included,
    Add-on). Nested licences are shown as linked inclusions;
    derived add-ons link to the licence or product that supplies them.
  - A **Compare** mode: pick two or more licences and see a matrix with products and features
    as rows, licences as columns, availability and the supplying licence ("via Entra ID P1") in
    each cell, and an option to hide rows that are the same in every column.
- **Products tab:**
  - A searchable list grouped by vendor and category, with features nested under their product.
    Selecting one shows title, vendor, description, links, target icons (the existing
    `TargetIcons`), child features, and "Included in", which lists licences grouped by
    availability with the nested licence each comes through.
- **Linking:** every product or licence name in a detail panel links to that entry in the other
  tab.
- Exact layout, responsive behaviour and styling are left to the builder, using the existing
  components and design tokens. Both tabs get Playwright e2e coverage and are checked with
  screenshots at about 375 px and desktop width, in light and dark mode.

## 9. Delivery

Each phase is one commit, pushed, with a progress log entry here:

1. This design document.
2. Schemas, `tools/catalog.py` and its tests with fixtures, and the publish index with tests.
3. Seed data for the 9 licences, reviewed.
4. The Licences tab.
5. The Products tab.

Coding goes to Sonnet subagents. UI and styling decisions are reviewed by Opus.

## 10. Builder decisions (settled after the design review, the designer's calls)

- **Ids and slugs:** a slug comes from the title (lowercase, every run of other characters becomes
  one hyphen, trimmed). If two products would get the same slug, the later one in matrix order
  takes its parent's slug as a prefix (`entra-id-access-reviews`). The matrix's own row ids are
  only used during seeding to merge repeated rows, and are not stored. Ids do not change after
  seeding, because rule mappings will reference them later.
- **Seed inputs:** the matrix page is `https://m365maps.com/matrix.htm` (scraped HTML: one
  `<tr data-id>` per row, indent classes give nesting, symbols as in section 7). The PDFs are
  Microsoft's Modern Work Plan Comparison documents for Enterprise and SMB. All three are
  downloaded into the session scratchpad. Name matching between PDF and matrix rows, where an
  exact normalised match fails, is done by a Haiku subagent working on a short list of
  candidates. No API keys or scripted model calls are involved.
- **Plan normalisation (seed only, superseded 2026-10-30; tiers are now licences):** "P1", "Plan 1" and "Plan1" map to plan id `plan_1` with title "Plan 1",
  and likewise for 2. Other named levels ("Basic", "Standard", "Premium", "Kiosk") become plans
  with an id from the level name (lowercase, underscores) when the same
  product shows them in two or more in-scope licences.
- **Precedence for effective inclusions:** when a licence lists a product directly and also gets
  it through a nested licence, the direct entry wins (its availability and note). Two direct
  entries for the same type and target cannot exist (section 5).
- **Index scope:** "through a licence" comes only from nested licence inclusions. An inclusion is not passed
  down to child features or up to ancestors. The UI shows the hierarchy so that the context is
  visible anyway.
- **Validation split:** as with rule mappings, Python (`tools/catalog.py`) is the gate. It uses
  the JSON Schema files through `jsonschema`, which is already a dependency, for structure, and
  Python code for cross-file checks. The TypeScript index builder only checks enough structure to
  skip unusable files.
- **URL state:** the existing query-parameter scheme in `webui/src/state/urlState.ts` is extended
  with `licence=<id>`, `product=<id>` and `compare=<id>,<id>,...`. Rules tab parameters keep their
  current behaviour.
- **Review notes:** `review` entries are allowed in committed data, and CI does not fail on them.
  They are the maintainer's cleanup list.

## Progress log

- 2026-10-27: Design written from the maintainer's answers (no code yet). Approved with plan ids changed to `plan_1` style, joined to the product id for a full id.
- 2026-10-27: Added the catalog folder with vendor, product and licence schemas, the Python validator `tools/catalog.py` (structure through the schemas, cross-file checks in Python) and its tests with a valid fixture catalog, and a README section (`feat: add product and licence catalog format and validator`).
- 2026-10-27: The publish step now copies `catalog/` to `webui/public/catalog/` and writes a compact `_index.json` (vendors, products, licences and a `by_product` lookup) built by a shared TypeScript module, with the inclusion-tree helpers and a never-throwing loader for the app (`feat: generate the catalog index at publish time`).
- 2026-10-27: Seeded 442 Microsoft products (19 plans) and the 9 Microsoft 365 Business and Enterprise licences (`feat: seed Microsoft 365 Business and Enterprise catalog`). Plan-level rows (Entra ID, Defender for Endpoint, Defender for Office 365, Intune, SharePoint Advanced Management) became plans on one product with plan features filled from the source nesting; same-title rows were merged; official comparison disagreements are listed in each licence's `review`. Note: the first-pass seed files were accidentally included in `ec45095` (`refactor: share catalog plan expansion between index and tree`); this commit replaces them.
- 2026-10-27: Added the Licences tab: licence, product and compare URL state (compare is a repeated param rather than comma-joined), a grouped licence list, a licence detail with filterable inclusion tree and a collapsed Needs review callout, and a compare matrix with sticky header and first column. The catalog loads with the library and a failed load is a warning (`feat: add the Licences tab`).
- 2026-10-27: Added the Products tab: a searchable product tree (vendor, category, collapsible features) and a product detail with breadcrumb, plans, features and an "Included in" section grouped by availability, linking back to the Licences tab (`feat: add the Products tab`).
- 2026-10-27: Maintainer feedback after reviewing the tabs: each view gets its own page path (`/rules`, `/licences`, `/products`) with real browser history; list groups become collapsible (collapsed by default); "package feature" is replaced by `included`, or `add_on` with a `package` reference naming the bundle to buy (plan Tasks 6 and 7).
- 2026-10-27: Products tab landed in 7b36577 (feat: add the Products tab), then 140a8b4 (fix: tidy the Products tab and keep product and licence ids separate: index namespaces, plan cards and Features in a multi-column list, one Included in row per licence) and a final fix so expanding a group no longer scrolls the list and the chevron has a 32px touch target (`fix: keep the product list still when expanding groups`).
- 2026-10-27: Each view now has its own path under the base (`rules`, `licences`, `products`; the `view` parameter is gone, old links break by design), `pushState` for navigations and `replaceState` for refinements with a `popstate` listener, `dist/<view>/index.html` copies for GitHub Pages, collapsible vendor/family/category groups (collapsed by default, selection's groups open), a scrollbar-free tab bar, the Rules search box in the Products pill style, and the chevron overlap fix (`feat: give each view its own page and keep browser history`).
- 2026-10-27: Replaced `package_feature` with `included`, or `add_on` with an optional `package` naming the bundle to buy: schema and validator rules, index and UI ("Add-on via <package>" in the Licences tree, compare cells and Products Included in), and a migration of the 534 existing package features (442 add-on via a package, 21 included, 71 add-on with a review note) (`feat: name the package behind add-on features`).
- 2026-10-28: Reworded the six Viva Pulse review notes that still named the retired package feature value (`fix: reword review notes that named the retired package feature value`), and made the Compare button read "Exit compare" in compare mode with a "Tick two or more licences to compare." hint until two are ticked (`fix: make the Compare button say how to leave compare mode`).
- 2026-10-28: Final whole-branch review fixes. Back past a comparison now leaves compare mode so the selected licence shows again, and going back to a `rule=` address reveals that rule like a link click (`fix: leave compare mode when going back past a comparison`, 3e0fffd). A failed catalog fetch is retried when a catalog tab next opens, repeated notes no longer share React keys, and the heading and inclusion-tree chevrons have 32px touch targets (`fix: retry a failed catalog load and tidy keys and touch targets`, b3010ed). The catalog helpers were de-duplicated (one `AVAILABILITIES`, `OTHER_CATEGORY`, `sortNodes` and one cycle-safe `ancestorChain`, shared `compareText`), the stale default-view comment was corrected, and a test now keeps `scripts/route-pages.mjs` in step with the view registry (`refactor: share catalog helpers and keep route pages in step with views`).
- 2026-10-29: Official-source review of products and licences (work begun 2026-10-28, checkpointed here). Bundles are now licences, not parent products: licence `includes` entries are typed (`type: product | licence`, `target`) and `package` is gone, so nested licences supply "via" provenance. Licence and product `requires` accept nested `all_of`/`any_of` groups, and product requirements may name a plan. Entra ID Governance (standard and P2 step-up), Private Access, Internet Access, Entra ID P1/P2, the Intune plans and modules, Defender for Endpoint P2, Defender Vulnerability Management, Copilot and the Viva bundles became purchasable licences with their prerequisites. The Products tab is grouped by the Modern Work Plan Comparison's workloads plus official product families (`docs/catalog-grouping.md`). Stale e2e assertions from the package model were updated to the nested-licence wording (`feat: model bundles as licences and group products by official workload`).
- 2026-10-30: Product plans removed; licensing tiers are licences (maintainer decision: the Products tab lists capabilities only, all licensing lives in licences). Tier licences nest (Entra ID P2 includes P1; step-up add-ons carry only the delta), suites include their tier licences, and 12 tier licences were added (Defender for Endpoint P1, Defender for Office 365 P1/P2, Exchange, SharePoint and OneDrive Plans 1/2, Microsoft 365 Apps for business/enterprise, SharePoint Advanced Management). Product `requires` is product-only (technical dependency); licence `requires` names the tier and is met transitively, collapsing the hand-listed suite prerequisites. The validator rejects a licence that grants no product. The compare matrix shows the supplying licence so tier differences survive "hide identical rows". A before/after diff of every licence's effective products showed no change except the intended step-up deltas (`feat: model licensing tiers as licences instead of product plans`).
- 2026-10-30: Checked three E3 data questions against the official Modern Work Plan Comparison (Enterprise) PDF. Page 7 shows no P2 identity rows for E3 or Purview Suite, so the direct Access Reviews, PIM, Risk-based Conditional Access and Entitlement Management entries were removed from E3 (and Access Reviews and Risk-based CA from Purview Suite). Pages 5 and 11 confirm E3 includes Intune Plan 2, Remote Help and Advanced Analytics, so that data stays. Page 11 lists Entra ID P2 as an E3 add-on and Governance P2 and Entra Suite P2 as E3 add-ons requiring P2, so E3's P2 add-on now points at the `entra-id-p2` licence (making those prerequisites reachable) and both P2 add-ons were added. Business Premium has the same P2 identity entries but is not covered by this PDF, so it is unchanged pending its own source (`fix: align E3 Entra ID P2 features with the official comparison`).
- 2026-10-30: Maintainer UI feedback. Licences in the sidebar are now indented under their family heading, and "via" sources are listed one per line beneath the product (Licences tree) or licence (Products "Included in") instead of inline, so several sources read as alternatives rather than a chain. In the Licences tree a product whose routes share one availability has one badge beside its title; mixed availabilities put a badge on each route line, and a direct route next to nested ones reads "directly" (`fix: indent sidebar licences and list via sources one per line`).
- 2026-10-30: A product with features no longer has its title pushed right by its expand chevron, in the Products tree and the Licences inclusion tree; the chevron button keeps its 32px touch target but takes the same 16px as the spacer on rows without one (`fix: line up tree titles whether or not they have a chevron`).
- 2026-10-30: Added `capacity` to product inclusions (maintainer decision: an amount that differs between licences for the same product lives on the licence, while a version with a different feature set stays a separate product). The tier licences carry the official comparison's page 3 figures (Exchange Online Plan 1/2 mailbox and archive, SharePoint per-licence storage, OneDrive Plan 1/2 storage, the E3/E5/E7 archive); suite-edge notes that only restated the tier were cleared. The business plans' "100 GB" Exchange Plan 1 note conflicts with the comparison's 50 GB and became a review note pending the Business comparison. The validator warns when nested licences give one product different capacities. The web UI does not display capacity yet; that follows once the parallel web UI work lands (`feat: record capacity on the licence that grants a product`).
- 2026-10-30: Folded the capacity-only products. 6-Months Searchable Data is gone (Microsoft Learn: Defender for Endpoint keeps 180 days of data on every plan, now in the product description). Graph Connector Capacity is gone (connector indexing has no per-licence quota any more). Viva Connections (50 instances) became capacity on Viva Connections: 1 experience in E3/E5/E7, up to 50 with Viva Communications and Communities; its add-on rows on the Defender and Purview suites were seed artefacts and were removed. Defender for IoT - eIoT (5 devices) became Microsoft Defender for IoT - Enterprise IoT with "5 devices per licence" on Defender Suite (comparison page 10, footnote 7); the Business suite keeps it as a note pending a source (`refactor: fold capacity-only products into licence capacity`).
