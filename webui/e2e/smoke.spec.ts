import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { buildMappingIndex } from '../src/logic/mappingIndex'
import { buildOverlayIndex } from '../src/logic/overlayIndex'

const ruleCount = (page: Page) => page.getByText(/^\d+ of \d+ rules$/)

const EMPTY_MAPPING_INDEX = { schema_version: 1, by_rule: {} }
const EMPTY_CATALOG_INDEX = { schema_version: 1, vendors: [], products: [], licences: [], by_product: {} }

// Every test starts from no mappings, whatever the committed
// baselines/_mappings/rules/ folder holds, so a real mapping cannot shift the
// details layout other tests check. The mapping tests register their own
// index later, and a later route wins.
test.beforeEach(async ({ page }) => {
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_MAPPING_INDEX) }),
  )
  // The catalog is independent of these tests; an empty one keeps whatever the
  // committed catalog/ folder holds out of them.
  await page.route('**/catalog/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_CATALOG_INDEX) }),
  )
})

async function searchForSingleRow(page: Page, search: string, title: RegExp | string) {
  const searchBox = page.getByPlaceholder('Search title or id…')
  // Clearing first keeps repeated calls in one test working: the count only
  // returns to the full library once the previous search is gone.
  await searchBox.fill('')
  await expect(ruleCount(page)).toHaveText(/^1493 of 1493 rules$/, { timeout: 10_000 })
  await searchBox.fill(search)
  const row = page.locator('table tbody tr').filter({ hasText: title })
  await expect(row).toHaveCount(1)
  return row
}

test('rule browser loads the mSCP library and expands a rule to its check', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Intune Compliance Toolkit' })).toBeVisible()
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

  const row = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')
  // Scoped to the row rather than the button's name, which flips between
  // "Expand" and "Collapse" on click.
  await row.getByRole('button').click()
  await expect(row.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  // objectIsForcedForKey appears only in the check shell, not in the
  // profile payload, so this proves the check itself rendered.
  await expect(page.getByText('objectIsForcedForKey')).toBeVisible()
  // Reference keys are shown raw; friendly names only come from the vocabulary file.
  const detail = page.locator('[id^="rule-detail-"]')
  // Checks and fixes are buttons per target, named by language or fix type; a single one starts open.
  await expect(detail.getByRole('button', { name: /Bash/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(detail.getByTestId('check-target')).toBeVisible()
  // Its remediation is a profile payload only, so no script language is named.
  await expect(detail.getByRole('button', { name: /Configuration profile/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(detail.getByTestId('remediation-target')).toBeVisible()
  await expect(detail.getByText('macos_15', { exact: true }).first()).toBeVisible()
  // The Benchmarks section labels versions through the vocabulary, so only the reference keys are checked.
  await expect(detail.locator('li > span', { hasText: /^macOS 15$/ })).toHaveCount(0)
})

test('an architecture-gated rule names its architecture by the raw mSCP code', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'os_dictation_disable', /Dictation/)
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')
  await expect(detail).toContainText('Applies to i386 Macs only; other Macs report a pass.')
  await expect(detail).not.toContainText('Intel (i386)')
})

// Asserts on the real filtering effect, not just presence - a facet
// checkbox that renders but no longer fires its handler looks identical in
// a screenshot.
test('Version and benchmark facets narrow the table together', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

  const countOf = async () => Number((await ruleCount(page).textContent())?.split(' ')[0])

  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText('1493 of 1493 rules')
  const versionOnly = await countOf()

  await page.getByRole('checkbox', { name: 'CIS Level 1', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText(`${versionOnly} of 1493 rules`)
  const both = await countOf()

  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText(`${both} of 1493 rules`)
  const benchmarkOnly = await countOf()

  expect(both).toBeGreaterThan(0)
  expect(both).toBeLessThan(versionOnly)
  expect(both).toBeLessThan(benchmarkOnly)

  await page.getByRole('radio', { name: 'Manual only' }).click()
  await expect(ruleCount(page)).not.toHaveText(`${benchmarkOnly} of 1493 rules`)
})

interface IndexBenchmark {
  name: string
  severity: string | null
}

async function committedIndexRules(): Promise<{ id: string; applicability: { target: string | null; version: string | null; benchmarks: IndexBenchmark[] }[] }[]> {
  const indexJson = await readFile(new URL('../../baselines/mscp/_index.json', import.meta.url), 'utf8')
  return JSON.parse(indexJson).rules
}

test('a benchmark severity option narrows the table to rules listing that severity on the selected version', async ({ page }) => {
  const expectedCount = (await committedIndexRules()).filter((rule) =>
    (rule.applicability.find((entry) => entry.target === 'macOS' && entry.version === '27.0')?.benchmarks ?? []).some((benchmark) => benchmark.name === 'disa_stig' && benchmark.severity === 'high'),
  ).length
  expect(expectedCount).toBeGreaterThan(0)

  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  const stigLabels = page.getByTestId('sidebar-scroll-area').locator('label').filter({ hasText: /^DISA STIG/ })
  await expect(stigLabels).toHaveText(['DISA STIG (low)', 'DISA STIG (medium)', 'DISA STIG (high)', 'DISA STIG (no severity)'])
  await expect(page.getByRole('checkbox', { name: 'CIS Level 1', exact: true })).toBeVisible()

  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await page.getByRole('checkbox', { name: 'DISA STIG (high)', exact: true }).click()
  await expect(ruleCount(page)).toHaveText(`${expectedCount} of 1493 rules`)
  await page.getByRole('button', { name: 'Expand all' }).click()
  await expect(page.locator('table tbody tr').first()).toContainText('DISA STIG (high)')
})

test('the benchmark column follows the Version filter', async ({ page }) => {
  const rules = await committedIndexRules()
  const stigOnlyOnFifteen = rules.find((rule) => {
    const benchmarksOn = (version: string) => rule.applicability.find((entry) => entry.target === 'macOS' && entry.version === version)?.benchmarks ?? []
    const [fifteen, twentySix, twentySeven] = ['15.0', '26.0', '27.0'].map(benchmarksOn)
    return fifteen.length === 1 && fifteen[0].name === 'disa_stig' && fifteen[0].severity === 'medium' && twentySix.length === 0 && twentySeven.length === 0
  })
  const inNoBenchmark = rules.find((rule) => rule.applicability.every((entry) => entry.benchmarks.length === 0))
  if (!stigOnlyOnFifteen || !inNoBenchmark) throw new Error('the committed index no longer has the rules this test needs')

  const rowOf = (ruleId: string) =>
    page.locator('table tbody tr').filter({ has: page.getByText(ruleId.replace('mscp.', ''), { exact: true }) })

  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  await page.getByRole('checkbox', { name: 'macOS 15', exact: true }).click()

  await searchBox(page).fill(stigOnlyOnFifteen.id.replace('mscp.', ''))
  const benchmarkCell = rowOf(stigOnlyOnFifteen.id).locator('td').last()
  await expect(benchmarkCell).toHaveText('DISA STIG (medium)')
  await expect(benchmarkCell).not.toContainText('macOS 27')

  await searchBox(page).fill(inNoBenchmark.id.replace('mscp.', ''))
  await expect(rowOf(inNoBenchmark.id).locator('td').last()).toHaveText('Not in a benchmark')
})

// Only the mSCP rules name a target, so ticking macOS or mscp keeps 350 of the 1493 rules; ticking ASD ISM keeps the other 1143.
test('the Target facet follows Automation and the Source facet sits between Version and Benchmark, and each filters to its own rules', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

  const facetTitles = page.getByTestId('sidebar-scroll-area').getByRole('heading')
  await expect(facetTitles.nth(0)).toHaveText('Automation')
  await expect(facetTitles.nth(1)).toHaveText('Target')
  await expect(facetTitles.nth(2)).toHaveText('Version')
  await expect(facetTitles.nth(3)).toHaveText('Source')
  await expect(facetTitles.nth(4)).toHaveText('Benchmark')
  await expect(facetTitles.last()).toHaveText('Tags')

  const platformOption = page.getByRole('checkbox', { name: 'macOS', exact: true })
  await platformOption.click()
  await expect(platformOption).toBeChecked()
  await expect(ruleCount(page)).toHaveText('350 of 1493 rules')
  await platformOption.click()

  const sourceOption = page.getByRole('checkbox', { name: 'NIST mSCP', exact: true })
  await sourceOption.scrollIntoViewIfNeeded()
  await sourceOption.click()
  await expect(sourceOption).toBeChecked()
  await expect(ruleCount(page)).toHaveText('350 of 1493 rules')
  await sourceOption.click()

  const ismSourceOption = page.getByRole('checkbox', { name: 'ASD ISM', exact: true })
  await ismSourceOption.scrollIntoViewIfNeeded()
  await ismSourceOption.click()
  await expect(ismSourceOption).toBeChecked()
  await expect(ruleCount(page)).toHaveText('1143 of 1493 rules')
})

// The two mSCP rules no release lists have an entry whose version is null,
// as every ISM control does, so Version "None" keeps them with the 1143 ISM
// rules while Target "None" keeps only the ISM rules.
test('Version "None" and Target "None" filter to the rules without a version or a target', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

  await expect(page.getByRole('group', { name: 'Target', exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Version', exact: true })).toBeVisible()

  const facetOptionNamedNone = (facetTitle: string) =>
    page.getByRole('group', { name: facetTitle, exact: true }).getByRole('checkbox', { name: 'None', exact: true })

  await facetOptionNamedNone('Version').click()
  await expect(ruleCount(page)).toHaveText('1145 of 1493 rules')
  await facetOptionNamedNone('Version').click()
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules')

  await facetOptionNamedNone('Target').click()
  await expect(ruleCount(page)).toHaveText('1143 of 1493 rules')
  await facetOptionNamedNone('Target').click()

  await page.getByRole('checkbox', { name: 'macOS', exact: true }).click()
  await facetOptionNamedNone('Version').click()
  await expect(ruleCount(page)).toHaveText('2 of 1493 rules')
  await page.getByRole('button', { name: 'Expand all' }).click()
  await expect(page.getByText('os_gatekeeper_rearm', { exact: true })).toBeVisible()
  await expect(page.getByText('os_firewall_log_enable', { exact: true })).toBeVisible()
  await expect(page.locator('table tbody tr').first().locator('td').last()).toHaveText('No version listed')
})

test('an ISM benchmark filters to ISM rules and its benchmarks show in the table', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

  await page.getByRole('checkbox', { name: 'Essential Eight ML3', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText('1493 of 1493 rules')
  await expect(ruleCount(page)).not.toHaveText('0 of 1493 rules')

  await page.getByRole('button', { name: 'Expand all' }).click()
  await expect(page.locator('table tbody tr td .font-mono').first()).toBeVisible()
  const ruleIds = await page.locator('table tbody tr td .font-mono').allTextContents()
  expect(ruleIds.length).toBeGreaterThan(0)
  expect(ruleIds.filter((ruleId) => !ruleId.startsWith('ism-'))).toEqual([])

  await expect(page.getByRole('group', { name: 'Version', exact: true }).getByRole('checkbox', { name: 'None', exact: true })).toBeEnabled()
})

test('an ISM row lists its benchmarks in the benchmark column', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'ism-1667', 'Microsoft Office is blocked from creating child processes.')
  await expect(row.locator('td').last()).toContainText('ISM Non-classified')
  await expect(row.locator('td').last()).toContainText('Essential Eight ML3')
})

const ISM_1803_BREADCRUMB =
  'Guidelines for cyber security incidents › Managing cyber security incidents › Cyber security incident register'

test('an ISM rule detail shows its breadcrumb, revision and Markdown list', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'ism-1803', /./)
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')

  await expect(detail.getByText(ISM_1803_BREADCRUMB)).toBeVisible()
  await expect(detail.getByText('Revision 0, updated Dec-22')).toBeVisible()
  await expect(detail.getByRole('listitem').filter({ hasText: 'to whom the cyber security incident was reported.' })).toBeVisible()
  await expect(detail.getByText('No macOS version listed')).toHaveCount(0)
})

test('an ISM rule detail turns a Markdown link into an external link', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'ism-0009', /./)
  await row.getByRole('button').click()
  const link = page.locator('[id^="rule-detail-"]').getByRole('link', { name: 'Information security manual' }).first()
  await expect(link).toHaveAttribute('href', /^https:\/\/www\.cyber\.gov\.au\//)
  await expect(link).toHaveAttribute('target', '_blank')
})

test('a version-less mSCP rule keeps its macOS warning with the new wording and shows no revision', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'os_firewall_log_enable', /./)
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')

  await expect(detail.getByText('No macOS version listed: the source does not map this rule to any macOS release.')).toBeVisible()
  await expect(detail.getByText(/^Revision /)).toHaveCount(0)
})

test('a one-level section path shows no breadcrumb while a multi-level one does', async ({ page }) => {
  await page.goto('/')
  const mscpRow = await searchForSingleRow(page, 'audit_acls_folders_configure', /./)
  await mscpRow.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')
  await expect(detail.getByText('The audit log folder')).toBeVisible()
  await expect(detail.getByTestId('rule-breadcrumb')).toHaveCount(0)
  await mscpRow.getByRole('button', { name: /Collapse/ }).click()

  const ismRow = await searchForSingleRow(page, 'ism-1803', /./)
  await ismRow.getByRole('button').click()
  await expect(detail.getByTestId('rule-breadcrumb')).toContainText('Guidelines for cyber security incidents ›')
})

test('each rule credits its own source in the detail panel', async ({ page }) => {
  await page.goto('/')
  const detail = page.locator('[id^="rule-detail-"]')
  const credit = detail.locator('p').filter({ hasText: /^From / })

  const ismRow = await searchForSingleRow(page, 'ism-1667', /./)
  await ismRow.getByRole('button').click()
  await expect(credit).toContainText('From ASD ISM v2026.09.4 (ism-1667)')
  await ismRow.getByRole('button').click()

  const mscpRow = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')
  await mscpRow.getByRole('button').click()
  await expect(credit).toContainText('From NIST mSCP release_27.0 (os_gatekeeper_enable)')
})

