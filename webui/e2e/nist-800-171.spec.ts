import { expect, test, type Page } from '@playwright/test'
import { openFacetGroup } from './facets'
import { ALL_RULES_PATH } from './locations'

const ruleCount = (page: Page) => page.getByText(/^[\d,]+ of [\d,]+ rules$/)

const EMPTY_MAPPING_INDEX = { schema_version: 1, by_rule: {} }
const EMPTY_CATALOG_INDEX = { schema_version: 1, vendors: [], products: [], licences: [], by_product: {} }

// A real mapping or catalog would change the details layout these tests read.
test.beforeEach(async ({ page }) => {
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_MAPPING_INDEX) }),
  )
  await page.route('**/catalog/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_CATALOG_INDEX) }),
  )
  await page.goto(ALL_RULES_PATH)
  await expect(ruleCount(page)).toHaveText('5,153 of 5,153 rules', { timeout: 10_000 })
})

async function openRequirement(page: Page, requirementNumber: string) {
  await page.getByPlaceholder('Search title or id…').fill(requirementNumber)
  const row = page
    .locator('table tbody tr')
    .filter({ has: page.getByRole('checkbox', { name: `Select ${requirementNumber}`, exact: true }) })
  await expect(row).toHaveCount(1)
  await row.getByRole('button').click()
  return page.locator('[id^="rule-detail-"]')
}

test('ticking the NIST SP 800-171 source keeps its 97 rules', async ({ page }) => {
  await openFacetGroup(page, 'Source')
  const option = page.getByRole('checkbox', { name: 'NIST SP 800-171', exact: true })
  await option.scrollIntoViewIfNeeded()
  await option.click()
  await expect(ruleCount(page)).toHaveText('97 of 5,153 rules')
})

test('a requirement opens with Requirement and Discussion headings, assignments and its credit line', async ({ page }) => {
  const detail = await openRequirement(page, '03.01.08')

  await expect(detail.getByText('Requirement', { exact: true })).toBeVisible()
  await expect(detail.getByText('Discussion', { exact: true })).toBeVisible()
  await expect(detail.getByRole('listitem').filter({ hasText: /^a\. Enforce a limit of \[Assignment: organization-defined number\]/ })).toBeVisible()
  await expect(detail.getByText(/\[Selection \(one or more\): lock the account or node/)).toBeVisible()
  const credit = detail.locator('p').filter({ hasText: /^From / })
  await expect(credit).toContainText('From NIST SP 800-171 v1.6.0 (SP_800_171_03.01.08)')
  await expect(credit).toContainText('under CC0 1.0 (public domain), modified for this tool.')
})

test('a requirement with sub-items renders them as a nested numbered list', async ({ page }) => {
  const detail = await openRequirement(page, '03.01.01')

  await expect(detail.locator('ul ul > li').filter({ hasText: /^1\. Authorized users of the system,/ })).toBeVisible()
  await expect(detail.getByText(/are addressed in 03\.01\.02\./)).toBeVisible()
})

test('the Frameworks card shows the 800-171 version beside the release tag', async ({ page }) => {
  await page.goto('/frameworks')
  const card = page.getByTestId('framework-card').filter({ hasText: 'NIST SP 800-171 Rev. 3' })
  await expect(card).toContainText('Current: 3.0.0 (v1.6.0) · 97 rules')
})

test('the Sources & licences dialog lists NIST SP 800-171 Rev. 3 under CC0 1.0', async ({ page }) => {
  await page.getByRole('contentinfo').getByRole('button', { name: 'Sources & licences' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sources & licences' })
  await expect(dialog).toContainText('Rules from the NIST SP 800-171 Rev. 3')
})
