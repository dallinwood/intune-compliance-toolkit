import { readdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { Manifest } from '../src/types/library'

const baselinesFolder = new URL('../../baselines/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('_manifest.json', baselinesFolder), 'utf8')) as Manifest

interface IndexRule {
  id: string
  title: string
  assessment: { status: 'automated' | 'manual'; manual_reason: string | null }
  applicability: { target: string | null }[]
}

const rulesById = new Map<string, IndexRule>()
for (const source of manifest.sources) {
  const index = JSON.parse(readFileSync(new URL(source.index_path, baselinesFolder), 'utf8')) as { rules: IndexRule[] }
  for (const rule of index.rules) rulesById.set(rule.id, rule)
}

const linkedIdsByRule = new Map<string, Set<string>>()
function addLink(ruleId: string, linkedId: string) {
  if (!linkedIdsByRule.has(ruleId)) linkedIdsByRule.set(ruleId, new Set())
  linkedIdsByRule.get(ruleId)!.add(linkedId)
}
const mappingsFolder = new URL('_mappings/rules/', baselinesFolder)
for (const fileName of readdirSync(mappingsFolder).filter((name) => name.endsWith('.json'))) {
  const file = JSON.parse(readFileSync(new URL(fileName, mappingsFolder), 'utf8')) as { links: { from: { id: string }[]; to: { id: string }[] }[] }
  for (const link of file.links) {
    for (const fromEndpoint of link.from) {
      for (const toEndpoint of link.to) {
        addLink(fromEndpoint.id, toEndpoint.id)
        addLink(toEndpoint.id, fromEndpoint.id)
      }
    }
  }
}

function linkCountsOf(ruleId: string) {
  const counts = { automated: 0, manual: 0 }
  for (const linkedId of linkedIdsByRule.get(ruleId) ?? []) {
    const linked = rulesById.get(linkedId)
    if (linked && linkedId !== ruleId) counts[linked.assessment.status] += 1
  }
  return counts
}

const hasNoTarget = (rule: IndexRule) => rule.applicability.every((entry) => entry.target === null)
const upstreamIdOf = (ruleId: string) => ruleId.slice(ruleId.indexOf('.') + 1)

const allRules = [...rulesById.values()]
const automatedMacosRule = allRules.find((rule) => rule.id.startsWith('mscp.') && rule.assessment.status === 'automated' && linkedIdsByRule.has(rule.id))!
const linkedControl = allRules.find((rule) => {
  const counts = linkCountsOf(rule.id)
  return rule.id.startsWith('asd_ism.') && hasNoTarget(rule) && rule.assessment.status === 'manual' && counts.automated > 1 && counts.manual > 1
})!
const unlinkedManualControl = allRules.find(
  (rule) => rule.id.startsWith('asd_ism.') && hasNoTarget(rule) && rule.assessment.manual_reason !== null && !linkedIdsByRule.has(rule.id),
)!

async function rowFor(page: Page, rule: IndexRule) {
  await page.goto('/')
  await page.getByPlaceholder('Search title or id…').fill(upstreamIdOf(rule.id))
  const row = page.locator(`table tbody tr[data-rule-id="${rule.id}"]`)
  await expect(row).toHaveCount(1)
  return row
}

const countWord = (count: number) => (count === 1 ? 'rule' : 'rules')

test('an automated mSCP rule shows a macOS icon named "macOS: automated check" and no pill text', async ({ page }) => {
  const row = await rowFor(page, automatedMacosRule)
  const cell = row.locator('td').nth(3)
  await expect(cell.getByRole('img', { name: 'macOS: automated check', exact: true })).toBeVisible()
  await expect(cell.getByText(/Automated|Manual/)).toHaveCount(0)
})

test('an ISM control with no platform shows a clipboard icon named "No platform: manual - <reason>"', async ({ page }) => {
  const row = await rowFor(page, unlinkedManualControl)
  const icon = row.locator('td').nth(3).getByRole('img', { name: /^No platform: manual - / })
  await expect(icon).toHaveCount(1)
  await expect(icon).toBeVisible()
})

test('a linked ISM control shows link icons whose names give the automated and manual counts from the mapping files', async ({ page }) => {
  const counts = linkCountsOf(linkedControl.id)
  const row = await rowFor(page, linkedControl)
  const cell = row.locator('td').nth(3)
  await expect(cell.getByRole('img', { name: `Linked to ${counts.automated} automated ${countWord(counts.automated)}`, exact: true })).toBeVisible()
  await expect(cell.getByRole('img', { name: `Linked to ${counts.manual} manual ${countWord(counts.manual)}`, exact: true })).toBeVisible()
})

test('a rule with no links shows no link icon', async ({ page }) => {
  const row = await rowFor(page, unlinkedManualControl)
  await expect(row.getByRole('img', { name: /^Linked to / })).toHaveCount(0)
})

test('hovering an icon shows its tooltip; focusing the strip shows every line', async ({ page }) => {
  const counts = linkCountsOf(linkedControl.id)
  const row = await rowFor(page, linkedControl)
  const cell = row.locator('td').nth(3)
  const automatedLabel = `Linked to ${counts.automated} automated ${countWord(counts.automated)}`

  await cell.getByRole('img', { name: automatedLabel, exact: true }).hover()
  await expect(page.getByRole('tooltip', { name: automatedLabel })).toBeVisible()

  await page.mouse.move(0, 0)
  await cell.getByRole('group').focus()
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'No platform: manual' })
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText(automatedLabel)
  await expect(tooltip).toContainText(`Linked to ${counts.manual} manual ${countWord(counts.manual)}`)
})

test('the legend lists the five meanings', async ({ page }) => {
  await page.goto('/')
  const legend = page.getByTestId('rule-status-legend')
  for (const text of ['automated check', 'manual', 'no platform', 'linked to automated rules', 'linked to manual rules']) {
    await expect(legend).toContainText(text)
  }
})
