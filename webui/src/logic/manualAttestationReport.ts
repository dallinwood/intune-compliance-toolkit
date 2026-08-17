import type { ManualAttestationEntry } from './chunking'

export function buildManualAttestationMarkdown(entries: ManualAttestationEntry[]): string {
  if (entries.length === 0) {
    return '# Manual attestation\n\nNo rules require manual attestation.\n'
  }

  const lines = [
    '# Manual attestation',
    '',
    'These selected rules could not be included in a generated compliance script and need to be verified manually.',
    '',
  ]
  for (const entry of entries) {
    lines.push(`- **${entry.id} - ${entry.title}**: ${entry.reason}`)
  }
  return lines.join('\n') + '\n'
}
