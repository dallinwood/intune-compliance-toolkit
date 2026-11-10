import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { compareReleases, type HistoryIndex } from '../src/logic/historyIndex'
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

// A release comparison of the framework's oldest release against its current one.
const firstIsmRelease = ism.releases[0]
const ismHistory = JSON.parse(readFileSync(new URL('../public/baselines/_history/asd_ism.json', import.meta.url), 'utf8')) as HistoryIndex
const REMOVED_ISM_RULE = compareReleases(ismHistory, firstIsmRelease.tag, currentIsmRelease.tag).removed[0]?.id ?? ''
const comparisonUrl = `/frameworks?framework=asd_ism&from=${firstIsmRelease.tag}&to=${currentIsmRelease.tag}`

const tileValue = async (page: Page, name: string) => Number(await page.getByTestId(`summary-tile-${name}`).locator('p').first().textContent())
const groupCount = async (page: Page, title: string) => {
  const heading = page.getByRole('heading').filter({ hasText: `${title} (` })
  if ((await heading.count()) === 0) return 0
  return Number(/\((\d+)\)/.exec((await heading.first().textContent()) ?? '')![1])
}

test('the summary tiles match the number of rules in each group', async ({ page }) => {
  await page.goto(comparisonUrl)
  await expect(page.getByTestId('summary-tile-changed')).toBeVisible({ timeout: 15_000 })

  expect(await tileValue(page, 'added')).toBe(await groupCount(page, 'Added'))
  expect(await tileValue(page, 'removed')).toBe(await groupCount(page, 'Removed'))
  expect(await tileValue(page, 'changed')).toBe(await groupCount(page, 'Changed'))
  expect(await tileValue(page, 'changed')).toBeGreaterThan(0)
  await expect(page.getByTestId('summary-tile-unchanged')).toContainText('unchanged (hidden)')
})

test('unticking Wording shrinks the Changed group', async ({ page }) => {
  await page.goto(comparisonUrl)
  await expect(page.getByTestId('summary-tile-changed')).toBeVisible({ timeout: 15_000 })
  const before = await tileValue(page, 'changed')

  await page.getByRole('checkbox', { name: 'Wording' }).click()

  await expect.poll(() => tileValue(page, 'changed')).toBeLessThan(before)
  await expect(page).toHaveURL(/kind=behaviour/)
})

test('the last kind of change cannot be unticked', async ({ page }) => {
  await page.goto(`${comparisonUrl}&kind=wording`)
  await expect(page.getByRole('checkbox', { name: 'Wording' })).toBeDisabled({ timeout: 15_000 })
})

test('expanding a changed rule shows what changed and links to the rule', async ({ page }) => {
  await page.goto(comparisonUrl)
  const row = page.locator('[data-testid="comparison-row"][data-group="changed"]').first()
  await row.getByRole('button').first().click()

  await expect(row.getByTestId('field-change').first()).toBeVisible({ timeout: 15_000 })
  await expect(row.getByRole('link', { name: 'Open rule' })).toBeVisible()
  await expect(row.getByRole('link', { name: 'Full history' })).toBeVisible()
})

test('Full history opens the rule in the Rules view on its History tab', async ({ page }) => {
  await page.goto(comparisonUrl)
  const row = page.locator('[data-testid="comparison-row"][data-group="changed"]').first()
  await row.getByRole('button').first().click()
  await row.getByRole('link', { name: 'Full history' }).click()

  await expect(page).toHaveURL(/\/rules\?.*rule=asd_ism\./)
  await expect(page.getByRole('tab', { name: /^History/ })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
})

test('a rule removed between the two releases opens with its details from the release it was last in', async ({ page }) => {
  expect(REMOVED_ISM_RULE).not.toBe('')
  await page.goto(`${comparisonUrl}&q=`)
  await page.getByRole('searchbox', { name: 'Search title or id' }).fill(REMOVED_ISM_RULE.replace('asd_ism.', ''))
  const row = page.locator('[data-testid="comparison-row"][data-group="removed"]').first()
  await row.getByRole('button').first().click()

  await expect(row).toContainText('licensed', { timeout: 15_000 })
  await expect(row).not.toContainText('Failed to load')
})

test('an only-rules filter with nothing to match says so', async ({ page }) => {
  await page.goto(`${comparisonUrl}&only=selected`)
  await expect(page.getByText('No rules match these filters.')).toBeVisible({ timeout: 15_000 })
})

test('a comparison address survives a reload', async ({ page }) => {
  await page.goto(`${comparisonUrl}&kind=behaviour&kind=wording&cq=access`)
  await expect(page.getByRole('searchbox', { name: 'Search title or id' })).toHaveValue('access')

  await page.reload()

  await expect(page.getByRole('searchbox', { name: 'Search title or id' })).toHaveValue('access')
  await expect(page.getByRole('checkbox', { name: 'Scope' })).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Wording' })).toBeChecked()
})
