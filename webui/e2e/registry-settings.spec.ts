import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { buildOverlayIndex } from '../src/logic/overlayIndex'
import { ALL_RULES_PATH } from './locations'

const manifest = JSON.parse(readFileSync(new URL('../../baselines/_manifest.json', import.meta.url), 'utf8')) as {
  sources: { name: string; release_tag: string }[]
}
const currentReleaseOf = (sourceName: string) => manifest.sources.find((source) => source.name === sourceName)?.release_tag ?? ''

const ISM_RULE_ID = 'asd_ism.ism-1622'
const ISM_TITLE = 'PowerShell is configured to use Constrained Language Mode.'
const ODV_RULE_ID = 'mscp.pwpolicy_minimum_length_enforce'
const LONG_KEY_PATH = 'SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU\\AnExtremelyLongSubKeyNameThatKeepsGoingAndGoingWithoutAnySpaces'

const registrySetting = (fields: Record<string, unknown>) => ({
  hive: 'HKLM',
  path: LONG_KEY_PATH,
  value_name: 'NoAutoUpdate',
  type: 'REG_DWORD',
  data: 1,
  state: 'present',
  ...fields,
})

const registryCheckItem = (settings: unknown[]) => ({
  name: null,
  language: 'registry',
  default: { registry: settings, result: null, additional_info: null },
  by_version: {},
})

const windowsApplicability = [{ target: 'Windows', version: null, benchmarks: [] }]

function overlayFor(ruleId: string, source: string, fields: Record<string, unknown>) {
  return {
    schema_version: 1,
    id: `registry-display-${ruleId.replace(/[^a-z0-9]/g, '-')}`,
    targets: [{ rule: ruleId, release: currentReleaseOf(source) }],
    fields: { applicability: windowsApplicability, ...fields },
  }
}

const ismOverlay = overlayFor(ISM_RULE_ID, 'asd_ism', {
  check: {
    Windows: [
      registryCheckItem([
        registrySetting({}),
        registrySetting({
          path: 'SOFTWARE\\Example',
          value_name: '',
          type: 'REG_SZ',
          data: 'C:\\Tools\\caf\u00e9',
        }),
      ]),
      {
        name: null,
        language: 'powershell',
        default: {
          shell: 'Write-Output "ok"',
          result: null,
          additional_info: null,
        },
        by_version: {},
      },
      {
        name: null,
        language: 'goss',
        default: {
          shell: 'registry:\n  exists: true',
          result: null,
          additional_info: null,
        },
        by_version: {},
      },
    ],
  },
  remediation: {
    Windows: {
      steps: [
        {
          name: null,
          language: 'registry',
          registry: [
            registrySetting({
              value_name: 'Gone',
              type: null,
              data: null,
              state: 'absent',
            }),
          ],
          additional_info: null,
          versions: null,
        },
        {
          name: null,
          language: 'ansible',
          shell: '- name: set it\n  ansible.windows.win_regedit:\n    state: present',
          additional_info: null,
          versions: null,
        },
      ],
      payloads: [],
    },
  },
})

const odvOverlay = overlayFor(ODV_RULE_ID, 'mscp', {
  check: {
    Windows: [
      registryCheckItem([
        registrySetting({
          value_name: 'MinimumPasswordLength',
          data: '$ODV_value',
        }),
      ]),
    ],
  },
})

async function serveOverlays(page: Page, overlays: Record<string, unknown>) {
  const fileNames = Object.keys(overlays).sort()
  const index = buildOverlayIndex(
    fileNames.map((fileName) => ({ fileName, value: overlays[fileName] })),
    (message) => {
      throw new Error(message)
    },
  )
  await page.route('**/baselines/_overlays/{_index.json,rules/*.json}', (route) => {
    const fileName = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    const body = fileName === '_index.json' ? index : overlays[fileName]
    if (body === undefined) return route.fulfill({ status: 404, body: 'Not found' })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}

test.beforeEach(async ({ page }) => {
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schema_version: 1, by_rule: {} }),
    }),
  )
  await page.route('**/catalog/_index.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schema_version: 1,
        vendors: [],
        products: [],
        licences: [],
        by_product: {},
      }),
    }),
  )
})

async function openRule(page: Page, search: string, title: RegExp | string) {
  await page.goto(ALL_RULES_PATH)
  await page.getByPlaceholder('Search title or id…').fill(search)
  const row = page.locator('table tbody tr').filter({ hasText: title })
  await expect(row).toHaveCount(1, { timeout: 15_000 })
  await row.getByRole('button').click()
  return page.locator('[id^="rule-detail-"]')
}

async function seedOdvValue(page: Page, odvValue: string) {
  await page.addInitScript(
    ({ ruleId, value }) => {
      const upstreamId = ruleId.slice(ruleId.indexOf('.') + 1)
      const ref = { id: ruleId, path: `mscp/rules/${upstreamId}.json` }
      const selections = {
        [ruleId]: { ref, enabled: true, odvValues: { value } },
      }
      window.localStorage.setItem('intune-toolkit:selections', JSON.stringify({ state: { selections }, version: 3 }))
    },
    { ruleId: ODV_RULE_ID, value: odvValue },
  )
}

