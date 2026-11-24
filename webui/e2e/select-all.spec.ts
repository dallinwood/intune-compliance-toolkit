import { expect, test, type Page } from '@playwright/test'
import { ALL_RULES_PATH } from './locations'

const SEARCH_PLACEHOLDER = 'Search title or id…'

function selectAllCheckbox(page: Page) {
  return page.getByRole('checkbox', { name: 'Select all rules in this view' })
}

async function visibleRuleCount(page: Page): Promise<number> {
  const summary = await page.getByText(/^[\d,]+ of [\d,]+ rules$/).textContent()
  return Number(summary!.split(' of ')[0].replace(/,/g, ''))
}

async function searchAndWaitForTable(page: Page, search: string) {
  await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(search)
  await expect(page.getByText('5,056 of 5,056 rules')).toHaveCount(0)
  await expect(page.getByRole('status', { name: 'Updating rules' })).toHaveCount(0)
}

test('select-all ticks the filtered rules; clearing the filter leaves it mixed with exactly those rules ticked', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('gatekeeper')
  await expect(page.getByText(/^[\d,]+ of 5,056 rules$/)).not.toHaveText('5,056 of 5,056 rules')
  const narrowedCount = await visibleRuleCount(page)
  expect(narrowedCount).toBeGreaterThan(1)
  await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', 'false')

  await selectAllCheckbox(page).click()
  await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText(`${narrowedCount} selected`)).toBeVisible()

  await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('')
  await expect(page.getByText('5,056 of 5,056 rules')).toBeVisible()
  await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', 'mixed')
  await expect(page.getByText(`${narrowedCount} selected`)).toBeVisible()
})

test('unticking from checked clears only the rules in the view', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await searchAndWaitForTable(page, 'gatekeeper')
  await selectAllCheckbox(page).click()
  await searchAndWaitForTable(page, 'os_calendar_app_disable_')
  await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', 'false')
  await selectAllCheckbox(page).click()
  await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', 'true')
  await selectAllCheckbox(page).click()
  await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', 'false')
  await searchAndWaitForTable(page, 'gatekeeper')
  await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', 'true')
})

test('ticking every rule of a small view by hand makes the header checkbox checked', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await searchAndWaitForTable(page, 'os_calendar_app_disable_')
  const rowCheckboxes = page.locator('table tbody tr[data-rule-id]').getByRole('checkbox')
  const rowCount = await rowCheckboxes.count()
  expect(rowCount).toBeGreaterThan(0)

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', rowIndex === 0 ? 'false' : 'mixed')
    await rowCheckboxes.nth(rowIndex).click()
  }
  await expect(selectAllCheckbox(page)).toHaveAttribute('aria-checked', 'true')
})

test('select-all is disabled when no rule matches', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('zzzz-no-such-rule')
  await expect(selectAllCheckbox(page)).toBeDisabled()
})