test('the sources dialog names no platform in its rule sources', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  await page.getByRole('contentinfo').getByRole('button', { name: 'Sources & licences' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sources & licences' })
  await expect(dialog).toContainText('Rules from the ASD Information Security Manual')
  await expect(dialog).toContainText('Rules from the NIST macOS Security Compliance Project')
  await expect(dialog).not.toContainText('macOS rules')
})

test('the Sources & licences dialog lists sources and bundled packages', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  const footerButton = page.getByRole('contentinfo').getByRole('button', { name: 'Sources & licences' })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await footerButton.click()

  const dialog = page.getByRole('dialog', { name: 'Sources & licences' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('ASD Information Security Manual (v2026.09.4)')
  await expect(dialog).toContainText('NIST macOS Security Compliance Project (release_27.0)')
  await expect(dialog).toContainText('modified for this tool')

  const packages = dialog.getByRole('listitem').filter({ has: page.locator('summary') })
  const react = packages.filter({ has: page.getByText('react', { exact: true }) })
  await expect(react).toHaveCount(1, { timeout: 10_000 })
  await expect(react).toContainText('MIT')
  const highlight = packages.filter({ has: page.getByText('highlight.js', { exact: true }) })
  await expect(highlight).toContainText('BSD-3-Clause')
  await highlight.locator('summary').click()
  await expect(highlight.locator('pre')).toContainText('Redistribution and use in source and binary forms')

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(footerButton).toBeFocused()
})

test('a facet with no reachable options is not rendered', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  const tagsHeading = page.getByTestId('sidebar-scroll-area').getByRole('heading', { name: 'Tags', exact: true })
  await expect(tagsHeading).toBeVisible()

  const ismSourceOption = page.getByRole('checkbox', { name: 'ASD ISM', exact: true })
  await ismSourceOption.scrollIntoViewIfNeeded()
  await ismSourceOption.click()
  await expect(ruleCount(page)).toHaveText('1143 of 1493 rules')
  // No ISM rule carries a tag, so the group is dropped once its options have faded out.
  await expect(tagsHeading).toHaveCount(0, { timeout: 10_000 })
})

test('searching an ISM control id finds exactly that control', async ({ page }) => {
  await page.goto('/')
  await searchForSingleRow(page, 'ism-1667', 'Microsoft Office is blocked from creating child processes.')
  await expect(ruleCount(page)).toHaveText('1 of 1493 rules')
  await expect(page.getByRole('checkbox', { name: 'Select ism-1667' })).toBeVisible()
})

test('an ISM control flows to the manual attestation report', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'ism-1667', 'Microsoft Office is blocked from creating child processes.')
  await row.getByRole('checkbox').click()
  await expect(page.getByText('1 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByRole('heading', { name: 'Review & generate' })).toBeVisible()

  const download = page.getByRole('button', { name: 'Download bundle (.zip)' })
  await expect(download).toBeEnabled({ timeout: 10_000 })

  const downloadEvent = page.waitForEvent('download')
  await download.click()
  const zipPath = await (await downloadEvent).path()
  const files = unzipSync(new Uint8Array(await readFile(zipPath)))

  expect(Object.keys(files)).toEqual(['manual-attestation.md'])
  const report = new TextDecoder().decode(files['manual-attestation.md'])
  expect(report).toContain('ism-1667')
  expect(report).toContain('Microsoft Office is blocked from creating child processes.')
})

test('a mixed mSCP and ISM manual selection credits both sources in the attestation report', async ({ page }) => {
  await page.goto('/')
  for (const [search, title] of [
    ['os_application_sandboxing', 'Ensure Separate Execution Domain for Processes'],
    ['ism-1667', 'Microsoft Office is blocked from creating child processes.'],
  ] as const) {
    const row = await searchForSingleRow(page, search, title)
    await row.getByRole('checkbox').click()
  }
  await expect(page.getByText('2 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Generate' }).click()
  const download = page.getByRole('button', { name: 'Download bundle (.zip)' })
  await expect(download).toBeEnabled({ timeout: 10_000 })

  const downloadEvent = page.waitForEvent('download')
  await download.click()
  const zipPath = await (await downloadEvent).path()
  const files = unzipSync(new Uint8Array(await readFile(zipPath)))

  expect(Object.keys(files)).toEqual(['manual-attestation.md'])
  const report = new TextDecoder().decode(files['manual-attestation.md'])
  expect(report).toContain('Rule content from the ASD Information Security Manual')
  expect(report).toContain('Rule content from the NIST macOS Security Compliance Project')
})

// The row's onClick skips toggling expand when the click landed on an
// interactive control. Base UI's Checkbox renders role="checkbox", not an
// <input>, so a selector listing only `input` would both select AND expand.
test('row checkbox selects without expanding the row', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')

  await expect(page.getByText('0 selected')).toBeVisible()
  await row.getByRole('checkbox').click()
  await expect(page.getByText('1 selected')).toBeVisible()
  await expect(row.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
})

test('an ODV title shows the effective value instead of $ODV', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'pwpolicy_minimum_length_enforce', /Minimum Password Length/)

  await expect(row).toContainText(/Require a Minimum Password Length of \d+ Characters/)
  await expect(row).not.toContainText('$ODV')
})

test('an ODV value with an apostrophe is rejected and not stored', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'pwpolicy_minimum_length_enforce', /Minimum Password Length/)
  await row.getByRole('button').click()

  const odvInput = page.getByRole('textbox', { name: /Minimum password length/ })
  await expect(odvInput).toBeVisible()
  await expect(page.getByText('Using recommended value: 6')).toBeVisible()

  await odvInput.fill('12')
  await expect(row).toContainText('Require a Minimum Password Length of 12 Characters')

  await odvInput.fill("12'")
  await expect(page.getByRole('alert')).toContainText('Value must be a whole number.')
  // The last valid value stays in effect.
  await expect(row).toContainText('Require a Minimum Password Length of 12 Characters')

  await odvInput.fill('')
  await expect(page.getByText('Using recommended value: 6')).toBeVisible()
  await expect(row).toContainText('Require a Minimum Password Length of 6 Characters')
})

// A value persisted by an older build can fail today's validation. The
// review screen blocks generation on it, so the detail panel must say so
// rather than imply the recommended value will be used instead.
test('an invalid stored ODV value is reported as blocking generation until fixed or cleared', async ({ page }) => {
  await page.addInitScript(() => {
    const ref = { id: 'mscp.pwpolicy_minimum_length_enforce', path: 'mscp/rules/pwpolicy_minimum_length_enforce.json' }
    const persisted = { state: { selections: { [ref.id]: { ref, enabled: true, odvValue: "12'" } } }, version: 2 }
    window.localStorage.setItem('intune-toolkit:selections', JSON.stringify(persisted))
  })
  await page.goto('/')
  const row = await searchForSingleRow(page, 'pwpolicy_minimum_length_enforce', /Minimum Password Length/)
  await expect(row).toContainText('Require a Minimum Password Length of 6 Characters')

  await row.getByRole('button', { name: /Expand/ }).click()
  const savedValueAlert = page.getByRole('alert')
  await expect(savedValueAlert).toHaveCount(1)
  await expect(savedValueAlert).toContainText(
    "Saved value '12'' is invalid: Value must be a whole number. Generation is blocked until you fix or clear it.",
  )
  await expect(savedValueAlert).not.toContainText('still using')
  await expect(page.getByText('Using recommended value: 6')).toHaveCount(0)
  await expect(page.getByText('$ODV stands for the organization-defined value, currently [value].').first()).toBeVisible()
  await expect(page.getByText('currently 6.')).toHaveCount(0)

  await savedValueAlert.getByRole('button', { name: 'Clear saved value' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Using recommended value: 6')).toBeVisible()
  await expect(page.getByText('Shown with the organization-defined value: 6').first()).toBeVisible()
})

// An option that becomes unreachable stays visible, disabled, for a quiet
// period instead of vanishing (or staying clickable into a zero-row table),
// then fades out - "the count changed" alone can't see either half.
test('an unreachable facet option greys out, fades, then disappears', async ({ page }) => {
  await page.goto('/')

  const nlmapgovBase = page.getByRole('checkbox', { name: 'NLMAPGOV Base', exact: true })
  // The animated wrapper FilterSidebar's StableFacetGroup toggles
  // data-leaving on.
  const nlmapgovBaseRow = page.locator('[data-leaving]', { has: nlmapgovBase })
  await expect(nlmapgovBase).toBeVisible({ timeout: 10_000 })
  await expect(nlmapgovBase).toBeEnabled()
  await expect(nlmapgovBaseRow).toHaveAttribute('data-leaving', 'false')

  // The leaving phase lasts only 300ms, which an expect() poll can miss
  // entirely under parallel load (its retry interval grows to a second), so
  // an observer in the page records the attribute flip instead. It is
  // installed before the click and awaited after.
  const rowHandle = await nlmapgovBaseRow.elementHandle()
  if (!rowHandle) throw new Error('NLMAPGOV Base facet row not found')
  const sawLeaving = rowHandle.evaluate(
    (element) =>
      new Promise<{ leaving: string | null; fadeClass: boolean }>((resolve) => {
        const observer = new MutationObserver(() => {
          if (element.getAttribute('data-leaving') !== 'true') return
          observer.disconnect()
          resolve({ leaving: element.getAttribute('data-leaving'), fadeClass: element.classList.contains('opacity-0') })
        })
        observer.observe(element, { attributes: true, attributeFilter: ['data-leaving'] })
      }),
  )

  // NLMAPGOV benchmarks are not listed under macOS 27 for any rule.
  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()

  await expect(nlmapgovBase).toBeVisible()
  await expect(nlmapgovBase).toBeDisabled()
  await expect(nlmapgovBase).not.toBeChecked()

  // After the ~2400ms quiet period the option is marked leaving, with the
  // fade-out class, and then removed.
  expect(await sawLeaving).toEqual({ leaving: 'true', fadeClass: true })
  await expect(nlmapgovBaseRow).toHaveCount(0, { timeout: 10_000 })
  await expect(nlmapgovBase).toHaveCount(0)
})

test('review & generate offers a download with defaults and lists an inherent rule for manual attestation', async ({ page }) => {
  await page.goto('/')
  for (const [search, title] of [
    ['os_gatekeeper_enable', 'Enable Gatekeeper'],
    ['pwpolicy_minimum_length_enforce', /Minimum Password Length/],
    ['os_application_sandboxing', 'Ensure Separate Execution Domain for Processes'],
  ] as const) {
    const row = await searchForSingleRow(page, search, title)
    await row.getByRole('checkbox').click()
  }
  await expect(page.getByText('3 selected')).toBeVisible()

  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByRole('heading', { name: 'Review & generate' })).toBeVisible()

  const download = page.getByRole('button', { name: 'Download bundle (.zip)' })
  await expect(download).toBeEnabled({ timeout: 10_000 })
  await expect(page.getByText('Fix these before generating')).toHaveCount(0)

  const manualList = page.getByRole('region', { name: /Needs manual attestation/ })
  await expect(manualList).toContainText('os_application_sandboxing')
  await expect(manualList).toContainText('Met by macOS by design (mSCP: inherent).')
  await expect(page.getByText('Require a Minimum Password Length of 6 Characters')).toBeVisible()

  const downloadEvent = page.waitForEvent('download')
  await download.click()
  expect((await downloadEvent).suggestedFilename()).toMatch(/^intune-toolkit-bundle-\d{4}-\d{2}-\d{2}\.zip$/)
})

test('review & generate blocks the download while a selected rule has an invalid organization value', async ({ page }) => {
  await page.addInitScript(() => {
    const ref = { id: 'mscp.pwpolicy_minimum_length_enforce', path: 'mscp/rules/pwpolicy_minimum_length_enforce.json' }
    const persisted = { state: { selections: { [ref.id]: { ref, enabled: true, odvValue: "12'" } } }, version: 2 }
    window.localStorage.setItem('intune-toolkit:selections', JSON.stringify(persisted))
  })
  await page.goto('/')
  await expect(page.getByText('1 selected')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Generate' }).click()

  const blocked = page.getByRole('alert').filter({ hasText: 'Fix these before generating' })
  await expect(blocked).toContainText('pwpolicy_minimum_length_enforce')
  await expect(blocked).toContainText('Organization value is invalid: Value must be a whole number.')
  await expect(page.getByRole('button', { name: 'Download bundle (.zip)' })).toBeDisabled()
  // No bundle count while blocked: packing waits until nothing is blocked.
  await expect(page.getByText('Bundles are packed once nothing is blocked')).toBeVisible()
  await expect(page.getByText(/\d+ bundle\(s\)/)).toHaveCount(0)
})

test('review & generate downloads a manual-only selection as a zip holding manual-attestation.md', async ({ page }) => {
  await page.addInitScript(() => {
    const ref = { id: 'mscp.os_application_sandboxing', path: 'mscp/rules/os_application_sandboxing.json' }
    const persisted = { state: { selections: { [ref.id]: { ref, enabled: true, odvValue: null } } }, version: 2 }
    window.localStorage.setItem('intune-toolkit:selections', JSON.stringify(persisted))
  })
  await page.goto('/')
  await expect(page.getByText('1 selected')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Generate' }).click()

  const download = page.getByRole('button', { name: 'Download bundle (.zip)' })
  await expect(download).toBeEnabled({ timeout: 10_000 })

  const downloadEvent = page.waitForEvent('download')
  await download.click()
  const zipPath = await (await downloadEvent).path()
  const files = unzipSync(new Uint8Array(await readFile(zipPath)))

  expect(Object.keys(files)).toEqual(['manual-attestation.md'])
  expect(new TextDecoder().decode(files['manual-attestation.md'])).toContain('**os_application_sandboxing**')
})

// A re-import can drop or rename a rule that is still saved as selected.
// That entry must not break the review, count as selected, or linger
// without the admin being told.
test('a saved selection that is no longer in the library is reported and removable without blocking the review', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const knownRef = { id: 'mscp.os_gatekeeper_enable', path: 'mscp/rules/os_gatekeeper_enable.json' }
    const unknownRef = { id: 'mscp.removed_by_reimport', path: 'mscp/rules/removed_by_reimport.json' }
    const odvRef = { id: 'mscp.pwpolicy_minimum_length_enforce', path: 'mscp/rules/pwpolicy_minimum_length_enforce.json' }
    const persisted = {
      state: {
        selections: {
          [knownRef.id]: { ref: knownRef, enabled: true, odvValue: null },
          [unknownRef.id]: { ref: unknownRef, enabled: true, odvValue: null },
          [odvRef.id]: { ref: odvRef, enabled: false, odvValue: 12 },
        },
      },
      version: 2,
    }
    window.localStorage.setItem('intune-toolkit:selections', JSON.stringify(persisted))
  })
  await page.goto('/')
  await expect(page.getByText('1 selected')).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByRole('heading', { name: 'Review & generate' })).toBeVisible()

  const notice = page.getByRole('status', { name: 'Saved selections not in this library' })
  await expect(notice).toContainText('1 saved selection is no longer in this library: mscp.removed_by_reimport')
  const download = page.getByRole('button', { name: 'Download bundle (.zip)' })
  await expect(download).toBeEnabled({ timeout: 10_000 })
  await expect(page.getByText('1 scripted rule(s)')).toBeVisible()
  await expect(page.getByText('Could not prepare the bundle')).toHaveCount(0)

  await notice.getByRole('button', { name: 'Remove it' }).click()
  await expect(notice).toHaveCount(0)
  await expect(page.getByText('1 selected')).toBeVisible()
  await expect(download).toBeEnabled({ timeout: 10_000 })

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('intune-toolkit:selections') ?? '{}'))
  expect(Object.keys(stored.state.selections).sort()).toEqual([
    'mscp.os_gatekeeper_enable',
    'mscp.pwpolicy_minimum_length_enforce',
  ])
  expect(stored.state.selections['mscp.pwpolicy_minimum_length_enforce'].odvValue).toBe(12)
  expect(stored.state.selections['mscp.os_gatekeeper_enable'].enabled).toBe(true)
})

