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
  - Product plans (such as "Plan 1" and "Plan 2") are defined once on the product, and every
    licence references them. A licence can define its own custom plan when one is unique to it.
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
- **Plan:** a level of a product ("Plan 1", "Plan 2", "Standard", "Premium"). Plans are defined on
  the product and may list the features (child products) that the plan includes.
- **Licence:** a purchasable subscription or add-on from one vendor. It lists what it includes.
- **Inclusion:** one entry in a licence's `includes` list, pointing at a product and optionally
  one of its plans or a custom plan, with an availability.

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
  "category": "Identity & Access",         // free text grouping for top-level products, or null
  "description": null,                     // string or null
  "links": [                               // may be empty
    { "title": "Documentation", "url": "https://learn.microsoft.com/entra/fundamentals/whatis" }
  ],
  "targets": [],                           // platform names, using the rule library's keys ("Windows", "macOS", "Linux", ...)
  "plans": [                               // may be empty
    { "id": "plan_1", "title": "Plan 1", "description": null, "features": [] },
    { "id": "plan_2", "title": "Plan 2", "description": null,
      "features": ["microsoft.entra-id-access-reviews", "microsoft.entra-id-pim"] }
  ]
}
```

- The file name is the id's slug: `products/microsoft/entra-id.json`.
- A plan id is unique within its product and matches `^[a-z0-9][a-z0-9_]*$` (for example
  `plan_1`, `premium`). Its full id is the product id and the plan id joined by a dot:
  `microsoft.entra-id.plan_1`. Product ids contain exactly one dot, so a full plan id always
  splits unambiguously. The full id is what the index, URLs and any future mapping use.
- Every feature is a full entry in its own file, with its own description, links, targets and
  plans, linked to its product through `parent`. A plan's `features` holds only references: the
  ids of those feature files, whose parent chain must lead back to this product. Nothing about a
  feature is written into the plan.
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
  "requires": [],                          // licence ids this add-on needs, may be empty
  "description": null,
  "links": [],
  "includes": [
    { "product": "microsoft.entra-id", "plan": "plan_2", "availability": "included", "note": null },
    { "product": "microsoft.entra-id-access-reviews", "availability": "included", "note": null },
    { "product": "microsoft.teams-premium", "availability": "add_on", "note": null },
    { "product": "microsoft.advanced-meetings", "availability": "add_on",
      "package": "microsoft.teams-premium", "note": null },   // bundle to buy, listed above as add_on
    { "product": "microsoft.exchange-online",
      "custom_plan": { "title": "Plan 2 (100 GB)", "description": null },
      "availability": "included", "note": null }
  ],
  "review": []                             // maintainer worklist strings, removed once resolved
}
```

- **`plan`** is the short plan id and must be defined on that product. Licence files keep
  `product` and `plan` as separate fields so a validation error can say which part is wrong. **`custom_plan`** is for a level unique to
  this licence. An entry sets at most one of the two.
- **`availability`:**
  - `included`: comes with the licence.
  - `add_on`: can be bought for this licence. When the feature is only sold as part of a bundle,
    `package` names that bundle.
- **`package`** is optional and holds the id of the product to buy to get the feature. It is
  allowed only on an `add_on` inclusion, must be an ancestor of the inclusion's product, and the
  licence must list that product itself as `add_on`. The UI shows "Add-on via <package title>"
  with the title linking to that product. An add-on with no `package` is bought on its own, or
  its bundle is not recorded yet and the licence's `review` says so.
- **What a licence includes in effect** is every listed entry, plus the `features` of every
  listed plan. A feature listed directly and through a plan is allowed, and the UI shows it
  once.
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
- a duplicate plan id within a product; a plan feature that is not a descendant of the product;
- a licence inclusion whose product does not exist; a `plan` not defined on that product; both
  `plan` and `custom_plan`; an unknown `availability`;
- the same product and plan listed twice in one licence;
- a `requires` entry that is not a licence id, or that points at itself;
- a file that is not UTF-8 or not LF.

The deploy workflow already runs the Python tests, so an invalid catalog cannot be published.

## 6. Publish step and indexes

`scripts/copy-baselines.mjs` (or a sibling script it calls) copies `catalog/` to
`webui/public/catalog/` and writes two compact generated files, never committed:

- **`_index.json`:** every vendor, product and licence with the fields the list views need, so
  the app makes one startup fetch for the catalog. With about 500 products and 9 licences this is
  well under 1 MB. If it grows a lot, per-file detail fetches can come later.
- **`by_product`** (inside the same index): for each product id, every licence that includes it,
  with availability, plan and whether it comes directly or through a plan. This is the reverse
  side of the mapping, so product files never store their licences.

A shared TypeScript module builds the index, as `mappingIndex.ts` does, so the publish step and
the tests use the same code. A file the validator would reject is skipped with a log line.

## 7. Seed data (one-off)

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
    product: plan badges on products, features nested under their product, and availability as
    a badge (Included, Add-on). An add-on with a package reads "Add-on via <package title>".
  - A **Compare** mode: pick two or more licences and see a matrix with products and features
    as rows, licences as columns, availability or plan in each cell, and an option to hide rows
    that are the same in every column.
- **Products tab:**
  - A searchable list grouped by vendor and category, with features nested under their product.
    Selecting one shows title, vendor, description, links, target icons (the existing
    `TargetIcons`), plans with their features, child features, and "Included in", which lists
    licences grouped by availability with the plan shown.
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
- **Plan normalisation:** "P1", "Plan 1" and "Plan1" map to plan id `plan_1` with title "Plan 1",
  and likewise for 2. Other named levels ("Basic", "Standard", "Premium", "Kiosk") become plans
  with an id from the level name (lowercase, underscores) when the same
  product shows them in two or more in-scope licences.
- **Precedence for effective inclusions:** when a licence lists a product directly and also gets
  it through a plan's `features`, the direct entry wins (its availability, plan and note). Two
  direct entries for the same product and plan cannot exist (section 5).
- **Index scope:** "through a plan" comes only from `plan.features`. An inclusion is not passed
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
