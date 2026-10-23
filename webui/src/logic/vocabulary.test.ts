import { describe, expect, it } from 'vitest'
import { readCommittedVocabularyJson, vocabularyFileOf, vocabularyIndexOf } from './testVocabularyFixtures'
import {
  buildVocabularyIndex,
  compareGroupKeys,
  groupLabel,
  parseVocabularyFile,
  termDescription,
  termGroupKey,
  termLabel,
} from './vocabulary'

const groupedIndex = vocabularyIndexOf({
  benchmarks: [
    { label: 'CIS Level 1', terms: ['cis_lvl1', 'cislevel1'], metadata: ['benchmark'] },
    { label: 'DISA STIG', terms: ['disa_stig'] },
  ],
  sections: [{ label: 'Supplemental', terms: ['supplemental'] }],
  tags: [{ label: 'Supplemental guidance tag', terms: ['supplemental'] }],
  manual_reasons: [
    { label: 'supplemental', terms: ['supplemental'], description: 'Supplemental guidance with no check.' },
    { label: 'inherent', terms: ['inherent'] },
  ],
})

describe('termLabel and termGroupKey', () => {
  it('returns the entry label for any of its terms', () => {
    expect(termLabel(groupedIndex, 'benchmarks', 'cis_lvl1')).toBe('CIS Level 1')
    expect(termLabel(groupedIndex, 'benchmarks', 'cislevel1')).toBe('CIS Level 1')
  })

  it('uses the entry first term as the group key for every term in it', () => {
    expect(termGroupKey(groupedIndex, 'benchmarks', 'cis_lvl1')).toBe('cis_lvl1')
    expect(termGroupKey(groupedIndex, 'benchmarks', 'cislevel1')).toBe('cis_lvl1')
  })

  it('falls back to the raw code for an unlisted term', () => {
    expect(termLabel(groupedIndex, 'benchmarks', 'brand_new_benchmark')).toBe('brand_new_benchmark')
    expect(termGroupKey(groupedIndex, 'benchmarks', 'brand_new_benchmark')).toBe('brand_new_benchmark')
    expect(termDescription(groupedIndex, 'benchmarks', 'brand_new_benchmark')).toBeNull()
  })

  it('resolves the same code separately in each vocabulary', () => {
    expect(termLabel(groupedIndex, 'sections', 'supplemental')).toBe('Supplemental')
    expect(termLabel(groupedIndex, 'tags', 'supplemental')).toBe('Supplemental guidance tag')
    expect(termLabel(groupedIndex, 'manual_reasons', 'supplemental')).toBe('supplemental')
    expect(termDescription(groupedIndex, 'manual_reasons', 'supplemental')).toBe('Supplemental guidance with no check.')
    expect(termDescription(groupedIndex, 'sections', 'supplemental')).toBeNull()
    expect(termLabel(groupedIndex, 'versions', 'supplemental')).toBe('supplemental')
  })

  it('returns null for an entry without a description', () => {
    expect(termDescription(groupedIndex, 'manual_reasons', 'inherent')).toBeNull()
  })
})

describe('groupLabel', () => {
  it('labels a group key, or passes an unknown key through', () => {
    expect(groupLabel(groupedIndex, 'benchmarks', 'cis_lvl1')).toBe('CIS Level 1')
    expect(groupLabel(groupedIndex, 'benchmarks', 'something_else')).toBe('something_else')
  })
})

describe('compareGroupKeys', () => {
  it('puts listed entries first in file order, then unlisted codes alphabetically', () => {
    const index = vocabularyIndexOf({
      sections: [
        { label: 'Operating system', terms: ['os'] },
        { label: 'Password policy', terms: ['pwpolicy'] },
        { label: 'Auditing', terms: ['audit'] },
      ],
    })
    const keys = ['zeta', 'audit', 'alpha', 'pwpolicy', 'os']
    expect([...keys].sort(compareGroupKeys(index, 'sections'))).toEqual(['os', 'pwpolicy', 'audit', 'alpha', 'zeta'])
  })
})

