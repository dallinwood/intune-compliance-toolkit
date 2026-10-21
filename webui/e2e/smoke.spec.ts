import { expect, test, type Page } from '@playwright/test'

const ruleCount = (page: Page) => page.getByText(/^\d+ of \d+ rules$/)

async function searchForSingleRow(page: Page, search: string, title: RegExp | string) {
  await page.getByPlaceholder('Search title or id…').fill(search)
  const row = page.locator('table tbody tr').filter({ hasText: title })
  await expect(row).toHaveCount(1)
  return row
}

test('rule browser loads the mSCP library and expands a rule to its check', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Intune Compliance Toolkit' })).toBeVisible()
  await expect(ruleCount(page)).toHaveText('350 of 350 rules', { timeout: 10_000 })

  const row = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')
  // Scoped to the row rather than the button's name, which flips between
  // "Expand" and "Collapse" on click.
  await row.getByRole('button').click()
  await expect(row.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('com.apple.systempolicy.control').first()).toBeVisible()
  await expect(page.getByText('EnableAssessment').first()).toBeVisible()
})

// Asserts on the real filtering effect, not just presence - a facet
// checkbox that renders but no longer fires its handler looks identical in
// a screenshot.
test('macOS version and benchmark facets narrow the table together', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('350 of 350 rules', { timeout: 10_000 })

  const countOf = async () => Number((await ruleCount(page).textContent())?.split(' ')[0])

  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText('350 of 350 rules')
  const versionOnly = await countOf()

  await page.getByRole('checkbox', { name: 'CIS Level 1', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText(`${versionOnly} of 350 rules`)
  const both = await countOf()

  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText(`${both} of 350 rules`)
  const benchmarkOnly = await countOf()

  expect(both).toBeGreaterThan(0)
  expect(both).toBeLessThan(versionOnly)
  expect(both).toBeLessThan(benchmarkOnly)

  await page.getByRole('radio', { name: 'Manual only' }).click()
  await expect(ruleCount(page)).not.toHaveText(`${benchmarkOnly} of 350 rules`)
})

// The row's onClick skips toggling expand when the click landed on an
// interactive control. Base UI's Checkbox renders role="checkbox", not an
// <input>, so a selector listing only `input` would both select AND expand.
test('row checkbox selects without expanding the row', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')

  await expect(page.getByText('0 selected')).toBeVisible()
  await row.getByRole('checkbox').click()
  await expect(page.getByText('1 selected')).toBeVisible()
  await expect(row.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
})

test('an ODV title shows the effective value instead of $ODV', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'pwpolicy_minimum_length_enforce', /Minimum Password Length/)

  await expect(row).toContainText(/Require a Minimum Password Length of \d+ Characters/)
  await expect(row).not.toContainText('$ODV')
})

test('an ODV value with an apostrophe is rejected and not stored', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'pwpolicy_minimum_length_enforce', /Minimum Password Length/)
  await row.getByRole('button').click()

  const odvInput = page.getByRole('textbox', { name: /Minimum password length/ })
  await expect(odvInput).toBeVisible()
  await expect(page.getByText('Using recommended value: 6')).toBeVisible()

  await odvInput.fill('12')
  await expect(row).toContainText('Require a Minimum Password Length of 12 Characters')

  await odvInput.fill("12'")
  await expect(page.getByRole('alert')).toContainText('Value must be a whole number.')
  // The last valid value stays in effect.
  await expect(row).toContainText('Require a Minimum Password Length of 12 Characters')

  await odvInput.fill('')
  await expect(page.getByText('Using recommended value: 6')).toBeVisible()
  await expect(row).toContainText('Require a Minimum Password Length of 6 Characters')
})

// An option that becomes unreachable stays visible, disabled, for a quiet
// period instead of vanishing (or staying clickable into a zero-row table),
// then fades out - "the count changed" alone can't see either half.
test('an unreachable facet option greys out, fades, then disappears', async ({ page }) => {
  await page.goto('/')

  const nlmapgovBase = page.getByRole('checkbox', { name: 'NLMAPGOV Base', exact: true })
  // The animated wrapper FilterSidebar's StableFacetGroup toggles
  // data-leaving on.
  const nlmapgovBaseRow = page.locator('[data-leaving]', { has: nlmapgovBase })
  await expect(nlmapgovBase).toBeVisible({ timeout: 10_000 })
  await expect(nlmapgovBase).toBeEnabled()
  await expect(nlmapgovBaseRow).toHaveAttribute('data-leaving', 'false')

  // NLMAPGOV benchmarks are not listed under macOS 27 for any rule.
  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()

  await expect(nlmapgovBase).toBeVisible()
  await expect(nlmapgovBase).toBeDisabled()
  await expect(nlmapgovBase).not.toBeChecked()
  await expect(nlmapgovBaseRow).toHaveAttribute('data-leaving', 'false')

  // After the ~2400ms quiet period the option starts its 300ms exit.
  // Sampling partway through proves the transition interpolates rather than
  // snapping to 0. The wait and the sample both run in the page: an
  // expect() poll can notice data-leaving up to a second late (its retry
  // interval grows), by which point the fade has already finished.
  const midTransitionOpacity = await nlmapgovBaseRow.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        const sampleOnceLeaving = () => {
          if (element.getAttribute('data-leaving') === 'true') {
            setTimeout(() => resolve(Number(getComputedStyle(element).opacity)), 100)
          } else {
            requestAnimationFrame(sampleOnceLeaving)
          }
        }
        sampleOnceLeaving()
      }),
  )
  expect(midTransitionOpacity).toBeGreaterThan(0)
  expect(midTransitionOpacity).toBeLessThan(1)

  await expect(nlmapgovBase).not.toBeVisible({ timeout: 4_000 })
})
