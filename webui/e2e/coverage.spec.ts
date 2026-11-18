import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { buildMappingIndex } from '../src/logic/mappingIndex'

const ISM_COVERAGE_PATH = '/frameworks?framework=asd_ism&tab=coverage'
const MSCP_COVERAGE_PATH = '/frameworks?framework=mscp&tab=coverage'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as {
  sources: { name: string; release_tag: string }[]
}
const currentReleaseOf = (sourceName: string) => manifest.sources.find((source) => source.name === sourceName)?.release_tag ?? ''
const ISM_RELEASE = currentReleaseOf('asd_ism')
const MSCP_RELEASE = currentReleaseOf('mscp')

// Written by `bun run dev` (copy-baselines), like the indexes the app fetches.
const ismIndex = JSON.parse(
  readFileSync(new URL(`../public/baselines/asd_ism/releases/${ISM_RELEASE}/_index.json`, import.meta.url), 'utf8'),
) as { rules: { id: string; applicability: { benchmarks: { name: string }[] }[] }[] }
const ismControlCount = ismIndex.rules.length
const ismProtectedControlCount = ismIndex.rules.filter((rule) =>
  rule.applicability.some((entry) => entry.benchmarks.some((benchmark) => benchmark.name === 'ism_protected')),
).length

const AUTOMATED_SUPPORTER = 'mscp.os_gatekeeper_enable'
const MANUAL_SUPPORTER = 'mscp.os_error_message'
const SELECTED_WITHOUT_LINKS = 'mscp.os_directory_services_configured'
const MEDIA_CONTROL = 'asd_ism.ism-0459'
const HARDENING_CONTROL = 'asd_ism.ism-1622'
const RELATED_CONTROL = 'asd_ism.ism-1621'
const AUTOMATED_NOTE = 'Gatekeeper covers the media control.'
const MANUAL_NOTE = 'Reviewer checks the error message by hand.'
const RELATED_NOTE = 'Only loosely related.'
const SUPPORTS_MAPPING_ID = 'media-and-hardening'
const RELATED_MAPPING_ID = 'loose-relation'

const endpoint = (id: string, release: string) => ({ kind: 'rule', id, release })
const mappingFiles = [
  {
    fileName: `${SUPPORTS_MAPPING_ID}.json`,
    value: {
      schema_version: 1,
      id: SUPPORTS_MAPPING_ID,
      links: [
        {
          relation: 'supports',
          from: [endpoint(AUTOMATED_SUPPORTER, MSCP_RELEASE)],
          to: [endpoint(MEDIA_CONTROL, ISM_RELEASE)],
          note: AUTOMATED_NOTE,
        },
        {
          relation: 'supports',
          from: [endpoint(MANUAL_SUPPORTER, MSCP_RELEASE)],
          to: [endpoint(MEDIA_CONTROL, ISM_RELEASE)],
          note: MANUAL_NOTE,
        },
        {
          relation: 'supports',
          from: [endpoint(AUTOMATED_SUPPORTER, MSCP_RELEASE)],
          to: [endpoint(HARDENING_CONTROL, ISM_RELEASE)],
        },
      ],
    },
  },
  {
    fileName: `${RELATED_MAPPING_ID}.json`,
    value: {
      schema_version: 1,
      id: RELATED_MAPPING_ID,
      generated_by: 'python tools/example_generator.py',
      links: [
        {
          relation: 'related',
          from: [endpoint(MANUAL_SUPPORTER, MSCP_RELEASE)],
          to: [endpoint(RELATED_CONTROL, ISM_RELEASE)],
          note: RELATED_NOTE,
        },
      ],
    },
  },
]

const report = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true })
const SUPPORTED_BY_MSCP = 'Supported by NIST mSCP'
const formattedIsmControlCount = ismControlCount.toLocaleString('en-US')

function seedSelection(page: Page, selectedRuleIds: string[]) {
  return page.addInitScript((ruleIds) => {
    const selections = Object.fromEntries(
      ruleIds.map((ruleId) => {
        const source = ruleId.slice(0, ruleId.indexOf('.'))
        const ref = { id: ruleId, path: `${source}/rules/${ruleId.slice(ruleId.indexOf('.') + 1)}.json` }
        return [ruleId, { ref, enabled: true, odvValue: null }]
      }),
    )
    window.localStorage.setItem('intune-toolkit:selections', JSON.stringify({ state: { selections }, version: 2 }))
  }, selectedRuleIds)
}

