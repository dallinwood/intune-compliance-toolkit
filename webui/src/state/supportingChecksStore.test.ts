import { beforeEach, describe, expect, it } from 'vitest'
import type { SupportingCheckOffer, SupportingCheckOffers } from '../logic/supportingChecks'
import { useSupportingChecksStore } from './supportingChecksStore'

function offerFor(ruleId: string): SupportingCheckOffer {
  return { ruleId, depth: 1, supports: [] }
}

describe('supporting checks store', () => {
  beforeEach(() => {
    useSupportingChecksStore.getState().replaceAll({ includeSupporting: false, overrides: {} })
  })

  it('starts with supporting checks off and no overrides', () => {
    const { includeSupporting, overrides } = useSupportingChecksStore.getState()
    expect({ includeSupporting, overrides }).toEqual({ includeSupporting: false, overrides: {} })
  })

  it('sets the main toggle', () => {
    useSupportingChecksStore.getState().setIncludeSupporting(true)
    expect(useSupportingChecksStore.getState().includeSupporting).toBe(true)
  })

  it('stores an override and removes it again for the default choice', () => {
    const store = useSupportingChecksStore.getState()
    store.setRuleChoice('mscp.a', 'exclude')
    store.setRuleChoice('mscp.b', 'include')
    expect(useSupportingChecksStore.getState().overrides).toEqual({ 'mscp.a': 'exclude', 'mscp.b': 'include' })

    store.setRuleChoice('mscp.a', 'default')
    expect(useSupportingChecksStore.getState().overrides).toEqual({ 'mscp.b': 'include' })
  })

  it('writes one choice for every id in a group', () => {
    useSupportingChecksStore.getState().setGroupChoice(['mscp.a', 'mscp.b'], 'include')
    expect(useSupportingChecksStore.getState().overrides).toEqual({ 'mscp.a': 'include', 'mscp.b': 'include' })
  })

  it('prunes overrides for rules that are no longer offered', () => {
    const offers: SupportingCheckOffers = {
      direct: [offerFor('mscp.a')],
      throughOtherRules: [],
      alreadySelectedSupporterIds: [],
      controlsWithSupportIds: [],
    }
    useSupportingChecksStore.getState().replaceAll({ includeSupporting: true, overrides: { 'mscp.a': 'exclude', 'mscp.gone': 'include' } })

    useSupportingChecksStore.getState().prune(offers)

    expect(useSupportingChecksStore.getState().overrides).toEqual({ 'mscp.a': 'exclude' })
  })

  it('replaces everything at once', () => {
    useSupportingChecksStore.getState().replaceAll({ includeSupporting: true, overrides: { 'mscp.a': 'include' } })
    const { includeSupporting, overrides } = useSupportingChecksStore.getState()
    expect({ includeSupporting, overrides }).toEqual({ includeSupporting: true, overrides: { 'mscp.a': 'include' } })
  })
})
