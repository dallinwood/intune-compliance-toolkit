import { expect, test } from '@playwright/test'
import { openFacetGroup } from './facets'
import { ALL_RULES_PATH } from './locations'

test.use({ viewport: { width: 1280, height: 800 } })

test('the sidebar scrolls on its own when its filters are taller than the space, without scrolling the table', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.goto(ALL_RULES_PATH)
  await expect(page.getByText(/^[\d,]+ of [\d,]+ rules$/)).toBeVisible({ timeout: 10_000 })
  const sidebarScrollArea = page.getByTestId('sidebar-scroll-area')
  const tableScrollArea = page.locator('main')
  const scrollPositions = () =>
    page.evaluate(() => ({
      sidebar: document.querySelector('[data-testid="sidebar-scroll-area"]')!.scrollTop,
      table: document.querySelector('main')!.scrollTop,
    }))

  const sidebarDimensions = await sidebarScrollArea.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }))
  expect(sidebarDimensions.scrollHeight).toBeGreaterThan(sidebarDimensions.clientHeight)
  expect(await scrollPositions()).toEqual({ sidebar: 0, table: 0 })

  const sidebarBox = (await sidebarScrollArea.boundingBox())!
  await page.mouse.move(sidebarBox.x + sidebarBox.width / 2, sidebarBox.y + sidebarBox.height / 2)
  await page.mouse.wheel(0, 120)
  await expect.poll(async () => (await scrollPositions()).sidebar).toBeGreaterThan(0)
  expect((await scrollPositions()).table).toBe(0)
  const sidebarAfterSidebarWheel = (await scrollPositions()).sidebar

  const tableBox = (await tableScrollArea.boundingBox())!
  await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height / 2)
  await page.mouse.wheel(0, 120)
  await expect.poll(async () => (await scrollPositions()).table).toBeGreaterThan(0)
  expect((await scrollPositions()).sidebar).toBe(sidebarAfterSidebarWheel)
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

test('every filter group starts open', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await expect(page.getByText(/^[\d,]+ of [\d,]+ rules$/)).toBeVisible({ timeout: 10_000 })
  for (const title of ['Automation', 'Check', 'Remediation', 'Organization values', 'Target', 'Source', 'Version', 'Benchmark', 'Section', 'Tags']) {
    await expect(page.getByRole('heading', { name: title, exact: true }).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  }
  await expect(page.getByRole('group', { name: 'Version', exact: true })).toBeVisible()
})

test('ticking an option keeps its group open', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await openFacetGroup(page, 'Version')
  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Version', exact: true }).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
})

test('Skip to rules is the first Tab stop and moves focus into the table', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await expect(page.getByTestId('rule-table')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: 'Skip to rules' })
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('rule-table')).toBeFocused()
})

test('both filter sidebars are named landmarks', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await expect(page.getByRole('complementary', { name: 'Filters' })).toBeVisible({ timeout: 10_000 })
})
