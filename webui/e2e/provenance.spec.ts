import { expect, test } from '@playwright/test'
import { ALL_RULES_PATH } from './locations'

test('the Frameworks home lists official cards before the Community separator and community cards after it', async ({ page }) => {
  await page.goto('/frameworks')

  const cards = page.getByTestId('framework-card')
  const separator = page.getByRole('heading', { name: 'Community', exact: true })
  await expect(separator).toBeVisible()

  const separatorTop = (await separator.boundingBox())!.y
  const cardPositions = await cards.evaluateAll((elements) =>
    elements.map((element) => ({ title: element.querySelector('h2')!.textContent!, top: element.getBoundingClientRect().top + window.scrollY })),
  )
  const separatorPageTop = separatorTop + (await page.evaluate(() => window.scrollY))
  const before = cardPositions.filter((position) => position.top < separatorPageTop).map((position) => position.title)
  const after = cardPositions.filter((position) => position.top > separatorPageTop).map((position) => position.title)

  expect(before.length + after.length).toBe(cardPositions.length)
  expect(before.length).toBeGreaterThan(0)
  expect(after).toHaveLength(2)
  expect(after.every((title) => title.startsWith('CIS'))).toBe(true)
  expect(before.some((title) => title.startsWith('CIS'))).toBe(false)
})

test('each card carries an Official or Community badge', async ({ page }) => {
  await page.goto('/frameworks')

  const nistCard = page.getByTestId('framework-card').filter({ has: page.getByRole('heading', { name: /NIST SP 800-53/ }) })
  await expect(nistCard.getByText('Official', { exact: true })).toBeVisible()
  const cisCards = page.getByTestId('framework-card').filter({ has: page.getByRole('heading', { name: /^CIS/ }) })
  await expect(cisCards).toHaveCount(2)
  await expect(cisCards.getByText('Community', { exact: true })).toHaveCount(2)
})

test('a framework page shows its provenance badge by the title', async ({ page }) => {
  await page.goto('/frameworks?framework=nist_800_53&tab=rules')
  await expect(page.getByRole('heading', { level: 2, name: /NIST SP 800-53/ }).locator('..').getByText('Official', { exact: true })).toBeVisible()

  await page.goto('/frameworks?framework=cis_rhel9&tab=rules')
  await expect(page.getByRole('heading', { level: 2, name: /^CIS/ }).locator('..').getByText('Community', { exact: true })).toBeVisible()
})

test('the all-rules page has no provenance badge beside its title', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  const title = page.getByRole('heading', { level: 2, name: 'All rules' })
  await expect(title).toBeVisible()
  await expect(title.locator('..').getByText(/^(Official|Community)$/)).toHaveCount(0)

  // The same locator finds the badge on a framework page, so the zero above
  // is a real absence and not a locator that matches nothing anywhere.
  await page.goto('/frameworks?framework=cis_rhel9&tab=rules')
  const frameworkTitle = page.getByRole('heading', { level: 2, name: /^CIS/ })
  await expect(frameworkTitle.locator('..').getByText(/^(Official|Community)$/)).toHaveCount(1)
})