// Display names come from baselines/_vocabulary.json at runtime; the app
// must stay usable with raw codes when that file is missing or broken.
test('display names come from the vocabulary file, with raw codes and a warning when it is missing', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  await expect(page.getByRole('checkbox', { name: 'CIS Level 1', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Operating system/ })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Display name problems' })).toHaveCount(0)

  await page.route('**/baselines/_vocabulary.json', (route) => route.fulfill({ status: 404, body: 'Not found' }))
  await page.reload()
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  await expect(page.getByRole('status', { name: 'Display name problems' })).toContainText('raw codes are shown')
  await expect(page.getByRole('checkbox', { name: 'cis_lvl1', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'macOS 27', exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'macOS 27.0', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^os \(\d+\)/ })).toBeVisible()

  // Raw-code filters still filter.
  await page.getByRole('checkbox', { name: 'cis_lvl1', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText('1493 of 1493 rules')
})

test('a malformed vocabulary file falls back to raw codes with a warning', async ({ page }) => {
  await page.route('**/baselines/_vocabulary.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"schema_version": 1, "vocabularies": []}' }),
  )
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  await expect(page.getByRole('status', { name: 'Display name problems' })).toContainText('vocabularies must be an object')
  await expect(page.getByRole('checkbox', { name: 'disa_stig (high)', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'disa_stig (no severity)', exact: true })).toBeVisible()
})

test.describe('filter sidebar scrolling', () => {
  test.use({ viewport: { width: 1280, height: 700 } })

  const topIndicator = (page: Page) => page.getByTestId('sidebar-scroll-up')
  const bottomIndicator = (page: Page) => page.getByTestId('sidebar-scroll-down')
  const scroller = (page: Page) => page.getByTestId('sidebar-scroll-area')

  test('scrolls with pinned search and edge indicators that follow the scroll position', async ({ page }) => {
    await page.goto('/')
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

    const metrics = await scroller(page).evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)

    const search = page.getByPlaceholder('Search title or id…')
    await expect(search).toBeInViewport()
    await expect(topIndicator(page)).toHaveCSS('opacity', '0')
    await expect(bottomIndicator(page)).toHaveCSS('opacity', '1')

    await scroller(page).evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    await expect(search).toBeInViewport()
    await expect(topIndicator(page)).toHaveCSS('opacity', '1')
    await expect(bottomIndicator(page)).toHaveCSS('opacity', '0')

    await scroller(page).evaluate((element) => element.scrollTo({ top: element.scrollHeight / 4 }))
    await expect(topIndicator(page)).toHaveCSS('opacity', '1')
    await expect(bottomIndicator(page)).toHaveCSS('opacity', '1')
  })

  test('the last tag is reachable and clickable', async ({ page }) => {
    await page.goto('/')
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

    const tagsFacet = scroller(page).getByRole('heading', { name: 'Tags', exact: true }).locator('..')
    const lastTag = tagsFacet.getByRole('checkbox').last()
    await lastTag.scrollIntoViewIfNeeded()
    await lastTag.click()
    await expect(lastTag).toBeChecked()
    await expect(ruleCount(page)).not.toHaveText('1493 of 1493 rules')
  })

  test('the last source option is reachable and clickable', async ({ page }) => {
    await page.goto('/')
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

    const lastSource = page.getByRole('group', { name: 'Source', exact: true }).getByRole('checkbox').last()
    await lastSource.scrollIntoViewIfNeeded()
    await lastSource.click()
    await expect(lastSource).toBeChecked()
    await expect(ruleCount(page)).toHaveText('350 of 1493 rules')
  })
})

test('the None facet options read as system-generated', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

  for (const facetTitle of ['Target', 'Version']) {
    const noneCheckbox = page.getByRole('group', { name: facetTitle, exact: true }).getByRole('checkbox', { name: 'None', exact: true })
    const noneLabel = page.getByRole('group', { name: facetTitle, exact: true }).locator('label', { hasText: /^None$/ })
    await expect(noneCheckbox).toBeVisible()
    await expect(noneLabel).toHaveClass(/(^|\s)text-muted-foreground(\s|$)/)
    await expect(noneLabel).not.toHaveClass(/(^|\s)italic(\s|$)/)
  }
  await expect(page.getByRole('group', { name: 'Source', exact: true }).locator('label.italic')).toHaveCount(0)
})

test('facet options show how many rules they would leave in view', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  const sourceGroup = page.getByRole('group', { name: 'Source', exact: true })
  const optionRow = (group: Locator, name: string) => group.getByRole('checkbox', { name, exact: true }).locator('xpath=..')
  await expect(optionRow(sourceGroup, 'ASD ISM')).toContainText('(1143)')
  await expect(optionRow(sourceGroup, 'NIST mSCP')).toContainText('(350)')

  await page.getByRole('checkbox', { name: 'ASD ISM', exact: true }).click()
  await expect(ruleCount(page)).toHaveText('1143 of 1493 rules')
  const targetGroup = page.getByRole('group', { name: 'Target', exact: true })
  await expect(optionRow(targetGroup, 'None')).toContainText('(1143)')
  await expect(optionRow(sourceGroup, 'ASD ISM')).toContainText('(1143)')
  await expect(sourceGroup.getByRole('checkbox', { name: 'ASD ISM', exact: true })).toBeChecked()
  await expect(optionRow(sourceGroup, 'NIST mSCP')).toContainText('(350)')

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules')
  await expect(optionRow(sourceGroup, 'NIST mSCP')).toContainText('(350)')
})

test('ticking one option leaves the others in its group selectable', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  const sectionGroup = page.getByRole('group', { name: 'Section', exact: true })
  const sourceGroup = page.getByRole('group', { name: 'Source', exact: true })

  await sectionGroup.getByRole('checkbox', { name: 'Auditing', exact: true }).click()
  const emailSection = sectionGroup.getByRole('checkbox', { name: 'Guidelines for email', exact: true })
  await expect(emailSection).toBeVisible()
  await emailSection.click()
  await expect(ruleCount(page)).toHaveText('57 of 1493 rules')
  await expect(sectionGroup.getByRole('checkbox', { name: 'Auditing', exact: true })).toBeChecked()
  await expect(emailSection).toBeChecked()

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules')
  await sourceGroup.getByRole('checkbox', { name: 'ASD ISM', exact: true }).click()
  await expect(ruleCount(page)).toHaveText('1143 of 1493 rules')
  const mscpRow = sourceGroup.getByRole('checkbox', { name: 'NIST mSCP', exact: true }).locator('xpath=..')
  await expect(mscpRow).toBeVisible()
  await expect(mscpRow).toContainText('(350)')
})

test('the table shows an Updating rules spinner while it catches up with a large filter change', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  const updatingStatus = page.getByRole('status', { name: 'Updating rules' })
  await expect(updatingStatus).toBeHidden()

  // An observer records the spinner the moment it mounts, so the assertion
  // does not depend on how often Playwright happens to poll while the page is
  // busy rendering. Throttling keeps the catch-up render slow whatever the build.
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate(() => {
    const windowWithFlag = window as unknown as { spinnerSeen: boolean }
    windowWithFlag.spinnerSeen = false
    new MutationObserver(() => {
      if (document.querySelector('[role="status"][aria-label="Updating rules"]')) windowWithFlag.spinnerSeen = true
    }).observe(document.body, { childList: true, subtree: true })
  })

  const platformOption = page.getByRole('checkbox', { name: 'macOS', exact: true })
  await platformOption.click()
  await expect(ruleCount(page)).toHaveText('350 of 1493 rules', { timeout: 30_000 })
  await expect(updatingStatus).toBeHidden({ timeout: 30_000 })
  expect(await page.evaluate(() => (window as unknown as { spinnerSeen: boolean }).spinnerSeen)).toBe(true)
})

// The clicks are dispatched together, without waiting for one to finish, so
// they land while the table is still rendering the previous state. The
// expected count comes from the committed index, not from a second UI run.
test('eight facet options from four facets toggled in quick succession all register and the table settles', async ({ page }) => {
  const rules = await committedIndexRules()
  const selectedVersions = ['26.0', '27.0']
  const selectedBenchmarks = [
    { name: 'cis_lvl2', severity: null },
    { name: 'disa_stig', severity: 'low' },
    { name: 'disa_stig', severity: 'medium' },
    { name: 'disa_stig', severity: 'high' },
  ]
  const expectedCount = rules.filter((rule) =>
    rule.applicability.some(
      (entry) =>
        entry.target === 'macOS' &&
        entry.version !== null &&
        selectedVersions.includes(entry.version) &&
        entry.benchmarks.some((benchmark) => selectedBenchmarks.some((wanted) => wanted.name === benchmark.name && wanted.severity === benchmark.severity)),
    ),
  ).length
  expect(expectedCount).toBeGreaterThan(0)
  expect(expectedCount).toBeLessThan(350)

  await openLibrary(page)
  const optionNames = ['macOS', 'NIST mSCP', 'macOS 26', 'macOS 27', 'CIS Level 2', 'DISA STIG (low)', 'DISA STIG (medium)', 'DISA STIG (high)']
  const options = optionNames.map((name) => page.getByRole('checkbox', { name, exact: true }))
  // dispatchEvent fires on the element itself; coordinate clicks issued
  // concurrently would race the sidebar scrolling and reflowing under them.
  await Promise.all(options.map((option) => option.dispatchEvent('click')))

  const updatingStatus = page.getByRole('status', { name: 'Updating rules' })
  await expect(updatingStatus).toBeHidden({ timeout: 30_000 })
  for (const option of options) await expect(option).toBeChecked()
  await expect(ruleCount(page)).toHaveText(`${expectedCount} of 1493 rules`)
})

const searchBox = (page: Page) => page.getByPlaceholder('Search title or id…')

async function openLibrary(page: Page, path = '/') {
  await page.goto(path)
  await expect(ruleCount(page)).toHaveText(/^\d+ of 1493 rules$/, { timeout: 10_000 })
}

test('filters, search, page and size survive a reload through the URL', async ({ page }) => {
  await openLibrary(page)
  const versionOption = page.getByRole('checkbox', { name: 'macOS 15', exact: true })

  await searchBox(page).fill('configure')
  await page.getByRole('checkbox', { name: 'NIST mSCP', exact: true }).click()
  await page.getByRole('checkbox', { name: 'ASD ISM', exact: true }).click()
  await page.getByRole('checkbox', { name: 'DISA STIG (high)', exact: true }).click()
  await versionOption.click()
  await expect(versionOption).toBeChecked()
  await expect(ruleCount(page)).not.toHaveText('1493 of 1493 rules')
  const filteredCount = String(await ruleCount(page).textContent())
  expect(filteredCount).toMatch(/^\d+ of 1493 rules$/)

  const parameters = new URL(page.url()).searchParams
  expect(parameters.get('q')).toBe('configure')
  expect(parameters.getAll('source')).toHaveLength(2)
  expect(parameters.getAll('benchmark')).toHaveLength(1)
  expect(parameters.getAll('benchmark')[0]).toContain('')
  expect(page.url()).toContain('%1F')
  expect(parameters.getAll('version')).toHaveLength(1)

  const withPaging = `${page.url()}&page=3&size=100`
  await page.goto(withPaging)
  await expect(ruleCount(page)).toHaveText(filteredCount, { timeout: 10_000 })
  await expect(searchBox(page)).toHaveValue('configure')
  await expect(page.getByRole('checkbox', { name: 'NIST mSCP', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'ASD ISM', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'DISA STIG (high)', exact: true })).toBeChecked()
  await expect(versionOption).toBeChecked()
  expect(page.url()).toBe(withPaging)

  await page.reload()
  await expect(ruleCount(page)).toHaveText(filteredCount, { timeout: 10_000 })
  await expect(versionOption).toBeChecked()

  await page.getByRole('radio', { name: 'Manual only' }).click()
  await expect(page.getByRole('radio', { name: 'Manual only' })).toBeChecked()
  expect(new URL(page.url()).searchParams.get('automation')).toBe('manual')
  expect(new URL(page.url()).searchParams.get('size')).toBe('100')
  expect(new URL(page.url()).searchParams.has('page')).toBe(false)
})

