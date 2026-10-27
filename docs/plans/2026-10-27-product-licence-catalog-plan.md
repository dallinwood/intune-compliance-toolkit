# Product and Licence Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a vendor-neutral catalog of products, features, plans and licences, seeded for Microsoft 365 Business and Enterprise, and two web UI tabs (Licences, Products) that show the mapping from both sides.

**Architecture:** Hand-edited JSON under `catalog/` is validated by `tools/catalog.py` (jsonschema for structure, Python for cross-file references). The publish step copies `catalog/` into `webui/public/catalog/` and writes one generated `_index.json` holding every vendor, product and licence plus a `by_product` reverse lookup, so the app makes one fetch. Two new views in `viewRegistry.tsx` render from that index.

**Tech Stack:** Python 3 + jsonschema + pytest; Bun + TypeScript + React 19 + Tailwind + zustand + Vitest + Playwright.

**Spec:** `docs/plans/2026-10-27-product-licence-catalog-design.md` (sections are cited as "design §N").

## Global Constraints

- No text in committed data or UI may mention m365maps, the PDFs, or any source attribution (design §2 anti-goals).
- Product id pattern `^[a-z0-9]+\.[a-z0-9][a-z0-9-]*$`; licence ids use the same pattern; plan id pattern `^[a-z0-9][a-z0-9_]*$`; full plan id is `<product id>.<plan id>`.
- `availability` is exactly one of `included`, `add_on`, `package_feature`. UI labels: "Included", "Add-on", "Package feature".
- Licence `kind` is exactly `subscription` or `add_on`.
- Files are UTF-8, LF, safe file names (reuse `PATH_SEGMENT_PATTERN` / the mapping file-name rule).
- UI spelling is "Licences" (British/Australian). No em dash characters anywhere.
- Comments only where the why is not expressible in code; full descriptive names, no single-letter variables.
- Do not add a `Co-Authored-By` or any AI attribution trailer to commits. Push after each commit (branch is not `main`).
- Every commit appends a line to the design doc's `## Progress log` (date, what, commit subject).

## Review Focus

1. A licence whose `includes` references a feature whose ancestors are not themselves included: the Licences tab must still show the feature under its top-level product (ancestors rendered as muted context rows), never drop it. Pinned in Task 2 (`effectiveInclusionTree` test) and Task 4 (e2e).
2. A deep link (`?view=licences&licence=<id>`, `?view=products&product=<id>`) to an id that does not exist: the tab renders its list with no selection and no crash. Pinned in Task 4 and Task 5 e2e.
3. The catalog index missing or malformed: Rules tab unaffected, catalog tabs show a warning. Pinned in Task 2 (loader test) and Task 4 e2e.
4. Narrow screens (~375 px): the Compare matrix scrolls horizontally inside its own container with a sticky first column, the page itself never scrolls sideways. Pinned in Task 4 screenshot check.
5. A product reached both directly and through a plan's `features` is shown once, with the direct entry winning (design §10). Pinned in Task 2 unit test.

---

### Task 1: Catalog format, schemas and Python validator

**Files:**
- Create: `catalog/vendors.json` (Microsoft only, as design §4.1), `catalog/_vendor.schema.json`, `catalog/_product.schema.json`, `catalog/_licence.schema.json`, `catalog/products/microsoft/.gitkeep`, `catalog/licences/microsoft/.gitkeep`
- Create: `tools/catalog.py`
- Create: `tests/test_catalog.py`, `tests/fixtures/catalog/valid/...` (a small valid catalog: 1 vendor, a product with 2 plans and 2 child features, 2 licences, one an add-on with `requires`)
- Modify: `README.md` (a "Product and licence catalog" section: folders, file shapes, how to validate)

**Interfaces:**
- Produces (Python): `validate_catalog(catalog_dir: Path) -> tuple[list[str], list[str]]` returning (errors, warnings); `load_catalog(catalog_dir: Path) -> dict` returning `{"vendors": [...], "products": {id: product}, "licences": {id: licence}}`; CLI `python -m tools.catalog [catalog_dir]` exits 1 on errors, prints warnings. `DEFAULT_CATALOG_DIR = REPOSITORY_ROOT / "catalog"`.
- Every error string starts with the file path relative to the catalog dir, as `tools/mappings.py` does.

