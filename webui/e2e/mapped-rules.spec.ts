import { readdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { buildMappingIndex } from '../src/logic/mappingIndex'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as {
  sources: { name: string; release_tag: string }[]
}
const currentReleaseOf = (sourceName: string) => manifest.sources.find((source) => source.name === sourceName)?.release_tag ?? ''
const MSCP_RELEASE = currentReleaseOf('mscp')
const ISM_RELEASE = currentReleaseOf('asd_ism')
const E4EIT_RELEASE = currentReleaseOf('asd_e4eit')

const GATEKEEPER = 'mscp.system_settings_gatekeeper_override_disallow'
const SUPPORTED_CONTROL = 'asd_ism.ism-1584'
const OTHER_SUPPORTED_CONTROL = 'asd_ism.ism-0864'
const RELATED_ACTION = 'asd_e4eit.it.pro-12.2'
const EMPTY_CATALOG_INDEX = { schema_version: 1, vendors: [], products: [], licences: [], by_product: {} }

const endpoint = (id: string, release: string) => ({ kind: 'rule', id, release })
const chainMappingFiles = [
  {
    fileName: 'gatekeeper-to-ism.json',
    value: {
      schema_version: 1,
      id: 'gatekeeper-to-ism',
      links: [
        {
          relation: 'supports',
          from: [endpoint(GATEKEEPER, MSCP_RELEASE)],
          to: [endpoint(SUPPORTED_CONTROL, ISM_RELEASE), endpoint(OTHER_SUPPORTED_CONTROL, ISM_RELEASE)],
        },
      ],
    },
  },
  {
    fileName: 'ism-to-action.json',
    value: {
      schema_version: 1,
      id: 'ism-to-action',
      generated_by: 'python tools/example_generator.py',
      links: [
        {
          relation: 'related',
          from: [endpoint(RELATED_ACTION, E4EIT_RELEASE)],
          to: [endpoint(SUPPORTED_CONTROL, ISM_RELEASE)],
          note: 'ASD lists these as intersecting.',
        },
      ],
    },
  },
]

const mappingsFolder = new URL('../../baselines/_mappings/rules/', import.meta.url)
const committedMappingFiles = readdirSync(mappingsFolder)
  .filter((fileName) => fileName.endsWith('.json'))
  .sort()
  .map((fileName) => ({ fileName, value: JSON.parse(readFileSync(new URL(fileName, mappingsFolder), 'utf8')) as unknown }))

const detailOf = (page: Page, ruleId: string) => page.locator(`[id="rule-detail-${ruleId}"]`)
const mappedRulesPanel = (page: Page, ruleId: string) => detailOf(page, ruleId).getByRole('tabpanel', { name: /^Mapped rules/ })

async function openMappedRules(page: Page, files: { fileName: string; value: unknown }[], ruleId: string, search: string) {
  const mappingIndex = buildMappingIndex(files, () => {})
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mappingIndex) }),
  )
  await page.route('**/catalog/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_CATALOG_INDEX) }),
  )
  await page.goto(`/?q=${search}&rule=${ruleId}`)
  await detailOf(page, ruleId).getByRole('tab', { name: /^Mapped rules/ }).click()
  await expect(mappedRulesPanel(page, ruleId)).toBeVisible()
}

