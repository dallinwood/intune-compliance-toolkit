import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { buildMappingIndex } from '../src/logic/mappingIndex'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as {
  sources: { name: string; release_tag: string }[]
}
const currentReleaseOf = (sourceName: string) => manifest.sources.find((source) => source.name === sourceName)?.release_tag ?? ''
const ISM_RELEASE = currentReleaseOf('asd_ism')
const MSCP_RELEASE = currentReleaseOf('mscp')

const MEDIA_CONTROL = 'asd_ism.ism-0459'
const HARDENING_CONTROL = 'asd_ism.ism-1622'
const DIRECT_SUPPORTER = 'mscp.os_gatekeeper_enable'
const VALUE_SUPPORTER = 'mscp.pwpolicy_minimum_length_enforce'
const CHAIN_SUPPORTER = 'mscp.os_sip_enable'
const MANUAL_MIDDLE_RULE = 'mscp.os_error_message'
const SELECTED_AUTOMATED_SUPPORTER = 'mscp.os_airdrop_disable'

const upstreamId = (ruleId: string) => ruleId.slice(ruleId.indexOf('.') + 1)
const endpoint = (id: string, release: string) => ({ kind: 'rule', id, release })
const ISM_MAPPING_ID = 'supporting-fixture'

// Two ISM controls; the gatekeeper check supports the media control, the password length check (it has
// an organization value) supports both, and the SIP check reaches the hardening control through a
// manual rule, so it is offered only as "through other rules".
const mappingFiles = [
  {
    fileName: `${ISM_MAPPING_ID}.json`,
    value: {
      schema_version: 1,
      id: ISM_MAPPING_ID,
      links: [
        { relation: 'supports', from: [endpoint(DIRECT_SUPPORTER, MSCP_RELEASE)], to: [endpoint(MEDIA_CONTROL, ISM_RELEASE)] },
        {
          relation: 'supports',
          from: [endpoint(VALUE_SUPPORTER, MSCP_RELEASE)],
          to: [endpoint(MEDIA_CONTROL, ISM_RELEASE), endpoint(HARDENING_CONTROL, ISM_RELEASE)],
        },
        { relation: 'supports', from: [endpoint(MANUAL_MIDDLE_RULE, MSCP_RELEASE)], to: [endpoint(HARDENING_CONTROL, ISM_RELEASE)] },
        { relation: 'supports', from: [endpoint(CHAIN_SUPPORTER, MSCP_RELEASE)], to: [endpoint(MANUAL_MIDDLE_RULE, MSCP_RELEASE)] },
        { relation: 'supports', from: [endpoint(SELECTED_AUTOMATED_SUPPORTER, MSCP_RELEASE)], to: [endpoint(HARDENING_CONTROL, ISM_RELEASE)] },
      ],
    },
  },
]

interface SeedSelection {
  ruleId: string
  odvValue?: string | number | null
  enabled?: boolean
}

async function seed(page: Page, selections: SeedSelection[], supportingChecks?: { includeSupporting: boolean; overrides: Record<string, string> }) {
  await page.addInitScript(
    ({ selectionsToSeed, supportingToSeed }) => {
      if (window.localStorage.getItem('intune-toolkit:seeded') !== null) return
      window.localStorage.setItem('intune-toolkit:seeded', '1')
      const persisted = Object.fromEntries(
        selectionsToSeed.map(({ ruleId, odvValue, enabled }) => {
          const source = ruleId.slice(0, ruleId.indexOf('.'))
          const ref = { id: ruleId, path: `${source}/rules/${ruleId.slice(ruleId.indexOf('.') + 1)}.json` }
          return [ruleId, { ref, enabled: enabled ?? true, odvValue: odvValue ?? null }]
        }),
      )
      window.localStorage.setItem('intune-toolkit:selections', JSON.stringify({ state: { selections: persisted }, version: 2 }))
      if (supportingToSeed) window.localStorage.setItem('intune-toolkit:supporting-checks', JSON.stringify({ state: supportingToSeed, version: 1 }))
    },
    { selectionsToSeed: selections, supportingToSeed: supportingChecks ?? null },
  )
}

test.beforeEach(async ({ page }) => {
  const mappingIndex = buildMappingIndex(mappingFiles, () => {})
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mappingIndex) }),
  )
})

async function openGenerate(page: Page, selectedCount: number) {
  await page.goto('/')
  await expect(page.getByText(`${selectedCount} selected`)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByRole('heading', { name: 'Review & generate' })).toBeVisible()
}

