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

test('ASD ISM has no Check group, offers the PowerShell remediations its overlays add, and hides Organization values', async ({ page }) => {
  await openRulesPage(page, 'asd_ism')

  await expect(page.getByRole('heading', { name: 'Check', exact: true })).toHaveCount(0)
  await openFacetGroup(page, 'Remediation')
  const remediationGroup = page.getByRole('group', { name: 'Remediation', exact: true })
  await expect(remediationGroup.getByRole('checkbox')).toHaveCount(1)
  await remediationGroup.getByRole('checkbox', { name: 'PowerShell', exact: true }).click()
  await expect(ruleCount(page)).toHaveText('5 of 1,143 rules')

  // Every ISM rule has no values to set, so that one option would filter nothing.
  await expect(page.getByRole('heading', { name: 'Organization values', exact: true })).toHaveCount(0)
})

test('a group whose one option every rule has is hidden, unless that option is ticked', async ({ page }) => {
  await openRulesPage(page, 'asd_e4eit')
  await expect(page.getByRole('heading', { name: 'Version', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Target', exact: true })).toHaveCount(0)

  await page.goto(`${frameworkRulesPath('asd_e4eit')}&target=none`)
  await expect(ruleCount(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('group', { name: 'Target', exact: true }).getByRole('checkbox', { name: 'None', exact: true })).toBeChecked()
})

test('on the all-rules page Benchmark options sit under their framework, and a shared option ticks in every framework', async ({ page }) => {
  await page.goto('/frameworks?framework=all&tab=rules')
  await expect(ruleCount(page)).toBeVisible({ timeout: 15_000 })
  const benchmarkGroup = page.getByRole('group', { name: 'Benchmark', exact: true })
  const server2019 = benchmarkGroup.getByRole('group', { name: 'CIS Windows Server 2019 (ansible-lockdown)', exact: true })
  const server2022 = benchmarkGroup.getByRole('group', { name: 'CIS Windows Server 2022 (ansible-lockdown)', exact: true })
  await expect(benchmarkGroup.getByRole('group', { name: 'NIST mSCP', exact: true }).getByRole('checkbox', { name: 'CIS Level 1', exact: true })).toBeVisible()

  await server2019.getByRole('checkbox', { name: 'Level 1 - Member Server', exact: true }).click()

  await expect(server2019.getByRole('checkbox', { name: 'Level 1 - Member Server', exact: true })).toBeChecked()
  await expect(server2022.getByRole('checkbox', { name: 'Level 1 - Member Server', exact: true })).toBeChecked()
  expect(new URL(page.url()).searchParams.getAll('benchmark')).toEqual(['level1_memberserver'])

  const subgroupToggle = benchmarkGroup.getByRole('button', { name: 'CIS Windows Server 2019 (ansible-lockdown)', exact: true })
  await expect(subgroupToggle).toHaveAttribute('aria-expanded', 'true')
  await subgroupToggle.click()
  await expect(server2019).toBeHidden()
})

test('a framework page lists its Benchmark options without framework sub-headings', async ({ page }) => {
  await openRulesPage(page, 'mscp')
  const benchmarkGroup = page.getByRole('group', { name: 'Benchmark', exact: true })
  await expect(benchmarkGroup.getByRole('checkbox', { name: 'CIS Level 1', exact: true })).toBeVisible()
  await expect(benchmarkGroup.getByRole('group')).toHaveCount(0)
})