test.describe('indirect mapped rules on a routed fixture index', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('direct groups come first, then an indirect part with a block per path and its group', async ({ page }) => {
    await openMappedRules(page, chainMappingFiles, GATEKEEPER, 'system_settings_gatekeeper_override_disallow')
    const panel = mappedRulesPanel(page, GATEKEEPER)

    await expect(panel.getByRole('heading', { name: 'Direct mapped rules (2)' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Indirect mapped rules (1)' })).toBeVisible()
    const throughHeading = panel.getByRole('heading', { name: 'Through ASD ISM ISM-1584 (this rule supports it)' })
    await expect(throughHeading).toBeVisible()

    const headingTexts = await panel.getByRole('heading').allTextContents()
    expect(headingTexts.findIndex((text) => text.startsWith('Direct mapped rules'))).toBeLessThan(
      headingTexts.findIndex((text) => text.startsWith('Indirect mapped rules')),
    )

    const indirectGroup = panel.getByRole('button', { name: 'Related, indirectly ASD E4EIT (1)' })
    await expect(indirectGroup).toHaveAttribute('aria-expanded', 'false')
    await indirectGroup.click()
    await expect(indirectGroup).toHaveAttribute('aria-expanded', 'true')
    await expect(indirectGroup).toBeFocused()
    await expect(panel.getByText('This rule is indirectly related to each rule below. Through ISM-1584.')).toBeVisible()
    const indirectList = panel.getByRole('list', { name: 'Related, indirectly, through ISM-1584: ASD E4EIT' })
    await expect(indirectList.getByTestId('mapped-rule')).toContainText('it.pro-12.2')
  })

  test('How this is linked toggles with aria-expanded, keeps focus and lists each hop with its provenance', async ({ page }) => {
    await openMappedRules(page, chainMappingFiles, GATEKEEPER, 'system_settings_gatekeeper_override_disallow')
    const panel = mappedRulesPanel(page, GATEKEEPER)
    await panel.getByRole('button', { name: 'Related, indirectly ASD E4EIT (1)' }).click()

    const toggle = panel.getByRole('button', { name: 'How this is linked' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toBeFocused()

    const hops = panel.getByRole('list', { name: 'Links on the way to this rule' })
    await expect(hops.getByRole('listitem')).toHaveCount(2)
    await expect(hops.getByRole('listitem').nth(0)).toContainText('NIST mSCP system_settings_gatekeeper_override_disallow supports ASD ISM ism-1584')
    await expect(hops.getByRole('listitem').nth(0)).toContainText('gatekeeper-to-ism')
    await expect(hops.getByRole('listitem').nth(0).getByText('Hand-written', { exact: true })).toBeVisible()
    await expect(hops.getByRole('listitem').nth(1)).toContainText('ASD ISM ism-1584 is related to ASD E4EIT it.pro-12.2')
    await expect(hops.getByRole('listitem').nth(1).getByText('Generated', { exact: true })).toBeVisible()

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()
    await expect(hops).toHaveCount(0)
  })

  test('a rule with no indirect rules shows no part headings', async ({ page }) => {
    await openMappedRules(page, chainMappingFiles, OTHER_SUPPORTED_CONTROL, 'ism-0864')
    const panel = mappedRulesPanel(page, OTHER_SUPPORTED_CONTROL)
    await expect(panel.getByRole('button', { name: /^Supported by NIST mSCP \(1\)$/ })).toBeVisible()
    await expect(panel.getByRole('heading', { name: /mapped rules/i })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /indirectly/ })).toHaveCount(0)
  })

  test('the text filter narrows indirect rows and opens their group', async ({ page }) => {
    await openMappedRules(page, chainMappingFiles, GATEKEEPER, 'system_settings_gatekeeper_override_disallow')
    const panel = mappedRulesPanel(page, GATEKEEPER)
    const filter = panel.getByRole('textbox', { name: 'Filter mapped rules' })

    await filter.fill('pro-12.2')
    await expect(panel.getByRole('button', { name: 'Related, indirectly ASD E4EIT (1 of 1)' })).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getByRole('heading', { name: 'Direct mapped rules (2)' })).toHaveCount(0)

    await filter.fill('no-such-rule')
    await expect(panel.getByText('No mapped rules match these filters.')).toBeVisible()
    await expect(panel.getByRole('heading', { name: /Indirect mapped rules/ })).toHaveCount(0)
  })
})

test.describe('indirect mapped rules from the committed mapping files', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('each rule an E4EIT action reaches through ISM controls is listed once, with an Also through line', async ({ page }) => {
    const action = 'asd_e4eit.it.det-01.1'
    await openMappedRules(page, committedMappingFiles, action, 'it.det-01.1')
    const panel = mappedRulesPanel(page, action)
    await expect(panel.getByRole('heading', { name: /^Indirect mapped rules \(\d+\)$/ })).toBeVisible()

    for (const group of await panel.getByRole('button', { name: /, indirectly .* \(\d+\)$/ }).all()) await group.click()
    const indirectRuleIds = await panel.getByTestId('mapped-rule').locator('p.font-mono').allTextContents()
    expect(new Set(indirectRuleIds).size).toBe(indirectRuleIds.length)
    expect(indirectRuleIds.length).toBeGreaterThan(0)
    await expect(panel.getByText(/^Also through ism-\d+/).first()).toBeVisible()
  })
})
