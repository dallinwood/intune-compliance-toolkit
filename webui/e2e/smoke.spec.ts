import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'

const ruleCount = (page: Page) => page.getByText(/^\d+ of \d+ rules$/)

async function searchForSingleRow(page: Page, search: string, title: RegExp | string) {
  await page.getByPlaceholder('Search title or id…').fill(search)
  const row = page.locator('table tbody tr').filter({ hasText: title })
  await expect(row).toHaveCount(1)
  return row
}

test('rule browser loads the mSCP library and expands a rule to its check', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Intune Compliance Toolkit' })).toBeVisible()
  await expect(ruleCount(page)).toHaveText('350 of 350 rules', { timeout: 10_000 })

  const row = await searchForSingleRow(page, 'os_gatekeeper_enable', 'Enable Gatekeeper')
  // Scoped to the row rather than the button's name, which flips between
  // "Expand" and "Collapse" on click.
  await row.getByRole('button').click()
  await expect(row.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  // objectIsForcedForKey appears only in the check shell, not in the
  // profile payload, so this proves the check itself rendered.
  await expect(page.getByText('objectIsForcedForKey')).toBeVisible()
})

// Asserts on the real filtering effect, not just presence - a facet
// checkbox that renders but no longer fires its handler looks identical in
// a screenshot.
test('macOS version and benchmark facets narrow the table together', async ({ page }) => {
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('350 of 350 rules', { timeout: 10_000 })

  const countOf = async () => Number((await ruleCount(page).textContent())?.split(' ')[0])

  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText('350 of 350 rules')
  const versionOnly = await countOf()

  await page.getByRole('checkbox', { name: 'CIS Level 1', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText(`${versionOnly} of 350 rules`)
  const both = await countOf()

  await page.getByRole('checkbox', { name: 'macOS 27', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText(`${both} of 350 rules`)
  const benchmarkOnly = await countOf()

  expect(both).toBeGreaterThan(0)
  expect(both).toBeLessThan(versionOnly)
  expect(both).toBeLessThan(benchmarkOnly)

  await page.getByRole('radio', { name: 'Manual only' }).click()
  await expect(ruleCount(page)).not.toHaveText(`${benchmarkOnly} of 350 rules`)
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
  await expect(ruleCount(page)).toHaveText('350 of 350 rules', { timeout: 10_000 })
  await expect(page.getByRole('checkbox', { name: 'CIS Level 1', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Operating system/ })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Display name problems' })).toHaveCount(0)

  await page.route('**/baselines/_vocabulary.json', (route) => route.fulfill({ status: 404, body: 'Not found' }))
  await page.reload()
  await expect(ruleCount(page)).toHaveText('350 of 350 rules', { timeout: 10_000 })
  await expect(page.getByRole('status', { name: 'Display name problems' })).toContainText('raw codes are shown')
  await expect(page.getByRole('checkbox', { name: 'cis_lvl1', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'macOS 27', exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: '27.0', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^os \(\d+\)/ })).toBeVisible()

  // Raw-code filters still filter.
  await page.getByRole('checkbox', { name: 'cis_lvl1', exact: true }).click()
  await expect(ruleCount(page)).not.toHaveText('350 of 350 rules')
})

test('a malformed vocabulary file falls back to raw codes with a warning', async ({ page }) => {
  await page.route('**/baselines/_vocabulary.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"schema_version": 1, "vocabularies": []}' }),
  )
  await page.goto('/')
  await expect(ruleCount(page)).toHaveText('350 of 350 rules', { timeout: 10_000 })
  await expect(page.getByRole('status', { name: 'Display name problems' })).toContainText('vocabularies must be an object')
  await expect(page.getByRole('checkbox', { name: 'disa_stig', exact: true })).toBeVisible()
})
