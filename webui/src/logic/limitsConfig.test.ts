import { describe, expect, it } from 'vitest'
import { GENERATION_LIMITS, HEADROOM_FACTOR, INTUNE_HARD_LIMITS } from './limitsConfig'

describe('limitsConfig', () => {
  it('derives generation limits as a fixed headroom fraction of Intune"s real hard limits', () => {
    expect(GENERATION_LIMITS.maxRulesPerChunk).toBe(Math.floor(INTUNE_HARD_LIMITS.maxRulesPerPolicy * HEADROOM_FACTOR))
    expect(GENERATION_LIMITS.maxRulesJsonBytesPerChunk).toBe(Math.floor(INTUNE_HARD_LIMITS.maxRulesJsonBytes * HEADROOM_FACTOR))
    expect(GENERATION_LIMITS.maxScriptBytesPerChunk).toBe(Math.floor(INTUNE_HARD_LIMITS.maxScriptBytes * HEADROOM_FACTOR))
  })

  it('targets 95% headroom for now', () => {
    expect(HEADROOM_FACTOR).toBe(0.95)
    expect(GENERATION_LIMITS.maxRulesPerChunk).toBe(95)
  })
})
