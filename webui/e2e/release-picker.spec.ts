import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { Manifest, RuleIndex } from '../src/types/library'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as Manifest
const mscp = manifest.sources.find((source) => source.name === 'mscp')!
const currentRelease = mscp.releases.at(-1)!
const olderRelease = mscp.releases.find((release) => release.label === '27.0')!
const olderIndex = JSON.parse(readFileSync(new URL(`../../baselines/${olderRelease.index_path}`, import.meta.url), 'utf8')) as RuleIndex

const RULES_PATH = '/frameworks?framework=mscp&tab=rules'
const releaseSelect = (page: Page) => page.getByRole('combobox', { name: 'Release' })
const olderReleaseNotice = (page: Page) => page.getByRole('note', { name: 'Older release' })

test('the Rules view opens on the current release', async ({ page }) => {
  await page.goto(RULES_PATH)

  await expect(releaseSelect(page)).toHaveValue(currentRelease.tag)
  await expect(releaseSelect(page).locator('option').first()).toHaveText(`${currentRelease.label} (${currentRelease.tag}) (current)`)
  await expect(olderReleaseNotice(page)).toHaveCount(0)
})

test('choosing an older release shows its rules read-only, survives a reload and resets on leaving the Rules view', async ({ page }) => {
  await page.goto(RULES_PATH)
  await expect(releaseSelect(page)).toHaveValue(currentRelease.tag)

  await releaseSelect(page).selectOption(olderRelease.tag)

  await expect(page).toHaveURL(new RegExp(`framework=mscp&tab=rules&release=${olderRelease.tag}$`))
  await expect(olderReleaseNotice(page)).toHaveText(
    `You are viewing ${olderRelease.label}, an older release. Selecting rules, coverage and Generate use the current release.`,
  )
  const ruleCount = olderIndex.rules.length.toLocaleString('en-US')
  await expect(page.getByText(`${ruleCount} of ${ruleCount} rules`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('checkbox', { name: 'Select all rules in this view' })).toBeDisabled()
  await expect(page.locator('table tbody tr[data-rule-id]').getByRole('checkbox').first()).toBeDisabled()

  await page.reload()
  await expect(releaseSelect(page)).toHaveValue(olderRelease.tag)
  await expect(olderReleaseNotice(page)).toBeVisible()

  await page.getByRole('navigation', { name: 'Page tabs' }).getByRole('link', { name: 'Coverage' }).click()
  await expect(page).toHaveURL(/framework=mscp&tab=coverage$/)
  await page.getByRole('navigation', { name: 'Page tabs' }).getByRole('link', { name: 'Rules' }).click()
  await expect(releaseSelect(page)).toHaveValue(currentRelease.tag)
  await expect(page).toHaveURL(/framework=mscp&tab=rules$/)
  await expect(olderReleaseNotice(page)).toHaveCount(0)
})

test('an unknown release in a shared link shows the current release and leaves the address', async ({ page }) => {
  await page.goto(`${RULES_PATH}&release=no_such_release`)

  await expect(releaseSelect(page)).toHaveValue(currentRelease.tag)
  await expect(page).toHaveURL(/framework=mscp&tab=rules$/)
})
