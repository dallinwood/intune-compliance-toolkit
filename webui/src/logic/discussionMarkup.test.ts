import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nestListItems, parseDiscussion, parseInline, parseMarkdownDiscussion } from './discussionMarkup'

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
      { kind: 'code', text: '/usr/bin/fdesetup enable\n\necho done', sourceLanguage: 'bash' },
      { kind: 'paragraph', text: 'After.' },
    ])
  })

  it('renders a [source] block without delimiters as code up to the next blank line', () => {
    expect(parseDiscussion('[source,bash]\n-  /usr/sbin/firmwarepasswd -setpasswd\n-\n\nNOTE: text')).toEqual([
      { kind: 'code', text: '-  /usr/sbin/firmwarepasswd -setpasswd\n-', sourceLanguage: 'bash' },
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

function topLevel(text: string) {
  return { text, depth: 0 }
}

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
        ].map(topLevel),
      },
      { kind: 'paragraph', text: 'Developing, implementing and maintaining a register can assist remediation.' },
    ])
  })

  it('starts a list directly after a paragraph line and ends it at the next plain line', () => {
    expect(parseMarkdownDiscussion('Intro\n- one\n- two\nOutro')).toEqual([
      { kind: 'paragraph', text: 'Intro' },
      { kind: 'list', items: ['one', 'two'].map(topLevel) },
      { kind: 'paragraph', text: 'Outro' },
    ])
  })

  it('reads a ## line as a heading block and ends the paragraph or list before it', () => {
    expect(parseMarkdownDiscussion(['Intro', '## Control', '- one', '## Discussion', 'Body'].join('\n'))).toEqual([
      { kind: 'paragraph', text: 'Intro' },
      { kind: 'heading', text: 'Control' },
      { kind: 'list', items: [topLevel('one')] },
      { kind: 'heading', text: 'Discussion' },
      { kind: 'paragraph', text: 'Body' },
    ])
  })

  it('reads one or more # followed by a space as a heading, and a # with no space as text', () => {
    const text = ['# Principle', 'Prose', '## Sub', '- one', '#hashtag', '#'].join('\n')
    expect(parseMarkdownDiscussion(text)).toEqual([
      { kind: 'heading', text: 'Principle' },
      { kind: 'paragraph', text: 'Prose' },
      { kind: 'heading', text: 'Sub' },
      { kind: 'list', items: [topLevel('one')] },
      { kind: 'paragraph', text: '#hashtag\n#' },
    ])
  })

  it('reads two spaces of indentation per list depth, and fails safe to depth 2 beyond that', () => {
    const text = ['- top', '  - middle', '    - deepest', '      - too deep', '        - far too deep', '- top again'].join('\n')
    expect(parseMarkdownDiscussion(text)).toEqual([
      {
        kind: 'list',
        items: [
          { text: 'top', depth: 0 },
          { text: 'middle', depth: 1 },
          { text: 'deepest', depth: 2 },
          { text: 'too deep', depth: 2 },
          { text: 'far too deep', depth: 2 },
          { text: 'top again', depth: 0 },
        ],
      },
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

describe('nestListItems', () => {
  it('nests each item under the closest earlier item one level up', () => {
    const items = [
      { text: 'a', depth: 0 },
      { text: 'a1', depth: 1 },
      { text: 'a1x', depth: 2 },
      { text: 'a2', depth: 1 },
      { text: 'b', depth: 0 },
    ]
    expect(nestListItems(items)).toEqual([
      {
        text: 'a',
        children: [
          { text: 'a1', children: [{ text: 'a1x', children: [] }] },
          { text: 'a2', children: [] },
        ],
      },
      { text: 'b', children: [] },
    ])
  })

  it('attaches an item indented more than one level below its predecessor one level down instead', () => {
    expect(nestListItems([{ text: 'top', depth: 0 }, { text: 'skipped', depth: 2 }])).toEqual([
      { text: 'top', children: [{ text: 'skipped', children: [] }] },
    ])
  })
})

describe('Markdown discussions in the committed libraries', () => {
  function committedDiscussion(relativePath: string): string {
    const rulePath = new URL(`../../../baselines/${relativePath}`, import.meta.url)
    return (JSON.parse(readFileSync(rulePath, 'utf8')) as { discussion: string }).discussion
  }

  it('parses a real ISM discussion to the paragraphs and flat list it always did', () => {
    const blocks = parseMarkdownDiscussion(committedDiscussion('asd_ism/releases/v2026.09.4/rules/ism-1803.json'))
    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'paragraph'])
    const list = blocks[1]
    if (list.kind !== 'list') throw new Error('expected a list block')
    expect(list.items.map((item) => item.depth)).toEqual([0, 0, 0, 0, 0])
    expect(list.items[0].text).toBe('the date the cyber security incident occurred')
  })

  it('reads nist_800_53.ac-2 as Control and Discussion headings with three-item lists nested under item d', () => {
    const blocks = parseMarkdownDiscussion(committedDiscussion('nist_800_53/releases/v1.6.0/rules/ac-2.json'))
    expect(blocks.filter((block) => block.kind === 'heading')).toEqual([
      { kind: 'heading', text: 'Control' },
      { kind: 'heading', text: 'Discussion' },
    ])
    const controlList = blocks.find((block) => block.kind === 'list')
    if (controlList?.kind !== 'list') throw new Error('expected a list block')
    expect(controlList.items.slice(3, 7)).toEqual([
      { text: 'd. Specify:', depth: 0 },
      { text: '1. Authorized users of the system;', depth: 1 },
      { text: '2. Group and role membership; and', depth: 1 },
      { text: '3. Access authorizations (i.e., privileges) and [Assignment: organization-defined attributes (as required)] for each account;', depth: 1 },
    ])
  })

  it('reads asd_e4eit.it.pro-13.1 as Principle and Indicators headings with three effectiveness lists', () => {
    const blocks = parseMarkdownDiscussion(committedDiscussion('asd_e4eit/releases/v2026.10.15/rules/it.pro-13.1.json'))
    expect(blocks.filter((block) => block.kind === 'heading')).toEqual([
      { kind: 'heading', text: 'Principle' },
      { kind: 'heading', text: 'Indicators of Good Practice' },
    ])
    expect(blocks.filter((block) => block.kind === 'list')).toHaveLength(3)
  })
})
