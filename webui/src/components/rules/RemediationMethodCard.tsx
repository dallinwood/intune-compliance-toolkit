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
        <div className="space-y-3 border-t border-slate-100 px-3 py-2 text-sm">
          <p className="whitespace-pre-line text-slate-600">{method.description}</p>
          {method.config_keys?.map((configKey, index) => (
            <div key={index} className="overflow-hidden rounded border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Configuration
              </div>
              <pre className="overflow-x-auto bg-slate-900 p-2 text-xs whitespace-pre-wrap text-slate-100">
                {JSON.stringify(configKey, null, 2)}
              </pre>
            </div>
          ))}
          {method.steps?.map((step, index) => (
            <div key={index} className="space-y-2">
              {step.command && (
                <div className="overflow-hidden rounded border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Command
                  </div>
                  <pre className="overflow-x-auto bg-slate-900 p-2 text-xs whitespace-pre-wrap text-slate-100">{step.command}</pre>
                </div>
              )}
              {(step.purpose || step.expected_output || step.result_note) && (
                <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  {step.purpose && <p>{step.purpose}</p>}
                  {step.expected_output && <p>Expected output: {step.expected_output}</p>}
                  {step.result_note && <p>{step.result_note}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
