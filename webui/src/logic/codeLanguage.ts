// Maps what the library says about a piece of code (a script's language, a
// payload's file extension, an AsciiDoc [source,...] attribute) to the id of
// a highlight.js language. Anything unrecognised maps to undefined, and the
// code is then shown as plain text: there is deliberately no auto-detection,
// which would guess wrongly on short snippets and cost bundle size.

import type { ScriptLanguage } from '../types/library'

export type HighlightLanguage = 'bash' | 'powershell' | 'json' | 'xml' | 'python'

const SCRIPT_LANGUAGES: Record<ScriptLanguage, HighlightLanguage> = {
  bash: 'bash',
  zsh: 'bash',
  powershell: 'powershell',
  python: 'python',
}

const PAYLOAD_EXTENSION_LANGUAGES: Record<string, HighlightLanguage> = {
  '.json': 'json',
  '.mobileconfig': 'xml',
  '.plist': 'xml',
  '.xml': 'xml',
  '.admx': 'xml',
  '.adml': 'xml',
}

const SOURCE_ATTRIBUTE_LANGUAGES: Record<string, HighlightLanguage> = {
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  powershell: 'powershell',
  ps1: 'powershell',
  json: 'json',
  xml: 'xml',
  plist: 'xml',
  python: 'python',
  py: 'python',
}

export function scriptHighlightLanguage(language: ScriptLanguage | undefined): HighlightLanguage | undefined {
  return language !== undefined && Object.hasOwn(SCRIPT_LANGUAGES, language) ? SCRIPT_LANGUAGES[language] : undefined
}

// Inline payloads (mobileconfig and ddm alike) are shown as stringified JSON.
export const INLINE_PAYLOAD_LANGUAGE: HighlightLanguage = 'json'

export function payloadFileHighlightLanguage(path: string): HighlightLanguage | undefined {
  const extensionStart = path.lastIndexOf('.')
  if (extensionStart === -1) return undefined
  const extension = path.slice(extensionStart).toLowerCase()
  return Object.hasOwn(PAYLOAD_EXTENSION_LANGUAGES, extension) ? PAYLOAD_EXTENSION_LANGUAGES[extension] : undefined
}

export function sourceAttributeHighlightLanguage(sourceLanguage: string | undefined): HighlightLanguage | undefined {
  if (sourceLanguage === undefined) return undefined
  const key = sourceLanguage.trim().toLowerCase()
  return Object.hasOwn(SOURCE_ATTRIBUTE_LANGUAGES, key) ? SOURCE_ATTRIBUTE_LANGUAGES[key] : undefined
}
