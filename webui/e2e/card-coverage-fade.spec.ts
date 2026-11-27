import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildMappingIndex } from '../src/logic/mappingIndex'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as {
  sources: { name: string; display_name: string; release_tag: string }[]
}
const currentReleaseOf = (sourceName: string) => manifest.sources.find((source) => source.name === sourceName)?.release_tag ?? ''
const displayNameOf = (sourceName: string) => manifest.sources.find((source) => source.name === sourceName)?.display_name ?? ''
const endpoint = (id: string, sourceName: string) => ({ kind: 'rule', id, release: currentReleaseOf(sourceName) })
const MSCP_RULE = 'mscp.os_gatekeeper_enable'

// mSCP supports three frameworks and is related to a fourth, so its card has four coverage bars.
const FOUR_BAR_INDEX = buildMappingIndex(
  [
    {
      fileName: 'four-frameworks.json',
      value: {
        schema_version: 1,
        id: 'four-frameworks',
        links: [
          { relation: 'supports', from: [endpoint(MSCP_RULE, 'mscp')], to: [endpoint('asd_ism.ism-0459', 'asd_ism')] },
          { relation: 'supports', from: [endpoint(MSCP_RULE, 'mscp')], to: [endpoint('nist_800_53.ac-1', 'nist_800_53')] },
          { relation: 'supports', from: [endpoint(MSCP_RULE, 'mscp')], to: [endpoint('nist_800_171.03.01.01', 'nist_800_171')] },
          { relation: 'related', from: [endpoint(MSCP_RULE, 'mscp')], to: [endpoint('asd_e4eit.it.pro-12.2', 'asd_e4eit')] },
        ],
      },
    },
  ],
  () => {},
)

async function openCardsWithFourBarsOnMscp(page: Page) {
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FOUR_BAR_INDEX) }),
  )
  await page.goto('/frameworks')
}

const card = (page: Page, sourceName: string) =>
  page.getByTestId('framework-card').filter({ has: page.getByRole('heading', { name: displayNameOf(sourceName), exact: true }) })

async function scrollMetrics(list: Locator) {
  return list.evaluate((element) => {
    const items = Array.from(element.children) as HTMLElement[]
    const third = items[2]
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      thirdItemBottom: third ? third.offsetTop + third.offsetHeight : null,
    }
  })
}

test('a card with four coverage bars is capped at three, with a fade that expands it to full height', async ({ page }) => {
  await openCardsWithFourBarsOnMscp(page)
  const mscpCard = card(page, 'mscp')
  const list = mscpCard.getByTestId('card-coverage-list')
  await expect(list.locator(':scope > *')).toHaveCount(4, { timeout: 15_000 })

  const capped = await scrollMetrics(list)
  expect(capped.scrollHeight).toBeGreaterThan(capped.clientHeight)
  expect(capped.clientHeight).toBe(capped.thirdItemBottom)
  const expandButton = mscpCard.getByRole('button', { name: 'Show all 4 coverage bars' })
  await expect(expandButton).toBeVisible()
  await expect(mscpCard.getByTestId('card-coverage-fade-up')).toHaveCSS('opacity', '0')

  await expandButton.click()

  await expect(expandButton).toHaveCount(0)
  const expanded = await scrollMetrics(list)
  expect(expanded.scrollHeight).toBe(expanded.clientHeight)
  await expect(mscpCard.getByText(`Related to ASD E4EIT`)).toBeInViewport()

  const collapseButton = mscpCard.getByRole('button', { name: 'Show fewer coverage bars' })
  await expect(collapseButton).toBeVisible()
  await collapseButton.click()

  await expect(collapseButton).toHaveCount(0)
  await expect(expandButton).toBeVisible()
  const collapsedAgain = await scrollMetrics(list)
  expect(collapsedAgain.clientHeight).toBe(collapsedAgain.thirdItemBottom)
})

test('scrolling a capped card to the end swaps the bottom fade for a top one', async ({ page }) => {
  await openCardsWithFourBarsOnMscp(page)
  const mscpCard = card(page, 'mscp')
  const list = mscpCard.getByTestId('card-coverage-list')
  await expect(list.locator(':scope > *')).toHaveCount(4, { timeout: 15_000 })

  await list.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))

  await expect(mscpCard.getByRole('button', { name: 'Show all 4 coverage bars' })).toHaveCount(0)
  await expect(mscpCard.getByTestId('card-coverage-fade-up')).toHaveCSS('opacity', '1')
})

test('cards with three coverage bars or fewer are not capped', async ({ page }) => {
  await page.goto('/frameworks')
  const mscpCard = card(page, 'mscp')
  const list = mscpCard.getByTestId('card-coverage-list')
  await expect(list.locator(':scope > *')).toHaveCount(3, { timeout: 15_000 })

  await expect(list).toHaveCSS('overflow-y', 'visible')
  await expect(list).toHaveCSS('max-height', 'none')
  await expect(page.getByRole('button', { name: /^Show all \d+ coverage bars$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show fewer coverage bars' })).toHaveCount(0)
})
