import { expect, test, type Page } from '@playwright/test'

const ruleCount = (page: Page) => page.getByText(/^\d+ of \d+ rules$/)

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
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('2509 of 2509 rules', { timeout: 10_000 })
})

async function tickFacetOption(page: Page, name: string) {
  const option = page.getByRole('checkbox', { name, exact: true })
  await option.scrollIntoViewIfNeeded()
  await option.click()
  await expect(option).toBeChecked()
}

// A search for 'ac-7' also finds its enhancements, so pick the control by its select checkbox.
async function searchForControlRow(page: Page, controlId: string) {
  await page.getByPlaceholder('Search title or id…').fill(controlId)
  const row = page.locator('table tbody tr').filter({ has: page.getByRole('checkbox', { name: `Select ${controlId}`, exact: true }) })
  await expect(row).toHaveCount(1)
  return row
}

test('ticking the NIST SP 800-53 source keeps its 1014 rules', async ({ page }) => {
  await tickFacetOption(page, 'NIST SP 800-53')
  await expect(ruleCount(page)).toHaveText('1014 of 2509 rules')
})

test('ticking the 800-53 Moderate benchmark keeps its 287 rules', async ({ page }) => {
  await tickFacetOption(page, '800-53 Moderate')
  await expect(ruleCount(page)).toHaveText('287 of 2509 rules')
})

test('searching an enhancement id finds exactly that enhancement, titled with its parent control', async ({ page }) => {
  await page.getByPlaceholder('Search title or id…').fill('ac-20.1')
  await expect(ruleCount(page)).toHaveText('1 of 2509 rules')
  const row = page.locator('table tbody tr')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Use of External Systems | Limits on Authorized Use')
})

test('a control opens with Control and Discussion headings, a nested list and its credit line', async ({ page }) => {
  const row = await searchForControlRow(page, 'ac-7')
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')

  await expect(detail.getByText('Control', { exact: true })).toBeVisible()
  await expect(detail.getByText('Discussion', { exact: true })).toBeVisible()
  await expect(detail.getByRole('listitem').filter({ hasText: /^a\. Enforce a limit/ })).toBeVisible()
  await expect(detail.getByText('[Assignment: organization-defined number]').first()).toBeVisible()
  await expect(detail.locator('p').filter({ hasText: /^From / })).toContainText('From NIST SP 800-53 v1.6.0 (ac-7)')
})

test('a control with sub-items renders them as a nested list', async ({ page }) => {
  const row = await searchForControlRow(page, 'ac-2')
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')

  const nestedItem = detail.locator('ul ul > li').filter({ hasText: /^1\. Authorized users of the system;/ })
  await expect(nestedItem).toBeVisible()
})

test('the Sources & licences dialog lists NIST SP 800-53 Rev. 5 under CC0 1.0', async ({ page }) => {
  await page.getByRole('contentinfo').getByRole('button', { name: 'Sources & licences' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sources & licences' })
  await expect(dialog).toContainText('Rules from the NIST SP 800-53 Rev. 5')
  await expect(dialog).toContainText('under CC0 1.0 (public domain)')
})
