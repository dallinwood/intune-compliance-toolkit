import { readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import type { HistoryIndex } from '../src/logic/historyIndex'
import { addChangedKinds, buildMappingIndex } from '../src/logic/mappingIndex'

const TOTAL_RULES = 2567
const E4EIT_RULES = 58
const PRO_13_1_STATEMENT =
  'Identify and disable or remove default and unused accounts regularly, permitting exceptions only where the account is documented, justified, hardened and monitored.'

const ruleCount = (page: Page) => page.getByText(/^\d+ of \d+ rules$/)
const detailOf = (page: Page, ruleId: string) => page.locator(`[id="rule-detail-${ruleId}"]`)
const mappedRulesPanel = (page: Page, ruleId: string) => detailOf(page, ruleId).getByRole('tabpanel', { name: /^Mapped rules/ })

const EMPTY_MAPPING_INDEX = { schema_version: 1, by_rule: {} }
const EMPTY_CATALOG_INDEX = { schema_version: 1, vendors: [], products: [], licences: [], by_product: {} }

const mappingsFolder = new URL('../../baselines/_mappings/rules/', import.meta.url)
const committedMappingFiles = readdirSync(mappingsFolder)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort()
  .map((fileName) => ({ fileName, value: JSON.parse(readFileSync(new URL(fileName, mappingsFolder), 'utf8')) as unknown }))
const historyIndexes = ['mscp', 'asd_ism', 'nist_800_53', 'asd_e4eit'].map(
  (sourceName) => JSON.parse(readFileSync(new URL(`../public/baselines/_history/${sourceName}.json`, import.meta.url), 'utf8')) as HistoryIndex,
)
const committedMappingIndex = addChangedKinds(
  buildMappingIndex(committedMappingFiles, () => {}),
  historyIndexes,
)

async function routeCatalogAsEmpty(page: Page) {
  await page.route('**/catalog/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_CATALOG_INDEX) }),
  )
}

async function tickFacetOption(page: Page, name: string) {
  const option = page.getByRole('checkbox', { name, exact: true })
  await option.scrollIntoViewIfNeeded()
  await option.click()
  await expect(option).toBeChecked()
}

test.describe('ASD E4EIT rules with no mappings loaded', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/baselines/_mappings/_index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_MAPPING_INDEX) }),
    )
    await routeCatalogAsEmpty(page)
    await page.goto('/')
    await expect(ruleCount(page)).toHaveText(`${TOTAL_RULES} of ${TOTAL_RULES} rules`, { timeout: 10_000 })
  })

  test('the ASD E4EIT source keeps its 58 rules', async ({ page }) => {
    await tickFacetOption(page, 'ASD E4EIT')
    await expect(ruleCount(page)).toHaveText(`${E4EIT_RULES} of ${TOTAL_RULES} rules`)
  })

  test('searching IT.PRO-13.1 shows one row titled with that action statement', async ({ page }) => {
    await page.getByPlaceholder('Search title or id…').fill('IT.PRO-13.1')
    await expect(ruleCount(page)).toHaveText(`1 of ${TOTAL_RULES} rules`)
    const row = page.locator('table tbody tr')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(PRO_13_1_STATEMENT)
  })

  test('the phase 1 benchmark keeps all 58 rules and the User devices domain keeps 20', async ({ page }) => {
    await tickFacetOption(page, 'E4EIT priority phase 1')
    await expect(ruleCount(page)).toHaveText(`${E4EIT_RULES} of ${TOTAL_RULES} rules`)
    await page.getByRole('checkbox', { name: 'E4EIT priority phase 1', exact: true }).click()
    await expect(ruleCount(page)).toHaveText(`${TOTAL_RULES} of ${TOTAL_RULES} rules`)
    await tickFacetOption(page, 'E4EIT User devices')
    await expect(ruleCount(page)).toHaveText(`20 of ${TOTAL_RULES} rules`)
  })

  test('an action opens with Principle and Indicators headings, effectiveness lists and its credit line', async ({ page }) => {
    await page.goto('/?q=IT.PRO-13.1&rule=asd_e4eit.it.pro-13.1')
    const detail = detailOf(page, 'asd_e4eit.it.pro-13.1')
    await expect(detail.getByText('Principle', { exact: true })).toBeVisible()
    await expect(detail.getByText('Indicators of Good Practice', { exact: true })).toBeVisible()
    await expect(detail.getByText('Fully effective:')).toBeVisible()
    await expect(detail.getByRole('listitem').filter({ hasText: /^A review has been conducted but does not cover all assets/ })).toBeVisible()
    await expect(detail.locator('p').filter({ hasText: /^From / })).toContainText('IT.PRO-13.1')
  })

  test('selecting an E4EIT action credits ASD Essentials for enterprise IT in the attestation report', async ({ page }) => {
    await page.getByPlaceholder('Search title or id…').fill('IT.PRO-13.1')
    await expect(page.locator('table tbody tr')).toHaveCount(1)
    await page.locator('table tbody tr').getByRole('checkbox').click()
    await expect(page.getByText('1 selected')).toBeVisible()

    await page.getByRole('button', { name: 'Generate' }).click()
    const download = page.getByRole('button', { name: 'Download bundle (.zip)' })
    await expect(download).toBeEnabled({ timeout: 10_000 })
    const downloadEvent = page.waitForEvent('download')
    await download.click()
    const zipPath = await (await downloadEvent).path()
    const files = unzipSync(new Uint8Array(await readFile(zipPath)))

    expect(Object.keys(files)).toEqual(['manual-attestation.md'])
    const report = new TextDecoder().decode(files['manual-attestation.md'])
    expect(report).toContain('it.pro-13.1')
    expect(report).toContain('ASD Essentials for enterprise IT')
  })

  test('the Sources & licences dialog lists ASD Essentials for enterprise IT', async ({ page }) => {
    await page.getByRole('contentinfo').getByRole('button', { name: 'Sources & licences' }).click()
    await expect(page.getByRole('dialog', { name: 'Sources & licences' })).toContainText('ASD Essentials for enterprise IT')
  })

  test('the Frameworks card shows the release tag once beside the Oct 2026 label', async ({ page }) => {
    await page.goto('/frameworks')
    const card = page.getByTestId('framework-card').filter({ hasText: 'ASD Essentials for enterprise IT' })
    await expect(card).toContainText('Current: Oct 2026 (v2026.10.15) · 58 rules')
  })
})

