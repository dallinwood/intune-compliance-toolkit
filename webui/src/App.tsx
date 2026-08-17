import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import { loadAllRuleRows } from './data/ruleRows'
import type { RuleRow } from './types/rule-row'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rows: RuleRow[] }

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadAllRuleRows()
      .then((rows) => {
        if (!cancelled) setState({ status: 'ready', rows })
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
  return <AppShell rows={state.rows} />
}

export default App