- [ ] **Step 1: Write failing tests** in `tests/test_catalog.py`, structured like `tests/test_mappings.py`:
  - `test_committed_catalog_is_valid()`: `validate_catalog(DEFAULT_CATALOG_DIR)` has no errors.
  - `test_valid_fixture_has_no_errors_or_warnings()`.
  - A parametrised `test_invalid_case_is_an_error(case)` where each case copies the valid fixture to `tmp_path`, applies one mutation, and asserts that one error containing an expected fragment appears. One case per error in design §5: unknown key, missing required key, wrong type, bad product id, bad plan id, duplicate id across files, id prefix not equal to `vendor`, file name not matching slug, file in wrong vendor folder, unknown vendor, missing parent, cross-vendor parent, parent cycle, duplicate plan id, plan feature not a descendant, inclusion of unknown product, `plan` not defined on product, both `plan` and `custom_plan`, unknown availability, unknown licence kind, same product+plan twice in one licence, `requires` unknown licence, `requires` itself, CRLF file, non-UTF-8 file.
  - `test_review_notes_are_allowed()`: a licence with a non-empty `review` list validates with no errors.
- [ ] **Step 2: Run** `python -m pytest tests/test_catalog.py -q`. Expected: fails (module missing).
- [ ] **Step 3: Implement** schemas (Draft 2020-12, `additionalProperties: false`, patterns from Global Constraints) and `tools/catalog.py` (jsonschema `Draft202012Validator` for structure as `tools/validate_library.py` does, Python for cross-file checks).
- [ ] **Step 4: Run** `python -m pytest -W error -q`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: add product and licence catalog format and validator` (plus progress log line), push.

### Task 2: Catalog index, publish step and data loader

**Files:**
- Create: `webui/src/types/catalog.ts`, `webui/src/logic/catalogIndex.ts`, `webui/src/logic/catalogIndex.test.ts`, `webui/src/logic/catalogTree.ts`, `webui/src/logic/catalogTree.test.ts`, `webui/src/data/catalog.ts`, `webui/src/data/catalog.test.ts`
- Modify: `scripts/copy-baselines.mjs` (also copy `catalog/` to `webui/public/catalog/`, dot-files excluded, and write `webui/public/catalog/_index.json` compact), `webui/.gitignore` (add `public/catalog`)

**Interfaces:**
- Consumes: catalog file shapes from Task 1.
- Produces (`types/catalog.ts`):
  ```ts
  type Availability = 'included' | 'add_on' | 'package_feature'
  interface CatalogPlan { id: string; title: string; description: string | null; features: string[] }
  interface CatalogVendor { id: string; title: string; url: string | null }
  interface CatalogProduct { id: string; title: string; vendor: string; parent: string | null; category: string | null; description: string | null; links: { title: string; url: string }[]; targets: string[]; plans: CatalogPlan[] }
  interface CatalogInclusion { product: string; plan?: string; custom_plan?: { title: string; description: string | null }; availability: Availability; note: string | null }
  interface CatalogLicence { id: string; title: string; vendor: string; family: string; kind: 'subscription' | 'add_on'; requires: string[]; description: string | null; links: { title: string; url: string }[]; includes: CatalogInclusion[]; review: string[] }
  interface ProductLicenceEntry { licence: string; availability: Availability; planId: string | null /* full plan id */; customPlanTitle: string | null; via: 'direct' | 'plan'; viaPlanId: string | null; note: string | null }
  interface CatalogIndex { schema_version: 1; vendors: CatalogVendor[]; products: CatalogProduct[]; licences: CatalogLicence[]; by_product: Record<string, ProductLicenceEntry[]> }
  ```
- Produces (`logic/catalogIndex.ts`): `buildCatalogIndex(files: { kind: 'vendors' | 'product' | 'licence'; fileName: string; value: unknown }[], warn: (message: string) => void): CatalogIndex` (skips structurally unusable files with a warning; sorted output, byte-stable); `fullPlanId(productId: string, planId: string): string`.
- Produces (`logic/catalogTree.ts`): `effectiveInclusions(licence: CatalogLicence, productsById: Map<string, CatalogProduct>): EffectiveInclusion[]` where `EffectiveInclusion = CatalogInclusion & { via: 'direct' | 'plan'; viaPlanId: string | null }` (direct wins over plan-derived for the same product); `effectiveInclusionTree(inclusions: EffectiveInclusion[], productsById): InclusionCategory[]` with `InclusionCategory = { category: string; roots: InclusionNode[] }`, `InclusionNode = { product: CatalogProduct; inclusions: EffectiveInclusion[] /* empty = context-only ancestor */; children: InclusionNode[] }`; `topLevelAncestor(productId, productsById): CatalogProduct`; `categoryOf(productId, productsById): string` ("Other" when null).
- Produces (`data/catalog.ts`): `loadCatalogIndex(): Promise<{ index: CatalogIndex | null; warning: string | null }>` fetching `catalog/_index.json` relative to the app base, never throwing.

- [ ] **Step 1: Write failing Vitest tests:**
  - `catalogIndex.test.ts`: `by_product` lists a direct inclusion with `via: 'direct'`; a plan with `features: ['x']` gives `x` an entry `via: 'plan'`, `viaPlanId` the full plan id; a feature included both ways appears once with `via: 'direct'`; a licence file missing `includes` is skipped and `warn` called; output of building twice is deep-equal and products are sorted by id.
  - `catalogTree.test.ts`: a licence including only feature `a.child` (parent `a.root`, root not included) yields one category whose root node is `a.root` with `inclusions: []` and child `a.child` with one inclusion (Review Focus 1); category comes from the top-level ancestor; null category becomes "Other".
  - `catalog.test.ts`: fetch failing or returning `{}` resolves to `{ index: null, warning: <non-empty> }`.
- [ ] **Step 2: Run** `bun run test` in `webui/`. Expected: new tests fail.
- [ ] **Step 3: Implement** the three modules and the publish-step change (mirror the mapping-file reading in `copy-baselines.mjs`, including the UTF-8/LF/safe-name skip).
- [ ] **Step 4: Run** `bun run test`, `bun run lint`, `bun run build` in `webui/`. Expected: pass; `webui/public/catalog/_index.json` exists.
- [ ] **Step 5: Commit** `feat: generate the catalog index at publish time`, push.

### Task 3: Seed Microsoft 365 Business and Enterprise data (one-off, scripts stay in the scratchpad)

**Files:**
- Create: `catalog/products/microsoft/*.json`, `catalog/licences/microsoft/*.json` (remove the `.gitkeep`s)

Inputs are already downloaded to the session scratchpad `sources/` folder: `matrix.htm`, `enterprise.pdf`, `smb.pdf`. Rules are design §7 and §10. Licences (9): Business Basic, Business Standard, Business Premium, Defender and Purview Suites for Business Premium (`kind: add_on`, `requires` Business Premium), M365 E3, M365 E5, M365 E7, Defender Suite and Purview Suite (`kind: add_on`, `requires` M365 E3).

- [ ] **Step 1: Extract** (Sonnet, Python with `pymupdf` and `re`, run with `python -I`): `matrix.json` (row id, title, indent depth, group, link, per in-scope column the cell symbol/text/tooltip) and `pdf.json` (row name, section, per column "●" present, using x positions of column headers). Check: matrix row counts per in-scope column are non-zero; PDF has a value for each of its licence columns that map to the 9.
- [ ] **Step 2: Match names** (Haiku): for PDF rows with no exact normalised title match, choose the matrix row from a short candidate list or "none". Output `name-matches.json`.
- [ ] **Step 3: Generate** catalog files (Sonnet): dedupe by matrix row id, hierarchy from indent, slugs per §10, plans per §10, availability per §7, PDF wins with a `review` note on disagreement; unmatched PDF rows become a `review` note on each licence they mark. No descriptions, no source fields.
- [ ] **Step 4: Validate** `python -m tools.catalog` and `python -m pytest -W error -q`. Expected: no errors.
- [ ] **Step 5: Review** (fresh Sonnet): spot-check 15 random inclusions against `matrix.json`/`pdf.json`, check for title garbage (HTML entities, trailing symbols), wrong parents, empty licences. Fix findings.
- [ ] **Step 6: Commit** `feat: seed Microsoft 365 Business and Enterprise catalog`, push.

### Task 4: URL state and the Licences tab

**Files:**
- Modify: `webui/src/state/urlState.ts` (+ its test), `webui/src/state/filterStore.ts`, `webui/src/views/viewRegistry.tsx`, `webui/src/views/viewContext.ts` (add `catalog: CatalogIndex | null`), wherever AppShell loads the library (load the catalog alongside it, push its warning into the existing warnings notice)
- Create: `webui/src/views/LicencesView.tsx`, `webui/src/components/catalog/AvailabilityBadge.tsx`, `webui/src/components/catalog/LicenceList.tsx`, `webui/src/components/catalog/LicenceDetail.tsx`, `webui/src/components/catalog/InclusionTree.tsx`, `webui/src/components/catalog/LicenceCompare.tsx`, `webui/src/logic/licenceCompare.ts` (+ test)
- Create: `webui/e2e/catalog.spec.ts`

**Interfaces:**
- `UrlState` gains `licence: string | null` (param `licence`), `product: string | null` (param `product`), `compare: string[]` (repeated param `compare`, consistent with the existing list params; recorded as a deviation from the `,`-joined form in design §10).
- `filterStore` gains `setLicence(id: string | null)`, `setProduct(id: string | null)`, `setCompare(ids: string[])`; `hrefForCatalogEntry(state, view: 'licences' | 'products', id: string): string`.
- `logic/licenceCompare.ts`: `compareRows(licences: CatalogLicence[], productsById): CompareRow[]` with `CompareRow = { product: CatalogProduct; depth: number; cells: (EffectiveInclusion | null)[] }`, tree order; `isUniform(row: CompareRow): boolean`.
- `AvailabilityBadge({ availability })`: existing `Badge`, a lucide icon plus the label (Check "Included", Plus "Add-on", Package "Package feature"), so availability never relies on colour alone.

**UI decisions (Opus):**
- Layout: on `lg` and up, a two-pane view: left list `w-80` scrolling independently, right detail. Below `lg`, the list shows when nothing is selected; selecting shows the detail with a "All licences" back link at the top.
- List: grouped by vendor title then `family` headings; each item shows title, an "Add-on" outline badge when `kind === 'add_on'`, and a small amber dot with `aria-label="Needs review"` when `review` is non-empty. A "Compare" toggle button in the list header switches items to checkboxes; with 2+ checked the right pane shows the matrix.
- Detail header: title, "Vendor · Family", kind badge, "Requires" as links to those licences, links list. If `review` is non-empty, an amber bordered callout "Needs review" listing each note.
- Inclusions: a toolbar with availability filter chips (All, Included, Add-on, Package feature, with counts) and a text filter; then one section per category (heading with count), rendering `effectiveInclusionTree` as an indented tree. Each row: product title as a link to the Products tab, plan title as an outline badge (shared plan title or custom plan title, custom plan italic with tooltip "Specific to this licence"), `AvailabilityBadge`, "via <plan title>" muted text for plan-derived, note as muted text under the title. Context-only ancestors render muted with no badges. Tree sections start expanded; each root is collapsible.
- Compare matrix: a `table` inside an `overflow-x-auto` container; sticky header row and sticky first column (product title, indented by `depth`, background token so it covers scrolling cells); cells centred showing the availability icon with plan text under it, empty cell shows a muted "-"; a "Hide identical rows" checkbox (default on). Column headers are licence titles linking to the licence.
- Empty and error states: no catalog → message "The product and licence catalog could not be loaded." in the pane; unknown `licence` id → list with no selection (Review Focus 2).

- [ ] **Step 1: Write failing tests:** urlState round-trip for `licence`, `product`, `compare` (repeated) and defaults omitted; `licenceCompare.test.ts` (row order follows tree, `isUniform` true when all cells equal availability and plan, false otherwise); e2e `catalog.spec.ts` using `page.route` to serve a fixture `catalog/_index.json`: Licences tab lists families, selecting a licence updates the URL and shows a feature under a context-only parent (Review Focus 1), the product link switches to the Products tab URL, `?view=licences&licence=nope` renders without error (Review Focus 2), a 404 index shows the warning while the Rules tab still lists rules (Review Focus 3), Compare with two licences shows the matrix and hiding identical rows reduces the row count.
- [ ] **Step 2: Run** `bun run test` and `bun run test:e2e`. Expected: new tests fail.
- [ ] **Step 3: Implement** the URL state, store actions, view registration (`{ id: 'licences', label: 'Licences' }` after Rules), and components.
- [ ] **Step 4: Verify:** `bun run test`, `bun run lint`, `bun run build`, `bun run test:e2e` pass. Take Playwright screenshots against the real seeded catalog at 375 px and 1440 px, light and dark, of the licence detail for Microsoft 365 E5 and the compare matrix (E3, E5, Business Premium); read each with the Read tool; the page must not scroll horizontally at 375 px (Review Focus 4).
- [ ] **Step 5: Opus UI review** of the screenshots and components; apply fixes; re-screenshot.
- [ ] **Step 6: Commit** `feat: add the Licences tab`, push.

### Task 5: The Products tab

**Files:**
- Create: `webui/src/views/ProductsView.tsx`, `webui/src/components/catalog/ProductList.tsx`, `webui/src/components/catalog/ProductDetail.tsx`, `webui/src/logic/productSearch.ts` (+ test)
- Modify: `webui/src/views/viewRegistry.tsx` (`{ id: 'products', label: 'Products' }` after Licences), `webui/e2e/catalog.spec.ts`

**Interfaces:**
- Consumes: `CatalogIndex`, `topLevelAncestor`, `categoryOf`, `AvailabilityBadge`, `TargetIcons`, `setProduct`, `hrefForCatalogEntry` from Tasks 2 and 4.
- `logic/productSearch.ts`: `productTree(products: CatalogProduct[]): ProductTreeVendor[]` (`{ vendor: CatalogVendor; categories: { category: string; roots: ProductTreeNode[] }[] }`, `ProductTreeNode = { product; children }`, sorted by title); `searchProducts(products, query: string): { product: CatalogProduct; path: CatalogProduct[] }[]` (case-insensitive title match, `path` = ancestors top-down).

**UI decisions (Opus):**
- Same two-pane and narrow-screen behaviour as the Licences tab (back link "All products").
- List: a search input at the top. With no query: vendor, then category headings, then a collapsible tree (top-level products collapsed by default, a chevron shows child count). With a query: a flat result list, each result showing its title and a muted breadcrumb path.
- Detail: breadcrumb of ancestors (links), title, vendor, `TargetIcons` when targets exist, description when present, links. "Plans" section when plans exist: one card per plan with title, description, and its features as links. "Features" section listing direct children as links. "Included in" section: groups by availability (Included, Add-on, Package feature), each entry the licence title as a link, plan or custom plan badge, "via <plan title>" when plan-derived, note. When nothing includes it: "No licence in the catalog includes this directly." with a note that it may come with a parent product.

- [ ] **Step 1: Write failing tests:** `productSearch.test.ts` (tree nesting and sort, search returns breadcrumb path, empty query returns []); e2e: Products tab search finds a feature and shows its breadcrumb, selecting it shows "Included in" with the fixture licence, the licence link goes back to the Licences tab with that licence selected, `?view=products&product=nope` renders without error.
- [ ] **Step 2: Run** tests. Expected: new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** as Task 4 Step 4 (screenshots: Microsoft Entra ID detail and a search for "Defender", 375 px and 1440 px, light and dark).
- [ ] **Step 5: Opus UI review**, fixes, re-screenshot.
- [ ] **Step 6: Commit** `feat: add the Products tab`, push. Then a whole-branch review.

### Task 6: Page routes, history, collapsible groups and polish (maintainer feedback, 2026-10-27)

**Files:**
- Modify: `webui/src/state/urlState.ts` (+ test), `webui/src/state/filterStore.ts`, `webui/src/components/layout/ViewTabs.tsx`, `webui/src/components/catalog/LicenceList.tsx`, `webui/src/components/catalog/ProductList.tsx`, the Rules search input component, `webui/package.json` build script (or a small `scripts/route-pages.mjs`), `webui/e2e/*.spec.ts`
- Modify: `.github/workflows/deploy-pages.yml` only if the build output location changes (it should not)

**Decisions:**
- **Routes:** the view comes from the path, not `?view=`: `<base>rules`, `<base>licences`, `<base>products`, where `<base>` is Vite's `import.meta.env.BASE_URL` (`/intune-compliance-toolkit/` in production, `/` in dev). `<base>` alone shows Rules and replaces the URL with `<base>rules`. A legacy `?view=<id>` URL is converted to the path form with `replaceState`. All other query parameters keep their names.
- **Static hosting:** after `vite build`, copy `dist/index.html` to `dist/rules/index.html`, `dist/licences/index.html` and `dist/products/index.html` so a refresh or deep link on GitHub Pages loads the app with status 200. Every runtime fetch (baselines, catalog) must resolve against `BASE_URL`, not the page path.
- **History:** `pushState` for a view switch, selecting or clearing a licence or product, opening a mapped rule, and entering or leaving compare mode. `replaceState` for search typing, filter changes, paging, and ticking licences inside compare. A `popstate` listener re-parses the URL into the store, so back and forward restore the exact view and selection.
- **Tab bar:** no scrollbar may appear on the tab bar at any width when the tabs fit. The current one comes from `overflow-x-auto` plus the tabs' `-mb-px`; keep horizontal scrolling only when the tabs genuinely overflow.
- **Collapsible groups:** in the Licences list, each vendor and each family heading is a collapsible button (chevron, `aria-expanded`). In the Products list, each vendor and each category heading is the same. Groups start collapsed; the group(s) containing the current selection start expanded. While a product search query is active, the flat results list is shown as now (no groups).
- **Rules search box:** use the same classes as the Products search input (rounded-full pill, same height and focus ring).

- [ ] **Step 1: Write failing tests:** urlState: parse view from path with and without base, legacy `?view=` conversion, serialize to path plus query; e2e: direct load of `/licences?licence=microsoft.m365-e5` shows E5; clicking a licence then a product link then `page.goBack()` twice returns to the licence and then the list; groups are collapsed by default and the selection's group is open; the tab bar has `scrollHeight <= clientHeight`.
- [ ] **Step 2: Run** them. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** `bun run test`, `lint`, `build` (check `dist/licences/index.html` exists), `test:e2e`; screenshots of the tab bar, both lists collapsed, and the Rules search at 375 and 1440 px.
- [ ] **Step 5: Commit** `feat: give each view its own page and keep browser history`, push.

### Task 7: Replace "package feature" with included or add-on via a named package

**Files:**
- Modify: `catalog/_licence.schema.json`, `tools/catalog.py`, `tests/test_catalog.py` (+ fixtures), `webui/src/types/catalog.ts`, `webui/src/logic/catalogIndex.ts`, `webui/src/logic/catalogTree.ts`, `webui/src/logic/licenceCompare.ts`, `webui/src/components/catalog/*`, their tests and e2e fixtures; every `catalog/licences/microsoft/*.json`; the design doc §4.3, §7.

**Decisions:**
- `availability` becomes exactly `included` or `add_on`. An inclusion gains optional `package`: the product id of the bundle that must be bought to get it. Validator errors: `package` not an existing product; `package` not an ancestor of the inclusion's product; `package` set with `availability: included`; the licence does not itself list `package` with `availability: add_on`.
- **Data migration** (a one-off script in the scratchpad, results committed): for each `package_feature` inclusion, walk up the product's ancestors to the nearest one the same licence lists with a non-package availability. Ancestor `included` -> `included`, no package. Ancestor `add_on` -> `add_on` with `package` set to that ancestor. No such ancestor -> `add_on`, no package, and a review note "<title>: part of a package that is not recorded yet." Where the official comparison (scratchpad `extract/pdf.json`, matched rows) marks the row for that licence, its value wins as before.
- **UI:** the "Package feature" badge goes away. An add-on with a package shows "Add-on via <package title>" with the package title linking to that product, in the Licences tree, the compare matrix tooltip and screen-reader text, and the Products "Included in" list. The compare legend loses "Package feature".

- [ ] **Step 1: Write failing tests** for each new validator error, the index and tree carrying `package`, and the UI text "Add-on via".
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement** code, migrate data, update design §4.3/§7 text.
- [ ] **Step 4: Verify** pytest, `python -m tools.catalog`, `bun run test`, `lint`, `build`, `test:e2e`; screenshots of a licence with a Teams Premium package and the compare legend.
- [ ] **Step 5: Commit** `feat: name the package behind add-on features`, push.

