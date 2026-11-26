import { expect, test, type Page } from '@playwright/test'
import { ALL_RULES_PATH } from './locations'

const RULE_FILE_PATTERN = /\/baselines\/mscp\/releases\/[^/]+\/rules\/os_gatekeeper_enable\.json$/

// No committed rule has two checks for one platform yet, so the rule file is
// served with a second, named item added to its macOS check.
async function serveGatekeeperWithSecondCheck(page: Page) {
  await page.route(RULE_FILE_PATTERN, async (route) => {
    const response = await route.fetch()
    const rule = await response.json()
    rule.check.macOS.push({
      name: 'Original goss test',
      language: 'python',
      by_version: {},
      default: { shell: 'print("second check body")', result: null, additional_info: null },
    })
    await route.fulfill({ response, json: rule })
  })
}

async function openGatekeeperDetail(page: Page) {
  await page.goto(ALL_RULES_PATH)
  await page.getByPlaceholder('Search title or id…').fill('os_gatekeeper_enable')
  const row = page.locator('table tbody tr').filter({ hasText: 'Enable Gatekeeper' })
  await expect(row).toHaveCount(1)
  await row.getByRole('button').click()
  return page.locator('[id^="rule-detail-"]')
}

test('a rule with two checks for one platform shows two entries labelled by name or language', async ({ page }) => {
  await serveGatekeeperWithSecondCheck(page)
  const detail = await openGatekeeperDetail(page)

  const languageEntry = detail.getByRole('tab', { name: 'macOS Bash', exact: true })
  const namedEntry = detail.getByRole('tab', { name: 'macOS Original goss test', exact: true })
  await expect(languageEntry).toBeVisible()
  await expect(namedEntry).toBeVisible()
  await expect(languageEntry).toHaveAttribute('aria-selected', 'true')
  await expect(detail.getByTestId('check-target')).toContainText('objectIsForcedForKey')

  await namedEntry.click()
  await expect(namedEntry).toHaveAttribute('aria-selected', 'true')
  await expect(detail.getByTestId('check-target')).toContainText('second check body')

  await languageEntry.click()
  await expect(namedEntry).toHaveAttribute('aria-selected', 'false')
  await expect(detail.getByTestId('check-target')).toContainText('objectIsForcedForKey')
  await expect(detail.getByTestId('check-target')).not.toContainText('second check body')
})