describe('buildVocabularyIndex', () => {
  it('gives raw codes and no warnings for a missing file', () => {
    const { index, warnings } = buildVocabularyIndex(null)
    expect(warnings).toEqual([])
    expect(termLabel(index, 'benchmarks', 'cis_lvl1')).toBe('cis_lvl1')
    expect(termGroupKey(index, 'sections', 'os')).toBe('os')
    expect(termDescription(index, 'manual_reasons', 'inherent')).toBeNull()
    expect(['b', 'a'].sort(compareGroupKeys(index, 'tags'))).toEqual(['a', 'b'])
  })

  it('keeps the first entry for a duplicated term, ignores the later one and warns', () => {
    const { index, warnings } = buildVocabularyIndex(
      vocabularyFileOf({
        benchmarks: [
          { label: 'CIS Level 1', terms: ['cis_lvl1'] },
          { label: 'CIS Level 1 (old)', terms: ['cis_lvl1', 'cislevel1'] },
        ],
      }),
    )
    expect(termLabel(index, 'benchmarks', 'cis_lvl1')).toBe('CIS Level 1')
    expect(termLabel(index, 'benchmarks', 'cislevel1')).toBe('CIS Level 1 (old)')
    expect(termGroupKey(index, 'benchmarks', 'cislevel1')).toBe('cislevel1')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('benchmarks')
    expect(warnings[0]).toContain('cis_lvl1')
  })

  it('drops an entry whose terms are all taken by earlier entries', () => {
    const { index, warnings } = buildVocabularyIndex(
      vocabularyFileOf({
        sections: [
          { label: 'Operating system', terms: ['os'] },
          { label: 'OS again', terms: ['os'] },
        ],
      }),
    )
    expect(termLabel(index, 'sections', 'os')).toBe('Operating system')
    expect(warnings).toHaveLength(1)
  })

  it('quietly ignores a term repeated within one entry', () => {
    const { index, warnings } = buildVocabularyIndex(
      vocabularyFileOf({ benchmarks: [{ label: 'CIS Level 1', terms: ['cis_lvl1', 'cis_lvl1', 'cislevel1'] }] }),
    )
    expect(warnings).toEqual([])
    expect(termLabel(index, 'benchmarks', 'cis_lvl1')).toBe('CIS Level 1')
    expect(termGroupKey(index, 'benchmarks', 'cislevel1')).toBe('cis_lvl1')
  })

  it('allows the same term in different vocabularies without a warning', () => {
    expect(
      buildVocabularyIndex(
        vocabularyFileOf({
          sections: [{ label: 'Supplemental', terms: ['supplemental'] }],
          manual_reasons: [{ label: 'supplemental', terms: ['supplemental'] }],
        }),
      ).warnings,
    ).toEqual([])
  })
})

describe('parseVocabularyFile', () => {
  it('accepts a well-formed file', () => {
    const file = vocabularyFileOf({ tags: [], sections: [{ label: 'Operating system', terms: ['os'], metadata: ['x'], description: 'd' }] })
    expect(parseVocabularyFile(file)).toEqual({ file })
  })

  it('accepts a severities vocabulary', () => {
    const file = vocabularyFileOf({ severities: [{ label: 'CAT I', terms: ['high'], metadata: ['severity'] }] })
    expect(parseVocabularyFile(file)).toEqual({ file })
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', []],
    ['a wrong schema version', { schema_version: 2, vocabularies: {} }],
    ['missing vocabularies', { schema_version: 1 }],
    ['vocabularies as an array', { schema_version: 1, vocabularies: [] }],
    ['an unknown vocabulary', { schema_version: 1, vocabularies: { frameworks: [] } }],
    ['a vocabulary that is not a list', { schema_version: 1, vocabularies: { sections: {} } }],
    ['an entry without terms', { schema_version: 1, vocabularies: { sections: [{ label: 'Operating system' }] } }],
    ['an entry with no terms', { schema_version: 1, vocabularies: { sections: [{ label: 'Operating system', terms: [] }] } }],
    ['an empty term', { schema_version: 1, vocabularies: { sections: [{ label: 'Operating system', terms: [''] }] } }],
    ['an empty label', { schema_version: 1, vocabularies: { sections: [{ label: '', terms: ['os'] }] } }],
    ['a non-string metadata tag', { schema_version: 1, vocabularies: { sections: [{ label: 'A', terms: ['os'], metadata: [1] }] } }],
    ['an empty description', { schema_version: 1, vocabularies: { sections: [{ label: 'A', terms: ['os'], description: '' }] } }],
    ['an unknown entry key', { schema_version: 1, vocabularies: { sections: [{ label: 'A', terms: ['os'], colour: 'red' }] } }],
  ])('rejects %s with a reason', (_description, value) => {
    const parsed = parseVocabularyFile(value)
    expect('error' in parsed && parsed.error.length > 0).toBe(true)
  })
})

describe('committed baselines/_vocabulary.json', () => {
  const parsed = parseVocabularyFile(readCommittedVocabularyJson())

  it('parses and indexes without warnings', () => {
    if ('error' in parsed) throw new Error(parsed.error)
    expect(buildVocabularyIndex(parsed.file).warnings).toEqual([])
  })

  // Labels stay raw so the UI reads as before; the entries exist for order.
  it('lists the severities low, medium and high in that order with raw labels', () => {
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.file.vocabularies.severities).toEqual([
      { label: 'low', terms: ['low'], metadata: ['severity'] },
      { label: 'medium', terms: ['medium'], metadata: ['severity'] },
      { label: 'high', terms: ['high'], metadata: ['severity'] },
    ])
  })
})
