import { describe, expect, it } from 'vitest'
import { effectiveAuditMethodIndex, scriptedMethodIndexes } from './auditMethods'
import type { AuditMethod } from '../types/rule-detail'

const MANUAL: AuditMethod = { method_name: 'Graphical Method', type: 'manual', description: '...' }
const SCRIPTED_A: AuditMethod = { method_name: 'Terminal Method', type: 'scripted', description: '...', steps: [] }
const SCRIPTED_B: AuditMethod = { method_name: 'Registry Method', type: 'scripted', description: '...', steps: [] }

describe('scriptedMethodIndexes', () => {
  it('returns the indexes of scripted methods only, in order', () => {
    expect(scriptedMethodIndexes([MANUAL, SCRIPTED_A, SCRIPTED_B])).toEqual([1, 2])
  })

  it('returns an empty array when no method is scripted', () => {
    expect(scriptedMethodIndexes([MANUAL])).toEqual([])
  })
})

describe('effectiveAuditMethodIndex', () => {
  it('returns the explicitly selected index when it points at a scripted method', () => {
    expect(effectiveAuditMethodIndex([MANUAL, SCRIPTED_A, SCRIPTED_B], 2)).toBe(2)
  })

  it('falls back to the first scripted method when nothing is explicitly selected', () => {
    expect(effectiveAuditMethodIndex([MANUAL, SCRIPTED_A, SCRIPTED_B], null)).toBe(1)
  })

  it('falls back to the first scripted method when the selected index points at a manual method', () => {
    expect(effectiveAuditMethodIndex([MANUAL, SCRIPTED_A], 0)).toBe(1)
  })

  it('returns null when the rule has no scripted method at all', () => {
    expect(effectiveAuditMethodIndex([MANUAL], null)).toBeNull()
    expect(effectiveAuditMethodIndex([MANUAL], 0)).toBeNull()
  })
})
