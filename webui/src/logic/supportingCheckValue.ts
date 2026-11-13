// The one-line organization value summary on a supporting check's row.

import type { Odv } from '../types/library'
import { effectiveOdvValue, validateOdvValue, type OdvSubstitutionMode } from './odv'
import type { OrgDefinedValue } from './selectionEntry'

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
