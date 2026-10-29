import { expect, test, type Page } from '@playwright/test'
import { buildCatalogIndex, type CatalogSourceFile } from '../src/logic/catalogIndex'

const EMPTY_MAPPING_INDEX = { schema_version: 1, by_rule: {} }

function product(id: string, fields: Record<string, unknown>): CatalogSourceFile {
  return {
    kind: 'product',
    fileName: `${id}.json`,
    value: { schema_version: 1, id, vendor: 'acme', parent: null, requires: null, category: null, description: null, links: [], targets: [], plans: [], ...fields },
  }
}

function licence(id: string, fields: Record<string, unknown>): CatalogSourceFile {
  return {
    kind: 'licence',
    fileName: `${id}.json`,
    value: { schema_version: 1, id, vendor: 'acme', kind: 'subscription', requires: null, description: null, links: [], review: [], ...fields },
  }
}

const FIXTURE_FILES: CatalogSourceFile[] = [
  { kind: 'vendors', fileName: 'vendors.json', value: { schema_version: 1, vendors: [{ id: 'acme', title: 'Acme', url: null }] } },
  product('acme.suite', {
    title: 'Security Suite',
    category: 'Security',
    plans: [
      { id: 'plan_1', title: 'Plan 1', description: null, features: ['acme.feature'] },
      { id: 'plan_2', title: 'Plan 2', description: null, features: [] },
    ],
  }),
  product('acme.feature', { title: 'Context Feature', parent: 'acme.suite' }),
  product('acme.tool', {
    title: 'Other Tool',
    category: 'Productivity',
    requires: { all_of: ['acme.feature', { any_of: ['acme.suite.plan_1', 'acme.suite.plan_2'] }] },
  }),
  licence('acme.basic', {
    title: 'Acme Basic',
    family: 'Acme Business',
    includes: [
      { type: 'product', target: 'acme.feature', availability: 'included', note: null },
      { type: 'product', target: 'acme.tool', availability: 'included', note: null },
    ],
    review: ['Check the feature against the official comparison.'],
  }),
  licence('acme.pro', {
    title: 'Acme Pro',
    family: 'Acme Business',
    includes: [
      { type: 'product', target: 'acme.suite', plan: 'plan_2', availability: 'add_on', note: null },
      { type: 'licence', target: 'acme.pack', availability: 'add_on', note: 'Purchased through the security bundle.' },
      { type: 'product', target: 'acme.tool', availability: 'included', note: null },
    ],
  }),
  licence('acme.pack', {
    title: 'Acme Security Pack',
    family: 'Acme Add-ons',
    kind: 'add_on',
    requires: { any_of: ['acme.pro', 'acme.basic'] },
    includes: [
      { type: 'product', target: 'acme.suite', plan: 'plan_1', availability: 'included', note: null },
      { type: 'licence', target: 'acme.optional', availability: 'add_on', note: null },
    ],
  }),
  product('acme.optional-feature', { title: 'Optional Feature' }),
  licence('acme.optional', {
    title: 'Optional Security Add-on',
    family: 'Acme Add-ons',
    kind: 'add_on',
    includes: [{ type: 'product', target: 'acme.optional-feature', availability: 'included', note: null }],
  }),
  licence('acme.broken', {
    title: 'Broken References',
    family: 'Acme Business',
    includes: [
      { type: 'product', target: 'acme.unknown-product', availability: 'included', note: null },
      { type: 'licence', target: 'acme.unknown-licence', availability: 'add_on', note: null },
    ],
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
  await expect(page).toHaveURL(/\/licences$/)

  await expect(page.getByRole('heading', { name: 'Acme Business' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Acme Add-ons' })).toBeVisible()
  await page.getByRole('button', { name: 'Acme Business' }).click()

  await page.getByRole('link', { name: 'Acme Pro', exact: true }).click()
  await expect(page).toHaveURL(/licence=acme\.pro/)
  await expect(page.getByRole('heading', { level: 2, name: 'Acme Pro' })).toBeVisible()
})

test('a feature whose parent the licence does not list shows under that parent as context', async ({ page }) => {
  await page.goto('/licences?licence=acme.basic')

  const securitySection = page.getByRole('region', { name: 'Security' })
  await expect(securitySection.getByText('Security Suite')).toBeVisible()
  await expect(securitySection.getByText('Context Feature')).toBeVisible()
  await expect(securitySection.getByText('Included', { exact: true })).toHaveCount(1)
})

test('availability and plans are labelled in words', async ({ page }) => {
  await page.goto('/licences?licence=acme.pro')

  const securitySection = page.getByRole('region', { name: 'Security' })
  await expect(securitySection.getByText('Add-on', { exact: true })).toHaveCount(3)
  await expect(securitySection.getByText('Plan 2', { exact: true })).toBeVisible()
  await expect(securitySection.getByText('Plan 1', { exact: true })).toBeVisible()
})

test('a nested add-on names and links its source licence without inheriting that licence’s optional add-ons', async ({ page }) => {
  await page.goto('/licences?licence=acme.pro')

  const securitySection = page.getByRole('region', { name: 'Security' })
  const nestedLines = securitySection.getByText('Add-on via Acme Security Pack', { exact: true })
  await expect(nestedLines).toHaveCount(2)
  const nestedLine = nestedLines.first()
  await expect(nestedLine).toBeVisible()
  await expect(nestedLine.getByRole('link', { name: 'Acme Security Pack' })).toHaveAttribute('href', /\/licences\?(.*&)?licence=acme\.pack/)
  await expect(page.getByRole('link', { name: 'Optional Feature' })).toHaveCount(0)
})

test('missing inclusion targets are shown as catalog reference problems', async ({ page }) => {
  await page.goto('/licences?licence=acme.broken')

  const problems = page.getByRole('region', { name: 'Catalog reference problems' })
  await expect(problems).toContainText('Missing product: acme.unknown-product')
  await expect(problems).toContainText('Missing licence: acme.unknown-licence')
})

test('the compare legend lists availability and shows nested source links and notes', async ({ page }) => {
  await page.goto('/licences?licence=acme.pro&compare=acme.basic&compare=acme.pro')

  const legend = page.getByRole('list', { name: 'Legend' })
  await expect(legend.getByRole('listitem')).toHaveText(['Included', 'Add-on', '-Not included'])
  const featureRow = page.getByRole('row', { name: /Context Feature/ })
  await expect(featureRow.getByRole('link', { name: 'Acme Security Pack' })).toHaveAttribute('href', /\/licences\?(.*&)?licence=acme\.pack/)
  await expect(featureRow.getByText('Purchased through the security bundle.')).toBeVisible()
})

test('a product link points at the Products tab for that product', async ({ page }) => {
  await page.goto('/licences?licence=acme.basic')

  await expect(page.getByRole('link', { name: 'Other Tool' })).toHaveAttribute('href', /\/products\?(.*&)?product=acme\.tool/)
})

test('review notes sit in a collapsed callout with their count', async ({ page }) => {
  await page.goto('/licences?licence=acme.basic')

  const callout = page.getByRole('group', { name: /Needs review/ })
  await expect(callout).toContainText('Needs review (1)')
  await expect(page.getByText('Check the feature against the official comparison.')).toBeHidden()
  await callout.getByText(/Needs review/).click()
  await expect(page.getByText('Check the feature against the official comparison.')).toBeVisible()
})

test('an unknown licence id renders the list without a selection and without error', async ({ page }) => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  await page.goto('/licences?licence=nope')

  await expect(page.getByRole('heading', { name: 'Acme', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
  expect(problems).toEqual([])
})

test('a Rules-only visit never requests the catalog index', async ({ page }) => {
  const catalogRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('catalog/_index.json')) catalogRequests.push(request.url())
  })
  await page.goto('/')
  await expect(page.getByText(/^\d+ of \d+ rules$/)).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(500)

  expect(catalogRequests).toEqual([])
})

test('a missing catalog index warns only inside the Licences tab and leaves the Rules tab working', async ({ page }) => {
  await page.route('**/catalog/_index.json', (route) => route.fulfill({ status: 404, body: 'Not found' }))
  await page.goto('/')

  await expect(page.getByText(/^\d+ of \d+ rules$/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('searchbox', { name: 'Search title or id' })).toBeVisible()
  await expect(page.getByRole('status', { name: 'Catalog problems' })).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Licences' }).click()
  await expect(page.getByRole('status', { name: 'Catalog problems' })).toBeVisible()
  await expect(page.getByText('The product and licence catalog could not be loaded.', { exact: true })).toBeVisible()
  await expect(page.getByText(/^\d+ of \d+ rules$/)).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Rules' }).click()
  await expect(page.getByRole('searchbox', { name: 'Search title or id' })).toBeVisible()
})

test('comparing two licences shows a matrix, and hiding identical rows drops the shared ones', async ({ page }) => {
  await page.goto('/licences')
  await page.getByRole('button', { name: 'Acme Business' }).click()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Exit compare' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Tick two or more licences to compare.')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Acme Basic' }).click()
  await expect(page.getByText('Tick two or more licences to compare.')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Acme Pro' }).click()
  await expect(page.getByText('2 selected')).toBeVisible()
  await expect(page.getByText('Tick two or more licences to compare.')).toHaveCount(0)
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

  await page.getByRole('button', { name: 'Exit compare' }).click()
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('going back past a comparison leaves compare mode, and forward restores it', async ({ page }) => {
  await page.goto('/licences?licence=acme.basic')
  await expect(page.getByRole('heading', { level: 2, name: 'Acme Basic' })).toBeVisible()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Acme Basic' }).click()
  await page.getByRole('checkbox', { name: 'Acme Pro' }).click()
  await expect(page.getByText('2 selected')).toBeVisible()

  await page.goBack()
  await expect(page).not.toHaveURL(/compare=/)
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('heading', { level: 2, name: 'Acme Basic' })).toBeVisible()
  await expect(page.getByText('Tick two or more licences to compare.')).toHaveCount(0)

  await page.goForward()
  await expect(page).toHaveURL(/compare=acme\.basic&compare=acme\.pro/)
  await expect(page.getByRole('button', { name: 'Exit compare' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('table').getByRole('columnheader', { name: 'Acme Pro' })).toBeVisible()
})

test('a product link in a licence switches to that product on a plain click', async ({ page }) => {
  await page.goto('/licences?licence=acme.basic')
  await page.getByRole('link', { name: 'Other Tool' }).click()

  await expect(page).toHaveURL(/\/products\?(.*&)?product=acme\.tool/)
  await expect(page.getByRole('heading', { level: 2, name: 'Other Tool' })).toBeVisible()
})

test('searching the Products tab finds a feature with its breadcrumb, and its detail lists the licences that include it', async ({ page }) => {
  await page.goto('/products')
  await page.getByRole('searchbox', { name: 'Search products' }).fill('context')

  const result = page.getByRole('link', { name: /Context Feature/ })
  await expect(result).toContainText('Security Suite')
  await result.click()
  await expect(page).toHaveURL(/product=acme\.feature/)

  const includedIn = page.getByRole('region', { name: 'Included in' })
  await expect(includedIn.getByText('Included', { exact: true })).toBeVisible()
  await expect(includedIn.getByText('Add-on', { exact: true })).toBeVisible()
  await expect(includedIn.getByLabel('Add-on').getByRole('link', { name: 'Acme Security Pack' })).toBeVisible()
  await includedIn.getByRole('link', { name: 'Acme Pro' }).click()
  await expect(page).toHaveURL(/\/licences\?(.*&)?licence=acme\.pro/)
  await expect(page.getByRole('heading', { level: 2, name: 'Acme Pro' })).toBeVisible()
})

test('a product detail shows its plans, features and the licences that include it', async ({ page }) => {
  await page.goto('/products?product=acme.suite')

  await expect(page.getByRole('region', { name: 'Plans' }).getByText('Plan 2', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Features' }).getByRole('link', { name: 'Context Feature' })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Included in' }).getByLabel('Included', { exact: true }).getByRole('link', { name: 'Acme Security Pack' }),
  ).toBeVisible()
})

test('a product requirement reads as and/or with nested groups in brackets, and links to the products', async ({ page }) => {
  await page.goto('/products?product=acme.tool')

  const requirement = page.locator('p', { hasText: 'Requires:' })
  await expect(requirement).toHaveText('Requires: Context Feature and (Security Suite Plan 1 or Security Suite Plan 2)')
  await requirement.getByRole('link', { name: 'Security Suite Plan 2' }).click()
  await expect(page).toHaveURL(/product=acme\.suite/)
})

test('a licence requirement lists the licences to buy first', async ({ page }) => {
  await page.goto('/licences?licence=acme.pack')

  await expect(page.locator('p', { hasText: 'Requires:' })).toHaveText('Requires: Acme Pro or Acme Basic')
})

test('an unknown product id renders the list without a selection and without error', async ({ page }) => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  await page.goto('/products?product=nope')

  await expect(page.getByRole('searchbox', { name: 'Search products' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)
  expect(problems).toEqual([])
})

test('expanding a group leaves the product list where it was scrolled', async ({ page }) => {
  const fillerProducts = Array.from({ length: 60 }, (_, position) => product(`acme.filler-${position}`, { title: `Filler ${String(position).padStart(2, '0')}`, category: 'Zeta' }))
  const bigIndex = buildCatalogIndex([...FIXTURE_FILES, ...fillerProducts], () => {})
  await page.route('**/catalog/_index.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bigIndex) }))
  await page.setViewportSize({ width: 1440, height: 500 })
  await page.goto('/products?product=acme.filler-59')
  const list = page.getByRole('navigation', { name: 'Products' }).locator('xpath=..')
  await expect(page.getByRole('heading', { level: 2, name: 'Filler 59' })).toBeVisible()
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  await list.evaluate((element) => element.scrollTo({ top: 0 }))
  await page.getByRole('button', { name: 'Security', exact: true }).click()
  await page.getByRole('button', { name: /^Expand Security Suite/ }).click()
  await expect(page.getByRole('link', { name: 'Context Feature' })).toBeVisible()

  expect(await list.evaluate((element) => element.scrollTop)).toBe(0)
})

test('a licence opened by its address is shown, its group is open and the others are collapsed', async ({ page }) => {
  await page.goto('/licences?licence=acme.pro')

  await expect(page.getByRole('heading', { level: 2, name: 'Acme Pro' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Acme Business' })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Acme Add-ons' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('link', { name: 'Optional Security Add-on' })).toHaveCount(0)
})

test('vendor groups start open and family and category groups start collapsed', async ({ page }) => {
  await page.goto('/licences')
  await expect(page.getByRole('button', { name: 'Acme', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Acme Business' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('link', { name: /^Acme Basic/ })).toHaveCount(0)

  await page.goto('/products')
  await expect(page.getByRole('button', { name: 'Acme', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Security', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('link', { name: 'Security Suite' })).toHaveCount(0)
})

test('back and forward walk from a licence to a product and back to the list', async ({ page }) => {
  await page.goto('/licences')
  await page.getByRole('button', { name: 'Acme Business' }).click()
  await page.getByRole('link', { name: /^Acme Basic/ }).click()
  await expect(page).toHaveURL(/\/licences\?licence=acme\.basic/)
  await page.getByRole('link', { name: 'Other Tool' }).click()
  await expect(page).toHaveURL(/\/products\?(.*&)?product=acme\.tool/)
  await expect(page.getByRole('heading', { level: 2, name: 'Other Tool' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Productivity' })).toHaveAttribute('aria-expanded', 'true')

  await page.goBack()
  await expect(page).toHaveURL(/\/licences\?licence=acme\.basic/)
  await expect(page.getByRole('heading', { level: 2, name: 'Acme Basic' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/licences$/)
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0)

  await page.goForward()
  await expect(page.getByRole('heading', { level: 2, name: 'Acme Basic' })).toBeVisible()
})

test('a selection reached by going back opens its group again', async ({ page }) => {
  await page.goto('/licences?licence=acme.basic')
  await page.getByRole('link', { name: 'Other Tool' }).click()
  await expect(page).toHaveURL(/\/products\?/)
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Acme Business' })).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Acme Business' }).click()
  await page.getByRole('link', { name: 'Other Tool' }).click()
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Acme Business' })).toHaveAttribute('aria-expanded', 'true')
})

test('typing a Rules search adds no history entry', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByPlaceholder('Search title or id…')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Licences' }).click()
  await expect(page).toHaveURL(/\/licences$/)
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Rules' }).click()
  await page.getByPlaceholder('Search title or id…').fill('gatekeeper')
  await expect(page).toHaveURL(/q=gatekeeper/)
  await page.goBack()
  await expect(page).toHaveURL(/\/licences$/)
})

test('the tab bar has no scrollbar at phone and desktop widths', async ({ page }) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const metrics = await page.getByRole('navigation', { name: 'Views' }).evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight)
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  }
})
