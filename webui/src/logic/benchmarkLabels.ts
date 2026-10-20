const BENCHMARK_LABELS: Record<string, string> = {
  cis_lvl1: 'CIS Level 1',
  cis_lvl2: 'CIS Level 2',
  disa_stig: 'DISA STIG',
  nlmapgov_base: 'NLMAPGOV Base',
  nlmapgov_plus: 'NLMAPGOV Plus',
}

export function benchmarkLabel(name: string): string {
  return BENCHMARK_LABELS[name] ?? name
}

export function macosVersionLabel(version: string): string {
  return `macOS ${version.split('.')[0]}`
}
