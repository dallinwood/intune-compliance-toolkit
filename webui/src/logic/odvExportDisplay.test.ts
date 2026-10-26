import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Rule } from '../types/library'
import { codeOdvValues, odvSubstitutionMode } from './odv'
import { expandsOdvOnlyAsQuotedVariable, shellWithExportedOdv } from './odvExportDisplay'
import { bashSingleQuote } from './scriptGen/bash'

const BANNER_RULE_ID = 'mscp.os_policy_banner_ssh_configure'
const bannerRule = JSON.parse(readFileSync('../baselines/mscp/rules/os_policy_banner_ssh_configure.json', 'utf8')) as Rule
const bannerCheckShell = bannerRule.check!.macOS.default!.shell!
const bannerOdv = bannerRule.odv!

describe('the SSH banner check shown as the generator runs it', () => {
  it('is variable mode and only expands "$ODV" as a quoted variable', () => {
    expect(odvSubstitutionMode(bannerRule)).toBe('variable')
    expect(expandsOdvOnlyAsQuotedVariable(bannerCheckShell)).toBe(true)
    const remediationShell = bannerRule.remediation!.macOS.steps[0].shell!
    expect(expandsOdvOnlyAsQuotedVariable(remediationShell)).toBe(true)
  })

  it('is the export line for the recommended banner followed by the unchanged check', () => {
    const recommended = bannerOdv.recommended!
    const { exported } = codeOdvValues(bannerOdv, 'variable', recommended, BANNER_RULE_ID)
    expect(exported).toBe(recommended)
    expect(shellWithExportedOdv(bannerCheckShell, exported!)).toBe(`export ODV=${bashSingleQuote(String(recommended))}\n${bannerCheckShell}`)
  })

  it('single-quote-escapes quotes, dollars, backticks and backslashes', () => {
    expect(shellWithExportedOdv('echo "$ODV"', "it's")).toBe("export ODV='it'\\''s'\necho \"$ODV\"")
    const awkward = "say \"hi\" $HOME `id` a\\b it's"
    const displayed = shellWithExportedOdv('echo "$ODV"', awkward)
    expect(displayed.split('\n')[0]).toBe(`export ODV=${bashSingleQuote(awkward)}`)
    expect(displayed.split('\n')[0]).toBe("export ODV='say \"hi\" $HOME `id` a\\b it'\\''s'")
  })
})

describe('expandsOdvOnlyAsQuotedVariable', () => {
  it('rejects bare, braced and text-replaced uses', () => {
    expect(expandsOdvOnlyAsQuotedVariable('a="$ODV"; b="$ODV"')).toBe(true)
    expect(expandsOdvOnlyAsQuotedVariable('sed s/x/$ODV/')).toBe(false)
    expect(expandsOdvOnlyAsQuotedVariable('echo $ODV')).toBe(false)
    expect(expandsOdvOnlyAsQuotedVariable('echo "$ODV" $ODV')).toBe(false)
  })
})