test('clearing the filters leaves a URL with no query string', async ({ page }) => {
  await openLibrary(page)
  await searchBox(page).fill('gatekeeper')
  await page.getByRole('checkbox', { name: 'macOS', exact: true }).click()
  expect(page.url()).toContain('?')

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  expect(page.url()).not.toContain('?')
})

test('filter changes do not add history entries', async ({ page }) => {
  await openLibrary(page)
  const historyLengthBefore = await page.evaluate(() => window.history.length)
  await page.getByRole('checkbox', { name: 'macOS', exact: true }).click()
  await searchBox(page).fill('gatekeeper')
  expect(page.url()).toContain('?')
  expect(await page.evaluate(() => window.history.length)).toBe(historyLengthBefore)
})

test('a search is restored after a reload', async ({ page }) => {
  await openLibrary(page)
  await searchBox(page).fill('os_gatekeeper_enable')
  await expect(ruleCount(page)).toHaveText('1 of 1493 rules')
  await page.reload()
  await expect(searchBox(page)).toHaveValue('os_gatekeeper_enable')
  await expect(ruleCount(page)).toHaveText('1 of 1493 rules', { timeout: 10_000 })
})

test('the search clear button appears with text, clears the search and refocuses the box', async ({ page }) => {
  await openLibrary(page)
  const clearButton = page.getByRole('button', { name: 'Clear search' })
  await expect(clearButton).toHaveCount(0)

  await searchBox(page).fill('os_gatekeeper_enable')
  await expect(ruleCount(page)).toHaveText('1 of 1493 rules')
  await expect(clearButton).toBeVisible()
  await clearButton.click()

  await expect(searchBox(page)).toHaveValue('')
  await expect(searchBox(page)).toBeFocused()
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  await expect(clearButton).toHaveCount(0)
  await expect(page).not.toHaveURL(/[?&]q=/)
})

test('Escape in the search box clears the search', async ({ page }) => {
  await openLibrary(page)
  await searchBox(page).fill('os_gatekeeper_enable')
  await expect(ruleCount(page)).toHaveText('1 of 1493 rules')
  await searchBox(page).press('Escape')
  await expect(searchBox(page)).toHaveValue('')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
})

test('a shared URL with unknown values loads and drops them on the next write', async ({ page }) => {
  await openLibrary(page, '/?benchmark=not_a_benchmark%1Fhigh&tag=no-such-tag&source=nope&target=macOS&unknown=1&automation=bogus&page=abc&size=junk')
  await expect(page.getByRole('radio', { name: 'All rules' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'macOS', exact: true })).toBeChecked()
  await expect(ruleCount(page)).toHaveText('350 of 1493 rules')

  const parameters = new URL(page.url()).searchParams
  expect(parameters.getAll('benchmark')).toEqual([])
  expect(parameters.getAll('tag')).toEqual([])
  expect(parameters.getAll('source')).toEqual([])
  expect(parameters.getAll('target')).toEqual(['macOS'])
})

test('Version None and its page and size are restored from the URL', async ({ page }) => {
  await openLibrary(page)
  const versionNone = page.getByRole('group', { name: 'Version', exact: true }).getByRole('checkbox', { name: 'None', exact: true })
  await versionNone.click()
  await expect(ruleCount(page)).toHaveText('1145 of 1493 rules')
  expect(new URL(page.url()).searchParams.getAll('version')).toHaveLength(1)

  await page.goto(`${page.url()}&page=3&size=100`)
  await expect(ruleCount(page)).toHaveText('1145 of 1493 rules', { timeout: 10_000 })
  await expect(versionNone).toBeChecked()
  const parameters = new URL(page.url()).searchParams
  expect(parameters.get('page')).toBe('3')
  expect(parameters.get('size')).toBe('100')

  await versionNone.click()
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules')
  expect(new URL(page.url()).searchParams.has('page')).toBe(false)
  expect(new URL(page.url()).searchParams.get('size')).toBe('100')
})

const ruleTable = (page: Page) => page.getByTestId('rule-table')
const ruleRows = (page: Page) => ruleTable(page).locator('table tbody tr')
const sectionHeadings = (page: Page, level: number) => ruleTable(page).getByRole('heading', { level })
const pageSizeSelect = (page: Page) => page.getByLabel('Rules per page')
const pageStatus = (page: Page) => page.getByText(/^Page \d+ of \d+$/)

test.describe('section tree and paging', () => {
  test('the initial view shows only the root section headers, all collapsed', async ({ page }) => {
    await openLibrary(page)
    // 7 mSCP sections and 23 ISM guidelines.
    await expect(sectionHeadings(page, 2)).toHaveCount(30)
    await expect(sectionHeadings(page, 3)).toHaveCount(0)
    await expect(ruleRows(page)).toHaveCount(0)
    await expect(ruleTable(page).getByRole('button', { expanded: true })).toHaveCount(0)
    await expect(sectionHeadings(page, 2).first()).toHaveText(/^Operating system \(200\)$/)
    await expect(pageStatus(page)).toHaveText('Page 1 of 1')
  })

  test('expand and collapse one level walk the mSCP and ISM sections level by level', async ({ page }) => {
    await openLibrary(page, '/?size=200&section=audit&section=Guidelines+for+email')
    await expect(ruleCount(page)).toHaveText('57 of 1493 rules')
    const ismRuleIds = ruleTable(page).locator('.font-mono', { hasText: /^ism-/ })

    await page.getByRole('button', { name: 'Expand one level' }).click()
    await expect(ruleTable(page).getByText('audit_acls_files_configure', { exact: true })).toBeVisible()
    await expect(sectionHeadings(page, 3)).toHaveText([/^Email gateways and servers \(\d+\)$/, /^Email usage \(\d+\)$/])
    await expect(ismRuleIds).toHaveCount(0)

    await page.getByRole('button', { name: 'Expand one level' }).click()
    await expect(sectionHeadings(page, 4).first()).toBeVisible()
    await expect(ismRuleIds).toHaveCount(0)

    await page.getByRole('button', { name: 'Expand one level' }).click()
    await expect(ismRuleIds).toHaveCount(26)
    await expect(ruleRows(page)).toHaveCount(57)

    await page.getByRole('button', { name: 'Collapse one level' }).click()
    await expect(ismRuleIds).toHaveCount(0)
    await expect(sectionHeadings(page, 4).first()).toBeVisible()
    await expect(ruleRows(page)).toHaveCount(31)

    await page.getByRole('button', { name: 'Collapse all' }).click()
    await expect(ruleRows(page)).toHaveCount(0)
    await expect(sectionHeadings(page, 3)).toHaveCount(0)
  })

  test('a section header toggles its own section', async ({ page }) => {
    await openLibrary(page)
    const auditing = ruleTable(page).getByRole('button', { name: /^Auditing \(31\)$/ })
    await auditing.click()
    await expect(auditing).toHaveAttribute('aria-expanded', 'true')
    await expect(ruleRows(page)).toHaveCount(31)
    await auditing.click()
    await expect(ruleRows(page)).toHaveCount(0)
  })

  test('the paging bar pages through the rules with previous, next, a page jump and the size select', async ({ page }) => {
    await openLibrary(page)
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(pageStatus(page)).toHaveText('Page 1 of 30')
    await expect(ruleRows(page)).toHaveCount(50)
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(pageStatus(page)).toHaveText('Page 2 of 30')
    await expect(ruleRows(page)).toHaveCount(50)
    // Page 2 starts inside Operating system, so its header repeats at the top.
    await expect(ruleTable(page).getByRole('heading').first()).toHaveText(/^Operating system/)

    await page.getByRole('button', { name: 'Previous page' }).click()
    await expect(pageStatus(page)).toHaveText('Page 1 of 30')

    const pageNumber = page.getByRole('spinbutton', { name: 'Page number' })
    await pageNumber.fill('30')
    await pageNumber.press('Enter')
    await expect(pageStatus(page)).toHaveText('Page 30 of 30')
    await expect(ruleRows(page)).toHaveCount(1493 - 29 * 50)
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled()

    await pageNumber.fill('999')
    await pageNumber.blur()
    await expect(pageStatus(page)).toHaveText('Page 30 of 30')
    await expect(pageNumber).toHaveValue('30')

    await pageNumber.fill('0')
    await pageNumber.press('Enter')
    await expect(pageStatus(page)).toHaveText('Page 1 of 30')

    await pageSizeSelect(page).selectOption('200')
    await expect(pageStatus(page)).toHaveText('Page 1 of 8')
    await expect(ruleRows(page)).toHaveCount(200)
  })

  test('a collapse that leaves fewer pages moves the stored page back, so reopening a section starts at its top', async ({ page }) => {
    await openLibrary(page, '/?page=7&size=25')
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(pageStatus(page)).toHaveText('Page 7 of 60')

    await page.getByRole('button', { name: 'Collapse all' }).click()
    await expect(pageStatus(page)).toHaveText('Page 1 of 1')
    await expect.poll(() => new URL(page.url()).searchParams.has('page')).toBe(false)

    await ruleTable(page).getByRole('button', { name: /^Auditing \(31\)$/ }).click()
    await expect(pageStatus(page)).toHaveText('Page 1 of 2')
    await expect(ruleRows(page)).toHaveCount(25)
    expect(new URL(page.url()).searchParams.has('page')).toBe(false)
  })

  test('infinite scroll restarts from the first batch after a collapse and expand, and its sentinel goes once every row is shown', async ({ page }) => {
    await openLibrary(page, '/?size=all')
    await page.getByRole('checkbox', { name: 'Operating system', exact: true }).click()
    await expect(ruleCount(page)).toHaveText('200 of 1493 rules')
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(ruleRows(page)).toHaveCount(100)
    await page.getByTestId('infinite-scroll-sentinel').scrollIntoViewIfNeeded()
    await expect(ruleRows(page)).toHaveCount(200)
    await expect(page.getByTestId('infinite-scroll-sentinel')).toHaveCount(0)

    await page.getByRole('button', { name: 'Collapse all' }).click()
    await expect(ruleRows(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(ruleRows(page)).toHaveCount(100)
    await expect(page.getByTestId('infinite-scroll-sentinel')).toHaveCount(1)
  })

  test('infinite scroll appends rule rows as the end of the table scrolls into view', async ({ page }) => {
    await openLibrary(page)
    await pageSizeSelect(page).selectOption({ label: 'Infinite scroll' })
    expect(new URL(page.url()).searchParams.get('size')).toBe('all')
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(ruleRows(page)).toHaveCount(100)
    await expect(pageStatus(page)).toHaveCount(0)

    await page.getByTestId('infinite-scroll-sentinel').scrollIntoViewIfNeeded()
    await expect(ruleRows(page)).toHaveCount(200)
  })

  test('a search opens every section holding a match, and clearing it restores the stored collapse state', async ({ page }) => {
    await openLibrary(page, '/?size=200&section=audit&section=Guidelines%20for%20email')
    await expect(page.getByRole('checkbox', { name: 'Auditing', exact: true })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Guidelines for email', exact: true })).toBeChecked()
    await expect(ruleCount(page)).toHaveText('57 of 1493 rules')
    await page.getByRole('button', { name: 'Expand one level' }).click()
    await expect(ruleRows(page)).toHaveCount(31)
    await expect(sectionHeadings(page, 3)).toHaveCount(2)

    await searchBox(page).fill('ism-0267')
    await expect(ruleCount(page)).toHaveText('1 of 1493 rules')
    await expect(ruleTable(page).getByText('ism-0267', { exact: true })).toBeVisible()
    await expect(sectionHeadings(page, 4)).toHaveText([/^Webmail services/])

    await searchBox(page).fill('')
    await expect(ruleCount(page)).toHaveText('57 of 1493 rules')
    await expect(ruleTable(page).getByText('ism-0267', { exact: true })).toHaveCount(0)
    await expect(ruleRows(page)).toHaveCount(31)
    await expect(sectionHeadings(page, 3)).toHaveCount(2)
    await expect(sectionHeadings(page, 4)).toHaveCount(0)

    // Facet filters do not open sections.
    await page.getByRole('button', { name: 'Collapse all' }).click()
    await page.getByRole('checkbox', { name: 'Auditing', exact: true }).click()
    await expect(ruleCount(page)).toHaveText('26 of 1493 rules')
    await expect(ruleRows(page)).toHaveCount(0)
  })

  test('the page and size persist in the URL, and the size is remembered for a visit without one', async ({ page }) => {
    await openLibrary(page)
    await pageSizeSelect(page).selectOption('100')
    await page.getByRole('button', { name: 'Expand all' }).click()
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(pageStatus(page)).toHaveText('Page 2 of 15')
    let parameters = new URL(page.url()).searchParams
    expect(parameters.get('page')).toBe('2')
    expect(parameters.get('size')).toBe('100')

    await page.reload()
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
    await expect(pageSizeSelect(page)).toHaveValue('100')
    await page.getByRole('button', { name: 'Expand all' }).click()
    await expect(pageStatus(page)).toHaveText('Page 2 of 15')
    parameters = new URL(page.url()).searchParams
    expect(parameters.get('page')).toBe('2')

    await openLibrary(page, '/')
    await expect(pageSizeSelect(page)).toHaveValue('100')
  })
})

test.describe('benchmark cell and detail benchmarks', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  const benchmarkCell = (row: Locator) => row.locator('td').last().getByTestId('benchmark-text')
  const detailHeadings = (page: Page) => page.locator('[id^="rule-detail-"]').locator('h5')
  const benchmarkList = (page: Page, scopeLabel: string) =>
    page.locator('[id^="rule-detail-"]').getByRole('region', { name: 'Benchmarks' }).getByRole('list', { name: scopeLabel })

  test('an ISM row with seven benchmarks and an mSCP row with one render at the same height', async ({ page }) => {
    await page.goto('/')
    const ismRow = await searchForSingleRow(page, 'ism-1667', /./)
    const ismHeight = (await ismRow.boundingBox())?.height ?? 0
    const mscpRow = await searchForSingleRow(page, 'audit_failure_halt', /./)
    await expect(benchmarkCell(mscpRow)).toHaveText('DISA STIG (medium) on macOS 15')
    const mscpHeight = (await mscpRow.boundingBox())?.height ?? 0
    expect(ismHeight).toBeGreaterThan(0)
    expect(Math.abs(ismHeight - mscpHeight)).toBeLessThan(0.5)
  })

  test('hovering or focusing an overflowing benchmark cell shows its full text in a tooltip', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'ism-1667', /./)
    const cell = benchmarkCell(row)
    await expect(cell).toHaveAttribute('data-overflowing', 'true')
    const fullText = String(await cell.textContent())
    expect(fullText).toContain('Essential Eight ML3')

    await cell.hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText(fullText)

    await page.mouse.move(0, 0)
    await expect(tooltip).toHaveCount(0)
    await cell.focus()
    await expect(tooltip).toHaveText(fullText)
  })

  test('the ism-1667 details list its benchmarks directly, with no None heading', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'ism-1667', /./)
    await row.getByRole('button').click()
    const section = page.locator('[id^="rule-detail-"]').getByRole('region', { name: 'Benchmarks' })
    await expect(section).not.toContainText('None')
    const items = section.getByRole('listitem')
    await expect(items.filter({ hasText: /^ISM PROTECTED$/ })).toHaveCount(1)
    await expect(items.filter({ hasText: /^Essential Eight ML3$/ })).toHaveCount(1)
    await expect(items).toHaveCount(7)
    // ism-1667 has no references, so Benchmarks is the last section.
    await expect(detailHeadings(page).last()).toHaveText('Benchmarks')
  })

  test('an mSCP rule details list DISA STIG (medium) under macOS 15, directly above References', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'audit_failure_halt', /./)
    await row.getByRole('button').click()
    await expect(benchmarkList(page, 'macOS 15').getByRole('listitem')).toHaveText(['DISA STIG (medium)'])
    await expect(detailHeadings(page).filter({ hasText: 'References' })).toHaveCount(1)
    const headingTexts = await detailHeadings(page).allTextContents()
    expect(headingTexts.indexOf('Benchmarks')).toBe(headingTexts.indexOf('References') - 1)
  })
})

