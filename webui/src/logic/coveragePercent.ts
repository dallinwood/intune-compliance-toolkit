// "<1%" rather than a misleading "0%" when something is covered but under half a percent.
export function formatCoveragePercent(count: number, total: number): string {
  if (total === 0 || count === 0) return '0%'
  const percent = Math.round((count / total) * 100)
  return percent === 0 ? '<1%' : `${percent}%`
}
