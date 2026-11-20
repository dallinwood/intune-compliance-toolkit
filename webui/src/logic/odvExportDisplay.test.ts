import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Rule } from '../types/library'
import { codeOdvValues, odvSubstitutionMode } from './odv'
import { expandsOdvOnlyAsQuotedVariable, shellWithExportedOdv } from './odvExportDisplay'
import { bashSingleQuote } from './scriptGen/bash'
import { currentRulesDirectory } from './testCurrentRelease'

const bannerRule = JSON.parse(readFileSync(new URL('os_policy_banner_ssh_configure.json', currentRulesDirectory('mscp')), 'utf8')) as Rule
const bannerCheckShell = bannerRule.check!.macOS[0].default!.shell!
const bannerOdv = bannerRule.odvs[0]

describe('the SSH banner check shown as the generator runs it', () => {
  it('is variable mode and only expands "$ODV_value" as a quoted variable', () => {
    expect(odvSubstitutionMode(bannerRule, bannerOdv)).toBe('variable')
    expect(expandsOdvOnlyAsQuotedVariable(bannerCheckShell, 'value')).toBe(true)
    const remediationShell = bannerRule.remediation!.macOS.steps[0].shell!
    expect(expandsOdvOnlyAsQuotedVariable(remediationShell, 'value')).toBe(true)
  })

  it('is the export line for the recommended banner followed by the unchanged check', () => {
    const recommended = bannerOdv.recommended
    const { exported } = codeOdvValues(bannerRule, { value: recommended })
    expect(exported).toEqual({ value: recommended })
    expect(shellWithExportedOdv(bannerCheckShell, 'value', recommended)).toBe(
      `export ODV_value=${bashSingleQuote(String(recommended))}\n${bannerCheckShell}`,
    )
  })

  it('single-quote-escapes quotes, dollars, backticks and backslashes', () => {
    expect(shellWithExportedOdv('echo "$ODV_value"', 'value', "it's")).toBe("export ODV_value='it'\\''s'\necho \"$ODV_value\"")
    const awkward = "say \"hi\" $HOME `id` a\\b it's"
    const displayed = shellWithExportedOdv('echo "$ODV_value"', 'value', awkward)
    expect(displayed.split('\n')[0]).toBe(`export ODV_value=${bashSingleQuote(awkward)}`)
    expect(displayed.split('\n')[0]).toBe("export ODV_value='say \"hi\" $HOME `id` a\\b it'\\''s'")
  })
})

describe('expandsOdvOnlyAsQuotedVariable', () => {
  it('rejects bare, braced and text-replaced uses', () => {
    expect(expandsOdvOnlyAsQuotedVariable('a="$ODV_value"; b="$ODV_value"', 'value')).toBe(true)
    expect(expandsOdvOnlyAsQuotedVariable('sed s/x/$ODV_value/', 'value')).toBe(false)
    expect(expandsOdvOnlyAsQuotedVariable('echo $ODV_value', 'value')).toBe(false)
    expect(expandsOdvOnlyAsQuotedVariable('echo "$ODV_value" $ODV_value', 'value')).toBe(false)
  })

  it('looks only at the ODV asked about, whole names only', () => {
    expect(expandsOdvOnlyAsQuotedVariable('echo "$ODV_a" $ODV_ab', 'a')).toBe(true)
    expect(expandsOdvOnlyAsQuotedVariable('echo "$ODV_a" $ODV_ab', 'ab')).toBe(false)
    expect(expandsOdvOnlyAsQuotedVariable('echo "$ODV_ab"', 'a')).toBe(true)
  })
})
