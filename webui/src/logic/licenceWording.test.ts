import { describe, expect, it } from 'vitest'
import { licenceLeadIn } from './licenceWording'

describe('licenceLeadIn', () => {
  it('credits a public-domain dedication "under" it', () => {
    expect(licenceLeadIn('CC0 1.0 (public domain)')).toBe('under')
  })

  it('keeps "licensed" for a licence that grants permissions', () => {
    expect(licenceLeadIn('CC BY 4.0')).toBe('licensed')
  })
})
