import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { compareReleases, type HistoryIndex } from '../src/logic/historyIndex'
import type { Manifest, ManifestSource } from '../src/types/library'
import { ALL_RULES_PATH } from './locations'

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
  await expect(ismCard).toContainText(`Current: ${currentIsmRelease.label} (${currentIsmRelease.tag}) · ${ism.rule_count.toLocaleString('en-US')} rules`)
  const pills = ismCard.getByRole('list', { name: 'Releases' }).getByRole('listitem')
  const hasOlderReleasesMenu = ism.releases.length > 4
  await expect(pills).toHaveCount(hasOlderReleasesMenu ? 5 : ism.releases.length)
  await expect(pills.last()).toContainText(`${currentIsmRelease.label} · current`)
  await expect(ismCard.getByText('· current')).toHaveCount(1)
})

const pill = (page: Page, displayName: string, labelStart: string) =>
  card(page, displayName).getByRole('list', { name: 'Releases' }).getByRole('link', { name: new RegExp(`^${labelStart}`) })

test('pressing the current release opens its comparison with the release before it', async ({ page }) => {
  await page.goto('/frameworks')

  await pill(page, ism.display_name, currentIsmRelease.label).click()

  await expect(page).toHaveURL(new RegExp(`framework=asd_ism&tab=releases&from=${previousIsmRelease.tag}&to=${currentIsmRelease.tag}$`))
  await page.goBack()
  await expect(page).toHaveURL(/\/frameworks$/)
  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
})

test('pressing a middle release compares it with the release before it', async ({ page }) => {
  await page.goto('/frameworks')

  await pill(page, ism.display_name, middleIsmRelease.label).click()

  await expect(page).toHaveURL(new RegExp(`framework=asd_ism&tab=releases&from=${releaseBeforeMiddleIsmRelease.tag}&to=${middleIsmRelease.tag}$`))
  await expect(page.getByRole('heading', { name: `${ism.display_name}: ${releaseBeforeMiddleIsmRelease.label} to ${middleIsmRelease.label}` })).toBeVisible({ timeout: 15_000 })
})

test('the cards have no Compare releases button', async ({ page }) => {
  await page.goto('/frameworks')

  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
  await expect(page.getByRole('button', { name: 'Compare releases' })).toHaveCount(0)
  await expect(page.getByText('Choose a release to see what changed in it.')).toHaveCount(manifest.sources.length)
})

test('the views are Frameworks, Licences and Products, with Frameworks first', async ({ page }) => {
  await page.goto('/')
  const links = page.getByRole('navigation', { name: 'Views' }).getByRole('link')
  await expect(links).toHaveText(['Frameworks', 'Licences', 'Products'])
})

// A release comparison of the framework's oldest release against its current one.
const firstIsmRelease = ism.releases[0]
const ismHistory = JSON.parse(readFileSync(new URL('../public/baselines/_history/asd_ism.json', import.meta.url), 'utf8')) as HistoryIndex
const REMOVED_ISM_RULE = compareReleases(ismHistory, firstIsmRelease.tag, currentIsmRelease.tag).removed[0]?.id ?? ''
const comparisonUrl = `/frameworks?framework=asd_ism&from=${firstIsmRelease.tag}&to=${currentIsmRelease.tag}`

const tileValue = async (page: Page, name: string) => Number((await page.getByTestId(`summary-tile-${name}`).locator('span').first().textContent())?.replace(',', ''))
const groupCount = async (page: Page, title: string) => {
  const heading = page.getByRole('heading').filter({ hasText: `${title} (` })
  if ((await heading.count()) === 0) return 0
  return Number(/\(([\d,]+)\)/.exec((await heading.first().textContent()) ?? '')![1].replace(',', ''))
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

test('Full history opens the rule on the all-rules page on its History tab', async ({ page }) => {
  await page.goto(comparisonUrl)
  const row = page.locator('[data-testid="comparison-row"][data-group="changed"]').first()
  await row.getByRole('button').first().click()
  await row.getByRole('link', { name: 'Full history' }).click()

  await expect(page).toHaveURL(/\/frameworks\?.*rule=asd_ism\.[^&]+&framework=all&tab=rules/)
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

  await expect(page).toHaveURL(new RegExp(`framework=asd_ism&tab=releases&from=empty&to=${firstIsmRelease.tag}$`))
  await expect(page.getByRole('heading', { name: /Empty release to/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(`Compared with an empty release, so every rule in ${firstIsmRelease.label} is listed as added.`)).toBeVisible()
  await expect.poll(() => tileValue(page, 'added')).toBe(ruleCountFirstAddedInIsm)
  for (const name of ['removed', 'changed', 'unchanged']) expect(await tileValue(page, name)).toBe(0)
})

test("a framework's oldest release opens its comparison against an empty release", async ({ page }) => {
  const nist = sourceNamed('nist_800_53')
  const oldestNistRelease = nist.releases[0]
  await page.goto('/frameworks')

  await pill(page, nist.display_name, oldestNistRelease.label).click()

  await expect(page).toHaveURL(new RegExp(`framework=nist_800_53&tab=releases&from=empty&to=${oldestNistRelease.tag}$`))
  await expect.poll(() => tileValue(page, 'added'), { timeout: 15_000 }).toBe(oldestNistRelease.rule_count)
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
  await expect(page).toHaveURL(/framework=nist_800_53&tab=releases&from=/)
})

test('an empty-release address survives a reload', async ({ page }) => {
  await page.goto(emptyIsmUrl)
  await expect(page.getByText('Compared with an empty release', { exact: false })).toBeVisible({ timeout: 15_000 })

  await page.reload()

  await expect(page).toHaveURL(new RegExp(`from=empty&to=${firstIsmRelease.tag}$`))
  await expect(page.getByLabel('From')).toHaveValue('empty', { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /Empty release to/ })).toBeVisible()
})

const mscp = sourceNamed('mscp')
const subTabs = (page: Page) => page.getByRole('navigation', { name: 'Page tabs' }).getByRole('link')
const ruleCount = (page: Page) => page.getByText(/^[\d,]+ of [\d,]+ rules$/)

test('the all-rules page has only the Rules sub-tab and keeps the Source facet', async ({ page }) => {
  await page.goto('/frameworks?framework=all&tab=rules')

  await expect(page.getByRole('heading', { name: 'All rules', level: 2 })).toBeVisible()
  await expect(subTabs(page)).toHaveText(['Rules'])
  await expect(ruleCount(page)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'Source' })).toBeVisible()
})

