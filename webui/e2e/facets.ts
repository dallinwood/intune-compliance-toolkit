import type { Page } from '@playwright/test'

// Every facet group starts open, but a spec may have closed one, so a spec
// that ticks an option makes sure its group is open first.
export async function openFacetGroup(page: Page, title: string) {
  const selectedCountSuffix = '( [(][0-9]+ selected[)])?'
  const toggle = page.getByRole('heading', { name: new RegExp(`^${title}${selectedCountSuffix}$`) }).getByRole('button')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
}
