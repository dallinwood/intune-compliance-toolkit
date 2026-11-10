import { describe, expect, it } from 'vitest'
import { diffLines, diffSequences, diffWords } from './sequenceDiff'

function summarise(operations: { type: string; items: string[] }[]): [string, string][] {
  return operations.map((operation) => [operation.type, operation.items.join('')])
}

describe('diffWords', () => {
  it('marks only the changed word, keeping the whitespace around it', () => {
    expect(summarise(diffWords('a b c', 'a x c'))).toEqual([
      ['same', 'a '],
      ['removed', 'b'],
      ['added', 'x'],
      ['same', ' c'],
    ])
  })

  it('gives back the original text when every item is joined', () => {
    const before = 'The  quick\nbrown fox'
    const after = 'The quick red\tfox jumps'
    const operations = diffWords(before, after)

    expect(operations.filter((operation) => operation.type !== 'added').flatMap((operation) => operation.items).join('')).toBe(before)
    expect(operations.filter((operation) => operation.type !== 'removed').flatMap((operation) => operation.items).join('')).toBe(after)
  })

  it('gives a single same operation for identical text', () => {
    expect(summarise(diffWords('same words here', 'same words here'))).toEqual([['same', 'same words here']])
  })

  it('gives no operations for two empty texts', () => {
    expect(diffWords('', '')).toEqual([])
  })

  it('gives only an added operation when the text was empty before', () => {
    expect(summarise(diffWords('', 'new text'))).toEqual([['added', 'new text']])
  })
})

describe('diffLines', () => {
  it('marks the two changed lines and keeps the lines around them', () => {
    const before = ['one', 'two', 'three', 'four'].join('\n')
    const after = ['one', 'TWO', 'THREE', 'four'].join('\n')

    expect(diffLines(before, after)).toEqual([
      { type: 'same', items: ['one'] },
      { type: 'removed', items: ['two', 'three'] },
      { type: 'added', items: ['TWO', 'THREE'] },
      { type: 'same', items: ['four'] },
    ])
  })

  it('gives a single same operation for identical text', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([{ type: 'same', items: ['a', 'b'] }])
  })
})

describe('diffSequences', () => {
  it('uses the given equality', () => {
    const operations = diffSequences(['A', 'b'], ['a', 'c'], (left, right) => left.toLowerCase() === right.toLowerCase())

    expect(operations).toEqual([
      { type: 'same', items: ['A'] },
      { type: 'removed', items: ['b'] },
      { type: 'added', items: ['c'] },
    ])
  })

  it('falls back to a whole replace above the size cap, quickly', () => {
    const before = Array.from({ length: 3000 }, (_, position) => `before-${position}`)
    const after = Array.from({ length: 3000 }, (_, position) => `after-${position}`)

    const startedAt = performance.now()
    const operations = diffSequences(before, after)
    const elapsedMilliseconds = performance.now() - startedAt

    expect(operations).toEqual([
      { type: 'removed', items: before },
      { type: 'added', items: after },
    ])
    expect(elapsedMilliseconds).toBeLessThan(50)
  })

  it('still diffs a large sequence with one change in the middle, because the shared ends are trimmed first', () => {
    const before = Array.from({ length: 5000 }, (_, position) => `line-${position}`)
    const after = [...before]
    after[2500] = 'changed'

    const operations = diffSequences(before, after)

    expect(operations.map((operation) => operation.type)).toEqual(['same', 'removed', 'added', 'same'])
    expect(operations[1].items).toEqual(['line-2500'])
  })
})
