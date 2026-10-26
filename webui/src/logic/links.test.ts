import { describe, expect, it } from 'vitest'
import { linkSegments } from './links'

const link = (href: string) => ({ kind: 'link', text: href, href })

describe('linkSegments', () => {
  it('links a URL on its own', () => {
    expect(linkSegments('https://example.com/a/b?x=1#top')).toEqual([link('https://example.com/a/b?x=1#top')])
  })

  it('links a URL inside a sentence and keeps the surrounding text', () => {
    expect(linkSegments('Read http://example.com/guide for details')).toEqual([
      { kind: 'text', text: 'Read ' },
      link('http://example.com/guide'),
      { kind: 'text', text: ' for details' },
    ])
  })

  it.each([
    ['see https://example.com/a.', 'https://example.com/a', '.'],
    ['https://example.com/a, then', 'https://example.com/a', ', then'],
    ['(see https://example.com/a)', 'https://example.com/a', ')'],
    ['"https://example.com/a"', 'https://example.com/a', '"'],
    ["'https://example.com/a'", 'https://example.com/a', "'"],
  ])('leaves trailing punctuation out of the link in %s', (input, href, trailing) => {
    const segments = linkSegments(input)
    expect(segments).toContainEqual(link(href))
    expect(segments[segments.length - 1]).toEqual({ kind: 'text', text: trailing })
  })

  it('finds several URLs', () => {
    expect(linkSegments('https://a.example/x, https://b.example/y')).toEqual([
      link('https://a.example/x'),
      { kind: 'text', text: ', ' },
      link('https://b.example/y'),
    ])
  })

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'mailto:someone@example.com', 'ftp://example.com/file'])(
    'does not link %s',
    (input) => {
      expect(linkSegments(input)).toEqual([{ kind: 'text', text: input }])
    },
  )

  it('returns text with no URL unchanged', () => {
    expect(linkSegments('NIST SP 800-53, AC-2')).toEqual([{ kind: 'text', text: 'NIST SP 800-53, AC-2' }])
  })

  it('returns no segments for empty text', () => {
    expect(linkSegments('')).toEqual([])
  })
})
