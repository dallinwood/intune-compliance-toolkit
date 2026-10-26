export type CopyOutcome = 'copied' | 'unavailable' | 'rejected'

export interface TextClipboard {
  writeText(text: string): Promise<void>
}

// navigator.clipboard is undefined outside a secure context (plain http on a
// non-localhost host), and writeText rejects when the page lacks permission
// or focus, so each case is reported separately for the caller to word.
export async function copyTextToClipboard(
  text: string,
  clipboard: TextClipboard | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
): Promise<CopyOutcome> {
  if (!clipboard) return 'unavailable'
  try {
    await clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'rejected'
  }
}