test.describe('ASD E4EIT to ISM mappings from the committed mapping files', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  async function openCommittedMappedRules(page: Page, ruleId: string, search: string) {
    await page.route('**/baselines/_mappings/_index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committedMappingIndex) }),
    )
    await routeCatalogAsEmpty(page)
    await page.goto(`/?q=${search}&rule=${ruleId}`)
    await expect(ruleCount(page)).toHaveText(/^\d+ of 2567 rules$/, { timeout: 10_000 })
    await detailOf(page, ruleId).getByRole('tab', { name: /^Mapped rules/ }).click()
    await expect(mappedRulesPanel(page, ruleId)).toBeVisible()
  }

  async function openMappedRules(page: Page, ruleId: string, search: string) {
    await openCommittedMappedRules(page, ruleId, search)
    await mappedRulesPanel(page, ruleId).getByRole('button', { name: /^Related ASD (ISM|E4EIT) \(\d+\)$/ }).click()
  }

  test('an E4EIT action lists ism-1997 and the ISM control lists it.gov-01.1', async ({ page }) => {
    await openMappedRules(page, 'asd_e4eit.it.gov-01.1', 'it.gov-01.1')
    await expect(mappedRulesPanel(page, 'asd_e4eit.it.gov-01.1')).toContainText('ism-1997')

    await openMappedRules(page, 'asd_ism.ism-1997', 'ism-1997')
    await expect(mappedRulesPanel(page, 'asd_ism.ism-1997')).toContainText('it.gov-01.1')
  })
  test('each group names the relation first and its caption says who supports whom', async ({ page }) => {
    const gatekeeper = 'mscp.system_settings_gatekeeper_override_disallow'
    await openCommittedMappedRules(page, gatekeeper, 'system_settings_gatekeeper_override_disallow')
    const gatekeeperPanel = mappedRulesPanel(page, gatekeeper)
    const supportsGroup = gatekeeperPanel.getByRole('button', { name: /^Supports ASD ISM \(\d+\)$/ })
    await supportsGroup.click()
    await expect(gatekeeperPanel.getByText('This rule supports each rule below.')).toBeVisible()
    await expect(gatekeeperPanel.getByRole('list', { name: 'Supports: ASD ISM' })).toBeVisible()

    const control = 'asd_ism.ism-1584'
    await openCommittedMappedRules(page, control, 'ism-1584')
    const controlPanel = mappedRulesPanel(page, control)
    await controlPanel.getByRole('button', { name: /^Supported by NIST mSCP \(\d+\)$/ }).click()
    await expect(controlPanel.getByText('Each rule below supports this rule.')).toBeVisible()
    await expect(controlPanel.getByRole('list', { name: 'Supported by: NIST mSCP' })).toBeVisible()
  })
})
