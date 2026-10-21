import type { Chunk, ManualAttestationEntry } from './chunking'
import { buildManualAttestationMarkdown } from './manualAttestationReport'
import { generateBashScript } from './scriptGen/bash'
import type { BundleFile } from './zipBundle'

export const MANUAL_ATTESTATION_FILE = 'manual-attestation.md'

export function bundleBaseName(chunk: Chunk): string {
  const part = chunk.partNumber === null ? '' : `-part${chunk.partNumber}`
  return `macOS-${chunk.sourceName}-${chunk.releaseTag}-${chunk.section}${part}`
}

function chunkFiles(chunk: Chunk): BundleFile[] {
  const baseName = bundleBaseName(chunk)
  return [
    { path: `${baseName}-discovery.sh`, content: generateBashScript(chunk.rules.map((rule) => rule.plan)) },
    { path: `${baseName}-rules.json`, content: JSON.stringify({ Rules: chunk.ruleEntries }, null, 2) + '\n' },
  ]
}

// Every file the downloadable zip needs: a discovery script and rules JSON
// per chunk, plus one manual-attestation report for the rules no script checks.
export function buildBundleFiles(chunks: Chunk[], manualEntries: ManualAttestationEntry[]): BundleFile[] {
  const files = [...chunks.flatMap(chunkFiles), { path: MANUAL_ATTESTATION_FILE, content: buildManualAttestationMarkdown(manualEntries) }]

  // Unreachable while packChunks groups by source, release and section;
  // kept so a broken invariant fails loudly instead of overwriting a file.
  const seenPaths = new Set<string>()
  for (const file of files) {
    if (seenPaths.has(file.path)) throw new Error(`Two generated bundle files would have the same name: "${file.path}".`)
    seenPaths.add(file.path)
  }
  return files
}
