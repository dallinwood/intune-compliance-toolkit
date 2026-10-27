// Copies baselines/ into webui/public/baselines/ so the built static site
// can fetch rule JSON and the generated _index.json/_manifest.json files at
// runtime - GitHub Pages serves whatever's in the build output, and Vite's
// publicDir can't reach outside webui/ on its own.
//
// The maintainer's overlays live in baselines/_overlays/rules/ (next to
// scripts/ and payloads/, like a source's rules/ folder) and arrive with that
// copy. This script also writes webui/public/baselines/_overlays/_index.json,
// since a static site cannot list a directory and the app should not fetch
// every overlay at startup: per overlay it lists the targets and only the
// fields an index entry carries (see webui/src/logic/overlayIndex.ts), plus a
// by_rule lookup. The app fetches an overlay's own file when a rule it
// targets is opened. The index is only ever written to the published copy,
// never to the repo's baselines/.
//
// Rule mappings in baselines/_mappings/rules/ are turned into
// webui/public/baselines/_mappings/_index.json the same way: one by-rule
// lookup (see webui/src/logic/mappingIndex.ts), so the app needs a single
// startup fetch to show a rule's mapped rules from either side. With no
// mapping files the index is still written, empty.
//
// catalog/ (docs/plans/2026-10-27-product-licence-catalog-design.md) is
// copied to webui/public/catalog/ the same way, and its vendor, product and
// licence files become webui/public/catalog/_index.json (see
// webui/src/logic/catalogIndex.ts): everything the Products and Licences views
// list plus a by_product lookup, so the app makes a single startup fetch.
//
// Run it with bun (see the copy-baselines script in webui/package.json): it
// imports the app's TypeScript, which plain node cannot load.
//
// Paths are resolved from this file's own location, not the working
// directory, so it behaves the same whether invoked from the repo root or
// from webui/.

if (typeof Bun === "undefined") {
  console.error("copy-baselines.mjs must run under bun (it imports TypeScript); use `bun run copy-baselines` from webui/.");
  process.exit(1);
}

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bun runs this script, so it can import the app's own TypeScript: one
// structural check for overlay files, shared with the app.
const { buildOverlayIndex } = await import("../webui/src/logic/overlayIndex.ts");
const { buildMappingIndex } = await import("../webui/src/logic/mappingIndex.ts");
const { buildCatalogIndex } = await import("../webui/src/logic/catalogIndex.ts");

const OVERLAY_INDEX_NAME = "_index.json";
// Left over from before the index existed; never an overlay.
const OVERLAY_MANIFEST_NAME = "_manifest.json";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinesSource = join(repoRoot, "baselines");
const baselinesDestination = join(repoRoot, "webui", "public", "baselines");
const overlaysDestination = join(baselinesDestination, "_overlays");
const overlayRulesDestination = join(overlaysDestination, "rules");
const mappingsDestination = join(baselinesDestination, "_mappings");
const mappingRulesDestination = join(mappingsDestination, "rules");
const MAPPING_INDEX_NAME = "_index.json";
const catalogSource = join(repoRoot, "catalog");
const catalogDestination = join(repoRoot, "webui", "public", "catalog");
const CATALOG_INDEX_NAME = "_index.json";
const CATALOG_VENDORS_FILE = "vendors.json";

await rm(baselinesDestination, { recursive: true, force: true });
// Dot-prefixed entries (editor/OS droppings, local scratch files) are not
// part of the published library at any depth.
await cp(baselinesSource, baselinesDestination, {
  recursive: true,
  filter: (entryPath) => !basename(entryPath).startsWith("."),
});
console.log(`Copied ${baselinesSource} -> ${baselinesDestination}`);

// Same selection and order as overlay_file_names in tools/overlays.py (read
// from the published copy, which is identical to the source): the
// plain code-unit sort matches Python's sorted(), so both apply overlays in
// the same order.
async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function overlayFileNames() {
  const entries = await directoryEntries(overlayRulesDestination);
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !entry.name.startsWith(".") &&
        entry.name !== OVERLAY_MANIFEST_NAME,
    )
    .map((entry) => entry.name)
    .sort();
}

const overlayFiles = [];
for (const fileName of await overlayFileNames()) {
  const path = join(overlayRulesDestination, fileName);
  try {
    overlayFiles.push({ fileName, value: JSON.parse(await readFile(path, "utf8")) });
  } catch (error) {
    console.warn(`${fileName}: cannot read JSON (${error.message}). It was skipped.`);
  }
}
const overlayIndex = buildOverlayIndex(overlayFiles, (message) => console.warn(message));
await mkdir(overlaysDestination, { recursive: true });
await writeFile(join(overlaysDestination, OVERLAY_INDEX_NAME), `${JSON.stringify(overlayIndex, null, 2)}
`);
console.log(`Indexed ${overlayIndex.overlays.length} overlay file(s) in ${join(overlaysDestination, OVERLAY_INDEX_NAME)}`);