test('a framework page lists only its rules, hides the Source facet and leaves the source filter alone', async ({ page }) => {
  await page.goto('/frameworks?framework=mscp&tab=rules&source=asd_ism')

  await expect(page.getByRole('heading', { name: mscp.display_name, level: 2 })).toBeVisible()
  await expect(page.getByText(`Current release: ${mscp.releases.at(-1)!.label} (${mscp.releases.at(-1)!.tag}) · ${mscp.rule_count} rules`)).toBeVisible()
  await expect(subTabs(page)).toHaveText(['Rules', 'Releases', 'Coverage'])
  await expect(ruleCount(page)).toHaveText(`${mscp.rule_count} of ${mscp.rule_count} rules`, { timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'Source' })).toHaveCount(0)
  await expect(page).toHaveURL(/source=asd_ism/)
})

test('the Releases sub-tab defaults to the current release against the previous one, and Back returns to Rules', async ({ page }) => {
  await page.goto('/frameworks?framework=asd_ism')
  await expect(page).toHaveURL(/framework=asd_ism&tab=rules$/)

  await subTabs(page).filter({ hasText: 'Releases' }).click()

  await expect(page).toHaveURL(/framework=asd_ism&tab=releases$/)
  await expect(page.getByRole('heading', { name: `${ism.display_name}: ${previousIsmRelease.label} to ${currentIsmRelease.label}` })).toBeVisible({ timeout: 15_000 })
  await page.goBack()
  await expect(page).toHaveURL(/framework=asd_ism&tab=rules$/)
  await expect(ruleCount(page)).toBeVisible()
})

test('the sub-tabs are links that carry the page address', async ({ page }) => {
  await page.goto('/frameworks?framework=asd_ism&tab=rules')

  await expect(subTabs(page).filter({ hasText: 'Releases' })).toHaveAttribute('href', /\/frameworks\?framework=asd_ism&tab=releases$/)
  await expect(subTabs(page).filter({ hasText: 'Rules' })).toHaveAttribute('aria-current', 'page')
})

test('All frameworks goes back to the card grid', async ({ page }) => {
  await page.goto('/frameworks?framework=asd_ism&tab=releases')

  await page.getByRole('link', { name: 'All frameworks' }).click()

  await expect(page).toHaveURL(/\/frameworks$/)
  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
})

test('an unknown framework shows the grid and a disallowed sub-tab falls back to Rules', async ({ page }) => {
  await page.goto('/frameworks?framework=nonsense')
  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)

  await page.goto('/frameworks?framework=all&tab=coverage')
  await expect(page).toHaveURL(/framework=all&tab=rules$/)
  await expect(subTabs(page)).toHaveText(['Rules'])
})

test('Generate opens the review in place of the framework page and Back returns to it', async ({ page }) => {
  const ruleId = Object.keys(ismHistory.rules)[0]
  await page.addInitScript((selectedRuleId) => {
    const ref = { id: selectedRuleId, path: `asd_ism/rules/${selectedRuleId.slice(selectedRuleId.indexOf('.') + 1)}.json` }
    const selections = { [selectedRuleId]: { ref, enabled: true, odvValue: null } }
    window.localStorage.setItem('intune-toolkit:selections', JSON.stringify({ state: { selections }, version: 2 }))
  }, ruleId)
  await page.goto('/frameworks?framework=asd_ism&tab=rules')
  await expect(page.getByText('1 selected')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByRole('heading', { name: 'Review & generate' })).toBeVisible()
  await expect(subTabs(page)).toHaveCount(0)

  await page.getByRole('button', { name: 'Back to ASD ISM' }).click()
  await expect(page.getByRole('heading', { name: ism.display_name, level: 2 })).toBeVisible()
})

