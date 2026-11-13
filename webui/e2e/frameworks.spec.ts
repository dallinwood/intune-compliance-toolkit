import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { compareReleases, type HistoryIndex } from '../src/logic/historyIndex'
import type { Manifest, ManifestSource } from '../src/types/library'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as Manifest
const sourceNamed = (name: string): ManifestSource => manifest.sources.find((source) => source.name === name)!
const ism = sourceNamed('asd_ism')
const previousIsmRelease = ism.releases.at(-2)!
const currentIsmRelease = ism.releases.at(-1)!
const middleIsmRelease = ism.releases.at(-2)!
const releaseBeforeMiddleIsmRelease = ism.releases.at(-3)!

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

const pill = (page: Page, displayName: string, labelStart: string) =>
  card(page, displayName).getByRole('list', { name: 'Releases' }).getByRole('link', { name: new RegExp(`^${labelStart}`) })

test('pressing the current release opens its comparison with the release before it', async ({ page }) => {
  await page.goto('/frameworks')

  await pill(page, ism.display_name, currentIsmRelease.label).click()

  await expect(page).toHaveURL(new RegExp(`framework=asd_ism&from=${previousIsmRelease.tag}&to=${currentIsmRelease.tag}$`))
  await page.goBack()
  await expect(page).toHaveURL(/\/frameworks$/)
  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
})

test('pressing a middle release compares it with the release before it', async ({ page }) => {
  await page.goto('/frameworks')

  await pill(page, ism.display_name, middleIsmRelease.label).click()

  await expect(page).toHaveURL(new RegExp(`framework=asd_ism&from=${releaseBeforeMiddleIsmRelease.tag}&to=${middleIsmRelease.tag}$`))
  await expect(page.getByRole('heading', { name: `${ism.display_name}: ${releaseBeforeMiddleIsmRelease.label} to ${middleIsmRelease.label}` })).toBeVisible({ timeout: 15_000 })
})

