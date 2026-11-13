import { expect, test } from '@playwright/test'
import { openFacetGroup } from './facets'

test.use({ viewport: { width: 1280, height: 800 } })

test('the filter list fits the sidebar on the full library, so only the table scrolls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/^\d+ of \d+ rules$/)).toBeVisible({ timeout: 10_000 })
  const dimensions = await page.getByTestId('sidebar-scroll-area').evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight)
})

test('a group restored from the URL with a selection starts open, and shows its count once closed', async ({ page }) => {
  await page.goto('/rules?section=audit')
  const sectionToggle = page.getByRole('heading', { name: 'Section' }).getByRole('button')
  await expect(sectionToggle).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 })
  await expect(page.getByRole('checkbox', { name: 'Auditing', exact: true })).toBeChecked()

  await sectionToggle.click()
  await expect(sectionToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: 'Section (1 selected)' })).toBeVisible()
})

test('Version, Benchmark, Section and Tags start closed and Automation, Target and Source start open', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/^\d+ of \d+ rules$/)).toBeVisible({ timeout: 10_000 })
  for (const title of ['Automation', 'Target', 'Source']) {
    await expect(page.getByRole('heading', { name: title, exact: true }).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  }
  for (const title of ['Version', 'Benchmark', 'Section', 'Tags']) {
    await expect(page.getByRole('heading', { name: title, exact: true }).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  }
  await openFacetGroup(page, 'Version')
  await expect(page.getByRole('group', { name: 'Version', exact: true })).toBeVisible()
})

test('ticking an option in a closed-by-default group keeps it open', async ({ page }) => {
  await page.goto('/')
  await openFacetGroup(page, 'Version')
  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Version', exact: true }).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
})

test('Skip to rules is the first Tab stop and moves focus into the table', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('rule-table')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: 'Skip to rules' })
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('rule-table')).toBeFocused()
})

test('both filter sidebars are named landmarks', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('complementary', { name: 'Filters' })).toBeVisible({ timeout: 10_000 })
})
