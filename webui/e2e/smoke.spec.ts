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

// Covers the shadcn primitives migration (FilterSidebar's Checkbox/
// RadioGroup) - a checkbox or radio that renders correctly but no longer
// actually fires its change handler looks identical in a screenshot, so
// this has to assert on the real filtering effect, not just presence.
test('facet checkbox and radio actually filter the table', async ({ page }) => {
  await page.goto('/')
  const ruleCount = page.getByText(/^\d+ of \d+ rules$/)
  await expect(ruleCount).toHaveText(/^(\d+) of \1 rules$/, { timeout: 10_000 })

  // Product checkbox: narrows, then un-narrows back to the baseline.
  await page.getByRole('checkbox', { name: 'windows_11' }).click()
  await expect(ruleCount).not.toHaveText(/^(\d+) of \1 rules$/)
  await page.getByRole('checkbox', { name: 'windows_11' }).click()
  await expect(ruleCount).toHaveText(/^(\d+) of \1 rules$/)

  // Automation radio: independently narrows too.
  await page.getByRole('radio', { name: 'Automatable' }).click()
  await expect(ruleCount).not.toHaveText(/^(\d+) of \1 rules$/)
})
