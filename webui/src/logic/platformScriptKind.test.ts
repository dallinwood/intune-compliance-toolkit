import { describe, expect, it } from 'vitest'
import { scriptKindForPlatform, slugifyPlatform } from './platformScriptKind'

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

describe('slugifyPlatform', () => {
  it('produces a filename-safe slug', () => {
    expect(slugifyPlatform('macOS')).toBe('macos')
    expect(slugifyPlatform('Windows 11 (Intune)')).toBe('windows-11-intune')
  })
})
