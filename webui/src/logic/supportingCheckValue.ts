// The one-line organization value summary on a supporting check's row.

import type { Odv, Rule } from '../types/library'
import { effectiveOdvValue, odvSubstitutionMode, validateOdvValue, type OdvSubstitutionMode } from './odv'
import type { OdvValues, OrgDefinedValue } from './selectionEntry'

export interface SupportingCheckValueSummary {
  text: string
  // 'invalid' blocks the download while the check is included.
  kind: 'recommended' | 'set-by-you' | 'invalid' | 'missing'
}

const SUMMARY_VALUE_LENGTH = 40

function shortened(value: OrgDefinedValue): string {
  const text = String(value).replace(/\s+/g, ' ')
  return text.length > SUMMARY_VALUE_LENGTH ? `${text.slice(0, SUMMARY_VALUE_LENGTH)}...` : text
}

export function supportingCheckValueSummary(
  odv: Odv,
  mode: OdvSubstitutionMode,
  storedValue: OrgDefinedValue | null,
  ruleId: string,
): SupportingCheckValueSummary {
  if (storedValue !== null) {
    const problem = validateOdvValue(odv, storedValue, mode, ruleId)
    if (problem !== null) return { text: `Value: ${shortened(storedValue)} is invalid`, kind: 'invalid' }
    return { text: `Value: ${shortened(storedValue)} (set by you)`, kind: 'set-by-you' }
  }
  const recommended = effectiveOdvValue(odv, null)
  if (recommended === null) return { text: 'Needs an organization value', kind: 'missing' }
  return { text: `Value: ${shortened(recommended)} (recommended)`, kind: 'recommended' }
}

const SUMMARY_SEVERITY: Record<SupportingCheckValueSummary['kind'], number> = {
  invalid: 3,
  missing: 2,
  'set-by-you': 1,
  recommended: 0,
}

// One line for the whole rule: the most pressing summary among its ODVs, named
// when the rule has several so the line says which value it is about.
export function supportingCheckValueSummaryForRule(rule: Rule, storedValues: OdvValues): SupportingCheckValueSummary | null {
  let worst: { summary: SupportingCheckValueSummary; odvName: string } | null = null
  for (const odv of rule.odvs) {
    const storedValue = Object.hasOwn(storedValues, odv.name) ? storedValues[odv.name] : null
    const summary = supportingCheckValueSummary(odv, odvSubstitutionMode(rule, odv), storedValue, rule.id)
    if (worst === null || SUMMARY_SEVERITY[summary.kind] > SUMMARY_SEVERITY[worst.summary.kind]) worst = { summary, odvName: odv.name }
  }
  if (worst === null) return null
  if (rule.odvs.length === 1) return worst.summary
  return { ...worst.summary, text: `${worst.odvName}: ${worst.summary.text}` }
}
