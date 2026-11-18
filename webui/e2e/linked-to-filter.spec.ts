import { readdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { cachedIndirectMappedRules } from '../src/logic/indirectMappings'
import { buildMappingIndex, linksWithinLibrary, parseMappingIndex } from '../src/logic/mappingIndex'
import { openFacetGroup } from './facets'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as {
  sources: { name: string; display_name: string; index_path: string }[]
}

function ruleIdsOf(sourceName: string): string[] {
  const source = manifest.sources.find((candidate) => candidate.name === sourceName)
  const index = JSON.parse(readFileSync(new URL(`../public/baselines/${source?.index_path}`, import.meta.url), 'utf8')) as { rules: { id: string }[] }
  return index.rules.map((rule) => rule.id)
}

const mappingsFolder = new URL('../../baselines/_mappings/rules/', import.meta.url)
const mappingFiles = readdirSync(mappingsFolder)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort()
  .map((fileName) => ({ fileName, value: JSON.parse(readFileSync(new URL(fileName, mappingsFolder), 'utf8')) as unknown }))
const parsedIndex = parseMappingIndex(buildMappingIndex(mappingFiles, () => {}))
const mappingsByRule = typeof parsedIndex === 'string' ? new Map() : parsedIndex.byRule

function mscpRulesLinkedTo(frameworkName: string): number {
  const libraryRuleIds = new Set(manifest.sources.flatMap((source) => ruleIdsOf(source.name)))
  const byRule = linksWithinLibrary(mappingsByRule, libraryRuleIds)
  const reachesFramework = (ruleId: string) =>
    [...(byRule.get(ruleId) ?? []).map((link) => link.rule), ...cachedIndirectMappedRules(ruleId, byRule).rules.map((rule) => rule.ruleId)].some((reachedId) =>
      reachedId.startsWith(`${frameworkName}.`),
    )
  return ruleIdsOf('mscp').filter(reachesFramework).length
}

const ruleCount = (page: Page) => page.getByText(/^[\d,]+ of [\d,]+ rules$/)

test('ticking Linked to: ASD ISM on the mSCP rules keeps the mSCP rules with a path to ISM', async ({ page }) => {
  const expectedCount = mscpRulesLinkedTo('asd_ism')
  const mscpRuleCount = ruleIdsOf('mscp').length
  expect(expectedCount).toBeGreaterThan(0)
  expect(expectedCount).toBeLessThan(mscpRuleCount)

  await page.goto('/frameworks?framework=mscp&tab=rules')
  await expect(ruleCount(page)).toHaveText(`${mscpRuleCount.toLocaleString('en-US')} of ${mscpRuleCount.toLocaleString('en-US')} rules`, { timeout: 15_000 })
  await openFacetGroup(page, 'Linked to')
  await page.getByRole('checkbox', { name: 'ASD ISM' }).check()
  await expect(ruleCount(page)).toHaveText(`${expectedCount.toLocaleString('en-US')} of ${mscpRuleCount.toLocaleString('en-US')} rules`)
  await expect(page).toHaveURL(/[?&]linked=asd_ism/)
})

test('mSCP is never offered as a link on its own page', async ({ page }) => {
  await page.goto('/frameworks?framework=mscp&tab=rules')
  await openFacetGroup(page, 'Linked to')
  await expect(page.getByRole('checkbox', { name: 'ASD ISM' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /^NIST mSCP/ })).toHaveCount(0)
})

test('an unknown linked value in a shared address is dropped', async ({ page }) => {
  await page.goto('/frameworks?framework=mscp&tab=rules&linked=nonsense')
  await expect(page).not.toHaveURL(/linked=/, { timeout: 15_000 })
})

test('a Linked to filter does not follow the page to another framework', async ({ page }) => {
  await page.goto('/frameworks?framework=mscp&tab=rules')
  await openFacetGroup(page, 'Linked to')
  await page.getByRole('checkbox', { name: 'ASD ISM' }).check()
  await expect(page).toHaveURL(/[?&]linked=asd_ism/)

  await page.getByRole('link', { name: 'All frameworks' }).click()
  await page.getByTestId('framework-card').filter({ has: page.getByRole('heading', { name: manifest.sources.find((source) => source.name === 'asd_ism')!.display_name }) }).getByRole('link', { name: 'Rules' }).click()

  await expect(page).toHaveURL(/framework=asd_ism/)
  await expect(page).not.toHaveURL(/linked=/)
  await expect(ruleCount(page)).toHaveText(/^[\d,]+ of [\d,]+ rules$/, { timeout: 15_000 })
  await expect(ruleCount(page)).not.toHaveText(/^0 of/)
})
