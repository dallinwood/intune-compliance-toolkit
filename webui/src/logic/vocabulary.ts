import { VOCABULARY_NAMES, type VocabularyEntry, type VocabularyFile, type VocabularyName } from '../types/vocabulary'

export type { VocabularyName } from '../types/vocabulary'

// Display names come from baselines/_vocabulary.json, never from code. An
// entry may list several terms (e.g. a benchmark mSCP renamed between
// releases); the UI treats them as one, identified by a group key: the
// entry's first term. A code the file does not list is its own group and is
// shown as-is.

interface IndexedEntry {
  groupKey: string
  label: string
  description: string | null
  position: number
}

interface IndexedVocabulary {
  entryByTerm: ReadonlyMap<string, IndexedEntry>
  entryByGroupKey: ReadonlyMap<string, IndexedEntry>
}

export type VocabularyIndex = Readonly<Record<VocabularyName, IndexedVocabulary>>

// A term may belong to one entry per vocabulary. The Python validator
// rejects a file that breaks this; the UI keeps the first entry for the term
// and warns instead, so a bad edit never stops the app from loading.
function indexVocabulary(vocabularyName: VocabularyName, entries: VocabularyEntry[], warnings: string[]): IndexedVocabulary {
  const entryByTerm = new Map<string, IndexedEntry>()
  const entryByGroupKey = new Map<string, IndexedEntry>()
  entries.forEach((entry, position) => {
    let indexedEntry: IndexedEntry | null = null
    for (const term of entry.terms) {
      const existingEntry = entryByTerm.get(term)
      if (existingEntry) {
        warnings.push(
          `Vocabulary "${vocabularyName}": term "${term}" is already listed under "${existingEntry.label}", ` +
            `so it is ignored under "${entry.label}".`,
        )
        continue
      }
      if (!indexedEntry) {
        indexedEntry = { groupKey: term, label: entry.label, description: entry.description ?? null, position }
        entryByGroupKey.set(term, indexedEntry)
      }
      entryByTerm.set(term, indexedEntry)
    }
  })
  return { entryByTerm, entryByGroupKey }
}

export function buildVocabularyIndex(file: VocabularyFile | null): { index: VocabularyIndex; warnings: string[] } {
  const warnings: string[] = []
  const index = Object.fromEntries(
    VOCABULARY_NAMES.map((vocabularyName) => [
      vocabularyName,
      indexVocabulary(vocabularyName, file?.vocabularies[vocabularyName] ?? [], warnings),
    ]),
  ) as Record<VocabularyName, IndexedVocabulary>
  return { index, warnings }
}

export const EMPTY_VOCABULARY_INDEX: VocabularyIndex = buildVocabularyIndex(null).index

export function termGroupKey(index: VocabularyIndex, vocabulary: VocabularyName, code: string): string {
  return index[vocabulary].entryByTerm.get(code)?.groupKey ?? code
}

export function termLabel(index: VocabularyIndex, vocabulary: VocabularyName, code: string): string {
  return index[vocabulary].entryByTerm.get(code)?.label ?? code
}

export function groupLabel(index: VocabularyIndex, vocabulary: VocabularyName, groupKey: string): string {
  return index[vocabulary].entryByGroupKey.get(groupKey)?.label ?? groupKey
}

export function termDescription(index: VocabularyIndex, vocabulary: VocabularyName, code: string): string | null {
  return index[vocabulary].entryByTerm.get(code)?.description ?? null
}

// Listed entries in file order first, then unlisted codes alphabetically.
export function compareGroupKeys(index: VocabularyIndex, vocabulary: VocabularyName): (left: string, right: string) => number {
  const entryByGroupKey = index[vocabulary].entryByGroupKey
  return (left, right) => {
    const leftPosition = entryByGroupKey.get(left)?.position
    const rightPosition = entryByGroupKey.get(right)?.position
    if (leftPosition !== undefined && rightPosition !== undefined) return leftPosition - rightPosition
    if (leftPosition !== undefined) return -1
    if (rightPosition !== undefined) return 1
    return left.localeCompare(right)
  }
}

// The fetched file is untyped JSON, so its shape is checked here (mirroring
// baselines/_vocabulary.schema.json) before anything trusts it. Any problem
// rejects the whole file: the UI then shows raw codes and a warning.

const ENTRY_KEYS = new Set(['label', 'terms', 'metadata', 'description'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonEmptyStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function isVocabularyName(name: string): name is VocabularyName {
  return (VOCABULARY_NAMES as readonly string[]).includes(name)
}

function entryProblem(entry: unknown, path: string): string | null {
  if (!isRecord(entry)) return `${path} must be an object`
  const unknownKey = Object.keys(entry).find((key) => !ENTRY_KEYS.has(key))
  if (unknownKey !== undefined) return `${path} has an unknown key "${unknownKey}"`
  if (!isNonEmptyString(entry.label)) return `${path}.label must be a non-empty string`
  if (!isNonEmptyStringList(entry.terms) || entry.terms.length === 0) {
    return `${path}.terms must be a non-empty list of non-empty strings`
  }
  if (entry.metadata !== undefined && !isNonEmptyStringList(entry.metadata)) {
    return `${path}.metadata must be a list of non-empty strings`
  }
  if (entry.description !== undefined && !isNonEmptyString(entry.description)) {
    return `${path}.description must be a non-empty string`
  }
  return null
}

function vocabularyFileProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the file must hold a JSON object'
  if (value.schema_version !== 1) return 'schema_version must be 1'
  const unknownTopLevelKey = Object.keys(value).find((key) => key !== 'schema_version' && key !== 'vocabularies')
  if (unknownTopLevelKey !== undefined) return `unknown top-level key "${unknownTopLevelKey}"`
  if (!isRecord(value.vocabularies)) return 'vocabularies must be an object'
  for (const [vocabularyName, entries] of Object.entries(value.vocabularies)) {
    if (!isVocabularyName(vocabularyName)) return `unknown vocabulary "${vocabularyName}"`
    if (!Array.isArray(entries)) return `vocabularies.${vocabularyName} must be a list`
    for (const [position, entry] of entries.entries()) {
      const problem = entryProblem(entry, `vocabularies.${vocabularyName}[${position}]`)
      if (problem) return problem
    }
  }
  return null
}

export function parseVocabularyFile(value: unknown): { file: VocabularyFile } | { error: string } {
  const problem = vocabularyFileProblem(value)
  return problem === null ? { file: value as VocabularyFile } : { error: problem }
}