// These tests serve their own overlays through page.route, replacing the
// committed baselines/_overlays/rules/ folder for the page they open.
test.describe('custom overlays', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  const CUSTOM_TITLE = 'PowerShell runs in Constrained Language Mode on every managed device.'
  const ISM_1622_TITLE = 'PowerShell is configured to use Constrained Language Mode.'
  const CURRENT_RELEASE = 'v2026.09.4'

  const titleOverlay = {
    schema_version: 1,
    id: 'powershell-title',
    targets: [{ rule: 'asd_ism.ism-1622', release: CURRENT_RELEASE }],
    fields: { title: CUSTOM_TITLE, tags: ['powershell-custom'] },
  }
  const staleOverlay = {
    schema_version: 1,
    id: 'powershell-old-guidance',
    targets: [{ rule: 'asd_ism.ism-1622', release: 'v2025.03.1' }],
    fields: { references: { microsoft: ['https://learn.microsoft.com/powershell/scripting/learn/ps101/01-getting-started'] } },
  }
  // Both pass the overlay file checks, so the generated index lists them.
  // The first fits no index entry (the table skips it at startup); the
  // second only fails once the full rule is merged, when the rule is opened.
  const indexLevelMisfit = {
    ...titleOverlay,
    id: 'applicability-shape',
    fields: { applicability: [{ target: null, version: null }] },
  }
  const ruleLevelMisfit = { ...titleOverlay, id: 'empty-remediation', fields: { remediation: { $replace: { Windows: {} } } } }

  // Serves the overlays the way the published site does: a generated
  // _index.json (built from the same code as the publish step) and the
  // overlay files, which the page fetches only when a targeted rule opens.
  async function serveOverlays(page: Page, files: Record<string, unknown>) {
    const fileNames = Object.keys(files).sort()
    const index = buildOverlayIndex(
      fileNames.map((fileName) => ({ fileName, value: files[fileName] })),
      () => {},
    )
    await page.route('**/baselines/_overlays/{_index.json,rules/*.json}', (route) => {
      const url = new URL(route.request().url())
      const fileName = url.pathname.split('/').pop() ?? ''
      const body = fileName === '_index.json' ? index : files[fileName]
      if (body === undefined) return route.fulfill({ status: 404, body: 'Not found' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
  }

  async function openIsm1622(page: Page) {
    const row = await searchForSingleRow(page, 'ism-1622', CUSTOM_TITLE)
    await row.getByRole('button').click()
    const detail = page.locator('[id^="rule-detail-"]')
    await expect(detail.getByTestId('custom-fields')).toBeVisible()
    return detail
  }

  test('an overlay changes the title in the table, search and tag facet, and the details tag it Custom', async ({ page }) => {
    await serveOverlays(page, { 'a-title.json': titleOverlay })
    await page.goto('/')
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

    const searchBox = page.getByPlaceholder('Search title or id…')
    await searchBox.fill('every managed device')
    await expect(ruleCount(page)).toHaveText('1 of 1493 rules')
    await expect(page.locator('table tbody tr').filter({ hasText: CUSTOM_TITLE })).toHaveCount(1)
    await expect(page.getByText(ISM_1622_TITLE)).toHaveCount(0)
    await searchBox.fill('')
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules')

    const tagOption = page.getByRole('checkbox', { name: 'powershell-custom', exact: true })
    await tagOption.scrollIntoViewIfNeeded()
    await expect(tagOption.locator('xpath=..')).toContainText('(1)')
    await tagOption.click()
    await expect(ruleCount(page)).toHaveText('1 of 1493 rules')
    await tagOption.click()

    const detail = await openIsm1622(page)
    await expect(detail.getByTestId('custom-title')).toContainText(CUSTOM_TITLE)
    await expect(detail.getByTestId('custom-title').getByText('Custom', { exact: true })).toBeVisible()
    await expect(detail.getByTestId('custom-fields')).toHaveText('Custom: tags')
    await expect(detail.getByTestId('stale-overlay-note')).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'Custom content problems' })).toHaveCount(0)
  })

  test('an overlay written for an older release shows a review note naming it', async ({ page }) => {
    await serveOverlays(page, { 'a-title.json': titleOverlay, 'b-old-guidance.json': staleOverlay })
    await page.goto('/')

    const detail = await openIsm1622(page)
    await expect(detail.getByTestId('stale-overlay-note')).toHaveCount(1)
    await expect(detail.getByTestId('stale-overlay-note')).toHaveText(
      `Custom content (powershell-old-guidance) was written for ASD ISM v2025.03.1; this rule is from ${CURRENT_RELEASE}. Review it for accuracy.`,
    )
    const referencesHeading = detail.getByRole('heading', { name: 'References' })
    await expect(referencesHeading.locator('..').getByText('Custom', { exact: true })).toBeVisible()
    await expect(detail.getByText('ps101/01-getting-started', { exact: false })).toBeVisible()
    await expect(detail.getByTestId('custom-fields')).toHaveText('Custom: tags')
  })

  test('startup reads only the overlay index; an overlay file is fetched when its rule opens', async ({ page }) => {
    await serveOverlays(page, { 'a-title.json': titleOverlay })
    const fetchedOverlayFiles: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/baselines/_overlays/rules/')) fetchedOverlayFiles.push(new URL(request.url()).pathname)
    })
    await page.goto('/')
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

    const searchBox = page.getByPlaceholder('Search title or id…')
    await searchBox.fill('every managed device')
    await expect(page.locator('table tbody tr').filter({ hasText: CUSTOM_TITLE })).toHaveCount(1)
    expect(fetchedOverlayFiles).toEqual([])

    const detail = await openIsm1622(page)
    await expect(detail.getByTestId('custom-fields')).toHaveText('Custom: tags')
    expect(fetchedOverlayFiles).toEqual(['/baselines/_overlays/rules/a-title.json'])
  })

  test('a misfit overlay is skipped with a warning while the valid ones still apply', async ({ page }) => {
    await serveOverlays(page, { 'a-title.json': titleOverlay, 'c-index-misfit.json': indexLevelMisfit, 'd-rule-misfit.json': ruleLevelMisfit })
    await page.goto('/')
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

    const notice = page.getByRole('status', { name: 'Custom content problems' })
    await expect(notice).toContainText('applicability-shape')
    await expect(page.getByRole('status', { name: 'Display name problems' })).toHaveCount(0)

    const detail = await openIsm1622(page)
    await expect(detail.getByTestId('custom-title')).toContainText(CUSTOM_TITLE)
    await expect(detail.getByTestId('custom-fields')).toHaveText('Custom: tags')
    await expect(detail.getByTestId('skipped-overlay-note')).toHaveCount(2)
    await expect(detail.getByTestId('skipped-overlay-note').filter({ hasText: 'empty-remediation' })).toHaveCount(1)
    await expect(detail.getByRole('heading', { name: 'Remediation' })).toHaveCount(0)
  })

  test('with no overlays the details show no custom content', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'ism-1622', ISM_1622_TITLE)
    await row.getByRole('button').click()
    const detail = page.locator('[id^="rule-detail-"]')
    await expect(detail.getByTestId('rule-breadcrumb')).toBeVisible()
    await expect(detail.getByText(/Custom/)).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'Custom content problems' })).toHaveCount(0)
  })

  test('a payload file is shown when it is text and offered for download either way', async ({ page }) => {
    const payloadsBase = 'baselines/_overlays/payloads'
    const payloadOverlay = {
      ...titleOverlay,
      id: 'payload-files',
      fields: {
        ...titleOverlay.fields,
        remediation: {
          Windows: {
            steps: [],
            payloads: [
              { kind: 'registry', versions: null, data_file: `${payloadsBase}/Policy.reg` },
              { kind: 'registry', versions: null, data_file: `${payloadsBase}/Registry.pol` },
              { kind: 'admx', versions: null, data_file: `${payloadsBase}/Missing.admx` },
            ],
          },
        },
      },
    }
    await serveOverlays(page, { 'a-payloads.json': payloadOverlay })
    await page.route(`**/${payloadsBase}/*`, (route) => {
      const fileName = new URL(route.request().url()).pathname.split('/').pop()
      if (fileName === 'Policy.reg') return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Windows Registry Editor Version 5.00\n' })
      if (fileName === 'Registry.pol') return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from([0x50, 0x52, 0x65, 0x67, 0x0d, 0x0a]) })
      return route.fulfill({ status: 404, body: 'Not found' })
    })
    await page.goto('/')
    const detail = await openIsm1622(page)
    const remediation = detail.getByTestId('remediation-target')

    const fixButtons = detail.getByRole('button', { name: /registry|admx/ })
    await expect(fixButtons).toHaveCount(3)
    await expect(remediation).toHaveCount(0)

    await fixButtons.nth(0).click()
    await expect(remediation.locator('pre', { hasText: 'Windows Registry Editor Version 5.00' })).toBeVisible()
    // .reg has no highlight.js language here, so it stays plain text.
    await expect(remediation.locator('pre .hljs')).toHaveCount(0)
    await expect(remediation.getByRole('link', { name: 'Download Policy.reg' })).toHaveAttribute('download', 'Policy.reg')

    // Registry.pol is binary, so a link only and no code block.
    await fixButtons.nth(1).click()
    const binaryLink = remediation.getByRole('link', { name: 'Download Registry.pol' })
    await expect(binaryLink).toHaveAttribute('download', 'Registry.pol')
    await expect(binaryLink).toHaveAttribute('href', new RegExp(`${payloadsBase}/Registry\\.pol$`))
    await expect(remediation.locator('pre')).toHaveCount(0)

    // Missing.admx fails to load.
    await fixButtons.nth(2).click()
    await expect(remediation.getByTestId('referenced-file-error')).toContainText('Missing.admx')
  })
})

test('the committed ASD Blueprint overlay gives ISM-1621 a Custom Windows PowerShell remediation step', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'ism-1621', /./)
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')

  const remediation = detail.getByTestId('remediation-target')
  await expect(remediation).toHaveCount(1)
  await expect(detail.getByRole('button', { name: /PowerShell script/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(remediation.getByText('RemovePowerShellV2', { exact: true })).toBeVisible()
  await expect(detail.getByRole('heading', { name: 'Remediation' }).locator('xpath=..').getByText('Custom', { exact: true })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Custom content problems' })).toHaveCount(0)
})

test('ISM-1621 shows its Blueprint script loaded from the referenced script file', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'ism-1621', /./)
  await row.getByRole('button').click()
  const remediation = page.locator('[id^="rule-detail-"]').getByTestId('remediation-target')

  await expect(remediation.locator('pre', { hasText: 'MicrosoftWindowsPowerShellV2Root' })).toBeVisible()
  await expect(remediation.getByTestId('referenced-file-error')).toHaveCount(0)
})

test('ISM-1654 and ISM-1655 each show their own Blueprint script step', async ({ page }) => {
  await page.goto('/')
  for (const [ruleId, stepName] of [
    ['ism-1654', 'RemoveInternetExplorer'],
    ['ism-1655', 'RemoveDotNet35'],
  ] as const) {
    const row = await searchForSingleRow(page, ruleId, /./)
    await row.getByRole('button').click()
    const remediation = page.locator('[id^="rule-detail-"]').getByTestId('remediation-target')
    await expect(remediation).toHaveCount(1)
    await expect(remediation.getByText(stepName, { exact: true })).toBeVisible()
    await expect(remediation.getByTestId('referenced-file-error')).toHaveCount(0)
  }
})

