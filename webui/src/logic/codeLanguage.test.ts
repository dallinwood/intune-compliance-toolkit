import { describe, expect, it } from 'vitest'
import {
  INLINE_PAYLOAD_LANGUAGE,
  payloadFileHighlightLanguage,
  scriptHighlightLanguage,
  sourceAttributeHighlightLanguage,
} from './codeLanguage'
import { parseDiscussion } from './discussionMarkup'

describe('scriptHighlightLanguage', () => {
  it('maps each script language, zsh sharing the bash grammar', () => {
    expect(scriptHighlightLanguage('bash')).toBe('bash')
    expect(scriptHighlightLanguage('zsh')).toBe('bash')
    expect(scriptHighlightLanguage('powershell')).toBe('powershell')
    expect(scriptHighlightLanguage('python')).toBe('python')
  })

  it('maps a missing or unknown language to none', () => {
    expect(scriptHighlightLanguage(undefined)).toBeUndefined()
    expect(scriptHighlightLanguage('toString' as never)).toBeUndefined()
  })
})

describe('payloadFileHighlightLanguage', () => {
  it('maps JSON to json and the XML-shaped formats to xml', () => {
    expect(payloadFileHighlightLanguage('baselines/x/Policy.json')).toBe('json')
    for (const extension of ['mobileconfig', 'plist', 'xml', 'admx', 'adml']) {
      expect(payloadFileHighlightLanguage(`baselines/x/File.${extension}`)).toBe('xml')
    }
  })

  it('leaves .reg and unknown extensions plain', () => {
    expect(payloadFileHighlightLanguage('baselines/x/Policy.reg')).toBeUndefined()
    expect(payloadFileHighlightLanguage('baselines/x/Policy.txt')).toBeUndefined()
    expect(payloadFileHighlightLanguage('noextension')).toBeUndefined()
  })

  it('shows inline payloads as json', () => {
    expect(INLINE_PAYLOAD_LANGUAGE).toBe('json')
  })
})

describe('sourceAttributeHighlightLanguage', () => {
  it('maps common AsciiDoc source languages and ignores case', () => {
    expect(sourceAttributeHighlightLanguage('bash')).toBe('bash')
    expect(sourceAttributeHighlightLanguage('Shell')).toBe('bash')
    expect(sourceAttributeHighlightLanguage('xml')).toBe('xml')
  })

  it('leaves an absent or unknown language plain', () => {
    expect(sourceAttributeHighlightLanguage(undefined)).toBeUndefined()
    expect(sourceAttributeHighlightLanguage('cobol')).toBeUndefined()
    expect(sourceAttributeHighlightLanguage('constructor')).toBeUndefined()
  })
})

describe('discussion source language', () => {
  it('is exposed on a [source,bash] block and absent on a bare listing', () => {
    const blocks = parseDiscussion('[source,bash]\n----\nls\n----\n\n----\nplain\n----')
    expect(blocks).toEqual([
      { kind: 'code', text: 'ls', sourceLanguage: 'bash' },
      { kind: 'code', text: 'plain' },
    ])
  })

  it('takes the first positional attribute after source', () => {
    expect(parseDiscussion('[source, xml, linenums]\n----\n<a/>\n----')).toEqual([
      { kind: 'code', text: '<a/>', sourceLanguage: 'xml' },
    ])
  })
})
