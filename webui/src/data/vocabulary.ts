import { parseVocabularyFile } from '../logic/vocabulary'
import type { VocabularyFile } from '../types/vocabulary'

const VOCABULARY_PATH = 'baselines/_vocabulary.json'

// Never rejects: display names are a convenience, so a missing or broken
// file leaves the app usable with raw codes and a warning.
export async function fetchVocabulary(): Promise<{ file: VocabularyFile | null; warning: string | null }> {
  const unavailable = (reason: string) => ({ file: null, warning: `Display names could not be loaded (${reason}), so raw codes are shown.` })

  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}${VOCABULARY_PATH}`)
  } catch (error: unknown) {
    return unavailable(`${VOCABULARY_PATH}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) return unavailable(`${VOCABULARY_PATH}: ${response.status} ${response.statusText}`.trim())

  let value: unknown
  try {
    // A dev server may answer a missing file with its HTML fallback page and
    // a 200, so a parse failure is the real signal, not only the status.
    value = await response.json()
  } catch {
    return unavailable(`${VOCABULARY_PATH} is not valid JSON`)
  }

  const parsed = parseVocabularyFile(value)
  if ('error' in parsed) return unavailable(`${VOCABULARY_PATH}: ${parsed.error}`)
  return { file: parsed.file, warning: null }
}
