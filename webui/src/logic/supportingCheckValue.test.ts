import { describe, expect, it } from 'vitest'
import type { Odv } from '../types/library'
import { supportingCheckValueSummary } from './supportingCheckValue'

const numberOdv: Odv = {
  description: 'Minimum length',
  datatype: 'number',
  recommended: 15,
  by_benchmark: {},
  validation: { min: 1, max: 64 },
} as unknown as Odv

describe('supportingCheckValueSummary', () => {
  it('names the recommended value when nothing is stored', () => {
    expect(supportingCheckValueSummary(numberOdv, 'none', null, 'mscp.x')).toEqual({ text: 'Value: 15 (recommended)', kind: 'recommended' })
  })

  it('names a stored value as set by you', () => {
    expect(supportingCheckValueSummary(numberOdv, 'none', 20, 'mscp.x')).toEqual({ text: 'Value: 20 (set by you)', kind: 'set-by-you' })
  })

  it('flags a stored value that fails validation', () => {
    expect(supportingCheckValueSummary(numberOdv, 'none', 999, 'mscp.x').kind).toBe('invalid')
  })

  it('says a value is needed when there is neither a stored nor a recommended value', () => {
    const withoutRecommended = { ...numberOdv, recommended: null } as unknown as Odv
    expect(supportingCheckValueSummary(withoutRecommended, 'none', null, 'mscp.x').kind).toBe('missing')
  })

  it('shortens a long value onto one line', () => {
    const textOdv = { description: 'Banner', datatype: 'string', recommended: 'x'.repeat(100), by_benchmark: {} } as unknown as Odv
    const summary = supportingCheckValueSummary(textOdv, 'none', null, 'mscp.x')
    expect(summary.text).toBe(`Value: ${'x'.repeat(40)}... (recommended)`)
  })
})