test.describe('with the library mappings', () => {
  const AUDIT_RULE = 'mscp.audit_auditd_enabled'

  test('ASD ISM lists the mSCP report and the E4EIT note, without a combined report', async ({ page }) => {
    await page.goto(ISM_COVERAGE_PATH)
    await expect(page.getByRole('navigation', { name: 'Page tabs' }).getByRole('link', { name: 'Coverage' })).toHaveAttribute('aria-current', 'page')
    await expect(report(page, SUPPORTED_BY_MSCP)).toContainText('max 61')
    await expect(report(page, SUPPORTED_BY_MSCP)).toContainText('Within reach of NIST mSCP - 61 controls')
    const relatedNote = report(page, 'Related to ASD E4EIT')
    await expect(relatedNote).toContainText('related only')
    await expect(relatedNote).toContainText('Linked as related, not counted as coverage.')
    await expect(relatedNote).not.toContainText('max')
    await expect(report(page, 'All mapped frameworks')).toHaveCount(0)
  })

  test('mSCP lists one report per framework it supports and no combined report', async ({ page }) => {
    await page.goto(MSCP_COVERAGE_PATH)
    await expect(report(page, 'Supports NIST SP 800-53')).toContainText('max 140')
    await expect(report(page, 'Supports ASD ISM')).toContainText('max 61')
    await expect(page.getByTestId('pair-coverage-report')).toHaveCount(2)
    await expect(report(page, 'All mapped frameworks')).toHaveCount(0)
  })

  test('selecting an mSCP rule raises its pair selection', async ({ page }) => {
    await page.goto(MSCP_COVERAGE_PATH)
    const nistReport = report(page, 'Supports NIST SP 800-53')
    await expect(nistReport).toContainText('0 direct · 0 through supporting checks')

    await seedSelection(page, [AUDIT_RULE])
    await page.reload()
    await expect(nistReport).toContainText('max 140')
    await expect(nistReport).not.toContainText('0 direct · 0 through supporting checks')
    await expect(nistReport).toContainText(/[1-9]\d* direct · \d+ through supporting checks/)
  })

  test('All rules shows the cap in both bars', async ({ page }) => {
    await page.goto(MSCP_COVERAGE_PATH)
    const nistReport = report(page, 'Supports NIST SP 800-53')
    await expect(nistReport.getByRole('button', { name: 'Your selection' })).toHaveAttribute('aria-pressed', 'true')
    await nistReport.getByRole('button', { name: 'All rules' }).click()
    await expect(nistReport.getByRole('button', { name: 'All rules' })).toHaveAttribute('aria-pressed', 'true')
    await expect(nistReport).toContainText('100% of the cap')
    await expect(nistReport).toContainText('0 still to go')
    await expect(nistReport).toContainText('140 supported')
  })
})

