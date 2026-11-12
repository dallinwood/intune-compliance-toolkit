import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { newestReleaseChange } from '../src/logic/generateChecks'
import type { HistoryIndex } from '../src/logic/historyIndex'

const EMPTY_MAPPING_INDEX = { schema_version: 1, by_rule: {} }
const EMPTY_CATALOG_INDEX = { schema_version: 1, vendors: [], products: [], licences: [], by_product: {} }

test.beforeEach(async ({ page }) => {
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_MAPPING_INDEX) }),
  )
  await page.route('**/catalog/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_CATALOG_INDEX) }),
  )
})

const mscpHistory = JSON.parse(
  readFileSync(new URL('../public/baselines/_history/mscp.json', import.meta.url), 'utf8'),
) as HistoryIndex

const mscpRuleIds = Object.keys(mscpHistory.rules)
const CHANGED_RULE_ID = mscpRuleIds.find((ruleId) => newestReleaseChange(mscpHistory, ruleId)?.kind === 'changed') ?? ''
// A rule in the newest release with no organization value to fill in, so it classifies without being blocked.
const CLEAN_RULE_ID =
  mscpRuleIds.find(
    (ruleId) =>
      newestReleaseChange(mscpHistory, ruleId) === null &&
      mscpHistory.rules[ruleId].versions.every((version) => version !== null) &&
      !mscpHistory.rules[ruleId].title.includes('$ODV') &&
      !ruleId.startsWith('mscp.pwpolicy'),
  ) ?? ''

async function selectRules(page: Page, selections: { ruleId: string; odvValue: string | null }[]) {
  await page.addInitScript((entries) => {
    const persistedSelections: Record<string, unknown> = {}
    for (const { ruleId, odvValue } of entries) {
      const upstreamId = ruleId.slice(ruleId.indexOf('.') + 1)
      const ref = { id: ruleId, path: `mscp/rules/${upstreamId}.json` }
      persistedSelections[ruleId] = { ref, enabled: true, odvValue }
    }
    window.localStorage.setItem('intune-toolkit:selections', JSON.stringify({ state: { selections: persistedSelections }, version: 2 }))
  }, selections)
  await page.goto('/')
  await expect(page.getByText(`${selections.length} selected`)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Generate' }).click()
}

const checksPanel = (page: Page) => page.getByTestId('generate-checks')
const checkRow = (page: Page, checkId: string) => checksPanel(page).locator(`[data-check-id="${checkId}"]`)

test('a blocked rule shows the organization-value error and disables download', async ({ page }) => {
  await selectRules(page, [{ ruleId: 'mscp.pwpolicy_minimum_length_enforce', odvValue: "12'" }])

  const errorRow = checkRow(page, 'organization-value')
  await expect(errorRow).toContainText('Fix these before generating')
  await expect(errorRow).toContainText('Error')
  await expect(errorRow).toContainText('pwpolicy_minimum_length_enforce')
  await expect(errorRow).toContainText('Organization value is invalid: Value must be a whole number.')
  await expect(page.getByRole('alert').locator('[data-check-id="organization-value"]')).toHaveCount(1)
  await expect(checksPanel(page)).toContainText('1 error')
  await expect(page.getByRole('button', { name: 'Download bundle (.zip)' })).toBeDisabled()
})

test('a rule changed between the last two mSCP releases shows a closed changed-in-newest-release note that opens', async ({ page }) => {
  expect(CHANGED_RULE_ID).not.toBe('')
  await selectRules(page, [{ ruleId: CHANGED_RULE_ID, odvValue: null }])

  const noteRow = checkRow(page, 'changed-in-newest-release')
  await expect(noteRow).toBeVisible({ timeout: 15_000 })
  await expect(noteRow).toContainText('Note')
  const toggle = noteRow.getByRole('button', { name: /1 rule/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const upstreamId = CHANGED_RULE_ID.slice(CHANGED_RULE_ID.indexOf('.') + 1)
  await expect(noteRow.getByText(upstreamId, { exact: true })).toBeHidden()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toBeFocused()
  await expect(noteRow.getByText(upstreamId, { exact: true })).toBeVisible()
  await expect(noteRow).toContainText('since')
})

test('a failing history index shows history-unavailable and the download still works', async ({ page }) => {
  await page.route('**/baselines/_history/mscp.json', (route) => route.fulfill({ status: 404, body: 'Not found' }))
  await selectRules(page, [{ ruleId: 'mscp.os_gatekeeper_enable', odvValue: null }])

  const unavailableRow = checkRow(page, 'history-unavailable')
  await expect(unavailableRow).toContainText('Release history could not be loaded for', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Download bundle (.zip)' })).toBeEnabled()
})

test('a clean selection shows no issues found', async ({ page }) => {
  expect(CLEAN_RULE_ID).not.toBe('')
  await selectRules(page, [{ ruleId: CLEAN_RULE_ID, odvValue: null }])

  await expect(checksPanel(page)).toContainText('No issues found with this selection.', { timeout: 15_000 })
  await expect(checksPanel(page).locator('[data-check-id]')).toHaveCount(0)
  await expect(checksPanel(page)).not.toContainText('Running checks')
})
