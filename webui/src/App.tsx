import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import { loadCatalogIndex, type LoadedCatalogIndex } from './data/catalog'
import { loadLibrary, type Library } from './data/ruleRows'
import { fetchVocabulary } from './data/vocabulary'
import { buildVocabularyIndex, type VocabularyIndex } from './logic/vocabulary'

interface Vocabulary {
  index: VocabularyIndex
  warnings: string[]
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; library: Library; vocabulary: Vocabulary; catalog: LoadedCatalogIndex }

async function loadVocabulary(): Promise<Vocabulary> {
  const { file, warning } = await fetchVocabulary()
  const { index, warnings } = buildVocabularyIndex(file)
  return { index, warnings: warning ? [warning, ...warnings] : warnings }
}

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    Promise.all([loadLibrary(), loadVocabulary(), loadCatalogIndex()])
      .then(([library, vocabulary, catalog]) => {
        if (!cancelled) setState({ status: 'ready', library, vocabulary, catalog })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return <div className="p-8 text-sm text-muted-foreground">Loading rule library…</div>
  }
  if (state.status === 'error') {
    return <div className="p-8 text-sm text-destructive">Failed to load rule library: {state.message}</div>
  }
  const { rows, sources, coveredVersions } = state.library
  return (
    <AppShell
      rows={rows}
      sources={sources}
      coveredVersions={coveredVersions}
      vocabularyIndex={state.vocabulary.index}
      vocabularyWarnings={state.vocabulary.warnings}
      overlayWarnings={state.library.overlayWarnings}
      mappingsByRule={state.library.mappingsByRule}
      mappingWarnings={state.library.mappingWarnings}
      catalog={state.catalog.index}
      catalogWarnings={state.catalog.warning === null ? [] : [state.catalog.warning]}
    />
  )
}

export default App
