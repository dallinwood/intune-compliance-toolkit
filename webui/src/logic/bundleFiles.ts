import type { BundleFile } from './zipBundle'
import type { Chunk, ManualAttestationEntry } from './chunking'
import { buildManualAttestationMarkdown } from './manualAttestationReport'
import { platformLabel, scriptKindForPlatform } from './platformScriptKind'
import { generateBashScript } from './scriptGen/bash'
import { generatePowerShellScript } from './scriptGen/powershell'

// Names files by the range of CIS rule ids they contain rather than an
// opaque "section N (part P)" label, so an admin can tell what's inside a
// bundle file without opening it. Product/version are included (not just
// platform+family) because two different benchmark versions on the same
// platform can otherwise produce the exact same id range.
function bundleBaseName(chunk: Chunk): string {
  const firstId = chunk.rules[0].id
  const lastId = chunk.rules[chunk.rules.length - 1].id
  return `${platformLabel(chunk.platform)}-${chunk.family}-${chunk.product}-${chunk.version}-${firstId}-${lastId}`
}

function chunkFiles(chunk: Chunk): BundleFile[] {
  const baseName = bundleBaseName(chunk)
  const scriptRules = chunk.rules.map((rule) => ({ id: rule.id, title: rule.title, steps: rule.steps }))
  const kind = scriptKindForPlatform(chunk.platform)
  const script = kind === 'bash' ? generateBashScript(scriptRules) : generatePowerShellScript(scriptRules)
  const scriptExtension = kind === 'bash' ? 'sh' : 'ps1'

  return [
    { path: `${baseName}-discovery.${scriptExtension}`, content: script },
    { path: `${baseName}-rules.json`, content: JSON.stringify({ Rules: chunk.ruleEntries }, null, 2) },
  ]
}

// Assembles every file the downloadable zip needs: a discovery
// script + rules JSON pair per chunk, plus one manual-attestation report
// covering every selected rule that couldn't be scripted.
export function buildBundleFiles(chunks: Chunk[], manualEntries: ManualAttestationEntry[]): BundleFile[] {
  const files = [...chunks.flatMap(chunkFiles), { path: 'manual-attestation.md', content: buildManualAttestationMarkdown(manualEntries) }]

  // Should be unreachable given packChunks' grouping (distinct benchmark +
  // id-range combinations can't collide) - kept as a loud safeguard rather
  // than silently overwriting a file if that invariant is ever broken.
  const seen = new Set<string>()
  for (const file of files) {
    if (seen.has(file.path)) {
      throw new Error(`Two generated bundle files would have the same name: "${file.path}".`)
    }
    seen.add(file.path)
  }

  return files
}
