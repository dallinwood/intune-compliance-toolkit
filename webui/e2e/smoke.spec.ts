import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'

const ruleCount = (page: Page) => page.getByText(/^\d+ of \d+ rules$/)

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
  await mscpRow.getByRole('button').click()

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

test('the attribution footer names no platform', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('1493 of 1493 rules', { timeout: 10_000 })
  const footer = page.getByRole('contentinfo')
  await expect(footer).toContainText('Rules from the ASD Information Security Manual')
  await expect(footer).toContainText('Rules from the NIST macOS Security Compliance Project')
  await expect(footer).not.toContainText('macOS rules')
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
  await expect(page.getByText('$ODV stands for the organization-defined value, currently 6.').first()).toBeVisible()
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
    await expect(noneLabel).toHaveClass(/(^|\s)italic(\s|$)/)
    await expect(noneLabel).toHaveClass(/text-slate-500/)
  }
  await expect(page.getByRole('group', { name: 'Source', exact: true }).locator('label.italic')).toHaveCount(0)
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
    await openLibrary(page, '/?size=200')
    await page.getByRole('checkbox', { name: 'Auditing', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Guidelines for email', exact: true }).click()
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
    await openLibrary(page, '/?size=200')
    await page.getByRole('checkbox', { name: 'Auditing', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Guidelines for email', exact: true }).click()
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

  test('the ism-1667 details list its benchmarks under None in a Benchmarks section', async ({ page }) => {
    await page.goto('/')
    const row = await searchForSingleRow(page, 'ism-1667', /./)
    await row.getByRole('button').click()
    const items = benchmarkList(page, 'None').getByRole('listitem')
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