test.describe('with fixture mappings', () => {
  test.beforeEach(async ({ page }) => {
    const mappingIndex = buildMappingIndex(mappingFiles, () => {})
    await page.route('**/baselines/_mappings/_index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mappingIndex) }),
    )
    await seedSelection(page, [AUTOMATED_SUPPORTER, MANUAL_SUPPORTER, SELECTED_WITHOUT_LINKS])
    await page.goto(ISM_COVERAGE_PATH)
  })

  const ismReport = (page: Page) => report(page, SUPPORTED_BY_MSCP)
  const mediaSection = (page: Page) => page.getByTestId('coverage-section').filter({ hasText: 'Guidelines for media' })

  async function openMediaControl(page: Page) {
    await mediaSection(page).getByRole('button', { name: /Guidelines for media/ }).click()
    await mediaSection(page).getByTestId('coverage-control').filter({ hasText: 'ism-0459' }).getByRole('button').click()
  }

  test('the report names supported, related and cap counts', async ({ page }) => {
    await expect(ismReport(page)).toContainText(`Whole framework - ${formattedIsmControlCount} controls`)
    await expect(ismReport(page)).toContainText('2 supported · 1 related only')
    await expect(
      ismReport(page).getByRole('img', { name: `2 of ${formattedIsmControlCount} supported, 1 related only, max 2 with current mappings` }),
    ).toBeVisible()
    await expect(ismReport(page)).toContainText('100% of the cap')
    await expect(report(page, 'All mapped frameworks')).toHaveCount(0)
  })

  test('scope narrows the denominator', async ({ page }) => {
    await ismReport(page).getByLabel('Scope').selectOption({ label: 'ISM PROTECTED' })
    await expect(ismReport(page)).toContainText(`Whole framework - ${ismProtectedControlCount.toLocaleString('en-US')} controls at ISM PROTECTED`)
  })

  test('a section expands to controls and a control to its provenance', async ({ page }) => {
    await expect(mediaSection(page).getByRole('button', { name: /Guidelines for media/ })).toHaveAttribute('aria-expanded', 'false')
    await openMediaControl(page)
    await expect(page.getByText(AUTOMATED_NOTE)).toBeVisible()
    await expect(page.getByText(SUPPORTS_MAPPING_ID).first()).toBeVisible()
    await expect(page.getByText('Hand-written', { exact: true }).first()).toBeVisible()
  })

  test('the uncovered controls toggle keeps focus, reports aria-expanded and hides the list again', async ({ page }) => {
    const section = mediaSection(page)
    await section.getByRole('button', { name: /Guidelines for media/ }).click()
    const toggle = section.getByRole('button', { name: /^Show \d+ uncovered$/ })
    const uncoveredRows = section.getByTestId('coverage-control')
    const reachedRowCount = await uncoveredRows.count()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    const hideToggle = section.getByRole('button', { name: 'Hide uncovered' })
    await expect(hideToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(hideToggle).toBeFocused()
    expect(await uncoveredRows.count()).toBeGreaterThan(reachedRowCount)
    await hideToggle.click()
    await expect(section.getByRole('button', { name: /^Show \d+ uncovered$/ })).toHaveAttribute('aria-expanded', 'false')
    await expect(uncoveredRows).toHaveCount(reachedRowCount)
  })

  test('related links show as related only and are not counted', async ({ page }) => {
    const hardeningSection = page.getByTestId('coverage-section').filter({ hasText: 'Guidelines for system hardening' })
    await hardeningSection.getByRole('button', { name: /Guidelines for system hardening/ }).click()
    const relatedControl = hardeningSection.getByTestId('coverage-control').filter({ hasText: 'ism-1621' })
    await expect(relatedControl).toContainText('Related only')
    await relatedControl.getByRole('button').click()
    await expect(relatedControl.getByText('Related (not counted)')).toBeVisible()
    await expect(relatedControl.getByText(RELATED_NOTE)).toBeVisible()
    await expect(relatedControl.getByText(RELATED_MAPPING_ID)).toBeVisible()
    await expect(relatedControl.getByText('Generated', { exact: true })).toBeVisible()
  })

  test('lists selected rules that support no control', async ({ page }) => {
    await expect(page.getByText('1 selected rule supports no control')).toBeVisible()
    await page.getByRole('button', { name: 'Show the list' }).click()
    const list = page.getByRole('list', { name: 'Selected rules that support no control' })
    await expect(list).toContainText(SELECTED_WITHOUT_LINKS.slice('mscp.'.length))
  })

  test('automated checks only drops a manual supporter from the selection and the cap', async ({ page }) => {
    await openMediaControl(page)
    await expect(page.getByText(MANUAL_NOTE)).toBeVisible()
    await page.getByRole('checkbox', { name: 'Automated checks only' }).click()
    await expect(page.getByText(MANUAL_NOTE)).toHaveCount(0)
    await expect(page.getByText(AUTOMATED_NOTE)).toBeVisible()
    await expect(ismReport(page)).toContainText('2 supported')
    await expect(ismReport(page)).not.toContainText('related only')
  })
})

// Selected: the gatekeeper check and the manual error message rule. The gatekeeper check supports the
// media control (direct), and the media control supports another hardening control (so that one is
// covered two hops from a selected rule). The password length check supports the manual rule (so it
// is offered as a supporting check) and the hardening control (which it covers only once added).
const SUPPORTING_MAPPING_ID = 'supporting-coverage'
const CHAINED_CONTROL = 'asd_ism.ism-1621'
const SUPPORTING_CHECK = 'mscp.pwpolicy_minimum_length_enforce'

test.describe('coverage through supporting rules', () => {
  const upstreamOf = (ruleId: string) => ruleId.slice(ruleId.indexOf('.') + 1)
  const ismReport = (page: Page) => report(page, SUPPORTED_BY_MSCP)

  test.beforeEach(async ({ page }) => {
    const mappingIndex = buildMappingIndex(
      [
        {
          fileName: `${SUPPORTING_MAPPING_ID}.json`,
          value: {
            schema_version: 1,
            id: SUPPORTING_MAPPING_ID,
            links: [
              { relation: 'supports', from: [endpoint(AUTOMATED_SUPPORTER, MSCP_RELEASE)], to: [endpoint(MEDIA_CONTROL, ISM_RELEASE)] },
              { relation: 'supports', from: [endpoint(MEDIA_CONTROL, ISM_RELEASE)], to: [endpoint(CHAINED_CONTROL, ISM_RELEASE)] },
              { relation: 'supports', from: [endpoint(SUPPORTING_CHECK, MSCP_RELEASE)], to: [endpoint(MANUAL_SUPPORTER, MSCP_RELEASE)] },
              { relation: 'supports', from: [endpoint(SUPPORTING_CHECK, MSCP_RELEASE)], to: [endpoint(HARDENING_CONTROL, ISM_RELEASE)] },
            ],
          },
        },
      ],
      () => {},
    )
    await page.route('**/baselines/_mappings/_index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mappingIndex) }),
    )
    await page.addInitScript(
      ({ selectedRuleIds, seededKey }) => {
        if (window.localStorage.getItem(seededKey) !== null) return
        window.localStorage.setItem(seededKey, '1')
        const selections = Object.fromEntries(
          selectedRuleIds.map((ruleId) => {
            const ref = { id: ruleId, path: `mscp/rules/${ruleId.slice('mscp.'.length)}.json` }
            return [ruleId, { ref, enabled: true, odvValue: null }]
          }),
        )
        window.localStorage.setItem('intune-toolkit:selections', JSON.stringify({ state: { selections }, version: 2 }))
        window.localStorage.removeItem('intune-toolkit:supporting-checks')
      },
      { selectedRuleIds: [AUTOMATED_SUPPORTER, MANUAL_SUPPORTER], seededKey: 'intune-toolkit:supporting-coverage-seeded' },
    )
    await page.goto(ISM_COVERAGE_PATH)
    await expect(ismReport(page)).toBeVisible({ timeout: 15_000 })
  })

  test('the bars name direct and through counts, and the add button flips the shared toggle and the numbers', async ({ page }) => {
    await expect(
      ismReport(page).getByRole('img', {
        name: `1 supported directly, 1 through supporting rules, 0 related only, of ${formattedIsmControlCount}, max 3 with current mappings`,
      }),
    ).toBeVisible()
    await expect(ismReport(page)).toContainText('1 direct · 1 through supporting checks')
    await expect(ismReport(page)).toContainText('1 still to go')
    await expect(ismReport(page)).toContainText('+1 more through supporting checks you have not added.')

    await ismReport(page).getByRole('button', { name: 'Add supporting checks to the bundle' }).click()

    await expect(ismReport(page)).toContainText('1 direct · 2 through supporting checks')
    await expect(ismReport(page)).toContainText('100% of the cap')
    await expect(ismReport(page)).not.toContainText('you have not added')
    await expect(ismReport(page).getByRole('button', { name: 'Add supporting checks to the bundle' })).toHaveCount(0)
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('intune-toolkit:supporting-checks') ?? '{}').state)
    expect(stored.includeSupporting).toBe(true)
  })

  test('a control covered through supporting rules shows its chain, with the supporting check marked once added', async ({ page }) => {
    const hardeningSection = page.getByTestId('coverage-section').filter({ hasText: 'Guidelines for system hardening' })
    await expect(hardeningSection).toContainText('0 + 1 of')
    await hardeningSection.getByRole('button', { name: /Guidelines for system hardening/ }).click()

    const chained = hardeningSection.getByTestId('coverage-control').filter({ hasText: upstreamOf(CHAINED_CONTROL) })
    await expect(chained).toContainText('Through supporting rules')
    await chained.getByRole('button').click()
    await expect(chained.getByText('Through', { exact: true })).toBeVisible()
    await expect(chained).toContainText(`${upstreamOf(AUTOMATED_SUPPORTER)} -> supports ${upstreamOf(MEDIA_CONTROL)} -> supports ${upstreamOf(CHAINED_CONTROL)}`)
    await expect(chained).not.toContainText('(supporting check)')
    await expect(chained.getByText(SUPPORTING_MAPPING_ID).first()).toBeVisible()

    await ismReport(page).getByRole('button', { name: 'Add supporting checks to the bundle' }).click()
    const supported = hardeningSection.getByTestId('coverage-control').filter({ hasText: upstreamOf(HARDENING_CONTROL) })
    await expect(supported).toContainText('Through supporting rules')
    await supported.getByRole('button').click()
    await expect(supported).toContainText(`${upstreamOf(SUPPORTING_CHECK)} (supporting check) -> supports ${upstreamOf(HARDENING_CONTROL)}`)
  })
})

const NIST_RELEASE = currentReleaseOf('nist_800_53')

test.describe('with two frameworks supporting the same framework', () => {
  test('ASD ISM shows the combined report', async ({ page }) => {
    const mappingIndex = buildMappingIndex(
      [
        {
          fileName: 'two-supporters.json',
          value: {
            schema_version: 1,
            id: 'two-supporters',
            links: [
              { relation: 'supports', from: [endpoint(AUTOMATED_SUPPORTER, MSCP_RELEASE)], to: [endpoint(MEDIA_CONTROL, ISM_RELEASE)] },
              { relation: 'supports', from: [endpoint('nist_800_53.ac-1', NIST_RELEASE)], to: [endpoint(HARDENING_CONTROL, ISM_RELEASE)] },
            ],
          },
        },
      ],
      () => {},
    )
    await page.route('**/baselines/_mappings/_index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mappingIndex) }),
    )
    await page.goto(ISM_COVERAGE_PATH)

    await expect(report(page, SUPPORTED_BY_MSCP)).toBeVisible({ timeout: 15_000 })
    await expect(report(page, 'All mapped frameworks')).toBeVisible()
  })
})
