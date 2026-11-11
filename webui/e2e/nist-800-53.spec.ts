import { readdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { HistoryIndex } from '../src/logic/historyIndex'
import { addChangedKinds, buildMappingIndex } from '../src/logic/mappingIndex'

const ruleCount = (page: Page) => page.getByText(/^\d+ of \d+ rules$/)

const EMPTY_MAPPING_INDEX = { schema_version: 1, by_rule: {} }
const EMPTY_CATALOG_INDEX = { schema_version: 1, vendors: [], products: [], licences: [], by_product: {} }

// A real mapping or catalog would change the details layout these tests read.
test.beforeEach(async ({ page }) => {
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_MAPPING_INDEX) }),
  )
  await page.route('**/catalog/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_CATALOG_INDEX) }),
  )
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('2509 of 2509 rules', { timeout: 10_000 })
})

async function tickFacetOption(page: Page, name: string) {
  const option = page.getByRole('checkbox', { name, exact: true })
  await option.scrollIntoViewIfNeeded()
  await option.click()
  await expect(option).toBeChecked()
}

// A search for 'ac-7' also finds its enhancements, so pick the control by its select checkbox.
async function searchForControlRow(page: Page, controlId: string) {
  await page.getByPlaceholder('Search title or id…').fill(controlId)
  const row = page.locator('table tbody tr').filter({ has: page.getByRole('checkbox', { name: `Select ${controlId}`, exact: true }) })
  await expect(row).toHaveCount(1)
  return row
}

test('ticking the NIST SP 800-53 source keeps its 1014 rules', async ({ page }) => {
  await tickFacetOption(page, 'NIST SP 800-53')
  await expect(ruleCount(page)).toHaveText('1014 of 2509 rules')
})

test('ticking the 800-53 Moderate benchmark keeps its 287 rules', async ({ page }) => {
  await tickFacetOption(page, '800-53 Moderate')
  await expect(ruleCount(page)).toHaveText('287 of 2509 rules')
})

test('searching an enhancement id finds exactly that enhancement, titled with its parent control', async ({ page }) => {
  await page.getByPlaceholder('Search title or id…').fill('ac-20.1')
  await expect(ruleCount(page)).toHaveText('1 of 2509 rules')
  const row = page.locator('table tbody tr')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Use of External Systems | Limits on Authorized Use')
})

test('a control opens with Control and Discussion headings, a nested list and its credit line', async ({ page }) => {
  const row = await searchForControlRow(page, 'ac-7')
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')

  await expect(detail.getByText('Control', { exact: true })).toBeVisible()
  await expect(detail.getByText('Discussion', { exact: true })).toBeVisible()
  await expect(detail.getByRole('listitem').filter({ hasText: /^a\. Enforce a limit/ })).toBeVisible()
  await expect(detail.getByText('[Assignment: organization-defined number]').first()).toBeVisible()
  await expect(detail.locator('p').filter({ hasText: /^From / })).toContainText('From NIST SP 800-53 v1.6.0 (ac-7)')
  await expect(detail.locator('p').filter({ hasText: /^From / })).toContainText('under CC0 1.0 (public domain), modified for this tool.')
})

test('a control with sub-items renders them as a nested list', async ({ page }) => {
  const row = await searchForControlRow(page, 'ac-2')
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')

  const nestedItem = detail.locator('ul ul > li').filter({ hasText: /^1\. Authorized users of the system;/ })
  await expect(nestedItem).toBeVisible()
})

