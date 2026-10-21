import { describe, expect, it } from 'vitest'
import { parseDiscussion, parseInline } from './discussionMarkup'

describe('parseDiscussion', () => {
  it('splits paragraphs on blank lines and keeps line breaks within one', () => {
    expect(parseDiscussion('First line\nsecond line\n\nNext paragraph.\n')).toEqual([
      { kind: 'paragraph', text: 'First line\nsecond line' },
      { kind: 'paragraph', text: 'Next paragraph.' },
    ])
  })

  it('renders a [source,bash] block delimited by ---- as code', () => {
    expect(parseDiscussion('Run this:\n[source,bash]\n----\n/usr/bin/fdesetup enable\n\necho done\n----\nAfter.')).toEqual([
      { kind: 'paragraph', text: 'Run this:' },
      { kind: 'code', text: '/usr/bin/fdesetup enable\n\necho done' },
      { kind: 'paragraph', text: 'After.' },
    ])
  })

  it('renders a [source] block without delimiters as code up to the next blank line', () => {
    expect(parseDiscussion('[source,bash]\n-  /usr/sbin/firmwarepasswd -setpasswd\n-\n\nNOTE: text')).toEqual([
      { kind: 'code', text: '-  /usr/sbin/firmwarepasswd -setpasswd\n-' },
      { kind: 'paragraph', text: 'NOTE: text' },
    ])
  })

  it('renders a |=== table as preformatted code', () => {
    expect(parseDiscussion('[%header,cols="3,7"]\n|===\n|Port\n|Service\n\n|22\n|SSH\n|===')).toEqual([
      { kind: 'code', text: '|Port\n|Service\n\n|22\n|SSH' },
    ])
  })

  it('turns admonition markers and section titles into headings and drops block delimiters', () => {
    expect(parseDiscussion('[IMPORTANT]\n====\nBe careful.\n====\n\n[discrete]\n==== Using fdesetup\nText')).toEqual([
      { kind: 'heading', text: 'Important' },
      { kind: 'paragraph', text: 'Be careful.' },
      { kind: 'heading', text: 'Using fdesetup' },
      { kind: 'paragraph', text: 'Text' },
    ])
  })
})

describe('parseInline', () => {
  it('marks _text_ as emphasis', () => {
    expect(parseInline('Gatekeeper _MUST_ be enabled.')).toEqual([
      { kind: 'text', text: 'Gatekeeper ' },
      { kind: 'emphasis', text: 'MUST' },
      { kind: 'text', text: ' be enabled.' },
    ])
  })

  it('leaves underscores inside identifiers alone', () => {
    expect(parseInline('see system_settings_filevault_enforce here')).toEqual([
      { kind: 'text', text: 'see system_settings_filevault_enforce here' },
    ])
  })

  it('marks backticks as code', () => {
    expect(parseInline('run `pfctl` now')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'pfctl' },
      { kind: 'text', text: ' now' },
    ])
  })

  it('turns link: macros and bare https URLs into links', () => {
    expect(parseInline('see link:https://example.com/a[the docs] or https://example.com/b.')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'the docs', href: 'https://example.com/a' },
      { kind: 'text', text: ' or ' },
      { kind: 'link', text: 'https://example.com/b', href: 'https://example.com/b' },
      { kind: 'text', text: '.' },
    ])
  })

  it('uses the URL as the text of a link macro with empty brackets', () => {
    expect(parseInline('link:https://example.com/x[]')).toEqual([
      { kind: 'link', text: 'https://example.com/x', href: 'https://example.com/x' },
    ])
  })
})
