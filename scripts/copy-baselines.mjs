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
// mapping files the index is still written, empty. A link whose rule is not
// on its current release also gets the kinds of change since that release (from
// the history indexes below), so the app can say whether a review is due
// without fetching any history.
//
// Every release of every source in the manifest is also summarised into
// webui/public/baselines/_history/<source>.json (see
// webui/src/logic/historyIndex.ts): per rule and release, one fingerprint per
// kind of change. Comparing releases and a rule's timeline then need no rule
// file; the app fetches a rule's release files only to draw a diff. Like the
// other generated indexes it is only written to the published copy.
//
// catalog/ (docs/plans/2026-10-27-product-licence-catalog-design.md) is
// copied to webui/public/catalog/ the same way, and its vendor, product and
// licence files become webui/public/catalog/_index.json (see
// webui/src/logic/catalogIndex.ts): everything the Products and Licences views
// list plus a by_product lookup, so the app makes a single startup fetch.
//
// Two modes (see the scripts in webui/package.json):
//
//   (default)  Build mode, `bun run copy-baselines`: copies baselines/ and
//              catalog/ into webui/public/ and writes the generated files
//              into that copy. This is what the published site is built from.
//   --dev      Dev mode, `bun run generate-indexes`: copies nothing. Reads
//              baselines/ and catalog/ in place and writes only the generated
//              files into webui/.generated/, mirroring their served paths. The
//              dev server (webui/vite-plugins/baselinesDevServer.ts) serves
//              those first and falls back to the repo folders, so starting it
//              does not copy ~24,000 files.
//
// Both modes read the repo's own folders and produce identical generated
// files; the many small files are read 64 at a time to keep indexing fast.
//
// Run it with bun (see the scripts in webui/package.json): it
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
const { addChangedKinds, buildMappingIndex } = await import("../webui/src/logic/mappingIndex.ts");
const { buildCatalogIndex } = await import("../webui/src/logic/catalogIndex.ts");
const { buildHistoryIndex } = await import("../webui/src/logic/historyIndex.ts");

const OVERLAY_INDEX_NAME = "_index.json";
// Left over from before the index existed; never an overlay.
const OVERLAY_MANIFEST_NAME = "_manifest.json";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinesSource = join(repoRoot, "baselines");
const catalogSource = join(repoRoot, "catalog");
const developmentMode = process.argv.includes("--dev");
const outputRoot = developmentMode ? join(repoRoot, "webui", ".generated") : join(repoRoot, "webui", "public");
const baselinesDestination = join(outputRoot, "baselines");
const catalogDestination = join(outputRoot, "catalog");
const overlaysDestination = join(baselinesDestination, "_overlays");
const overlayRulesSource = join(baselinesSource, "_overlays", "rules");
const mappingsDestination = join(baselinesDestination, "_mappings");
const mappingRulesSource = join(baselinesSource, "_mappings", "rules");
const MAPPING_INDEX_NAME = "_index.json";
const READ_CONCURRENCY = 64;
const CATALOG_INDEX_NAME = "_index.json";
const CATALOG_VENDORS_FILE = "vendors.json";

