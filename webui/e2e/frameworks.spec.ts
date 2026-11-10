import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { Manifest, ManifestSource } from '../src/types/library'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as Manifest
const sourceNamed = (name: string): ManifestSource => manifest.sources.find((source) => source.name === name)!
const ism = sourceNamed('asd_ism')
const previousIsmRelease = ism.releases.at(-2)!
const currentIsmRelease = ism.releases.at(-1)!

const card = (page: Page, displayName: string) => page.getByTestId('framework-card').filter({ has: page.getByRole('heading', { name: displayName }) })

test('the Frameworks tab lists a card per framework with its current release and every release', async ({ page }) => {
  await page.goto('/frameworks')

  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
  const ismCard = card(page, ism.display_name)
  await expect(ismCard).toContainText(`Current: ${currentIsmRelease.label} (${currentIsmRelease.tag}) · ${ism.rule_count} rules`)
  const pills = ismCard.getByRole('list', { name: 'Releases' }).getByRole('listitem')
  await expect(pills).toHaveCount(ism.releases.length)
  await expect(pills.last()).toContainText(`${currentIsmRelease.label} · current`)
  await expect(ismCard.getByText('· current')).toHaveCount(1)
})

test('Compare releases opens the comparison from the previous release to the current one', async ({ page }) => {
  await page.goto('/frameworks')

  await card(page, ism.display_name).getByRole('button', { name: 'Compare releases' }).click()

  await expect(page).toHaveURL(new RegExp(`framework=asd_ism&from=${previousIsmRelease.tag}&to=${currentIsmRelease.tag}$`))
  await page.goBack()
  await expect(page).toHaveURL(/\/frameworks$/)
  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
})

test('the Frameworks tab sits after Rules in the navigation', async ({ page }) => {
  await page.goto('/')
  const links = page.getByRole('navigation', { name: 'Views' }).getByRole('link')
  await expect(links.nth(0)).toHaveText('Rules')
  await expect(links.nth(1)).toHaveText('Frameworks')
})
