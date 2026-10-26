import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import xml from 'highlight.js/lib/languages/xml'
import type { HighlightLanguage } from './codeLanguage'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('python', python)

// highlight.js HTML-escapes the code before it adds its span markup, which is
// what makes inserting this string as HTML safe even though the code comes
// from rule files and overlays.
export function highlightedHtml(code: string, language: HighlightLanguage | undefined): string | null {
  if (language === undefined || hljs.getLanguage(language) === undefined) return null
  return hljs.highlight(code, { language, ignoreIllegals: true }).value
}