const panel = (page: Page) => page.getByTestId('supporting-checks')
const mainToggle = (page: Page) => panel(page).getByRole('checkbox', { name: /Add automated checks from rules that support/ })
const reviewButton = (page: Page) => panel(page).getByRole('button', { name: /^Review supporting checks/ })
const rowOf = (page: Page, ruleId: string) => panel(page).locator(`[data-rule-id="${ruleId}"]`)
const download = (page: Page) => page.getByRole('button', { name: 'Download bundle (.zip)' })

test('the panel is hidden when no selected control has an automated supporter', async ({ page }) => {
  await seed(page, [{ ruleId: DIRECT_SUPPORTER }])
  await openGenerate(page, 1)
  await expect(page.getByText('1 scripted rule')).toBeVisible({ timeout: 15_000 })
  await expect(panel(page)).toHaveCount(0)
})

test('a supporting check row stays a compact list row rather than a card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await seed(page, [{ ruleId: MEDIA_CONTROL }, { ruleId: HARDENING_CONTROL }])
  await openGenerate(page, 2)
  await reviewButton(page).click()
  const box = await rowOf(page, DIRECT_SUPPORTER).boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeLessThan(70)
})

test('the toggle adds direct supporting checks, leaves those through other rules out, and an excluded row leaves the count', async ({ page }) => {
  await seed(page, [{ ruleId: MEDIA_CONTROL }, { ruleId: HARDENING_CONTROL }])
  await openGenerate(page, 2)

  await expect(panel(page)).toContainText('4 checks available for 2 of 2 selected controls; 1 need an organization value.')
  await expect(page.getByText('0 scripted rule')).toBeVisible()
  await expect(mainToggle(page)).not.toBeChecked()

  await mainToggle(page).click()
  await expect(panel(page)).toContainText('Adding 3 of 4 supporting checks', { timeout: 15_000 })
  await expect(page.getByText('3 scripted rule')).toBeVisible()

  await reviewButton(page).click()
  await expect(reviewButton(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(rowOf(page, DIRECT_SUPPORTER).getByRole('checkbox', { name: `Include ${upstreamId(DIRECT_SUPPORTER)}` })).toBeChecked()
  await expect(rowOf(page, VALUE_SUPPORTER)).toContainText('Supports ism-0459, ism-1622')
  await expect(rowOf(page, VALUE_SUPPORTER)).toContainText('Require a Minimum Password Length of 6 Characters')
  await expect(rowOf(page, VALUE_SUPPORTER)).toContainText('Value: 6 (recommended)')

  const throughToggle = panel(page).getByRole('button', { name: /^Through other rules \(1\)/ })
  await expect(throughToggle).toHaveAttribute('aria-expanded', 'false')
  await throughToggle.click()
  const chainRow = rowOf(page, CHAIN_SUPPORTER)
  await expect(chainRow.getByRole('checkbox')).not.toBeChecked()
  await expect(chainRow.getByLabel(/os_sip_enable supports os_error_message, which supports ism-1622/)).toContainText(
    'os_sip_enable -> supports os_error_message -> supports ism-1622',
  )

  const rulePathRequests: string[] = []
  page.on('request', (request) => {
    if (/\/baselines\/(mscp|asd_ism)\/.*\/rules\/.*\.json/.test(request.url())) rulePathRequests.push(request.url())
  })
  await rowOf(page, DIRECT_SUPPORTER).getByRole('checkbox').click()
  await expect(panel(page)).toContainText('Adding 2 of 4 supporting checks')
  await expect(page.getByText('2 scripted rule')).toBeVisible()
  await chainRow.getByRole('checkbox').click()
  await expect(panel(page)).toContainText('Adding 3 of 4 supporting checks')
  await mainToggle(page).click()
  await mainToggle(page).click()
  await expect(panel(page)).toContainText('Adding 3 of 4 supporting checks')
  expect(rulePathRequests).toEqual([])
})

test('with a filter active the bulk buttons say they act on the shown rows only', async ({ page }) => {
  await seed(page, [{ ruleId: MEDIA_CONTROL }, { ruleId: HARDENING_CONTROL }])
  await openGenerate(page, 2)
  await reviewButton(page).click()
  await expect(panel(page).getByRole('button', { name: 'Include all direct supporting checks' })).toHaveText('Include all')

  await panel(page).getByRole('searchbox', { name: 'Filter supporting checks' }).fill('gatekeeper')
  const includeShown = panel(page).getByRole('button', { name: 'Include shown direct supporting checks' })
  await expect(includeShown).toHaveText('Include shown')
  await expect(panel(page).getByRole('button', { name: 'Exclude shown direct supporting checks' })).toHaveText('Exclude shown')
  await expect(panel(page).getByRole('button', { name: 'Include all direct supporting checks' })).toHaveCount(0)
})

test('an offered check that fails to load only warns while it is not included', async ({ page }) => {
  await page.route(`**/rules/${upstreamId(CHAIN_SUPPORTER)}.json`, (route) => route.abort())
  await seed(page, [{ ruleId: MEDIA_CONTROL }, { ruleId: HARDENING_CONTROL }])
  await openGenerate(page, 2)
  await mainToggle(page).click()
  await expect(panel(page)).toContainText('1 supporting check could not be loaded', { timeout: 15_000 })
  await expect(page.getByText('3 scripted rule')).toBeVisible()
  await expect(download(page)).toBeEnabled()
})

test('an invalid stored value on an included supporting check blocks the download until it is excluded', async ({ page }) => {
  await seed(page, [{ ruleId: MEDIA_CONTROL }, { ruleId: VALUE_SUPPORTER, enabled: false, odvValue: "12'" }], {
    includeSupporting: true,
    overrides: {},
  })
  await openGenerate(page, 1)

  const errorRow = page.getByTestId('generate-checks').locator('[data-check-id="organization-value"]')
  await expect(errorRow).toContainText('Organization value is invalid', { timeout: 15_000 })
  await expect(errorRow).toContainText('(supporting check)')
  await expect(errorRow).toContainText('For supporting checks, set the value under Supporting checks below.')
  await expect(download(page)).toBeDisabled()

  await reviewButton(page).click()
  await rowOf(page, VALUE_SUPPORTER).getByRole('checkbox').click()
  await expect(errorRow).toHaveCount(0)
  await expect(download(page)).toBeEnabled()
})

test('the download holds supporting-checks.md and the attestation report split by automated support', async ({ page }) => {
  await seed(page, [{ ruleId: MEDIA_CONTROL }, { ruleId: HARDENING_CONTROL }, { ruleId: SELECTED_AUTOMATED_SUPPORTER }], {
    includeSupporting: true,
    overrides: { [DIRECT_SUPPORTER]: 'exclude' },
  })
  await openGenerate(page, 3)
  await expect(download(page)).toBeEnabled({ timeout: 15_000 })

  const report = page.locator('section[aria-labelledby="manual-attestation-heading"]')
  await expect(report).toContainText('Needs manual attestation (2)')
  await expect(report.getByRole('button', { name: 'No automated support (0)' })).toHaveCount(0)
  await expect(report.getByRole('button', { name: 'Supported by automated checks in this bundle (2)' })).toHaveAttribute('aria-expanded', 'false')

  const downloadEvent = page.waitForEvent('download')
  await download(page).click()
  const files = unzipSync(new Uint8Array(await readFile(await (await downloadEvent).path())))
  const fileNames = Object.keys(files)
  expect(fileNames).toContain('supporting-checks.md')
  expect(fileNames).toContain('manual-attestation.md')

  const supporting = new TextDecoder().decode(files['supporting-checks.md'])
  expect(supporting).toContain(`## Direct`)
  expect(supporting).toContain(`**${upstreamId(VALUE_SUPPORTER)}**`)
  expect(supporting).toContain(`(mapping ${ISM_MAPPING_ID})`)
  expect(supporting).toContain('## Excluded by you')
  expect(supporting.indexOf(`**${upstreamId(DIRECT_SUPPORTER)}**`)).toBeGreaterThan(supporting.indexOf('## Excluded by you'))

  const attestation = new TextDecoder().decode(files['manual-attestation.md'])
  expect(attestation).toContain('## Supported by automated checks in this bundle (2)')
  expect(attestation).toContain(`Automated support: ${upstreamId(SELECTED_AUTOMATED_SUPPORTER)}, ${upstreamId(VALUE_SUPPORTER)}`)
})

test('supporting check choices survive an export and an import', async ({ page }) => {
  await seed(page, [{ ruleId: MEDIA_CONTROL }], { includeSupporting: true, overrides: { [DIRECT_SUPPORTER]: 'exclude', [CHAIN_SUPPORTER]: 'include' } })
  await page.goto('/')
  await expect(page.getByText('1 selected')).toBeVisible({ timeout: 15_000 })

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const exportedPath = await (await downloadEvent).path()
  const exported = JSON.parse(await readFile(exportedPath, 'utf8')) as { supportingChecks?: unknown }
  expect(exported.supportingChecks).toEqual({ includeSupporting: true, overrides: { [DIRECT_SUPPORTER]: 'exclude', [CHAIN_SUPPORTER]: 'include' } })

  await page.evaluate(() => window.localStorage.removeItem('intune-toolkit:supporting-checks'))
  await page.evaluate(() => window.localStorage.removeItem('intune-toolkit:selections'))
  await page.reload()
  await expect(page.getByText('0 selected')).toBeVisible({ timeout: 15_000 })

  await page.locator('input[type="file"]').setInputFiles(exportedPath)
  await expect(page.getByText('1 selected')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem('intune-toolkit:supporting-checks') ?? '{}').state))
    .toEqual({ includeSupporting: true, overrides: { [DIRECT_SUPPORTER]: 'exclude', [CHAIN_SUPPORTER]: 'include' } })
})

