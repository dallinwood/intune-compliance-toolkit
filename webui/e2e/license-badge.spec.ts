import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Manifest } from '../src/types/library'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as Manifest

const badgeName = (licenseName: string) => `Licence: ${licenseName} (opens in a new tab)`

test('every framework card shows its source licence as a link on the source line', async ({ page }) => {
  await page.goto('/frameworks')
  for (const source of manifest.sources) {
    const card = page.getByTestId('framework-card').filter({ has: page.getByRole('heading', { name: source.display_name, exact: true }) })
    const badge = card.getByRole('link', { name: badgeName(source.license.name) })
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('href', source.license.url)
    await expect(badge).toHaveAttribute('target', '_blank')
    await expect(badge).toContainText('licence')
    await expect(badge).toContainText(source.license.name)

    const sourceLine = card.getByTestId('source-line')
    await expect(sourceLine.getByRole('link', { name: /^Licence:/ })).toHaveCount(1)
    await expect(card.getByRole('heading', { name: source.display_name, exact: true }).locator('..').getByRole('link', { name: /^Licence:/ })).toHaveCount(0)
  }
})

test('a framework page header shows the licence badge', async ({ page }) => {
  const nist = manifest.sources.find((source) => source.name === 'nist_800_53')!
  await page.goto('/frameworks?framework=nist_800_53&tab=rules')
  await expect(page.getByTestId('source-line').getByRole('link', { name: badgeName(nist.license.name) })).toBeVisible()
})
