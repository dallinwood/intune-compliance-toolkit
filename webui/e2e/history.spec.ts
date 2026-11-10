import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { changeCount, ruleTimeline, type HistoryIndex } from '../src/logic/historyIndex'

// Written by `bun run dev` (copy-baselines) next to the other published indexes.
function readHistory(sourceName: string): HistoryIndex {
  return JSON.parse(readFileSync(new URL(`../public/baselines/_history/${sourceName}.json`, import.meta.url), 'utf8')) as HistoryIndex
}

const ismHistory = readHistory('asd_ism')
const mscpHistory = readHistory('mscp')

// A real ISM control whose content changed between editions, and a real mSCP
// rule that is in both releases and did not change.
const CHANGED_ISM_RULE = Object.keys(ismHistory.rules).find((ruleId) => changeCount(ruleTimeline(ismHistory, ruleId)) > 0) ?? ''
const UNCHANGED_MSCP_RULE =
  Object.keys(mscpHistory.rules).find((ruleId) => {
    const timeline = ruleTimeline(mscpHistory, ruleId)
    return timeline.length === mscpHistory.releases.length && changeCount(timeline) === 0 && timeline.every((entry) => entry.state !== 'absent')
  }) ?? ''

const detailOf = (page: Page, ruleId: string) => page.locator(`[id="rule-detail-${ruleId}"]`)
const historyTab = (page: Page, ruleId: string) => detailOf(page, ruleId).getByRole('tab', { name: /^History/ })
const historyPanel = (page: Page, ruleId: string) => detailOf(page, ruleId).getByRole('tabpanel', { name: /^History/ })
const cards = (panel: Locator) => panel.getByTestId('history-card')

async function openRule(page: Page, ruleId: string) {
  await page.goto(`/?q=${encodeURIComponent(ruleId.split('.')[1])}&rule=${ruleId}`)
  await expect(historyTab(page, ruleId)).toBeVisible({ timeout: 15_000 })
}

test('the data has a changed ISM control and an unchanged mSCP rule to look at', () => {
  expect(CHANGED_ISM_RULE).not.toBe('')
  expect(UNCHANGED_MSCP_RULE).not.toBe('')
})

test('a rule that changed has a History tab counting its changes, with a card per release and kind tags', async ({ page }) => {
  await openRule(page, CHANGED_ISM_RULE)
  const expectedCount = changeCount(ruleTimeline(ismHistory, CHANGED_ISM_RULE))
  await expect(historyTab(page, CHANGED_ISM_RULE)).toHaveAccessibleName(`History (${expectedCount} ${expectedCount === 1 ? 'change' : 'changes'})`)

  await historyTab(page, CHANGED_ISM_RULE).click()
  const panel = historyPanel(page, CHANGED_ISM_RULE)
  await expect(cards(panel).first()).toBeVisible()
  await expect(cards(panel).first().getByText(/^(Behaviour|Scope|Wording|References)$/).first()).toBeVisible()
})

test('the newest card with changes starts open and shows what changed', async ({ page }) => {
  await openRule(page, CHANGED_ISM_RULE)
  await historyTab(page, CHANGED_ISM_RULE).click()
  const panel = historyPanel(page, CHANGED_ISM_RULE)

  await expect(panel.getByTestId('field-change').first()).toBeVisible({ timeout: 10_000 })
  await expect(panel.getByRole('button', { expanded: true })).toHaveCount(1)
})

test('an mSCP rule with no change between releases shows no changes and its earliest release', async ({ page }) => {
  await openRule(page, UNCHANGED_MSCP_RULE)
  await expect(historyTab(page, UNCHANGED_MSCP_RULE)).toHaveAccessibleName('History (0 changes)')

  await historyTab(page, UNCHANGED_MSCP_RULE).click()
  const panel = historyPanel(page, UNCHANGED_MSCP_RULE)
  await expect(panel.getByTestId('history-starting-point')).toContainText('starting point: the oldest release kept here')
  await expect(cards(panel)).toHaveCount(0)
  await expect(panel.getByTestId('history-quiet-run')).toContainText('1 release with no changes')
})

