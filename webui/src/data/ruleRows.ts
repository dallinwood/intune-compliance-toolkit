import type { RuleRow } from '../types/rule-row'
import { fetchManifest } from './manifest'
import { fetchRuleIndex } from './ruleIndex'

export async function loadAllRuleRows(): Promise<RuleRow[]> {
  const manifest = await fetchManifest()

  const rowsByFolder = await Promise.all(
    manifest.baselines.map(async (entry) => {
      const index = await fetchRuleIndex(entry.indexPath)
      return index.rules.map(
        (rule): RuleRow => ({
          ref: {
            family: entry.family,
            product: entry.product,
            version: entry.version,
            file: rule.file,
            id: rule.id,
          },
          title: rule.title,
          assessmentStatus: rule.assessment_status,
          sourceAssessmentStatus: rule.source_assessment_status,
          platform: entry.platform,
          profileApplicability: rule.profile_applicability,
          requiresOrganizationDefinedValue: rule.requires_organization_defined_value,
        }),
      )
    }),
  )

  return rowsByFolder.flat()
}
