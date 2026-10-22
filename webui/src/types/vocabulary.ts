// Mirrors baselines/_vocabulary.schema.json: the hand-edited display names
// for the code words the rule library uses. Field names stay snake_case as
// in the JSON.

export const VOCABULARY_NAMES = ['platforms', 'sources', 'benchmarks', 'severities', 'os_versions', 'sections', 'tags', 'manual_reasons'] as const

export type VocabularyName = (typeof VOCABULARY_NAMES)[number]

export interface VocabularyEntry {
  label: string
  terms: string[]
  metadata?: string[]
  description?: string
}

export interface VocabularyFile {
  schema_version: 1
  vocabularies: Partial<Record<VocabularyName, VocabularyEntry[]>>
}
