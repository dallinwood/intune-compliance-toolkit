import { useEffect, useState } from 'react'
import { CopyButton } from '../rules/CopyButton'
import { fetchThirdPartyPackages, type ThirdPartyPackage } from '../../data/thirdPartyLicences'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; packages: ThirdPartyPackage[] }

export function ThirdPartyPackages() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetchThirdPartyPackages()
      .then((packages) => {
        if (!cancelled) setState({ status: 'ready', packages })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') return <p className="text-sm text-slate-500">Loading packages…</p>
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm break-words text-red-600">
        {state.message}
      </p>
    )
  }
  return (
    <ul className="divide-y divide-slate-200 rounded border border-slate-200">
      {state.packages.map((item) => (
        <li key={`${item.name}@${item.version}`}>
          <details>
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm hover:bg-slate-50">
              <span className="font-medium break-all">{item.name}</span>
              <span className="text-slate-500">{item.version}</span>
              <span className="text-slate-500">{item.license}</span>
            </summary>
            <div className="space-y-2 px-3 pb-3">
              {item.repository && (
                <a
                  className="block text-xs break-all underline hover:text-slate-700"
                  href={item.repository}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.repository}
                </a>
              )}
              <div className="relative">
                <pre className="max-h-64 overflow-auto rounded bg-slate-50 p-2 pr-10 font-mono text-xs whitespace-pre-wrap break-words">
                  {item.licenseText}
                </pre>
                <CopyButton text={item.licenseText} tone="light" />
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}
