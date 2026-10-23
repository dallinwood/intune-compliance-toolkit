// Copies baselines/ into webui/public/baselines/ so the built static site
// can fetch rule JSON and the generated _index.json/_manifest.json files at
// runtime - GitHub Pages serves whatever's in the build output, and Vite's
// publicDir can't reach outside webui/ on its own.
//
// Also publishes the maintainer's overlays/ to webui/public/overlays/ with a
// generated _manifest.json listing them, since a static site cannot list a
// directory. The manifest is never committed or hand-written.
//
// Paths are resolved from this file's own location, not the working
// directory, so it behaves the same whether invoked from the repo root or
// from webui/.

import { copyFile, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OVERLAY_MANIFEST_NAME = "_manifest.json";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinesSource = join(repoRoot, "baselines");
const baselinesDestination = join(repoRoot, "webui", "public", "baselines");
const overlaysSource = join(repoRoot, "overlays");
const overlaysDestination = join(repoRoot, "webui", "public", "overlays");

await rm(baselinesDestination, { recursive: true, force: true });
// Dot-prefixed entries (editor/OS droppings, local scratch files) are not
// part of the published library at any depth.
await cp(baselinesSource, baselinesDestination, {
  recursive: true,
  filter: (entryPath) => !basename(entryPath).startsWith("."),
});
console.log(`Copied ${baselinesSource} -> ${baselinesDestination}`);

// Same selection and order as overlay_file_names in tools/overlays.py: the
// plain code-unit sort matches Python's sorted(), so both apply overlays in
// the same order.
async function overlayFileNames() {
  let entries;
  try {
    entries = await readdir(overlaysSource, { withFileTypes: true });
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

await rm(overlaysDestination, { recursive: true, force: true });
await mkdir(overlaysDestination, { recursive: true });
const overlayFiles = await overlayFileNames();
for (const fileName of overlayFiles) {
  await copyFile(join(overlaysSource, fileName), join(overlaysDestination, fileName));
}
await writeFile(
  join(overlaysDestination, OVERLAY_MANIFEST_NAME),
  `${JSON.stringify({ files: overlayFiles }, null, 2)}\n`,
);
console.log(`Published ${overlayFiles.length} overlay file(s) -> ${overlaysDestination}`);