// Applies the mapper to every item, at most `limit` at a time, and returns the
// results in the order of the items so the output stays deterministic.
async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextPosition = 0;
  async function worker() {
    while (nextPosition < items.length) {
      const position = nextPosition++;
      results[position] = await mapper(items[position], position);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

await rm(baselinesDestination, { recursive: true, force: true });
await rm(catalogDestination, { recursive: true, force: true });
if (!developmentMode) {
  // Dot-prefixed entries (editor/OS droppings, local scratch files) are not
  // part of the published library at any depth.
  await cp(baselinesSource, baselinesDestination, {
    recursive: true,
    filter: (entryPath) => !basename(entryPath).startsWith("."),
  });
  console.log(`Copied ${baselinesSource} -> ${baselinesDestination}`);
  await cp(catalogSource, catalogDestination, {
    recursive: true,
    filter: (entryPath) => !basename(entryPath).startsWith("."),
  });
  console.log(`Copied ${catalogSource} -> ${catalogDestination}`);
}

// Same selection and order as overlay_file_names in tools/overlays.py: the
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
  const entries = await directoryEntries(overlayRulesSource);
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

const overlayReads = await mapWithConcurrency(await overlayFileNames(), READ_CONCURRENCY, async (fileName) => {
  try {
    return { fileName, value: JSON.parse(await readFile(join(overlayRulesSource, fileName), "utf8")) };
  } catch (error) {
    return { fileName, problem: error.message };
  }
});
const overlayFiles = [];
for (const read of overlayReads) {
  if ("problem" in read) console.warn(`${read.fileName}: cannot read JSON (${read.problem}). It was skipped.`);
  else overlayFiles.push(read);
}
const overlayIndex = buildOverlayIndex(overlayFiles, (message) => console.warn(message));
await mkdir(overlaysDestination, { recursive: true });
await writeFile(join(overlaysDestination, OVERLAY_INDEX_NAME), `${JSON.stringify(overlayIndex, null, 2)}
`);
console.log(`Indexed ${overlayIndex.overlays.length} overlay file(s) in ${join(overlaysDestination, OVERLAY_INDEX_NAME)}`);

// Built before the mapping index, which notes what changed in each mapped rule.
const historyDestination = join(baselinesDestination, "_history");
await mkdir(historyDestination, { recursive: true });
const manifest = JSON.parse(await readFile(join(baselinesSource, "_manifest.json"), "utf8"));
const historyIndexes = [];
for (const source of manifest.sources) {
  const rulesByTag = new Map();
  for (const release of source.releases) {
    const releaseDirectory = dirname(join(baselinesSource, release.index_path));
    const releaseIndex = JSON.parse(await readFile(join(baselinesSource, release.index_path), "utf8"));
    const rules = await mapWithConcurrency(releaseIndex.rules, READ_CONCURRENCY, async (entry) => {
      const rule = JSON.parse(await readFile(join(releaseDirectory, entry.file), "utf8"));
      return { ...rule, file: entry.file };
    });
    rulesByTag.set(release.tag, rules);
  }
  const historyPath = join(historyDestination, `${source.name}.json`);
  // Compact for the same reason as the mapping index.
  const historyIndex = buildHistoryIndex(source, rulesByTag);
  historyIndexes.push(historyIndex);
  await writeFile(historyPath, `${JSON.stringify(historyIndex)}
`);
  console.log(`Indexed ${source.releases.length} release(s) of ${source.name} in ${historyPath}`);
}

// Same selection and order as mapping_file_names in tools/mappings.py. A
// folder holding only .gitkeep is empty here and gives an empty index.
async function mappingFileNames() {
  const entries = await directoryEntries(mappingRulesSource);
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

const mappingReads = await mapWithConcurrency(await mappingFileNames(), READ_CONCURRENCY, async (fileName) => ({
  fileName,
  file: await readCheckedJsonFile(mappingRulesSource, fileName),
}));
const mappingFiles = [];
for (const { fileName, file } of mappingReads) {
  if ("problem" in file) console.warn(`${fileName}: ${file.problem}. It was skipped.`);
  else mappingFiles.push({ fileName, value: file.value });
}
const mappingIndex = addChangedKinds(buildMappingIndex(mappingFiles, (message) => console.warn(message)), historyIndexes);
await mkdir(mappingsDestination, { recursive: true });
// Compact, unlike the overlay index: this one grows with every link (design
// section 5), and nobody reads it by hand.
await writeFile(join(mappingsDestination, MAPPING_INDEX_NAME), `${JSON.stringify(mappingIndex)}
`);
console.log(
  `Indexed ${mappingFiles.length} mapping file(s) for ${Object.keys(mappingIndex.by_rule).length} rule(s) in ${join(mappingsDestination, MAPPING_INDEX_NAME)}`,
);

// Same selection as _catalog_files in tools/catalog.py: every .json file under
// products/ and licences/ at any depth. Names are relative paths with forward
// slashes so warnings read the same on every platform.
async function catalogJsonFiles(folderName) {
  const folder = join(catalogSource, folderName);
  const entries = await directoryEntries(folder);
  const relativePaths = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
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
  const directory = separatorPosition === -1 ? catalogSource : join(catalogSource, relativePath.slice(0, separatorPosition));
  const file = await readCheckedJsonFile(directory, relativePath.slice(separatorPosition + 1));
  if ("problem" in file) {
    console.warn(`${relativePath}: ${file.problem}. It was skipped.`);
    return null;
  }
  return { kind, fileName: relativePath, value: file.value };
}

const sourceFiles = [
  ["vendors", [CATALOG_VENDORS_FILE]],
  ["product", await catalogJsonFiles("products")],
  ["licence", await catalogJsonFiles("licences")],
];
const catalogReadTasks = sourceFiles.flatMap(([kind, relativePaths]) => relativePaths.map((relativePath) => ({ kind, relativePath })));
const catalogReads = await mapWithConcurrency(catalogReadTasks, READ_CONCURRENCY, ({ kind, relativePath }) =>
  readCatalogFile(kind, relativePath),
);
const catalogFiles = catalogReads.filter((catalogFile) => catalogFile !== null);
await mkdir(catalogDestination, { recursive: true });
const catalogIndex = buildCatalogIndex(catalogFiles, (message) => console.warn(message));
// Compact for the same reason as the mapping index.
await writeFile(join(catalogDestination, CATALOG_INDEX_NAME), `${JSON.stringify(catalogIndex)}
`);
console.log(
  `Indexed ${catalogIndex.products.length} product(s) and ${catalogIndex.licences.length} licence(s) in ${join(catalogDestination, CATALOG_INDEX_NAME)}`,
);