test.describe('check and fix buttons', () => {
  test('a rule with a single check shows it open', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')
    await row.getByRole('button').click()
    const detail = page.locator('[id^="rule-detail-"]')
    const checkButton = detail.getByRole('button', { name: 'macOS Bash', exact: true })
    await expect(checkButton).toHaveAttribute('aria-expanded', 'true')
    await expect(detail.getByTestId('check-target').locator('pre')).toContainText('objectIsForcedForKey')
    await expect(detail.getByText('Expected result')).toBeVisible()
    await checkButton.click()
    await expect(checkButton).toHaveAttribute('aria-expanded', 'false')
    await expect(detail.getByTestId('check-target')).toHaveCount(0)
  })

  test('a fix with two items shows two closed buttons, one open at a time', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'os_sshd_fips_compliant', /./)
    await row.getByRole('button').click()
    const detail = page.locator('[id^="rule-detail-"]')
    const bashButton = detail.getByRole('button', { name: /Bash script/ })
    const declarationButton = detail.getByRole('button', { name: /DDM declaration/ })
    const remediation = detail.getByTestId('remediation-target')

    await expect(bashButton).toHaveAttribute('aria-expanded', 'false')
    await expect(declarationButton).toHaveAttribute('aria-expanded', 'false')
    await expect(remediation).toHaveCount(0)

    await bashButton.click()
    await expect(bashButton).toHaveAttribute('aria-expanded', 'true')
    await expect(declarationButton).toHaveAttribute('aria-expanded', 'false')
    await expect(remediation.locator('pre')).toHaveCount(1)
    const bashRegionId = await bashButton.getAttribute('aria-controls')
    expect(await page.locator(`[id="${bashRegionId}"]`).count()).toBe(1)

    await declarationButton.click()
    await expect(bashButton).toHaveAttribute('aria-expanded', 'false')
    await expect(declarationButton).toHaveAttribute('aria-expanded', 'true')
    await expect(remediation).toHaveCount(1)

    await declarationButton.click()
    await expect(declarationButton).toHaveAttribute('aria-expanded', 'false')
    await expect(remediation).toHaveCount(0)
  })

  test('a rule with per-version checks shows a version row that swaps the content', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'os_authenticated_root_enable', /./)
    await row.getByRole('button').click()
    const detail = page.locator('[id^="rule-detail-"]')
    // A single platform's check starts open.
    await expect(detail.getByRole('button', { name: 'macOS Bash', exact: true })).toHaveAttribute('aria-expanded', 'true')
    const versionRow = detail.getByRole('group', { name: 'Check versions' })
    const defaultButton = versionRow.getByRole('button', { name: 'Default' })
    const versionButton = versionRow.getByRole('button', { name: 'macOS 15' })
    await expect(defaultButton).toHaveAttribute('aria-pressed', 'true')
    await expect(detail.getByTestId('check-target')).toContainText('sealed')

    await versionButton.click()
    await expect(versionButton).toHaveAttribute('aria-pressed', 'true')
    await expect(detail.getByTestId('check-target')).toContainText('AuthenticatedRootVolumeEnabled')
    await expect(detail.getByTestId('check-target')).not.toContainText('sealed')
  })
})

test.describe('code highlighting', () => {
  test('an mSCP bash check is coloured', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'audit_acls_folders_configure', /./)
    await row.getByRole('button').click()
    const check = page.locator('[id^="rule-detail-"]').getByTestId('check-target')
    await expect(check.locator('pre code.hljs [class*="hljs-"]').first()).toBeVisible()
  })

  test('the ISM-1621 PowerShell script is coloured', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'ism-1621', /./)
    await row.getByRole('button').click()
    const remediation = page.locator('[id^="rule-detail-"]').getByTestId('remediation-target')
    const script = remediation.locator('pre', { hasText: 'MicrosoftWindowsPowerShellV2Root' })
    await expect(script.locator('[class*="hljs-"]').first()).toBeVisible()
  })
})

test.describe('code block copy button', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  test('copies the displayed text, confirms briefly, then reverts', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')
    await row.getByRole('button').click()

    const checkBlock = page.getByTestId('check-target').first().locator('pre').first()
    await expect(checkBlock).toContainText('objectIsForcedForKey')
    const displayedText = await checkBlock.textContent()
    const copyButton = checkBlock.locator('xpath=following-sibling::button')
    await expect(copyButton).toHaveAccessibleName('Copy code')

    await copyButton.click()
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveCount(1)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(displayedText)
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toHaveCount(0, { timeout: 4_000 })
  })

  test('says so when the clipboard API is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    })
    await page.goto('/')
    const row = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')
    await row.getByRole('button').click()

    await page.getByRole('button', { name: 'Copy code' }).first().click()
    await expect(page.getByRole('status').filter({ hasText: 'Copying is not available here' })).toHaveCount(1)
  })

  test('the licence text in the Sources & licences dialog can be copied', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('contentinfo').getByRole('button', { name: 'Sources & licences' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sources & licences' })
    const firstPackage = dialog.locator('details').first()
    await firstPackage.locator('summary').click()
    await firstPackage.getByRole('button', { name: 'Copy code' }).click()
    const licenceText = await firstPackage.locator('pre').textContent()
    // Windows' clipboard hands multi-line text back with CRLF line endings.
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText.replace(/\r\n/g, '\n')).toBe(licenceText)
  })
})

test.describe('live organization-defined value in code blocks', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

  async function openMinimumLengthRule(page: Page) {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'pwpolicy_minimum_length_enforce', /Minimum Password Length/)
    await row.getByRole('button').click()
    const detail = page.locator('[id^="rule-detail-"]')
    const odvInput = page.getByRole('textbox', { name: /Minimum password length/ })
    await expect(odvInput).toBeVisible()
    return { detail, odvInput, checkBlock: detail.getByTestId('check-target').first().locator('pre').first() }
  }

  test('the check shows the recommended value, follows edits, and reverts on an invalid value', async ({ page }) => {
    const { detail, odvInput, checkBlock } = await openMinimumLengthRule(page)

    await expect(checkBlock).not.toContainText('$ODV')
    await expect(checkBlock).toContainText('-v ODV=6 ')
    await expect(detail.getByText('Shown with the organization-defined value: 6').first()).toBeVisible()

    await odvInput.fill('14')
    await expect(checkBlock).not.toContainText('$ODV')
    await expect(checkBlock).toContainText('-v ODV=14 ')
    await expect(detail.getByText('Shown with the organization-defined value: 14').first()).toBeVisible()

    await odvInput.fill("14'")
    await expect(page.getByRole('alert')).toContainText('Value must be a whole number.')
    // The last valid value stays in effect, as it does for generation.
    await expect(checkBlock).toContainText('-v ODV=14 ')

    await odvInput.fill('')
    await expect(checkBlock).toContainText('-v ODV=6 ')
  })

  test('an invalid stored value keeps the literal $ODV and the note', async ({ page }) => {
    await page.addInitScript(() => {
      const ref = { id: 'mscp.pwpolicy_minimum_length_enforce', path: 'mscp/rules/pwpolicy_minimum_length_enforce.json' }
      const persisted = { state: { selections: { [ref.id]: { ref, enabled: true, odvValue: "12'" } } }, version: 2 }
      window.localStorage.setItem('intune-toolkit:selections', JSON.stringify(persisted))
    })
    await page.goto('/')
    const row = await searchForSingleRow(page, 'pwpolicy_minimum_length_enforce', /Minimum Password Length/)
    await row.getByRole('button', { name: /Expand/ }).click()
    const checkBlock = page.locator('[id^="rule-detail-"]').getByTestId('check-target').first().locator('pre').first()
    await expect(checkBlock).toContainText('$ODV')
    await expect(page.getByText('$ODV stands for the organization-defined value, currently [value].').first()).toBeVisible()
  })

  test('a remediation script only shows a value that is safe to paste into a shell', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'audit_retention_configure', /./)
    await row.getByRole('button').click()
    const remediationBlock = page.getByTestId('remediation-target').first().locator('pre').first()
    await expect(remediationBlock).toContainText('expire-after:7d')

    // "60d OR 5G" satisfies the rule's own pattern but has spaces, so it is not shell-safe.
    const odvInput = page.getByRole('textbox', { name: /Time or disk size/ })
    await odvInput.fill('60d OR 5G')
    await expect(remediationBlock).toContainText('expire-after:$ODV')
    await expect(page.getByText('$ODV stands for the organization-defined value').first()).toBeVisible()
  })

  test('a variable-mode rule shows the export line the generated script runs, and Copy copies it', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'os_policy_banner_ssh_configure', /./)
    await row.getByRole('button').click()
    const checkBlock = page.getByTestId('check-target').first().locator('pre').first()
    await expect(checkBlock).toContainText("export ODV='You are accessing")
    await expect(page.getByText('Shown with the organization-defined value set as ODV, as the generated script does.').first()).toBeVisible()
    const displayedText = await checkBlock.textContent()
    expect(displayedText).toMatch(/^export ODV='You are accessing/)
    expect(displayedText).toContain('bannerText="$ODV"')

    await checkBlock.locator('xpath=following-sibling::button').click()
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText.replace(/\r\n/g, '\n')).toBe(displayedText)
  })

  test('Copy puts the substituted text on the clipboard', async ({ page }) => {
    const { odvInput, checkBlock } = await openMinimumLengthRule(page)
    await odvInput.fill('14')
    await expect(checkBlock).not.toContainText('$ODV')

    const displayedText = await checkBlock.textContent()
    await checkBlock.locator('xpath=following-sibling::button').click()
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toBe(displayedText)
    expect(clipboardText).toContain('-v ODV=14 ')
    expect(clipboardText).not.toContain('$ODV')
  })
})

test('a URL in a rule reference is a link that opens in a new tab', async ({ page }) => {
  await page.goto('/')
  const row = await searchForSingleRow(page, 'ism-1674', /./)
  await row.getByRole('button').click()
  const detail = page.locator('[id^="rule-detail-"]')
  await expect(detail.getByRole('heading', { name: 'References' })).toBeVisible()
  const link = detail.locator('li', { hasText: 'asd_blueprint:' }).locator('a[href^="https://blueprint.asd.gov.au/configuration/intune/devices/scripts/"]')
  await expect(link.first()).toBeVisible()
  await expect(link.first()).toHaveAttribute('target', '_blank')
  await expect(link.first()).toHaveAttribute('rel', 'noreferrer')
})

test.describe('light and dark theme', () => {
  const htmlElement = (page: Page) => page.locator('html')

  test('the footer toggle switches the theme and the choice survives a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await openLibrary(page)
    await expect(htmlElement(page)).not.toHaveClass(/\bdark\b/)

    await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect(htmlElement(page)).toHaveClass(/\bdark\b/)
    await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()

    await page.reload()
    await expect(htmlElement(page)).toHaveClass(/\bdark\b/)
    await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()

    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await expect(htmlElement(page)).not.toHaveClass(/\bdark\b/)
    await page.reload()
    await expect(htmlElement(page)).not.toHaveClass(/\bdark\b/)
  })

  test.describe('with a dark OS preference', () => {
    test.use({ colorScheme: 'dark' })

    test('the inline script in index.html sets the class without the app bundle', async ({ page }) => {
      // With the app's entry module blocked, only the pre-paint script can set it.
      await page.route('**/src/main.tsx*', (route) => route.abort())
      await page.goto('/')
      await expect(htmlElement(page)).toHaveClass(/\bdark\b/)
    })

    test('a first visit with no stored choice starts dark', async ({ page }) => {
      await page.goto('/')
      await expect(htmlElement(page)).toHaveClass(/\bdark\b/)
      await expect(page.getByText(/^1493 of 1493 rules$/)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()
    })

    test('a stored light choice wins over the OS preference', async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem('intune-toolkit:theme', 'light'))
      await page.goto('/')
      await expect(htmlElement(page)).not.toHaveClass(/\bdark\b/)
    })
  })
})

test.describe('target platform icons', () => {
  const iconNamed = (row: Locator, name: string) => row.getByRole('img', { name, exact: true })

  test('an mSCP row shows a macOS icon to the left of its Automated badge, with a tooltip', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'audit_auditd_enabled', /Enable Security Auditing/i)
    const icon = iconNamed(row, 'macOS')
    await expect(icon).toBeVisible()
    await expect(icon.locator('svg')).toHaveCount(1)
    const logoBox = await icon.locator('svg').boundingBox()
    expect(logoBox!.width).toBeGreaterThan(8)
    const badge = row.locator('td').nth(3).getByText(/^(Automated|Manual)/)
    const iconBox = await icon.boundingBox()
    const badgeBox = await badge.boundingBox()
    expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(badgeBox!.x)
    await icon.hover()
    await expect(page.getByRole('tooltip', { name: 'macOS' })).toBeVisible()
  })

  test('the longest badge stays on one line with its icon at desktop width', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'pwpolicy_temporary_or_emergency_accounts_disable', /./)
    const iconBox = await iconNamed(row, 'macOS').boundingBox()
    const badgeBox = await row.locator('td').nth(3).getByText('Manual - marked by mSCP').boundingBox()
    expect(iconBox!.y).toBeLessThan(badgeBox!.y + badgeBox!.height)
    expect(badgeBox!.y).toBeLessThan(iconBox!.y + iconBox!.height)
    expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(badgeBox!.x)
  })

  test('an ISM control with no overlay shows no target icon', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'ism-1667', 'Microsoft Office is blocked from creating child processes.')
    await expect(row.getByRole('img', { name: /^(macOS|Windows)$/ })).toHaveCount(0)
  })
})

