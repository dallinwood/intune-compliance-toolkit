// Copies baselines/ into webui/public/baselines/ so the built static site
// can fetch rule JSON and the generated _index.json/_manifest.json files at
// runtime - GitHub Pages serves whatever's in the build output, and Vite's
// publicDir can't reach outside webui/ on its own.
//
// Paths are resolved from this file's own location, not the working
// directory, so it behaves the same whether invoked from the repo root or
// from webui/.

import { cp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "baselines");
const destination = join(repoRoot, "webui", "public", "baselines");

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });

console.log(`Copied ${source} -> ${destination}`);
