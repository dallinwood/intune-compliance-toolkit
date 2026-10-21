import type { Rule } from '../types/library'
import type { RuleCheckPlan } from './checkPlan'
import { displayWithOdv } from './odv'
import type { IntuneDataType, IntuneOperator } from './operatorMap'

export interface RemediationString {
  Language: string
  Title: string
  Description: string
}

export interface IntuneRuleEntry {
  SettingName: string
  Operator: IntuneOperator
  DataType: IntuneDataType
  Operand: string | number | boolean
  MoreInfoUrl: string
  RemediationStrings: RemediationString[]
}

const PARAGRAPH_BREAK = /\n\s*\n/

function firstParagraph(text: string): string {
  return text.split(PARAGRAPH_BREAK)[0].trim()
}

// The discovery script reports either the raw value mSCP expects or its own
// in-script comparison as a boolean, so every entry is a plain equality.
export function buildRuleEntry(plan: RuleCheckPlan, rule: Rule): IntuneRuleEntry {
  return {
    SettingName: plan.settingName,
    Operator: 'IsEquals',
    DataType: plan.dataType,
    Operand: plan.operand,
    MoreInfoUrl: rule.source.upstream_url,
    RemediationStrings: [
      {
        Language: 'en_US',
        Title: displayWithOdv(rule.title, plan.odvValue),
        Description: displayWithOdv(firstParagraph(rule.discussion), plan.odvValue),
      },
    ],
  }
}
