// Shared by the tests only; nothing in the app imports it.
import { readFileSync } from 'node:fs'
import type { VocabularyEntry, VocabularyFile, VocabularyName } from '../types/vocabulary'
import { buildVocabularyIndex, parseVocabularyFile, type VocabularyIndex } from './vocabulary'

const BASELINES_DIRECTORY = new URL('../../../baselines/', import.meta.url)

export function readCommittedVocabularyJson(): unknown {
  return JSON.parse(readFileSync(new URL('_vocabulary.json', BASELINES_DIRECTORY), 'utf8'))
}

// The committed baselines/_vocabulary.json, so tests that check display text
// see exactly what the app shows.
export function committedVocabularyIndex(): VocabularyIndex {
  const parsed = parseVocabularyFile(readCommittedVocabularyJson())
  if ('error' in parsed) throw new Error(`Committed vocabulary is invalid: ${parsed.error}`)
  const { index, warnings } = buildVocabularyIndex(parsed.file)
  if (warnings.length > 0) throw new Error(`Committed vocabulary has warnings: ${warnings.join('; ')}`)
  return index
}

export function vocabularyFileOf(vocabularies: Partial<Record<VocabularyName, VocabularyEntry[]>>): VocabularyFile {
  return { schema_version: 1, vocabularies }
}

export function vocabularyIndexOf(vocabularies: Partial<Record<VocabularyName, VocabularyEntry[]>>): VocabularyIndex {
  return buildVocabularyIndex(vocabularyFileOf(vocabularies)).index
}