function watchRuleFetches(page: Page): string[] {
  const rulePathRequests: string[] = []
  page.on('request', (request) => {
    if (/\/baselines\/(mscp|asd_ism)\/.*\/rules\/.*\.json/.test(request.url())) rulePathRequests.push(request.url())
  })
  return rulePathRequests
}

const valueField = (row: ReturnType<typeof rowOf>) => row.getByRole('textbox')

test('the quick editor takes a typed value or a recommended pick, rejects an invalid one, and never re-fetches', async ({ page }) => {
  await seed(page, [{ ruleId: MEDIA_CONTROL }], { includeSupporting: true, overrides: {} })
  await openGenerate(page, 1)
  await expect(panel(page)).toContainText('Adding', { timeout: 15_000 })
  await reviewButton(page).click()
  const row = rowOf(page, VALUE_SUPPORTER)
  await expect(row).toContainText('Value: 6 (recommended)')

  const rulePathRequests = watchRuleFetches(page)
  const change = row.getByRole('button', { name: 'Change' })
  await expect(change).toHaveAttribute('aria-expanded', 'false')
  await change.click()
  await expect(change).toHaveAttribute('aria-expanded', 'true')

  await valueField(row).fill('12')
  await expect(row).toContainText('Value: 12 (set by you)')
  await expect(row).toContainText('Require a Minimum Password Length of 12 Characters')

  await valueField(row).fill('abc')
  await expect(row.getByRole('alert')).toContainText('Value must be a whole number.')
  await expect(row).toContainText('Value: 12 (set by you)')
  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('intune-toolkit:selections') ?? '{}').state.selections)
  expect(stored[VALUE_SUPPORTER]).toMatchObject({ enabled: false, odvValue: 12 })

  await row.getByRole('button', { name: /^Recommended/ }).click()
  await expect(row).toContainText('Value: 6 (set by you)')
  expect(rulePathRequests).toEqual([])
})