test('the mSCP card shows its caps, and neither the ISM card nor the NIST card has a combined bar', async ({ page }) => {
  await page.goto('/frameworks')
  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)

  const mscpCard = card(page, mscp.display_name)
  await expect(mscpCard.getByText('max 140')).toBeVisible()
  await expect(mscpCard.getByText('max 61')).toBeVisible()
  await expect(card(page, mscp.display_name).getByText('Supports NIST SP 800-53')).toBeVisible()
  await expect(card(page, ism.display_name).getByText('All mapped frameworks')).toHaveCount(0)
  await expect(card(page, ism.display_name).getByText('linked as related, not counted as coverage')).toBeVisible()
  await expect(card(page, sourceNamed('nist_800_53').display_name).getByText('All mapped frameworks')).toHaveCount(0)
})

test('Browse all rules opens the all-rules page and a card Coverage link opens its Coverage sub-tab', async ({ page }) => {
  await page.goto('/frameworks')

  await page.getByRole('link', { name: 'Browse all rules' }).click()
  await expect(page).toHaveURL(/framework=all&tab=rules$/)

  await page.goto('/frameworks')
  await card(page, mscp.display_name).getByRole('link', { name: 'Coverage' }).click()
  await expect(page).toHaveURL(/framework=mscp&tab=coverage$/)
})

test('a card Rules link opens the Rules sub-tab of its framework', async ({ page }) => {
  await page.goto('/frameworks')

  await card(page, ism.display_name).getByRole('link', { name: 'Rules' }).click()
  await expect(page).toHaveURL(/framework=asd_ism&tab=rules$/)
})

test('the card Rules and Coverage links sit in the title row, to the right of the title', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/frameworks')

  const mscpCard = card(page, mscp.display_name)
  const titleBox = (await mscpCard.getByRole('heading', { name: mscp.display_name }).boundingBox())!
  for (const linkName of ['Rules', 'Coverage']) {
    const linkBox = (await mscpCard.getByRole('link', { name: linkName, exact: true }).boundingBox())!
    expect(linkBox.x).toBeGreaterThan(titleBox.x + titleBox.width)
    expect(Math.abs(linkBox.y + linkBox.height / 2 - (titleBox.y + titleBox.height / 2))).toBeLessThan(titleBox.height)
  }
})

test('an Older releases menu appears on exactly the cards that keep more than four releases', async ({ page }) => {
  await page.goto('/frameworks')

  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
  await expect(page.getByRole('button', { name: 'Older releases' })).toHaveCount(manifest.sources.filter((source) => source.releases.length > 4).length)
})

test('an older release from the Older releases menu opens its comparison on the Releases sub-tab', async ({ page }) => {
  const framework = manifest.sources.find((source) => source.releases.length > 4)
  test.skip(framework === undefined, 'no framework keeps more than four releases')
  const olderRelease = framework!.releases[1]
  await page.goto('/frameworks')

  await card(page, framework!.display_name).getByRole('button', { name: 'Older releases' }).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${olderRelease.label}`) }).click()

  await expect(page).toHaveURL(new RegExp(`framework=${framework!.name}&tab=releases&from=${framework!.releases[0].tag}&to=${olderRelease.tag}$`))
  await expect(page.getByRole('heading', { name: new RegExp(`^${framework!.display_name}: .* to ${olderRelease.label}`) })).toBeVisible({ timeout: 15_000 })
})

test('a remembered page size on the explicit /frameworks path keeps the card grid', async ({ page }) => {
  await page.goto('/frameworks?size=100')
  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
  await expect(page).not.toHaveURL(/framework=all/)
})

test('Back from a framework page to a searched grid lands on the grid, not the all-rules page', async ({ page }) => {
  await page.goto(ALL_RULES_PATH)
  await page.getByPlaceholder('Search title or id…').fill('audit')
  await page.getByRole('link', { name: 'All frameworks' }).click()
  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
  await card(page, ism.display_name).getByRole('link', { name: 'Rules' }).click()
  await expect(page).toHaveURL(/framework=asd_ism/)

  await page.goBack()

  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
})

test('an old bare-base Rules link lands on the all-rules page with its search kept', async ({ page }) => {
  await page.goto('/?q=audit')
  await expect(page).toHaveURL(/framework=all&tab=rules/)
  await expect(page).toHaveURL(/q=audit/)
})

test('an unknown framework in the address shows the card grid and is dropped from the address', async ({ page }) => {
  await page.goto('/frameworks?framework=nonsense')

  await expect(page.getByTestId('framework-card')).toHaveCount(manifest.sources.length)
  await expect(page).not.toHaveURL(/framework=/)
})

test('a framework card with a related partner draws a grey related-only bar', async ({ page }) => {
  await page.goto('/frameworks')

  await expect(page.getByTestId('framework-card').first()).toBeVisible()
  const relatedLines = page.getByText(/^Related to /)
  test.skip((await relatedLines.count()) === 0, 'no framework pair is related only')
  await expect(page.getByRole('img', { name: /related only, not counted as coverage/ }).first()).toBeVisible()
})
