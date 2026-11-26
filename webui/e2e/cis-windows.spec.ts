import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { ALL_RULES_PATH } from './locations'

const WINDOWS_CIS_TITLES = [
  'CIS Windows 11 (ansible-lockdown)',
  'CIS Windows Server 2025 (ansible-lockdown)',
  'CIS Windows Server 2022 (ansible-lockdown)',
  'CIS Windows Server 2019 (ansible-lockdown)',
]

const REGISTRY_RULE_ID = 'lockdown_cis_windows11.18.1.1.1'
const ANSIBLE_ONLY_RULE_ID = 'lockdown_cis_windows11.5.3'
const ANSIBLE_ONLY_RULE_TITLE = "Ensure 'Computer Browser (Browser)' is set to 'Disabled' or 'Not Installed'"

async function openRule(page: Page, ruleId: string) {
  await page.goto(ALL_RULES_PATH)
  await page.getByPlaceholder('Search title or id…').fill(ruleId.slice(ruleId.indexOf('.') + 1))
  const row = page.locator(`table tbody tr[data-rule-id="${ruleId}"]`)
  await expect(row).toHaveCount(1, { timeout: 15_000 })
  await row.getByRole('button').click()
  return page.locator('[id^="rule-detail-"]')
}

test('the Frameworks home lists the four Windows CIS sources under Community', async ({ page }) => {
  await page.goto('/frameworks')

  const communityHeading = page.getByRole('heading', { name: 'Community', exact: true })
  await expect(communityHeading).toBeVisible()
  const communityTop = (await communityHeading.boundingBox())!.y + (await page.evaluate(() => window.scrollY))

  for (const title of WINDOWS_CIS_TITLES) {
    const card = page.getByTestId('framework-card').filter({ has: page.getByRole('heading', { name: title }) })
    await expect(card).toHaveCount(1)
    await expect(card.getByText('Community', { exact: true })).toBeVisible()
    const cardTop = (await card.boundingBox())!.y + (await page.evaluate(() => window.scrollY))
    expect(cardTop).toBeGreaterThan(communityTop)
  }
})

test('a Windows CIS registry rule shows the registry table, PowerShell and goss checks, and downloads a .reg file', async ({ page }) => {
  const detail = await openRule(page, REGISTRY_RULE_ID)
  const checkPanel = detail.getByTestId('check-target')

  await detail.getByRole('tab', { name: /Registry/ }).first().click()
  const table = checkPanel.getByRole('table')
  for (const header of ['Key', 'Value', 'Type', 'Data']) {
    await expect(table.getByRole('columnheader', { name: header })).toBeVisible()
  }
  const settingRow = table.getByRole('row').filter({ hasText: 'NoLockScreenCamera' })
  await expect(settingRow).toContainText('HKEY_LOCAL_MACHINE\\Software\\Policies\\Microsoft\\Windows\\Personalization')
  await expect(settingRow).toContainText('REG_DWORD')
  await expect(settingRow.getByRole('cell').last()).toHaveText('1')

  await detail.getByRole('tab', { name: /PowerShell/ }).first().click()
  await expect(checkPanel.locator('pre', { hasText: 'NoLockScreenCamera' })).toBeVisible()

  await detail.getByRole('tab', { name: /goss/ }).click()
  await expect(checkPanel.locator('pre', { hasText: 'win11cis_rule_18_1_1_1' })).toBeVisible()

  await detail.getByRole('tab', { name: /Registry/ }).first().click()
  const downloadPromise = page.waitForEvent('download')
  await checkPanel.getByRole('button', { name: 'Download .reg' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`${REGISTRY_RULE_ID}-Windows-check.reg`)
  const bytes = await readFile((await download.path()) as string)
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe])
  const text = bytes.subarray(2).toString('utf16le')
  expect(text).toContain('[HKEY_LOCAL_MACHINE\\Software\\Policies\\Microsoft\\Windows\\Personalization]')
  expect(text).toContain('"NoLockScreenCamera"=dword:00000001')
})

test('an Ansible-only Windows CIS rule shows Manual and its original Ansible step', async ({ page }) => {
  const detail = await openRule(page, ANSIBLE_ONLY_RULE_ID)
  const row = page.locator(`table tbody tr[data-rule-id="${ANSIBLE_ONLY_RULE_ID}"]`)
  await expect(row).toContainText(ANSIBLE_ONLY_RULE_TITLE)
  await expect(row.locator('[data-status-icon*="manual"]')).toBeVisible()

  const remediation = detail.getByTestId('remediation-target')
  const ansibleStep = remediation.locator('pre', { hasText: 'when: win11cis_rule_5_3' })
  await detail.getByRole('tab', { name: /Ansible/ }).click()
  await expect(ansibleStep).toBeVisible()
})
