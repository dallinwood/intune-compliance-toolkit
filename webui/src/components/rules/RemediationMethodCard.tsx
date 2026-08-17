import { useState } from 'react'
import type { RemediationMethod } from '../../types/rule-detail'

export function RemediationMethodCard({ method }: { method: RemediationMethod }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm"
      >
        <span className="text-slate-400">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium text-slate-700">{method.method_name}</span>
        <span className="text-xs text-slate-400">({method.type})</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-2 text-sm">
          <p className="whitespace-pre-line text-slate-600">{method.description}</p>
          {method.config_keys?.map((configKey, index) => (
            <pre key={index} className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
              {JSON.stringify(configKey, null, 2)}
            </pre>
          ))}
          {method.steps?.map((step, index) => (
            <div key={index} className="space-y-1 rounded bg-slate-50 p-2 text-xs text-slate-600">
              {step.command && <pre className="overflow-x-auto whitespace-pre-wrap text-slate-700">{step.command}</pre>}
              {step.purpose && <p>{step.purpose}</p>}
              {step.expected_output && <p>Expected output: {step.expected_output}</p>}
              {step.result_note && <p>{step.result_note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
