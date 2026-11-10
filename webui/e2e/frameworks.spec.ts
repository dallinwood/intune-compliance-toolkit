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

const tileValue = async (page: Page, name: string) => Number(await page.getByTestId(`summary-tile-${name}`).locator('span').first().textContent())
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
  await expect(page.getByTestId('summary-tile-unchanged')).toContainText('unchanged')
})

test('ticking a kind narrows the Changed group to rules with that kind', async ({ page }) => {
  await page.goto(comparisonUrl)
  await expect(page.getByTestId('summary-tile-changed')).toBeVisible({ timeout: 15_000 })
  const before = await tileValue(page, 'changed')
  await expect(page.getByText('Showing all kinds')).toBeVisible()

  await page.getByRole('checkbox', { name: 'References' }).click()

  await expect.poll(() => tileValue(page, 'changed')).toBeLessThan(before)
  await expect(page).toHaveURL(/kind=references/)
  await expect(page.getByRole('button', { name: 'Show all' })).toBeVisible()
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect.poll(() => tileValue(page, 'changed')).toBe(before)
})

test('unticking the last kind shows every kind again', async ({ page }) => {
  await page.goto(`${comparisonUrl}&kind=wording`)
  const checkbox = page.getByRole('checkbox', { name: 'Wording' })
  await expect(checkbox).toBeChecked({ timeout: 15_000 })
  const narrowed = await tileValue(page, 'changed')

  await checkbox.click()

  await expect(page.getByText('Showing all kinds')).toBeVisible()
  await expect.poll(() => tileValue(page, 'changed')).toBeGreaterThanOrEqual(narrowed)
  expect(new URL(page.url()).searchParams.has('kind')).toBe(false)
})

test('a summary tile narrows the comparison to its group, and pressing it again shows every group', async ({ page }) => {
  await page.goto(comparisonUrl)
  const changedTile = page.getByTestId('summary-tile-changed')
  await expect(changedTile).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /^Added \(/ })).toBeVisible()

  await changedTile.click()
  await expect(changedTile).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/group=changed/)
  await expect(page.getByRole('heading', { name: /^Added \(/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /^Changed \(/ })).toBeVisible()

  await page.getByTestId('summary-tile-removed').click()
  await expect(changedTile).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('heading', { name: /^Removed \(/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Changed \(/ })).toHaveCount(0)

  await page.getByTestId('summary-tile-removed').click()
  await expect(page.getByRole('heading', { name: /^Added \(/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Changed \(/ })).toBeVisible()
  expect(new URL(page.url()).searchParams.has('group')).toBe(false)
})

test('the unchanged tile lists the unchanged rules, whose rows open to the rule at the To release', async ({ page }) => {
  await page.goto(comparisonUrl)
  await expect(page.getByTestId('summary-tile-unchanged')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /^Unchanged \(/ })).toHaveCount(0)
  const unchangedCount = await tileValue(page, 'unchanged')
  expect(unchangedCount).toBeGreaterThan(0)

  await page.getByTestId('summary-tile-unchanged').click()

  await expect(page.getByRole('heading', { name: new RegExp(`^Unchanged \\(${unchangedCount}\\)$`) })).toBeVisible()
  const row = page.locator('[data-testid="comparison-row"][data-group="unchanged"]').first()
  await row.getByRole('button').first().click()
  await expect(row).toContainText('licensed', { timeout: 15_000 })
  await expect(row).toContainText(currentIsmRelease.tag)
})

test('group headers collapse like the Rules tab sections, and the toolbar expands and collapses them', async ({ page }) => {
  await page.goto(comparisonUrl)
  const addedHeader = page.getByRole('button', { name: /^Added \(/ })
  await expect(addedHeader).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 })
  await expect(page.locator('[data-testid="comparison-row"][data-group="added"]').first()).toBeVisible()

  await addedHeader.click()
  await expect(addedHeader).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('[data-testid="comparison-row"][data-group="added"]')).toHaveCount(0)

  const toolbar = page.getByRole('group', { name: 'Sections' })
  await toolbar.getByRole('button', { name: 'Collapse all' }).click()
  for (const name of [/^Added \(/, /^Removed \(/, /^Changed \(/]) await expect(page.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false')

  await toolbar.getByRole('button', { name: 'Expand all' }).click()
  for (const name of [/^Added \(/, /^Removed \(/, /^Changed \(/]) await expect(page.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-testid="comparison-row"] [aria-expanded="true"]').first()).toBeVisible()
})

test('the framework select uses the short source name', async ({ page }) => {
  await page.goto(comparisonUrl)
  await expect(page.getByLabel('Framework')).toHaveValue('asd_ism', { timeout: 15_000 })
  await expect(page.getByLabel('Framework').locator('option:checked')).toHaveText('ASD ISM')
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