// Same selection and order as mapping_file_names in tools/mappings.py. The
// copy above already left out .gitkeep, so a folder holding only that is
// empty or missing here and gives an empty index.
async function mappingFileNames() {
  const entries = await directoryEntries(mappingRulesDestination);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

// The same file checks as load_mappings in tools/mappings.py, so the index
// never holds a file CI would reject for its name, encoding or line endings.
const SAFE_FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

async function readCheckedJsonFile(directory, fileName) {
  if (!SAFE_FILE_NAME.test(fileName)) return { problem: "the file name must use only letters, digits, '.', '_' and '-'" };
  const bytes = await readFile(join(directory, fileName));
  let text;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    return { problem: "the file is not UTF-8" };
  }
  if (text.includes("\r")) return { problem: "the file must use LF line endings, not CRLF" };
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { problem: `cannot read JSON (${error.message})` };
  }
}

const mappingFiles = [];
for (const fileName of await mappingFileNames()) {
  const file = await readCheckedJsonFile(mappingRulesDestination, fileName);
  if ("problem" in file) console.warn(`${fileName}: ${file.problem}. It was skipped.`);
  else mappingFiles.push({ fileName, value: file.value });
}
const mappingIndex = buildMappingIndex(mappingFiles, (message) => console.warn(message));
await mkdir(mappingsDestination, { recursive: true });
// Compact, unlike the overlay index: this one grows with every link (design
// section 5), and nobody reads it by hand.
await writeFile(join(mappingsDestination, MAPPING_INDEX_NAME), `${JSON.stringify(mappingIndex)}
`);
console.log(
  `Indexed ${mappingFiles.length} mapping file(s) for ${Object.keys(mappingIndex.by_rule).length} rule(s) in ${join(mappingsDestination, MAPPING_INDEX_NAME)}`,
);

await rm(catalogDestination, { recursive: true, force: true });
await cp(catalogSource, catalogDestination, {
  recursive: true,
  filter: (entryPath) => !basename(entryPath).startsWith("."),
});
console.log(`Copied ${catalogSource} -> ${catalogDestination}`);

// Same selection as _catalog_files in tools/catalog.py: every .json file under
// products/ and licences/ at any depth. Names are relative paths with forward
// slashes so warnings read the same on every platform.
async function catalogJsonFiles(folderName) {
  const folder = join(catalogDestination, folderName);
  const entries = await directoryEntries(folder);
  const relativePaths = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      for (const nestedPath of await catalogJsonFiles(`${folderName}/${entry.name}`)) relativePaths.push(nestedPath);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      relativePaths.push(`${folderName}/${entry.name}`);
    }
  }
  return relativePaths.sort();
}

async function readCatalogFile(kind, relativePath) {
  const separatorPosition = relativePath.lastIndexOf("/");
  const directory = separatorPosition === -1 ? catalogDestination : join(catalogDestination, relativePath.slice(0, separatorPosition));
  const file = await readCheckedJsonFile(directory, relativePath.slice(separatorPosition + 1));
  if ("problem" in file) {
    console.warn(`${relativePath}: ${file.problem}. It was skipped.`);
    return null;
  }
  return { kind, fileName: relativePath, value: file.value };
}

const catalogFiles = [];
const sourceFiles = [
  ["vendors", [CATALOG_VENDORS_FILE]],
  ["product", await catalogJsonFiles("products")],
  ["licence", await catalogJsonFiles("licences")],
];
for (const [kind, relativePaths] of sourceFiles) {
  for (const relativePath of relativePaths) {
    const catalogFile = await readCatalogFile(kind, relativePath);
    if (catalogFile !== null) catalogFiles.push(catalogFile);
  }
}
const catalogIndex = buildCatalogIndex(catalogFiles, (message) => console.warn(message));
// Compact for the same reason as the mapping index.
await writeFile(join(catalogDestination, CATALOG_INDEX_NAME), `${JSON.stringify(catalogIndex)}
`);
console.log(
  `Indexed ${catalogIndex.products.length} product(s) and ${catalogIndex.licences.length} licence(s) in ${join(catalogDestination, CATALOG_INDEX_NAME)}`,
);
