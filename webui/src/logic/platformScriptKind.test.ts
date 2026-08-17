import { describe, expect, it } from 'vitest'
import { platformLabel, scriptKindForPlatform } from './platformScriptKind'

describe('scriptKindForPlatform', () => {
  it('maps macOS to bash', () => {
    expect(scriptKindForPlatform('macOS')).toBe('bash')
  })

  it('maps a Windows platform string to powershell', () => {
    expect(scriptKindForPlatform('Windows 11 (Intune)')).toBe('powershell')
  })

  it('throws for an unrecognized platform rather than guessing', () => {
    expect(() => scriptKindForPlatform('Linux')).toThrow()
  })
})

describe('platformLabel', () => {
  it('labels macOS as "macOS"', () => {
    expect(platformLabel('macOS')).toBe('macOS')
  })

  it('labels any Windows platform string as "Windows"', () => {
    expect(platformLabel('Windows 11 (Intune)')).toBe('Windows')
  })

  it('throws for an unrecognized platform rather than guessing', () => {
    expect(() => platformLabel('Linux')).toThrow()
  })
})
