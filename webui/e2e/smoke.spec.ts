import { expect, test } from '@playwright/test'

test('rule browser loads, lists rules, and expands a row', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Intune Compliance Toolkit' })).toBeVisible()

  // Scoped by row position rather than by the button's accessible name -
  // that name flips between "Expand X" and "Collapse X" on click, so a
  // name-based locator re-resolves to a *different* (still-collapsed) row
  // once this one expands, making the assertion below look like it never
  // took effect even though it did.
  const firstRow = page.locator('table tbody tr').first()
  const expandButton = firstRow.getByRole('button')
  await expect(expandButton).toBeVisible({ timeout: 10_000 })
  await expandButton.click()
  await expect(expandButton).toHaveAttribute('aria-expanded', 'true')
})
