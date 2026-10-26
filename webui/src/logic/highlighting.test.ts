import { describe, expect, it } from 'vitest'
import { highlightedHtml } from './highlighting'

describe('highlightedHtml', () => {
  it('escapes markup and ampersands in the input', () => {
    const html = highlightedHtml('echo "<script>alert(1)</script>" && true', 'bash') ?? ''
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;&amp;')
  })

  it('wraps tokens in hljs spans and keeps the text unchanged', () => {
    const html = highlightedHtml('Get-Item $ODV', 'powershell') ?? ''
    expect(html).toContain('hljs-')
    expect(html.replace(/<[^>]+>/g, '')).toBe('Get-Item $ODV')
  })

  it('returns null when there is no registered language', () => {
    expect(highlightedHtml('x', undefined)).toBeNull()
  })
})
