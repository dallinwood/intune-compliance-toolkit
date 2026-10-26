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
// Paths are resolved from this file's own location, not the working
// directory, so it behaves the same whether invoked from the repo root or
// from webui/.

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bun runs this script, so it can import the app's own TypeScript: one
// structural check for overlay files, shared with the app.
import { buildOverlayIndex } from "../webui/src/logic/overlayIndex.ts";

const OVERLAY_INDEX_NAME = "_index.json";
// Left over from before the index existed; never an overlay.
const OVERLAY_MANIFEST_NAME = "_manifest.json";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinesSource = join(repoRoot, "baselines");
const baselinesDestination = join(repoRoot, "webui", "public", "baselines");
const overlaysDestination = join(baselinesDestination, "_overlays");
const overlayRulesDestination = join(overlaysDestination, "rules");

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
async function overlayFileNames() {
  let entries;
  try {
    entries = await readdir(overlayRulesDestination, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
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
