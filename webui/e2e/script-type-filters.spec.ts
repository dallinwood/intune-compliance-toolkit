import { expect, test, type Page } from '@playwright/test'
import { openFacetGroup } from './facets'

test.use({ viewport: { width: 1280, height: 800 } })

const frameworkRulesPath = (framework: string) => `/frameworks?framework=${framework}&tab=rules`
const ruleCount = (page: Page) => page.getByText(/^[\d,]+ of [\d,]+ rules$/)

async function openRulesPage(page: Page, framework: string) {
  await page.goto(frameworkRulesPath(framework))
  await expect(ruleCount(page)).toBeVisible({ timeout: 15_000 })
}

test('a CIS Windows page offers only the check and remediation types its rules have', async ({ page }) => {
  await openRulesPage(page, 'lockdown_cis_windows11')
  await openFacetGroup(page, 'Check')
  await openFacetGroup(page, 'Remediation')

  const checkGroup = page.getByRole('group', { name: 'Check', exact: true })
  const remediationGroup = page.getByRole('group', { name: 'Remediation', exact: true })
  for (const name of ['goss', 'PowerShell', 'Registry']) await expect(checkGroup.getByRole('checkbox', { name, exact: true })).toBeVisible()
  await expect(checkGroup.getByRole('checkbox')).toHaveCount(3)
  for (const name of ['Ansible', 'PowerShell', 'Registry']) await expect(remediationGroup.getByRole('checkbox', { name, exact: true })).toBeVisible()
  await expect(remediationGroup.getByRole('checkbox')).toHaveCount(3)
  await expect(remediationGroup.getByRole('checkbox', { name: 'Configuration profile', exact: true })).toHaveCount(0)
})

test('the Check and Remediation filters narrow the rules separately and are kept in the address', async ({ page }) => {
  await openRulesPage(page, 'mscp')
  await expect(ruleCount(page)).toHaveText('352 of 352 rules')
  await openFacetGroup(page, 'Remediation')

  await page.getByRole('group', { name: 'Remediation', exact: true }).getByRole('checkbox', { name: 'Configuration profile', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText('352 of 352 rules')
  const profileCount = await ruleCount(page).innerText()
  expect(new URL(page.url()).searchParams.getAll('fix')).toEqual(['mobileconfig'])

  await openFacetGroup(page, 'Check')
  await page.getByRole('group', { name: 'Check', exact: true }).getByRole('checkbox', { name: 'Bash', exact: true }).click()
  expect(new URL(page.url()).searchParams.getAll('check')).toEqual(['bash'])

  await page.reload()
  await expect(ruleCount(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('group', { name: 'Remediation', exact: true }).getByRole('checkbox', { name: 'Configuration profile', exact: true })).toBeChecked()
  await expect(page.getByRole('group', { name: 'Check', exact: true }).getByRole('checkbox', { name: 'Bash', exact: true })).toBeChecked()
  expect(Number((await ruleCount(page).innerText()).split(' ')[0])).toBeLessThanOrEqual(Number(profileCount.split(' ')[0]))
})

test('Organization values filters to rules with values to set', async ({ page }) => {
  await openRulesPage(page, 'mscp')
  await openFacetGroup(page, 'Organization values')

  await page.getByRole('group', { name: 'Organization values', exact: true }).getByRole('checkbox', { name: 'Has values to set', exact: true }).click()

  await expect(ruleCount(page)).toHaveText('35 of 352 rules')
  expect(new URL(page.url()).searchParams.getAll('odv')).toEqual(['yes'])
})

test('ASD ISM has no Check group, offers the PowerShell remediations its overlays add, and only No values to set', async ({ page }) => {
  await openRulesPage(page, 'asd_ism')

  await expect(page.getByRole('heading', { name: 'Check', exact: true })).toHaveCount(0)
  await openFacetGroup(page, 'Remediation')
  const remediationGroup = page.getByRole('group', { name: 'Remediation', exact: true })
  await expect(remediationGroup.getByRole('checkbox')).toHaveCount(1)
  await remediationGroup.getByRole('checkbox', { name: 'PowerShell', exact: true }).click()
  await expect(ruleCount(page)).toHaveText('5 of 1,143 rules')

  await openFacetGroup(page, 'Organization values')
  const odvGroup = page.getByRole('group', { name: 'Organization values', exact: true })
  await expect(odvGroup.getByRole('checkbox')).toHaveCount(1)
  await expect(odvGroup.getByRole('checkbox', { name: 'No values to set', exact: true })).toBeVisible()
})
