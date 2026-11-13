import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { Manifest } from '../src/types/library'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as Manifest
const ism = manifest.sources.find((source) => source.name === 'asd_ism')!
const currentIsmIndex = JSON.parse(
  readFileSync(new URL(`../../baselines/${ism.index_path}`, import.meta.url), 'utf8'),
) as { rules: { id: string }[] }
const ismRuleId = currentIsmIndex.rules[0].id
const ismUpstreamId = ismRuleId.slice(ismRuleId.indexOf('.') + 1)

const palette = (page: Page) => page.getByRole('dialog', { name: 'Go to' })
const paletteInput = (page: Page) => palette(page).getByRole('combobox')
const headerSearchButton = (page: Page) => page.getByRole('banner').getByRole('button', { name: /Search/ })

async function openPaletteWithShortcut(page: Page) {
  await expect(headerSearchButton(page)).toBeVisible()
  await page.keyboard.press('Control+k')
  await expect(paletteInput(page)).toBeFocused()
}

test('Ctrl+K opens the palette with the input focused and Escape closes it, returning focus', async ({ page }) => {
  await page.goto('/rules')
  await headerSearchButton(page).focus()

  await page.keyboard.press('Control+k')
  await expect(paletteInput(page)).toBeFocused()
  await page.keyboard.press('Escape')

  await expect(palette(page)).toHaveCount(0)
  await expect(headerSearchButton(page)).toBeFocused()
})

test('the header Search button opens the palette', async ({ page }) => {
  await page.goto('/coverage')

  await headerSearchButton(page).click()

  await expect(paletteInput(page)).toBeFocused()
  await expect(palette(page).getByRole('option', { name: /Coverage/ })).toBeVisible()
})

test('typing an ISM upstream id and pressing Enter opens that rule on the Rules tab', async ({ page }) => {
  await page.goto('/frameworks')
  await openPaletteWithShortcut(page)

  await page.keyboard.type(ismUpstreamId)
  await expect(palette(page).getByRole('option').first()).toContainText(ismUpstreamId)
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(new RegExp(`/rules\\?.*rule=${ismRuleId.replace('.', '\\.')}`))
  await expect(page.locator(`[id="rule-detail-${ismRuleId}"]`)).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/frameworks$/)
})

test('choosing a framework opens its comparison on the Frameworks tab', async ({ page }) => {
  await page.goto('/rules')
  await openPaletteWithShortcut(page)

  await page.keyboard.type(ism.display_name)
  await palette(page).getByRole('option', { name: new RegExp(`${ism.display_name}.*Framework`) }).click()

  await expect(page).toHaveURL(/\/frameworks\?.*framework=asd_ism/)
})

test('choosing the Coverage view switches to it', async ({ page }) => {
  await page.goto('/rules')
  await openPaletteWithShortcut(page)

  await page.keyboard.type('coverage')
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/coverage$/)
  await expect(page.getByRole('link', { name: 'Coverage' })).toHaveAttribute('aria-current', 'page')
})

test('the result list exposes combobox, listbox and option roles and announces a count', async ({ page }) => {
  await page.goto('/rules')
  await openPaletteWithShortcut(page)

  await page.keyboard.type('ism')

  await expect(paletteInput(page)).toBeVisible()
  await expect(palette(page).getByRole('listbox')).toBeVisible()
  await expect(palette(page).getByRole('option').first()).toBeVisible()
  await expect(palette(page).getByRole('group')).not.toHaveCount(0)
  await expect(palette(page).getByText(/^(\d+ results?|Showing \d+ of \d+ rules; keep typing to narrow)$/)).toBeVisible()
  const activeDescendant = await paletteInput(page).getAttribute('aria-activedescendant')
  expect(activeDescendant).not.toBeNull()
  await expect(page.locator(`[id="${activeDescendant}"]`)).toHaveAttribute('role', 'option')
})

test('Ctrl+K does nothing while another dialog is open', async ({ page }) => {
  await page.goto('/rules')
  await page.getByRole('contentinfo').getByRole('button', { name: 'Sources & licences' }).click()
  const sourcesDialog = page.getByRole('dialog', { name: 'Sources & licences' })
  await expect(sourcesDialog).toBeVisible()

  await page.keyboard.press('Control+k')

  await expect(palette(page)).toHaveCount(0)
  await expect(sourcesDialog).toBeVisible()
})

test('a query with no matches says No matches', async ({ page }) => {
  await page.goto('/rules')
  await openPaletteWithShortcut(page)

  await page.keyboard.type('zzzz-no-such-rule')

  await expect(palette(page).getByText('No matches')).toBeVisible()
  await expect(palette(page).getByRole('option')).toHaveCount(0)
})