test('a bar of quiet releases opens to list them', async ({ page }) => {
  await openRule(page, UNCHANGED_MSCP_RULE)
  await historyTab(page, UNCHANGED_MSCP_RULE).click()
  const bar = historyPanel(page, UNCHANGED_MSCP_RULE).getByTestId('history-quiet-run')

  await expect(bar).not.toContainText('No changes')
  await bar.getByRole('button', { name: 'show' }).click()
  await expect(bar).toContainText('No changes')
  await bar.getByRole('button', { name: 'hide' }).click()
  await expect(bar).not.toContainText('No changes')
})

test('Compare any two offers only later releases to compare to, then draws the comparison', async ({ page }) => {
  await openRule(page, CHANGED_ISM_RULE)
  await historyTab(page, CHANGED_ISM_RULE).click()
  const panel = historyPanel(page, CHANGED_ISM_RULE)
  const from = panel.getByLabel('From', { exact: true })
  const to = panel.getByLabel('To', { exact: true })

  await expect(to).toBeDisabled()
  await from.selectOption({ label: ismHistory.releases[0].label })
  await expect(to).toBeEnabled()
  await expect(to.locator('option:not([value=""])')).toHaveCount(ismHistory.releases.length - 1)
  await from.selectOption({ label: ismHistory.releases[2].label })
  await expect(to.locator('option:not([value=""])')).toHaveCount(ismHistory.releases.length - 3)

  await from.selectOption({ label: ismHistory.releases[0].label })
  await to.selectOption({ label: ismHistory.releases.at(-1)!.label })
  await expect(panel.getByTestId('history-compare-result')).toBeVisible()
  await expect(panel.getByTestId('history-compare-result')).not.toContainText('Loading changes')
})

test('the oldest release is an end marker, not a bordered card', async ({ page }) => {
  await openRule(page, CHANGED_ISM_RULE)
  await historyTab(page, CHANGED_ISM_RULE).click()
  const panel = historyPanel(page, CHANGED_ISM_RULE)
  const oldest = ismHistory.releases[0]

  await expect(panel.getByTestId('history-starting-point')).toHaveText(`${oldest.label} (${oldest.tag}) · starting point: the oldest release kept here`)
  await expect(cards(panel).filter({ hasText: oldest.tag })).toHaveCount(0)
})

test('kind pills hide the changes of the other kinds and fold their releases into a quiet bar', async ({ page }) => {
  await openRule(page, CHANGED_ISM_RULE)
  await historyTab(page, CHANGED_ISM_RULE).click()
  const panel = historyPanel(page, CHANGED_ISM_RULE)
  const pill = (name: string) => panel.getByRole('group', { name: 'Kinds of change to show' }).getByRole('button', { name })
  await expect(panel.getByTestId('field-change').first()).toBeVisible({ timeout: 10_000 })
  for (const name of ['Behaviour', 'Scope', 'Wording', 'References']) await expect(pill(name)).toHaveAttribute('aria-pressed', 'true')
  const countBefore = await historyTab(page, CHANGED_ISM_RULE).textContent()

  await pill('Wording').click()
  await pill('References').click()
  await pill('Scope').click()

  // ISM controls only ever change in wording or references, so nothing is left to show.
  await expect(panel.getByTestId('field-change')).toHaveCount(0)
  await expect(cards(panel)).toHaveCount(0)
  await expect(panel.getByTestId('history-quiet-run').first()).toContainText('no changes shown')
  await expect(pill('Behaviour')).toBeEnabled()
  await expect(panel.getByRole('button', { name: 'Show all' })).toBeVisible()
  await expect(historyTab(page, CHANGED_ISM_RULE)).toHaveText(countBefore ?? '')

  await panel.getByTestId('history-quiet-run').first().getByRole('button', { name: 'show' }).click()
  await expect(panel.getByTestId('history-quiet-run').first()).toContainText('Changes hidden:')

  // Nothing selected shows every kind again, with a note instead of the Show all button.
  await pill('Behaviour').click()
  await expect(panel.getByText('Showing all kinds')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Show all' })).toHaveCount(0)
  await expect(panel.getByTestId('field-change').first()).toBeVisible()

  await pill('Wording').click()
  await panel.getByRole('button', { name: 'Show all' }).click()
  for (const name of ['Behaviour', 'Scope', 'Wording', 'References']) await expect(pill(name)).toHaveAttribute('aria-pressed', 'true')
})
