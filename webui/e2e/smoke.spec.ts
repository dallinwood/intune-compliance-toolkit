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

// Covers the shadcn primitives migration in RuleDetailPanel (Increment 2):
// OutputCheckRow's variable/operator/value chips -> Badge, and the
// tri-state BooleanToggle's True/False/Clear buttons -> Button. A Button
// that renders but no longer fires onClick, or a tri-state that collapsed
// to two states, looks identical in a screenshot - this asserts on the
// actual value flowing from the toggle into the rendered output-check badge.
test('org-defined boolean toggle updates the output check value badge', async ({ page }) => {
  await page.goto('/')

  await page.getByPlaceholder('Search title or id…').fill('Audit iCloud Passwords & Keychain')
  const row = page.locator('table tbody tr').filter({ hasText: 'Audit iCloud Passwords & Keychain' })
  await expect(row).toHaveCount(1)
  await row.getByRole('button').click()

  await expect(page.getByRole('heading', { name: 'Organization-defined values' })).toBeVisible()
  await page.getByRole('button', { name: 'Terminal Method' }).click()

  const valueBadge = page.getByText('needs value')
  await expect(valueBadge).toBeVisible()

  await page.getByRole('button', { name: 'True', exact: true }).click()
  await expect(valueBadge).not.toBeVisible()
  await expect(page.getByText('true', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(valueBadge).toBeVisible()
})

// Covers the shadcn primitives migration in RuleTable (Increment 3): the
// row checkbox -> Checkbox and the expand chevron -> Button. The row's
// onClick handler skips toggling expand when the click landed on the
// checkbox (or any other interactive control), matched via a DOM selector
// (`input, a, button, [data-slot="checkbox"]`) - Base UI's Checkbox renders
// role="checkbox", not a real <input>, so a selector that only listed
// `input` would silently both select AND expand the row on every checkbox
// click. That would look identical in a screenshot to correct behavior.
test('row checkbox selects without expanding the row', async ({ page }) => {
  await page.goto('/')

  await page.getByPlaceholder('Search title or id…').fill('Audit iCloud Passwords & Keychain')
  const row = page.locator('table tbody tr').filter({ hasText: 'Audit iCloud Passwords & Keychain' })
  await expect(row).toHaveCount(1)

  await expect(page.getByText('0 selected')).toBeVisible()
  await row.getByRole('checkbox').click()
  await expect(page.getByText('1 selected')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Organization-defined values' })).not.toBeVisible()
})

// Covers the facet-list stabilization added after user feedback that
// picking a filter made every other facet section immediately reflow,
// making a run of clicks awkward. An option that becomes unreachable now
// stays visible, disabled, for a quiet period instead of vanishing (or
// remaining clickable, which would land the user on a zero-row table) -
// verifying only "the count changed" (as the older facet-filtering test
// does) can't see either half of that.
test('an unreachable facet option greys out, fades, then disappears', async ({ page }) => {
  await page.goto('/')

  const macosVersion = page.getByRole('checkbox', { name: 'v1.1.0' })
  // The animated wrapper div useStableFacetShown/FilterSidebar toggle
  // data-leaving on - see FilterSidebar's StableFacetGroup.
  const macosVersionRow = page.locator('[data-leaving]', { has: macosVersion })
  await expect(macosVersion).toBeVisible({ timeout: 10_000 })
  await expect(macosVersion).toBeEnabled()
  await expect(macosVersionRow).toHaveAttribute('data-leaving', 'false')

  // windows_11 rules never use version v1.1.0, so this makes it unreachable.
  await page.getByRole('checkbox', { name: 'windows_11' }).click()

  // It doesn't vanish immediately - it stays, visibly disabled, so a quick
  // run of other clicks isn't disrupted by the panel reflowing.
  await expect(macosVersion).toBeVisible()
  await expect(macosVersion).toBeDisabled()
  // A disabled option must not be clickable into a zero-row table.
  await expect(macosVersion).not.toBeChecked()
  await expect(macosVersionRow).toHaveAttribute('data-leaving', 'false')

  // Once the (doubled, 2400ms) quiet period elapses with no further filter
  // changes, it starts fading/collapsing out - assert the transition is
  // genuinely interpolating (not an instant snap to 0) partway through the
  // 300ms exit window, rather than just that removal eventually happens.
  // Generous margin above the nominal 2400ms: this runs against the Vite
  // dev server under StrictMode, and timer firing can lag under load.
  await expect(macosVersionRow).toHaveAttribute('data-leaving', 'true', { timeout: 8_000 })
  await page.waitForTimeout(150)
  const midTransitionOpacity = await macosVersionRow.evaluate((el) => Number(getComputedStyle(el).opacity))
  expect(midTransitionOpacity).toBeGreaterThan(0)
  expect(midTransitionOpacity).toBeLessThan(1)

  // The exit transition then finishes and it leaves the DOM entirely.
  await expect(macosVersion).not.toBeVisible({ timeout: 4_000 })
})
