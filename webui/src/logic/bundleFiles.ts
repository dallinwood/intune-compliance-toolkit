import type { BundleFile } from './zipBundle'
import type { Chunk, ManualAttestationEntry } from './chunking'
import { buildManualAttestationMarkdown } from './manualAttestationReport'
import { scriptKindForPlatform, slugifyPlatform } from './platformScriptKind'
import { generateBashScript } from './scriptGen/bash'
import { generatePowerShellScript } from './scriptGen/powershell'

function bundleBaseName(chunk: Chunk): string {
  const part = chunk.partNumber !== null ? `-part-${chunk.partNumber}` : ''
  return `${slugifyPlatform(chunk.platform)}-section-${chunk.section}${part}`
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
  return [...chunks.flatMap(chunkFiles), { path: 'manual-attestation.md', content: buildManualAttestationMarkdown(manualEntries) }]
}