test('a registry check shows a table, the default value as (Default), and the goss pill', async ({ page }) => {
  await serveOverlays(page, { 'a-ism.json': ismOverlay })
  const detail = await openRule(page, 'ism-1622', ISM_TITLE)
  const checkPanel = detail.getByTestId('check-target')

  await detail
    .getByRole('tab', { name: /Registry/ })
    .first()
    .click()
  const table = checkPanel.getByRole('table')
  for (const header of ['Key', 'Value', 'Type', 'Data']) {
    await expect(table.getByRole('columnheader', { name: header })).toBeVisible()
  }
  const settingRow = table.getByRole('row').filter({ hasText: 'NoAutoUpdate' })
  await expect(settingRow).toContainText(`HKEY_LOCAL_MACHINE\\${LONG_KEY_PATH}`)
  await expect(settingRow).toContainText('REG_DWORD')
  await expect(settingRow.getByRole('cell').last()).toHaveText('1')
  const defaultRow = table.getByRole('row').filter({ hasText: '(Default)' })
  await expect(defaultRow).toContainText('REG_SZ')
  await expect(defaultRow).toContainText('C:\\Tools\\caf\u00e9')

  await detail.getByRole('tab', { name: /goss/ }).click()
  await expect(checkPanel.locator('pre', { hasText: 'exists: true' })).toBeVisible()
})

test('a registry remediation step shows a Delete row and the Ansible pill', async ({ page }) => {
  await serveOverlays(page, { 'a-ism.json': ismOverlay })
  const detail = await openRule(page, 'ism-1622', ISM_TITLE)
  const remediation = detail.getByTestId('remediation-target')

  await detail.getByRole('tab', { name: /Registry/ }).last().click()
  const deleteRow = remediation.getByRole('table').getByRole('row').filter({ hasText: 'Gone' })
  await expect(deleteRow).toContainText('Delete')

  await detail.getByRole('tab', { name: /Ansible/ }).click()
  await expect(remediation.locator('pre', { hasText: 'ansible.windows.win_regedit' })).toBeVisible()
})

test('Download .reg saves <rule id>-Windows-check.reg as UTF-16LE with a byte order mark', async ({ page }) => {
  await serveOverlays(page, { 'a-ism.json': ismOverlay })
  const detail = await openRule(page, 'ism-1622', ISM_TITLE)
  await detail
    .getByRole('tab', { name: /Registry/ })
    .first()
    .click()

  const downloadPromise = page.waitForEvent('download')
  await detail.getByTestId('check-target').getByRole('button', { name: 'Download .reg' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`${ISM_RULE_ID}-Windows-check.reg`)
  const bytes = await readFile((await download.path()) as string)
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe])
  const text = bytes.subarray(2).toString('utf16le')
  expect(text.startsWith('Windows Registry Editor Version 5.00\r\n')).toBe(true)
  expect(text).toContain(`[HKEY_LOCAL_MACHINE\\${LONG_KEY_PATH}]`)
  expect(text).toContain('@="C:\\\\Tools\\\\caf\u00e9"')
})

test('the remediation Download .reg saves <rule id>-Windows-fix.reg, apart from the check download', async ({ page }) => {
  await serveOverlays(page, { 'a-ism.json': ismOverlay })
  const detail = await openRule(page, 'ism-1622', ISM_TITLE)
  await detail.getByRole('tab', { name: /Registry/ }).last().click()

  const downloadPromise = page.waitForEvent('download')
  await detail.getByTestId('remediation-target').getByRole('button', { name: 'Download .reg' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`${ISM_RULE_ID}-Windows-fix.reg`)
})

test('a customised organization value appears in the table and the .reg download', async ({ page }) => {
  await serveOverlays(page, { 'a-odv.json': odvOverlay })
  await seedOdvValue(page, '900')
  const detail = await openRule(page, 'pwpolicy_minimum_length_enforce', /minimum/i)
  await detail
    .getByRole('tab', { name: /Registry/ })
    .first()
    .click()
  const checkPanel = detail.getByTestId('check-target')
  await expect(checkPanel.getByRole('table').getByRole('row').filter({ hasText: 'MinimumPasswordLength' })).toContainText('900')

  const downloadPromise = page.waitForEvent('download')
  await checkPanel.getByRole('button', { name: 'Download .reg' }).click()
  const bytes = await readFile((await (await downloadPromise).path()) as string)
  expect(bytes.subarray(2).toString('utf16le')).toContain('"MinimumPasswordLength"=dword:00000384')
})

test('an organization value with no usable value disables Download .reg and says why', async ({ page }) => {
  await serveOverlays(page, { 'a-odv.json': odvOverlay })
  await seedOdvValue(page, 'not a number')
  const detail = await openRule(page, 'pwpolicy_minimum_length_enforce', /minimum/i)
  await detail
    .getByRole('tab', { name: /Registry/ })
    .first()
    .click()
  const checkPanel = detail.getByTestId('check-target')
  await expect(checkPanel.getByRole('button', { name: 'Download .reg' })).toBeDisabled()
  await expect(checkPanel).toContainText('Set a valid value for $ODV_value to download')
})
