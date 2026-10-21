import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import { loadLibrary, type Library } from './data/ruleRows'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; library: Library }

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadLibrary()
      .then((library) => {
        if (!cancelled) setState({ status: 'ready', library })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return <div className="p-8 text-sm text-slate-500">Loading rule library…</div>
  }
  if (state.status === 'error') {
    return <div className="p-8 text-sm text-red-600">Failed to load rule library: {state.message}</div>
  }
  const { rows, sources, coveredVersions } = state.library
  return <AppShell rows={rows} sources={sources} coveredVersions={coveredVersions} />
}

export default App
