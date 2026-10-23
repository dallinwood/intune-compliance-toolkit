import { describe, expect, it } from 'vitest'
import { parseDiscussion, parseInline, parseMarkdownDiscussion } from './discussionMarkup'

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

  it('does not read markdown links in AsciiDoc text', () => {
    expect(parseInline('[ACSC](https://www.cyber.gov.au/)')).toEqual([
      { kind: 'text', text: '[ACSC](' },
      { kind: 'link', text: 'https://www.cyber.gov.au/', href: 'https://www.cyber.gov.au/' },
      { kind: 'text', text: ')' },
    ])
  })
})

const ISM_1803_DISCUSSION = [
  'A cyber security incident register contains the following for each cyber security incident:',
  '',
  '- the date the cyber security incident occurred',
  '- the date the cyber security incident was discovered',
  '- a description of the cyber security incident',
  '- any actions taken in response to the cyber security incident',
  '- to whom the cyber security incident was reported.',
  '',
  'Developing, implementing and maintaining a register can assist remediation.',
].join('\n')

describe('parseMarkdownDiscussion', () => {
  it('reads a lead-in, a bullet list and a closing paragraph as three blocks', () => {
    expect(parseMarkdownDiscussion(ISM_1803_DISCUSSION)).toEqual([
      { kind: 'paragraph', text: 'A cyber security incident register contains the following for each cyber security incident:' },
      {
        kind: 'list',
        items: [
          'the date the cyber security incident occurred',
          'the date the cyber security incident was discovered',
          'a description of the cyber security incident',
          'any actions taken in response to the cyber security incident',
          'to whom the cyber security incident was reported.',
        ],
      },
      { kind: 'paragraph', text: 'Developing, implementing and maintaining a register can assist remediation.' },
    ])
  })

  it('starts a list directly after a paragraph line and ends it at the next plain line', () => {
    expect(parseMarkdownDiscussion('Intro\n- one\n- two\nOutro')).toEqual([
      { kind: 'paragraph', text: 'Intro' },
      { kind: 'list', items: ['one', 'two'] },
      { kind: 'paragraph', text: 'Outro' },
    ])
  })

  it('does not treat AsciiDoc syntax as markup', () => {
    expect(parseMarkdownDiscussion('[source,bash]\n----\nls\n----')).toEqual([
      { kind: 'paragraph', text: '[source,bash]\n----\nls\n----' },
    ])
  })
})

describe('parseInline for markdown', () => {
  it('turns [text](https://...) into a link', () => {
    expect(parseInline('see [ACSC](https://www.cyber.gov.au/) now', 'markdown')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'ACSC', href: 'https://www.cyber.gov.au/' },
      { kind: 'text', text: ' now' },
    ])
  })

  it('leaves a link with a non-http URL as text', () => {
    expect(parseInline('[x](javascript:alert(1))', 'markdown')).toEqual([{ kind: 'text', text: '[x](javascript:alert(1))' }])
  })

  it('leaves underscores and backticks alone, since ISM text never uses them as markup', () => {
    expect(parseInline('use _this_ and `that`', 'markdown')).toEqual([{ kind: 'text', text: 'use _this_ and `that`' }])
  })
})

describe('parseDiscussion on a hyphen-led list', () => {
  it('keeps the lines as AsciiDoc paragraph text', () => {
    expect(parseDiscussion('Steps:\n- first\n- second')).toEqual([{ kind: 'paragraph', text: 'Steps:\n- first\n- second' }])
  })
})
