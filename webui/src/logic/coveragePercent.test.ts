import { describe, expect, it } from 'vitest'
import { formatCoveragePercent } from './coveragePercent'

describe('formatCoveragePercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatCoveragePercent(140, 1014)).toBe('14%')
    expect(formatCoveragePercent(1014, 1014)).toBe('100%')
  })

  it('shows <1% for a covered count that rounds to zero, and 0% for none', () => {
    expect(formatCoveragePercent(1, 1014)).toBe('<1%')
    expect(formatCoveragePercent(0, 1014)).toBe('0%')
    expect(formatCoveragePercent(0, 0)).toBe('0%')
  })
})