test('the cards have no Compare releases button', async ({ page }) => {
  await page.goto('/frameworks')

  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
  await expect(page.getByRole('button', { name: 'Compare releases' })).toHaveCount(0)
  await expect(page.getByText('Choose a release to see what changed in it.')).toHaveCount(manifest.sources.length)
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

test('every kind starts ticked, and unticking one narrows the Changed group, with a way back', async ({ page }) => {
  await page.goto(comparisonUrl)
  await expect(page.getByTestId('summary-tile-changed')).toBeVisible({ timeout: 15_000 })
  const before = await tileValue(page, 'changed')
  for (const name of ['Behaviour', 'Scope', 'Wording', 'References']) await expect(page.getByRole('checkbox', { name })).toBeChecked()
  await expect(page.getByText('Showing all kinds')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Wording' }).click()

  await expect.poll(() => tileValue(page, 'changed')).toBeLessThan(before)
  await expect(page).toHaveURL(/kind=behaviour&kind=scope&kind=references/)
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect.poll(() => tileValue(page, 'changed')).toBe(before)
  expect(new URL(page.url()).searchParams.has('kind')).toBe(false)
})

test('unticking the last kind shows every kind again', async ({ page }) => {
  await page.goto(`${comparisonUrl}&kind=wording`)
  const checkbox = page.getByRole('checkbox', { name: 'Wording' })
  await expect(checkbox).toBeChecked({ timeout: 15_000 })
  const narrowed = await tileValue(page, 'changed')

  await checkbox.click()

  await expect(page.getByText('Showing all kinds')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show all' })).toHaveCount(0)
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
  await expect(toolbar.getByRole('button', { name: /one level/ })).toHaveCount(0)
  await toolbar.getByRole('button', { name: 'Collapse all' }).click()
  for (const name of [/^Added \(/, /^Removed \(/, /^Changed \(/]) await expect(page.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false')

  await toolbar.getByRole('button', { name: 'Expand all' }).click()
  for (const name of [/^Added \(/, /^Removed \(/, /^Changed \(/]) await expect(page.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
  // As on the Rules tab, the toolbar does not open the rows themselves.
  await expect(page.locator('[data-testid="comparison-row"] > button[aria-expanded="true"]')).toHaveCount(0)
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

test('Show more starts over when the search changes', async ({ page }) => {
  await page.goto(`${comparisonUrl}&group=changed`)
  const rows = page.locator('[data-testid="comparison-row"][data-group="changed"]')
  await expect(rows).toHaveCount(50, { timeout: 15_000 })
  await page.getByRole('button', { name: /^Show 50 more/ }).click()
  await expect(rows).toHaveCount(100)

  await page.getByRole('searchbox', { name: 'Search title or id' }).fill('the')

  await expect(rows).toHaveCount(50)
})

test('the custom changes option is disabled with a reason when the custom changes could not be loaded', async ({ page }) => {
  await page.route('**/baselines/_overlays/_index.json', (route) => route.fulfill({ status: 500, body: 'broken' }))
  await page.goto(comparisonUrl)

  await expect(page.getByRole('checkbox', { name: 'have my custom changes' })).toBeDisabled({ timeout: 15_000 })
  await expect(page.getByText('Your custom changes could not be loaded.')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'are in my selection' })).toBeEnabled()
})

const ruleCountFirstAddedInIsm = Object.values(ismHistory.rules).filter((rule) => rule.versions[0] !== null).length
const emptyIsmUrl = `/frameworks?framework=asd_ism&from=empty&to=${firstIsmRelease.tag}`

test('pressing the first release compares it with an empty release, so every rule is added', async ({ page }) => {
  await page.goto('/frameworks')

  await pill(page, ism.display_name, firstIsmRelease.label).click()

  await expect(page).toHaveURL(new RegExp(`framework=asd_ism&from=empty&to=${firstIsmRelease.tag}$`))
  await expect(page.getByRole('heading', { name: /Empty release to/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(`Compared with an empty release, so every rule in ${firstIsmRelease.label} is listed as added.`)).toBeVisible()
  await expect.poll(() => tileValue(page, 'added')).toBe(ruleCountFirstAddedInIsm)
  for (const name of ['removed', 'changed', 'unchanged']) expect(await tileValue(page, name)).toBe(0)
})

test("a single-release framework's release opens its comparison", async ({ page }) => {
  const nist = sourceNamed('nist_800_53')
  expect(nist.releases).toHaveLength(1)
  await page.goto('/frameworks')

  await pill(page, nist.display_name, nist.releases[0].label).click()

  await expect(page).toHaveURL(new RegExp(`framework=nist_800_53&from=empty&to=${nist.releases[0].tag}$`))
  await expect.poll(() => tileValue(page, 'added'), { timeout: 15_000 }).toBe(nist.rule_count)
})

test('the From select offers Empty release and choosing it lists every rule in To as added', async ({ page }) => {
  await page.goto(comparisonUrl)
  const from = page.getByLabel('From')
  await expect(from).toHaveValue(firstIsmRelease.tag, { timeout: 15_000 })
  await expect(from.locator('option').first()).toHaveText('Empty release')

  await from.selectOption('empty')

  await expect(page).toHaveURL(new RegExp(`from=empty&to=${currentIsmRelease.tag}$`))
  await expect.poll(() => tileValue(page, 'added')).toBe(ism.rule_count)
  expect(await tileValue(page, 'removed')).toBe(0)
})

test('the Framework select lists every framework', async ({ page }) => {
  await page.goto(comparisonUrl)
  await expect(page.getByLabel('Framework')).toHaveValue('asd_ism', { timeout: 15_000 })

  await expect(page.getByLabel('Framework').locator('option')).toHaveCount(manifest.sources.length)

  await page.getByLabel('Framework').selectOption('nist_800_53')
  await expect(page).toHaveURL(/framework=nist_800_53&from=empty&to=/)
})

test('an empty-release address survives a reload', async ({ page }) => {
  await page.goto(emptyIsmUrl)
  await expect(page.getByText('Compared with an empty release', { exact: false })).toBeVisible({ timeout: 15_000 })

  await page.reload()

  await expect(page).toHaveURL(new RegExp(`from=empty&to=${firstIsmRelease.tag}$`))
  await expect(page.getByLabel('From')).toHaveValue('empty', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /Empty release to/ })).toBeVisible()
})
