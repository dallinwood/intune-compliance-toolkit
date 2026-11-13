import type { Page } from '@playwright/test'

// Facet groups other than Automation, Target and Source start closed unless
// they hold a selection, so a spec that ticks one opens it first.
export async function openFacetGroup(page: Page, title: string) {
  const selectedCountSuffix = '( [(][0-9]+ selected[)])?'
  const toggle = page.getByRole('heading', { name: new RegExp(`^${title}${selectedCountSuffix}$`) }).getByRole('button')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
}