test.describe('Windows target from the ASD Blueprint overlays', () => {
  const blueprintControls = ['ism-1542', 'ism-1621', 'ism-1654', 'ism-1655', 'ism-1674']

  test('ISM-1621 shows a Windows icon', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'ism-1621', /ism-1621/)
    const icon = row.getByRole('img', { name: 'Windows', exact: true })
    await expect(icon).toBeVisible()
    await expect(icon.locator('svg')).toHaveCount(1)
  })

  test('the Target "Windows" option lists exactly the five Blueprint-overlaid controls', async ({ page }) => {
    await page.goto('/')
    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
    await page.getByRole('group', { name: 'Target', exact: true }).getByRole('checkbox', { name: 'Windows', exact: true }).click()
    await expect(ruleCount(page)).toHaveText('5 of 1493 rules')
    await page.getByRole('button', { name: 'Expand all' }).click()
    for (const control of blueprintControls) {
      await expect(page.getByRole('checkbox', { name: `Select ${control}` })).toBeVisible()
    }
  })
})

// These tests serve their own mapping index through page.route, built by the
// same code as the publish step, in place of the committed (empty)
// baselines/_mappings/rules/ folder.
test.describe('rule mappings', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  const ISM_1622 = 'asd_ism.ism-1622'
  const ISM_1621 = 'asd_ism.ism-1621'
  const GATEKEEPER = 'mscp.os_gatekeeper_enable'
  const DICTATION = 'mscp.os_dictation_disable'
  // The library's current releases, so a re-import keeps these links current;
  // the stale link uses a deliberately old release.
  const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as {
    sources: { name: string; release_tag: string }[]
  }
  const releaseOf = (sourceName: string) => manifest.sources.find((source) => source.name === sourceName)?.release_tag ?? ''
  const ISM_RELEASE = releaseOf('asd_ism')
  const MSCP_RELEASE = releaseOf('mscp')
  const STALE_ISM_RELEASE = 'v2000.01.1'
  const ISM_1622_TITLE = 'PowerShell is configured to use Constrained Language Mode.'

  const ruleEndpoint = (id: string, release: string) => ({ kind: 'rule', id, release })
  const supportsIsm1622 = {
    schema_version: 1,
    id: 'powershell-constrained-language',
    links: [
      {
        relation: 'supports',
        from: [ruleEndpoint(GATEKEEPER, MSCP_RELEASE), ruleEndpoint(DICTATION, MSCP_RELEASE)],
        to: [ruleEndpoint(ISM_1622, ISM_RELEASE)],
        note: 'Covers the PowerShell part only.',
      },
    ],
  }
  const staleRelated = {
    schema_version: 1,
    id: 'older-release',
    links: [{ relation: 'related', from: [ruleEndpoint(ISM_1621, STALE_ISM_RELEASE)], to: [ruleEndpoint(ISM_1622, ISM_RELEASE)] }],
  }

  async function serveMappings(page: Page, files: Record<string, unknown>) {
    const fileNames = Object.keys(files).sort()
    const index = buildMappingIndex(
      fileNames.map((fileName) => ({ fileName, value: files[fileName] })),
      () => {},
    )
    await page.route('**/baselines/_mappings/_index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(index) }),
    )
  }

  const detailOf = (page: Page, ruleId: string) => page.locator(`[id="rule-detail-${ruleId}"]`)
  const mappedRulesTab = (page: Page, ruleId: string) => detailOf(page, ruleId).getByRole('tab', { name: /^Mapped rules/ })
  const mappedRulesPanel = (page: Page, ruleId: string) => detailOf(page, ruleId).getByRole('tabpanel', { name: /^Mapped rules/ })
  const groupButton = (page: Page, ruleId: string, name: string) => mappedRulesPanel(page, ruleId).getByRole('button', { name, exact: true })

  const mappedRow = (page: Page, ruleId: string, upstreamId: string) =>
    mappedRulesPanel(page, ruleId).getByTestId('mapped-rule').filter({ hasText: upstreamId })
  const titleButton = (row: Locator, upstreamId: string) => row.getByRole('button', { name: new RegExp(`^[^:]*${upstreamId}:`) })
  const summaryTooltip = (page: Page, text: string) => page.getByRole('tooltip').filter({ hasText: text })

  async function openMappedRules(page: Page, ruleId: string) {
    await mappedRulesTab(page, ruleId).click()
    await expect(mappedRulesPanel(page, ruleId)).toBeVisible()
  }

  test('a rule with mappings shows Details first and a Mapped rules tab with its count', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)

    const detail = detailOf(page, ISM_1622)
    await expect(detail.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    await expect(mappedRulesTab(page, ISM_1622)).toHaveAccessibleName('Mapped rules (2)')
    await expect(mappedRulesTab(page, ISM_1622)).toHaveAttribute('aria-selected', 'false')
    await expect(detail.getByRole('heading', { name: 'Benchmarks' })).toBeVisible()
  })

  test('groups start closed and open to show rows like the main table, with the note', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)

    const group = groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)')
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(mappedRulesPanel(page, ISM_1622).getByRole('listitem')).toHaveCount(0)
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'true')

    const items = mappedRulesPanel(page, ISM_1622).getByRole('list', { name: 'NIST mSCP Supported by' }).getByRole('listitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText(/os_dictation_disable/)
    await expect(items.nth(1)).toContainText(/os_gatekeeper_enable/)
    await expect(items.first()).toContainText('Covers the PowerShell part only.')
    await expect(items.first().getByText(/^(Automated|Manual)$/)).toBeVisible()
    await expect(mappedRulesPanel(page, ISM_1622).getByTestId('stale-mapping-note')).toHaveCount(0)
  })

  test('the mSCP side shows the ISM rule it supports', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=os_gatekeeper_enable&rule=${GATEKEEPER}`)
    await openMappedRules(page, GATEKEEPER)

    const group = groupButton(page, GATEKEEPER, 'ASD ISM Supports (1)')
    await group.click()
    const items = mappedRulesPanel(page, GATEKEEPER).getByRole('list', { name: 'ASD ISM Supports' }).getByRole('listitem')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText(/ism-1622/)
    await expect(items.first()).toContainText(ISM_1622_TITLE)
  })

  test('filtering opens matching groups, shows matching of total, and clearing restores them', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)

    await mappedRulesPanel(page, ISM_1622).getByRole('textbox', { name: 'Filter mapped rules' }).fill('gatekeeper')
    const filtered = groupButton(page, ISM_1622, 'NIST mSCP Supported by (1 of 2)')
    await expect(filtered).toHaveAttribute('aria-expanded', 'true')
    await expect(mappedRulesPanel(page, ISM_1622).getByRole('listitem')).toHaveCount(1)

    await mappedRulesPanel(page, ISM_1622).getByRole('textbox', { name: 'Filter mapped rules' }).fill('')
    await expect(groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)')).toHaveAttribute('aria-expanded', 'false')
  })

  test('the assessment choice filters rows and the filter survives a tab switch', async ({ page }) => {
    const manualRule = 'mscp.audit_alert_processing_fail'
    await serveMappings(page, {
      'powershell.json': supportsIsm1622,
      'manual.json': {
        schema_version: 1,
        id: 'manual-audit',
        links: [{ relation: 'supports', from: [ruleEndpoint(manualRule, MSCP_RELEASE)], to: [ruleEndpoint(ISM_1622, ISM_RELEASE)] }],
      },
    })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    const panel = mappedRulesPanel(page, ISM_1622)
    const assessment = panel.getByRole('radiogroup', { name: 'Assessment' })

    await expect(assessment.getByRole('radio')).toHaveCount(3)
    for (const name of ['All', 'Automated', 'Manual']) {
      await expect(assessment.getByRole('radio', { name, exact: true })).toBeVisible()
    }
    await expect(groupButton(page, ISM_1622, 'NIST mSCP Supported by (3)')).toHaveAttribute('aria-expanded', 'false')

    await assessment.getByRole('radio', { name: 'Manual', exact: true }).click()
    await expect(groupButton(page, ISM_1622, 'NIST mSCP Supported by (1 of 3)')).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getByRole('listitem')).toHaveCount(1)
    await expect(panel.getByRole('listitem').first()).toContainText(/audit_alert_processing_fail/)

    await assessment.getByRole('radio', { name: 'Automated', exact: true }).click()
    await expect(groupButton(page, ISM_1622, 'NIST mSCP Supported by (2 of 3)')).toBeVisible()
    await expect(panel.getByRole('listitem')).toHaveCount(2)

    await panel.getByRole('textbox', { name: 'Filter mapped rules' }).fill('gatekeeper')
    await expect(groupButton(page, ISM_1622, 'NIST mSCP Supported by (1 of 3)')).toBeVisible()
    await detailOf(page, ISM_1622).getByRole('tab', { name: 'Details' }).click()
    await mappedRulesTab(page, ISM_1622).click()
    await expect(panel.getByRole('textbox', { name: 'Filter mapped rules' })).toHaveValue('gatekeeper')
    await expect(assessment.getByRole('radio', { name: 'Automated', exact: true })).toBeChecked()
    await expect(panel.getByRole('listitem')).toHaveCount(1)
  })

  test('hovering a mapped rule shows a summary with targets, automation, check and fix, and the start of its description', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()

    await titleButton(mappedRow(page, ISM_1622, 'os_gatekeeper_enable'), 'os_gatekeeper_enable').hover()
    const summary = summaryTooltip(page, 'Check: yes')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('os_gatekeeper_enable')
    await expect(summary).toContainText('Enable Gatekeeper')
    await expect(summary).toContainText('Fix: yes')
    await expect(summary).toContainText('Gatekeeper MUST be enabled.')
    await expect(summary.getByRole('img', { name: 'macOS' })).toBeVisible()
    await expect(summary.getByText(/^(Automated|Manual)$/)).toBeVisible()
  })

  test('focusing a mapped rule title by keyboard shows the same summary', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()

    await page.keyboard.press('Tab')
    await expect(titleButton(mappedRow(page, ISM_1622, 'os_dictation_disable'), 'os_dictation_disable')).toBeFocused()
    const summary = summaryTooltip(page, 'Check: ')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('os_dictation_disable')
    await expect(summary).toContainText('Fix: ')
  })

  test('clicking a mapped rule expands its details in place, with no nested tabs', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()

    const row = mappedRow(page, ISM_1622, 'os_gatekeeper_enable')
    const title = titleButton(row, 'os_gatekeeper_enable')
    await expect(title).toHaveAttribute('aria-expanded', 'false')
    await title.click()
    await expect(title).toHaveAttribute('aria-expanded', 'true')
    await expect(row.getByText('digitally signed by an Apple-issued certificate')).toBeVisible()
    await expect(row.getByRole('heading', { name: 'Check' })).toBeVisible()
    await expect(row.getByRole('tablist')).toHaveCount(0)
    await expect(detailOf(page, ISM_1622).getByRole('tab', { name: 'Details' })).toBeVisible()
    await expect(mappedRulesPanel(page, ISM_1622)).toBeVisible()

    await title.click()
    await expect(title).toHaveAttribute('aria-expanded', 'false')
    await expect(row.getByRole('heading', { name: 'Check' })).toHaveCount(0)
  })

  test('clicking anywhere on a mapped rule row toggles its details', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()

    const row = mappedRow(page, ISM_1622, 'os_gatekeeper_enable')
    const title = titleButton(row, 'os_gatekeeper_enable')
    await row.getByText('Covers the PowerShell part only.').click()
    await expect(title).toHaveAttribute('aria-expanded', 'true')
    await expect(row.getByRole('heading', { name: 'Check' })).toBeVisible()

    await row.getByText('Covers the PowerShell part only.').click()
    await expect(title).toHaveAttribute('aria-expanded', 'false')
  })

  test('the hover summary of a rule with an organization-defined value shows no raw placeholder', async ({ page }) => {
    const deferral = 'mscp.os_software_update_deferral'
    await serveMappings(page, {
      'deferral.json': {
        schema_version: 1,
        id: 'deferral',
        links: [{ relation: 'related', from: [ruleEndpoint(deferral, MSCP_RELEASE)], to: [ruleEndpoint(ISM_1622, ISM_RELEASE)] }],
      },
    })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Related (1)').click()

    await titleButton(mappedRow(page, ISM_1622, 'os_software_update_deferral'), 'os_software_update_deferral').hover()
    const summary = summaryTooltip(page, 'Check: ')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText(/deferred for \d+ days/)
    await expect(summary).not.toContainText('$ODV')
  })

  test('Go to this rule opens it in the main table, from either side', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page)
    const row = await searchForSingleRow(page, 'ism-1622', ISM_1622_TITLE)
    await row.getByRole('button').click()
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()
    await expect(mappedRulesPanel(page, ISM_1622).getByTestId('stale-mapping-note')).toHaveCount(0)

    const gatekeeperRow = mappedRow(page, ISM_1622, 'os_gatekeeper_enable')
    await titleButton(gatekeeperRow, 'os_gatekeeper_enable').click()
    await gatekeeperRow.getByRole('link', { name: 'Go to this rule' }).click()
    await expect(searchBox(page)).toHaveValue('os_gatekeeper_enable')
    expect(new URL(page.url()).searchParams.get('rule')).toBe(GATEKEEPER)
    await expect(mappedRulesTab(page, GATEKEEPER)).toHaveAccessibleName('Mapped rules (1)')
    await openMappedRules(page, GATEKEEPER)
    await groupButton(page, GATEKEEPER, 'ASD ISM Supports (1)').click()
    await expect(mappedRulesPanel(page, GATEKEEPER).getByTestId('mapped-rule')).toContainText(ISM_1622_TITLE)

    // A filter that would hide the target is cleared on the way back; the
    // search box keeps the opened rule in view meanwhile.
    const mscpSource = page.getByRole('checkbox', { name: 'NIST mSCP', exact: true })
    await mscpSource.click()
    await expect(mscpSource).toBeChecked()
    await expect(detailOf(page, GATEKEEPER)).toBeVisible()
    const ismRow = mappedRow(page, GATEKEEPER, 'ism-1622')
    await titleButton(ismRow, 'ism-1622').click()
    await ismRow.getByRole('link', { name: 'Go to this rule' }).click()
    await expect(searchBox(page)).toHaveValue('ism-1622')
    await expect(mscpSource).not.toBeChecked()
    await expect(mappedRulesTab(page, ISM_1622)).toHaveAccessibleName('Mapped rules (2)')
    expect(new URL(page.url()).searchParams.get('rule')).toBe(ISM_1622)
  })

  test('the Go to this rule address opens just that rule when shared', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()
    const gatekeeperRow = mappedRow(page, ISM_1622, 'os_gatekeeper_enable')
    await titleButton(gatekeeperRow, 'os_gatekeeper_enable').click()

    const href = await gatekeeperRow.getByRole('link', { name: 'Go to this rule' }).getAttribute('href')
    expect(href).not.toBeNull()
    const sharedUrl = new URL(href ?? '', page.url())
    expect(sharedUrl.searchParams.get('q')).toBe('os_gatekeeper_enable')
    expect(sharedUrl.searchParams.get('rule')).toBe(GATEKEEPER)
    await page.goto(sharedUrl.toString())
    await expect(detailOf(page, GATEKEEPER)).toBeVisible()
    await expect(mappedRulesTab(page, GATEKEEPER)).toHaveAccessibleName('Mapped rules (1)')
  })

  test('a mapped rule open in the main table and expanded in a tab has no duplicate element ids', async ({ page }) => {
    const calendar = 'mscp.os_calendar_app_disable'
    const familyControls = 'mscp.os_calendar_app_disable_familycontrols'
    await serveMappings(page, {
      'calendar.json': {
        schema_version: 1,
        id: 'calendar',
        links: [{ relation: 'related', from: [ruleEndpoint(familyControls, MSCP_RELEASE)], to: [ruleEndpoint(calendar, MSCP_RELEASE)] }],
      },
    })
    await openLibrary(page, `/?q=os_calendar_app_disable&rule=${calendar}`)
    await openMappedRules(page, calendar)
    await groupButton(page, calendar, 'NIST mSCP Related (1)').click()
    const familyControlsRow = mappedRulesPanel(page, calendar).getByTestId('mapped-rule')
    await titleButton(familyControlsRow, 'os_calendar_app_disable_familycontrols').click()
    await expect(familyControlsRow.getByRole('heading', { name: 'Check' })).toBeVisible()
    await page.locator(`[data-rule-id="${familyControls}"]`).getByRole('button', { name: 'Expand os_calendar_app_disable_familycontrols' }).click()
    await expect(detailOf(page, familyControls)).toBeVisible()

    expect(await page.locator(`[id="rule-detail-${familyControls}"]`).count()).toBe(1)
    const duplicatedIds = await page.evaluate(() => {
      const seen = new Set<string>()
      const duplicated: string[] = []
      for (const element of document.querySelectorAll('[id]')) {
        if (seen.has(element.id)) duplicated.push(element.id)
        seen.add(element.id)
      }
      return duplicated
    })
    expect(duplicatedIds).toEqual([])
  })

  test('a mapped rule whose file fails to load still shows its summary facts', async ({ page }) => {
    await page.route('**/mscp/rules/os_gatekeeper_enable.json', (route) => route.fulfill({ status: 404, body: 'not found' }))
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()

    await titleButton(mappedRow(page, ISM_1622, 'os_gatekeeper_enable'), 'os_gatekeeper_enable').hover()
    const summary = summaryTooltip(page, 'Details could not be loaded.')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('Enable Gatekeeper')
    await expect(summary).toContainText('os_gatekeeper_enable')
  })

  test('a group opened by hand stays open after a filter is typed and cleared', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    const group = groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)')
    await group.click()

    const filterBox = mappedRulesPanel(page, ISM_1622).getByRole('textbox', { name: 'Filter mapped rules' })
    await filterBox.fill('gatekeeper')
    await expect(groupButton(page, ISM_1622, 'NIST mSCP Supported by (1 of 2)')).toHaveAttribute('aria-expanded', 'true')
    await filterBox.fill('')
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await expect(mappedRulesPanel(page, ISM_1622).getByTestId('mapped-rule')).toHaveCount(2)
  })

  test('open groups and expanded rows survive switching to Details and back', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()
    const title = titleButton(mappedRow(page, ISM_1622, 'os_gatekeeper_enable'), 'os_gatekeeper_enable')
    await title.click()
    await expect(title).toHaveAttribute('aria-expanded', 'true')

    await detailOf(page, ISM_1622).getByRole('tab', { name: 'Details' }).click()
    await openMappedRules(page, ISM_1622)
    await expect(groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)')).toHaveAttribute('aria-expanded', 'true')
    await expect(title).toHaveAttribute('aria-expanded', 'true')
    await expect(mappedRow(page, ISM_1622, 'os_gatekeeper_enable').getByRole('heading', { name: 'Check' })).toBeVisible()
    await expect(titleButton(mappedRow(page, ISM_1622, 'os_dictation_disable'), 'os_dictation_disable')).toHaveAttribute('aria-expanded', 'false')
  })

  test('collapsing the rule and reopening it resets the tab to Details with groups closed', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)').click()
    await titleButton(mappedRow(page, ISM_1622, 'os_gatekeeper_enable'), 'os_gatekeeper_enable').click()

    await page.getByRole('button', { name: 'Collapse ism-1622' }).click()
    await expect(detailOf(page, ISM_1622)).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand ism-1622' }).click()
    await expect(detailOf(page, ISM_1622).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')

    await openMappedRules(page, ISM_1622)
    const group = groupButton(page, ISM_1622, 'NIST mSCP Supported by (2)')
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await group.click()
    await expect(titleButton(mappedRow(page, ISM_1622, 'os_gatekeeper_enable'), 'os_gatekeeper_enable')).toHaveAttribute('aria-expanded', 'false')
  })

  test('a filter matching nothing says so', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)

    await mappedRulesPanel(page, ISM_1622).getByRole('textbox', { name: 'Filter mapped rules' }).fill('zzz')
    await expect(mappedRulesPanel(page, ISM_1622)).toContainText('No mapped rules match these filters.')
  })

  test('a link checked against an older release shows a review note inside an opened group', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622, 'older.json': staleRelated })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)
    await openMappedRules(page, ISM_1622)

    await groupButton(page, ISM_1622, 'ASD ISM Related (1)').click()
    await expect(mappedRulesPanel(page, ISM_1622).getByTestId('stale-mapping-note')).toHaveText(
      `This link was checked against ASD ISM ${STALE_ISM_RELEASE} for ism-1621, which is now from ${ISM_RELEASE}. Review it for accuracy.`,
    )
  })

  test('the stale note shows from the other side of the link too', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622, 'older.json': staleRelated })
    await openLibrary(page, `/?q=ism-1621&rule=${ISM_1621}`)
    await openMappedRules(page, ISM_1621)

    await groupButton(page, ISM_1621, 'ASD ISM Related (1)').click()
    await expect(mappedRulesPanel(page, ISM_1621).getByTestId('stale-mapping-note')).toHaveCount(1)
  })

  test('a shared URL opens the linked rule and collapsing it lets it go', async ({ page }) => {
    await serveMappings(page, { 'powershell.json': supportsIsm1622 })
    await openLibrary(page, `/?q=os_dictation_disable&rule=${DICTATION}`)

    await expect(mappedRulesTab(page, DICTATION)).toHaveAccessibleName('Mapped rules (1)')
    await page.getByRole('button', { name: 'Collapse os_dictation_disable' }).click()
    await expect(detailOf(page, DICTATION)).toHaveCount(0)
    expect(new URL(page.url()).searchParams.has('rule')).toBe(false)
  })

  test('a mapped rule title shows its organization-defined value, as the table does', async ({ page }) => {
    const passwordLength = 'mscp.pwpolicy_minimum_length_enforce'
    await serveMappings(page, {
      'password.json': {
        schema_version: 1,
        id: 'password-length',
        links: [{ relation: 'related', from: [ruleEndpoint(passwordLength, MSCP_RELEASE)], to: [ruleEndpoint(ISM_1622, ISM_RELEASE)] }],
      },
    })
    await openLibrary(page, `/?q=ism-1622&rule=${ISM_1622}`)

    await openMappedRules(page, ISM_1622)
    await groupButton(page, ISM_1622, 'NIST mSCP Related (1)').click()
    const passwordLink = mappedRulesPanel(page, ISM_1622).getByRole('button', { name: /pwpolicy_minimum_length_enforce/ })
    await expect(passwordLink).toContainText(/Require a Minimum Password Length of \d+ Characters/)
    await expect(passwordLink).toHaveAccessibleName(/Require a Minimum Password Length of \d+ Characters/)
    await expect(passwordLink).not.toContainText('$ODV')
  })

  // os_calendar_app_disable's id is part of
  // os_calendar_app_disable_familycontrols's, so its search shows both rules
  // and the second one's link points at the rule already open.
  test('a link to the rule already open scrolls it back into view', async ({ page }) => {
    const calendar = 'mscp.os_calendar_app_disable'
    const familyControls = 'mscp.os_calendar_app_disable_familycontrols'
    await serveMappings(page, {
      'calendar.json': {
        schema_version: 1,
        id: 'calendar',
        links: [{ relation: 'related', from: [ruleEndpoint(familyControls, MSCP_RELEASE)], to: [ruleEndpoint(calendar, MSCP_RELEASE)] }],
      },
    })
    await page.setViewportSize({ width: 1280, height: 500 })
    await openLibrary(page, `/?q=os_calendar_app_disable&rule=${calendar}`)
    await expect(detailOf(page, calendar)).toBeVisible()
    await page.locator(`[data-rule-id="${familyControls}"]`).getByRole('button', { name: 'Expand os_calendar_app_disable_familycontrols' }).click()

    await openMappedRules(page, familyControls)
    await groupButton(page, familyControls, 'NIST mSCP Related (1)').click()
    const calendarMappedRow = mappedRulesPanel(page, familyControls).getByTestId('mapped-rule')
    await calendarMappedRow.getByRole('button', { name: /os_calendar_app_disable(?!_)/ }).click()
    const linkBack = calendarMappedRow.getByRole('link', { name: 'Go to this rule' })
    await linkBack.scrollIntoViewIfNeeded()
    const calendarRow = page.locator(`[data-rule-id="${calendar}"]`)
    await expect(calendarRow).not.toBeInViewport()
    await linkBack.click()
    await expect(calendarRow).toBeInViewport()
    expect(new URL(page.url()).searchParams.get('rule')).toBe(calendar)
  })

  test('going back to a rule link scrolls that rule into view', async ({ page }) => {
    const calendar = 'mscp.os_calendar_app_disable'
    const familyControls = 'mscp.os_calendar_app_disable_familycontrols'
    await serveMappings(page, {
      'calendar.json': {
        schema_version: 1,
        id: 'calendar',
        links: [{ relation: 'related', from: [ruleEndpoint(familyControls, MSCP_RELEASE)], to: [ruleEndpoint(calendar, MSCP_RELEASE)] }],
      },
    })
    await page.setViewportSize({ width: 1280, height: 500 })
    await openLibrary(page, `/?q=os_calendar_app_disable&rule=${calendar}`)
    await expect(detailOf(page, calendar)).toBeVisible()

    await openMappedRules(page, calendar)
    await groupButton(page, calendar, 'NIST mSCP Related (1)').click()
    const familyControlsMappedRow = mappedRulesPanel(page, calendar).getByTestId('mapped-rule')
    await familyControlsMappedRow.getByRole('button', { name: /os_calendar_app_disable_familycontrols/ }).click()
    await familyControlsMappedRow.getByRole('link', { name: 'Go to this rule' }).click()
    const calendarRow = page.locator(`[data-rule-id="${calendar}"]`)
    await expect(page.locator(`[data-rule-id="${familyControls}"]`)).toBeInViewport()
    await expect(calendarRow).not.toBeInViewport()

    await page.goBack()
    expect(new URL(page.url()).searchParams.get('rule')).toBe(calendar)
    await expect(calendarRow).toBeInViewport()
  })

  test('a broken mapping index is a warning and the app still loads', async ({ page }) => {
    await page.route('**/baselines/_mappings/_index.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{ broken' }))
    await openLibrary(page)

    await expect(ruleCount(page)).toHaveText('1493 of 1493 rules')
    await expect(page.getByRole('status', { name: 'Mapping problems' })).toContainText('Rule mappings could not be loaded')
    const row = await searchForSingleRow(page, 'ism-1622', ISM_1622_TITLE)
    await row.getByRole('button').click()
    await expect(detailOf(page, ISM_1622).getByRole('heading', { name: 'Benchmarks' })).toBeVisible()
    await expect(detailOf(page, ISM_1622).getByRole('tablist')).toHaveCount(0)
  })

  test('with no mappings the details show no tab strip', async ({ page }) => {
    await serveMappings(page, {})
    await openLibrary(page)
    const row = await searchForSingleRow(page, 'ism-1622', ISM_1622_TITLE)
    await row.getByRole('button').click()

    await expect(detailOf(page, ISM_1622).getByRole('heading', { name: 'Benchmarks' })).toBeVisible()
    await expect(detailOf(page, ISM_1622).getByRole('tablist')).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'Mapping problems' })).toHaveCount(0)
  })
})

test('the Views navigation shows Rules as the current page', async ({ page }) => {
  await page.goto('/')

  const views = page.getByRole('navigation', { name: 'Views' })
  const rulesTab = views.getByRole('link', { name: 'Rules' })
  await expect(rulesTab).toHaveAttribute('aria-current', 'page')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })

  await page.getByPlaceholder('Search title or id…').fill('gatekeeper')
  await rulesTab.click()
  await expect(page.getByPlaceholder('Search title or id…')).toHaveValue('gatekeeper')
  await expect(page).toHaveURL(/\/rules\?q=gatekeeper/)
})

test('a bare base address shows Rules and its address says so', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/rules$/)
})

test('an unknown view in the URL opens Rules and is replaced in the URL', async ({ page }) => {
  await page.goto('/unknown?q=gatekeeper')

  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Rules' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByPlaceholder('Search title or id…')).toHaveValue('gatekeeper')
  await page.getByPlaceholder('Search title or id…').fill('gatekeeper enable')
  await expect(page).toHaveURL(/\/rules\?q=gatekeeper/)
})