test('a recommended pick clears a blocking stored value and the scripted count follows', async ({ page }) => {
  await seed(page, [{ ruleId: MEDIA_CONTROL }, { ruleId: VALUE_SUPPORTER, enabled: false, odvValue: "12'" }], {
    includeSupporting: true,
    overrides: { [DIRECT_SUPPORTER]: 'exclude' },
  })
  await openGenerate(page, 1)
  await expect(download(page)).toBeDisabled({ timeout: 15_000 })
  await reviewButton(page).click()
  const row = rowOf(page, VALUE_SUPPORTER)
  await expect(row).toContainText("Value: 12' is invalid")

  await row.getByRole('button', { name: 'Change' }).click()
  await row.getByRole('button', { name: /^Recommended/ }).click()
  await expect(row).toContainText('Value: 6 (set by you)')
  await expect(download(page)).toBeEnabled()
  await expect(page.getByText('1 scripted rule')).toBeVisible()
})

test('Details opens the rule in a dialog, a value set there shows on the row, and focus returns to Details', async ({ page }) => {
  await seed(page, [{ ruleId: MEDIA_CONTROL }], { includeSupporting: true, overrides: {} })
  await openGenerate(page, 1)
  await expect(panel(page)).toContainText('Adding', { timeout: 15_000 })
  await reviewButton(page).click()
  const row = rowOf(page, VALUE_SUPPORTER)
  await row.scrollIntoViewIfNeeded()
  const scrollContainer = page.locator('div.overflow-y-auto').first()
  const scrollTopBefore = await scrollContainer.evaluate((element) => element.scrollTop)

  const rulePathRequests = watchRuleFetches(page)
  const detailsButton = row.getByRole('button', { name: 'Details' })
  await detailsButton.click()
  const dialog = page.getByRole('dialog', { name: new RegExp(`^${upstreamId(VALUE_SUPPORTER)} - Require a Minimum Password Length of [0-9]+ Characters$`) })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill('20')
  await expect(row).toContainText('Value: 20 (set by you)')

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(detailsButton).toBeFocused()
  expect(await scrollContainer.evaluate((element) => element.scrollTop)).toBe(scrollTopBefore)

  await detailsButton.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(detailsButton).toBeFocused()
  expect(rulePathRequests).toEqual([])
})
