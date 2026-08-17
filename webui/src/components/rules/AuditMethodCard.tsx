import { useState } from 'react'
import type { AuditMethod } from '../../types/rule-detail'
import { OutputCheckRow } from './OutputCheckRow'

export function AuditMethodCard({
  method,
  isEffective,
  showSelector,
  onSelect,
}: {
  method: AuditMethod
  isEffective: boolean
  showSelector: boolean
  onSelect: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isScripted = method.type === 'scripted'

  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-2 py-1">
        {showSelector ? (
          <input
            type="radio"
            name="audit-method"
            checked={isEffective}
            onChange={onSelect}
            title="Use this method's check for the generated script"
          />
        ) : (
          <span className="w-4 text-center text-xs" title={isScripted ? 'Used for the generated script' : 'Not used in generated scripts'}>
            {isScripted && isEffective ? '✓' : ''}
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex flex-1 items-center gap-2 text-left text-sm"
        >
          <span className="text-slate-400">{expanded ? '▾' : '▸'}</span>
          <span className="font-medium text-slate-700">{method.method_name}</span>
          <span className="text-xs text-slate-400">{isScripted ? 'Scripted' : 'Manual (not used in generated scripts)'}</span>
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-2 text-sm">
          <p className="whitespace-pre-line text-slate-600">{method.description}</p>
          {method.steps?.map((step, index) => (
            <div key={index} className="space-y-2">
              {!step.check_command_verified && (
                <p className="text-xs font-medium text-amber-600">⚠ Unverified check command</p>
              )}
              <div className="overflow-hidden rounded border border-slate-200">
                <div className="border-b border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Command
                </div>
                <pre className="overflow-x-auto bg-slate-900 p-2 text-xs whitespace-pre-wrap text-slate-100">
                  {step.check_command}
                </pre>
              </div>
              {(step.output_description || step.output_check.length > 0) && (
                <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
                  {step.output_description && <p className="text-xs text-slate-600">{step.output_description}</p>}
                  {step.output_check.length > 0 && (
                    <div className="space-y-1">
                      {step.output_check.map((check) => (
                        <OutputCheckRow key={check.variable} check={check} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