test('the Sources & licences dialog lists NIST SP 800-53 Rev. 5 under CC0 1.0', async ({ page }) => {
  await page.getByRole('contentinfo').getByRole('button', { name: 'Sources & licences' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sources & licences' })
  await expect(dialog).toContainText('Rules from the NIST SP 800-53 Rev. 5')
  await expect(dialog).toContainText('under CC0 1.0 (public domain)')
})

test('the Frameworks card shows the release tag once beside the 800-53 version', async ({ page }) => {
  await page.goto('/frameworks')
  const card = page.getByTestId('framework-card').filter({ hasText: 'NIST SP 800-53 Rev. 5' })
  await expect(card).toContainText('Current: 5.2.0 (v1.6.0) · 1014 rules')
})

// These tests serve the committed baselines/_mappings/rules/ folder through the
// same index code as the publish step, so they read the generated mSCP to
// 800-53 links (the file above routes an empty index for every other test).
test.describe('generated mSCP to 800-53 mappings', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  const GATEKEEPER = 'mscp.os_gatekeeper_enable'
  const CM_7 = 'nist_800_53.cm-7'
  const GENERATED_NOTE = "Generated from mSCP's own references: mSCP lists this 800-53 control for this rule. Not reviewed by this project."

  const mappingsFolder = new URL('../../baselines/_mappings/rules/', import.meta.url)
  const committedMappingFiles = readdirSync(mappingsFolder)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .map((fileName) => ({ fileName, value: JSON.parse(readFileSync(new URL(fileName, mappingsFolder), 'utf8')) as unknown }))
  const historyIndexes = ['mscp', 'asd_ism', 'nist_800_53'].map(
    (sourceName) => JSON.parse(readFileSync(new URL(`../public/baselines/_history/${sourceName}.json`, import.meta.url), 'utf8')) as HistoryIndex,
  )
  const committedMappingIndex = addChangedKinds(
    buildMappingIndex(committedMappingFiles, () => {}),
    historyIndexes,
  )

  const detailOf = (page: Page, ruleId: string) => page.locator(`[id="rule-detail-${ruleId}"]`)
  const mappedRulesPanel = (page: Page, ruleId: string) => detailOf(page, ruleId).getByRole('tabpanel', { name: /^Mapped rules/ })

  async function openRuleWithCommittedMappings(page: Page, ruleId: string, search: string) {
    await page.route('**/baselines/_mappings/_index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committedMappingIndex) }),
    )
    await page.goto(`/?q=${search}&rule=${ruleId}`)
    await expect(ruleCount(page)).toHaveText(/^\d+ of 2509 rules$/, { timeout: 10_000 })
    await detailOf(page, ruleId).getByRole('tab', { name: /^Mapped rules/ }).click()
    await expect(mappedRulesPanel(page, ruleId)).toBeVisible()
  }

  test('an mSCP rule lists the 800-53 controls mSCP cites for it, each with the generated note', async ({ page }) => {
    await openRuleWithCommittedMappings(page, GATEKEEPER, 'os_gatekeeper_enable')
    const panel = mappedRulesPanel(page, GATEKEEPER)

    await panel.getByRole('button', { name: 'NIST SP 800-53 Supports (5)', exact: true }).click()
    const items = panel.getByRole('list', { name: 'NIST SP 800-53 Supports' }).getByRole('listitem')
    await expect(items).toHaveCount(5)
    for (const controlId of ['cm-14', 'cm-5', 'si-7.1', 'si-7.15', 'si-3']) {
      const item = items.filter({ has: page.getByRole('button', { name: new RegExp(`^[^:]*${controlId.replaceAll('.', '[.]')}:`) }) })
      await expect(item).toHaveCount(1)
      await expect(item).toContainText(GENERATED_NOTE)
    }
  })

  test('an 800-53 control lists the mSCP rules that support it and the filter narrows them', async ({ page }) => {
    await openRuleWithCommittedMappings(page, CM_7, 'cm-7')
    const panel = mappedRulesPanel(page, CM_7)

    const group = panel.getByRole('button', { name: 'NIST mSCP Supported by (77)', exact: true })
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await group.click()
    const items = panel.getByRole('list', { name: 'NIST mSCP Supported by' }).getByRole('listitem')
    await expect(items).toHaveCount(77)

    await panel.getByRole('textbox', { name: 'Filter mapped rules' }).fill('os_airdrop_disable')
    await expect(panel.getByRole('button', { name: 'NIST mSCP Supported by (1 of 77)', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText('os_airdrop_disable')
  })

  test('Go to this rule moves between an mSCP rule and an 800-53 control, in both directions', async ({ page }) => {
    await openRuleWithCommittedMappings(page, GATEKEEPER, 'os_gatekeeper_enable')
    const mscpPanel = mappedRulesPanel(page, GATEKEEPER)
    await mscpPanel.getByRole('button', { name: 'NIST SP 800-53 Supports (5)', exact: true }).click()
    const cm5Row = mscpPanel.getByTestId('mapped-rule').filter({ hasText: 'cm-5' })
    await cm5Row.getByRole('button', { name: /^[^:]*cm-5:/ }).click()
    await cm5Row.getByRole('link', { name: 'Go to this rule' }).click()

    const cm5 = 'nist_800_53.cm-5'
    await expect(detailOf(page, cm5)).toBeVisible()
    expect(new URL(page.url()).searchParams.get('rule')).toBe(cm5)
    await detailOf(page, cm5).getByRole('tab', { name: /^Mapped rules/ }).click()
    const controlPanel = mappedRulesPanel(page, cm5)
    await controlPanel.getByRole('button', { name: /^NIST mSCP Supported by \(\d+\)$/ }).click()
    const gatekeeperRow = controlPanel.getByTestId('mapped-rule').filter({ hasText: 'os_gatekeeper_enable' })
    await gatekeeperRow.getByRole('button', { name: /^[^:]*os_gatekeeper_enable:/ }).click()
    await gatekeeperRow.getByRole('link', { name: 'Go to this rule' }).click()

    await expect(detailOf(page, GATEKEEPER)).toBeVisible()
    expect(new URL(page.url()).searchParams.get('rule')).toBe(GATEKEEPER)
  })
})
