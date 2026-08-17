import type { AuditMethod } from '../../types/rule-detail'

export function AuditMethodPicker({
  methods,
  selectedIndex,
  onChange,
}: {
  methods: AuditMethod[]
  selectedIndex: number
  onChange: (index: number) => void
}) {
  // Nothing to pick when there's only one method - the picker would just
  // repeat information the panel already shows.
  if (methods.length <= 1) return null

  return (
    <div>
      <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Audit method</h5>
      {methods.map((method, index) => (
        <label key={method.method_name} className="flex items-center gap-2 py-0.5 text-sm">
          <input type="radio" name="audit-method" checked={selectedIndex === index} onChange={() => onChange(index)} />
          {method.method_name}
          <span className="text-xs text-slate-400">({method.type})</span>
        </label>
      ))}
    </div>
  )
}
