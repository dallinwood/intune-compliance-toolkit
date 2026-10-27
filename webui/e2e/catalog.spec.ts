import { expect, test, type Page } from '@playwright/test'
import { buildCatalogIndex, type CatalogSourceFile } from '../src/logic/catalogIndex'

const EMPTY_MAPPING_INDEX = { schema_version: 1, by_rule: {} }

function product(id: string, fields: Record<string, unknown>): CatalogSourceFile {
  return {
    kind: 'product',
    fileName: `${id}.json`,
    value: { schema_version: 1, id, vendor: 'acme', parent: null, category: null, description: null, links: [], targets: [], plans: [], ...fields },
  }
}

function licence(id: string, fields: Record<string, unknown>): CatalogSourceFile {
  return {
    kind: 'licence',
    fileName: `${id}.json`,
    value: { schema_version: 1, id, vendor: 'acme', kind: 'subscription', requires: [], description: null, links: [], review: [], ...fields },
  }
}

const FIXTURE_FILES: CatalogSourceFile[] = [
  { kind: 'vendors', fileName: 'vendors.json', value: { schema_version: 1, vendors: [{ id: 'acme', title: 'Acme', url: null }] } },
  product('acme.suite', {
    title: 'Security Suite',
    category: 'Security',
    plans: [
      { id: 'plan_1', title: 'Plan 1', description: null, features: [] },
      { id: 'plan_2', title: 'Plan 2', description: null, features: [] },
    ],
  }),
  product('acme.feature', { title: 'Context Feature', parent: 'acme.suite' }),
  product('acme.tool', { title: 'Other Tool', category: 'Productivity' }),
  licence('acme.basic', {
    title: 'Acme Basic',
    family: 'Acme Business',
    includes: [
      { product: 'acme.feature', availability: 'included', note: null },
      { product: 'acme.tool', availability: 'included', note: null },
    ],
    review: ['Check the feature against the official comparison.'],
  }),
  licence('acme.pro', {
    title: 'Acme Pro',
    family: 'Acme Business',
    includes: [
      { product: 'acme.suite', plan: 'plan_2', availability: 'included', note: null },
      { product: 'acme.feature', availability: 'add_on', note: null },
      { product: 'acme.tool', availability: 'included', note: null },
    ],
  }),
  licence('acme.pack', {
    title: 'Acme Security Pack',
    family: 'Acme Add-ons',
    kind: 'add_on',
    requires: ['acme.pro'],
    includes: [{ product: 'acme.suite', plan: 'plan_1', availability: 'included', note: null }],
  }),
]

async function serveCatalog(page: Page) {
  const index = buildCatalogIndex(FIXTURE_FILES, () => {})
  await page.route('**/catalog/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(index) }),
  )
}

test.beforeEach(async ({ page }) => {
  await page.route('**/baselines/_mappings/_index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_MAPPING_INDEX) }),
  )
  await serveCatalog(page)
})

test('the Licences tab lists licences under their family and updates the URL on selection', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Licences' }).click()
  await expect(page).toHaveURL(/view=licences/)

  await expect(page.getByRole('heading', { name: 'Acme Business' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Acme Add-ons' })).toBeVisible()

  await page.getByRole('link', { name: 'Acme Pro', exact: true }).click()
  await expect(page).toHaveURL(/licence=acme\.pro/)
  await expect(page.getByRole('heading', { level: 2, name: 'Acme Pro' })).toBeVisible()
})

test('a feature whose parent the licence does not list shows under that parent as context', async ({ page }) => {
  await page.goto('/?view=licences&licence=acme.basic')

  const securitySection = page.getByRole('region', { name: 'Security' })
  await expect(securitySection.getByText('Security Suite')).toBeVisible()
  await expect(securitySection.getByText('Context Feature')).toBeVisible()
  await expect(securitySection.getByText('Included', { exact: true })).toHaveCount(1)
})

test('availability and plans are labelled in words', async ({ page }) => {
  await page.goto('/?view=licences&licence=acme.pro')

  const securitySection = page.getByRole('region', { name: 'Security' })
  await expect(securitySection.getByText('Add-on', { exact: true })).toBeVisible()
  await expect(securitySection.getByText('Plan 2', { exact: true })).toBeVisible()
})

test('a product link points at the Products tab for that product', async ({ page }) => {
  await page.goto('/?view=licences&licence=acme.basic')

  await expect(page.getByRole('link', { name: 'Other Tool' })).toHaveAttribute('href', /view=products&(.*&)?product=acme\.tool/)
})

test('review notes sit in a collapsed callout with their count', async ({ page }) => {
  await page.goto('/?view=licences&licence=acme.basic')

  const callout = page.getByRole('group', { name: /Needs review/ })
  await expect(callout).toContainText('Needs review (1)')
  await expect(page.getByText('Check the feature against the official comparison.')).toBeHidden()
  await callout.getByText(/Needs review/).click()
  await expect(page.getByText('Check the feature against the official comparison.')).toBeVisible()
})

test('an unknown licence id renders the list without a selection and without error', async ({ page }) => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  await page.goto('/?view=licences&licence=nope')

  await expect(page.getByRole('heading', { name: 'Acme Business' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
  expect(problems).toEqual([])
})

test('a missing catalog index shows a warning and leaves the Rules tab working', async ({ page }) => {
  await page.route('**/catalog/_index.json', (route) => route.fulfill({ status: 404, body: 'Not found' }))
  await page.goto('/')

  await expect(page.getByRole('status', { name: 'Catalog problems' })).toBeVisible()
  await expect(page.getByText(/^\d+ of \d+ rules$/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('searchbox', { name: 'Search title or id' })).toBeVisible()

  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Licences' }).click()
  await expect(page.getByText('The product and licence catalog could not be loaded.', { exact: true })).toBeVisible()
})

test('comparing two licences shows a matrix, and hiding identical rows drops the shared ones', async ({ page }) => {
  await page.goto('/?view=licences')
  await page.getByRole('button', { name: 'Compare' }).click()
  await page.getByRole('checkbox', { name: 'Acme Basic' }).click()
  await page.getByRole('checkbox', { name: 'Acme Pro' }).click()
  await expect(page).toHaveURL(/compare=acme\.basic&compare=acme\.pro/)

  const matrix = page.getByRole('table')
  await expect(matrix.getByRole('columnheader', { name: 'Acme Pro' })).toBeVisible()
  const hideIdentical = page.getByRole('checkbox', { name: 'Hide identical rows' })
  await expect(hideIdentical).toBeChecked()
  await expect(matrix.locator('tbody tr')).toHaveCount(2)
  await expect(matrix.getByText('Other Tool')).toHaveCount(0)

  await hideIdentical.click()
  await expect(matrix.locator('tbody tr')).toHaveCount(3)
  await expect(matrix.getByText('Other Tool')).toBeVisible()
})
