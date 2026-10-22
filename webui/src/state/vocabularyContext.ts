import { createContext, useContext } from 'react'
import { EMPTY_VOCABULARY_INDEX, type VocabularyIndex } from '../logic/vocabulary'

// Loaded once in App and read by whichever component displays a code word,
// so the index is not threaded through every component's props. Without a
// provider, codes show raw.
export const VocabularyContext = createContext<VocabularyIndex>(EMPTY_VOCABULARY_INDEX)

export function useVocabularyIndex(): VocabularyIndex {
  return useContext(VocabularyContext)
}
