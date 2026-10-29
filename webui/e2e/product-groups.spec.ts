import { expect, test } from '@playwright/test'
import { parseCatalogIndex } from '../src/logic/catalogIndex'
import { productTree, type ProductTreeNode } from '../src/logic/productSearch'

test('the published catalog places every product in one group without subscription buckets', async ({ request }) => {
  const response = await request.get('/catalog/_index.json')
  expect(response.ok()).toBe(true)
  const catalog = parseCatalogIndex(await response.json())
  if (typeof catalog === 'string') throw new Error(catalog)
  const tree = productTree(catalog.products, catalog.vendors)
  const groups = tree.flatMap((vendor) => vendor.categories)
  const ids: string[] = []
  function collect(nodes: ProductTreeNode[]) {
    for (const node of nodes) {
      ids.push(node.product.id)
      collect(node.children)
    }
  }
  for (const group of groups) collect(group.roots)
  expect(ids.sort()).toEqual(catalog.products.map((product) => product.id).sort())
  expect(new Set(ids).size).toBe(ids.length)
  expect(groups.map((group) => group.category)).not.toContain('Enterprise Mobility + Security')
  for (const obsolete of ['Office 365', 'Suite Value', 'Extra Capacity', 'Identity', 'Microsoft Entra', 'Employee experience', 'Employee Experience']) {
    expect(groups.some((group) => group.category === obsolete)).toBe(false)
  }
  const identity = groups.find((group) => group.category === 'Identity and access management')
  expect(identity).toBeDefined()
  expect(identity?.roots.map((node) => node.product.id)).toEqual(expect.arrayContaining([
    'microsoft.entra-id',
    'microsoft.entra-id-governance',
    'microsoft.entra-internet-access',
    'microsoft.entra-private-access',
    'microsoft.entra-workload-id-free',
    'microsoft.entra-workload-id-premium',
  ]))
})

test('the Products tab shows Entra ID and standalone access products in the same workload', async ({ page }) => {
  await page.goto('/products?product=microsoft.entra-id')
  const navigation = page.getByRole('navigation', { name: 'Products', exact: true })
  await expect(navigation.getByRole('button', { name: 'Identity and access management', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('link', { name: 'Microsoft Entra ID', exact: true })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Entra Internet Access', exact: true })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Entra Private Access', exact: true })).toBeVisible()
  await expect(navigation.getByRole('button', { name: 'Enterprise Mobility + Security', exact: true })).toHaveCount(0)
  await expect(navigation.getByRole('button', { name: 'Microsoft Entra', exact: true })).toHaveCount(0)

  await navigation.getByRole('link', { name: 'Entra Internet Access', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Entra Internet Access', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/product=microsoft\.entra-internet-access/)
})

test('products outside the comparison remain visible under their official family', async ({ page }) => {
  await page.goto('/products?product=microsoft.azure-backup')
  const navigation = page.getByRole('navigation', { name: 'Products', exact: true })
  await expect(navigation.getByRole('button', { name: 'Microsoft Azure', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('link', { name: 'Azure Backup', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Azure Backup', exact: true })).toBeVisible()
})
