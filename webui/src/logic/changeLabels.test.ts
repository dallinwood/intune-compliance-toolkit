import { describe, expect, it } from 'vitest'
import { KIND_LABELS } from './changeLabels'
import { CHANGE_KINDS } from './ruleChanges'

describe('KIND_LABELS', () => {
  it('has a plain-word label for every kind of change', () => {
    expect(CHANGE_KINDS.map((kind) => KIND_LABELS[kind])).toEqual(['Behaviour', 'Scope', 'Wording', 'References'])
  })
})
