import type { RemediationMethod } from '../../types/rule-detail'

export function RemediationMethodPicker({
  methods,
  selectedIndex,
  onChange,
}: {
  methods: RemediationMethod[]
  selectedIndex: number
  onChange: (index: number) => void
}) {
  if (methods.length <= 1) return null

  return (
    <div>
      <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Remediation method</h5>
      {methods.map((method, index) => (
        <label key={method.method_name} className="flex items-center gap-2 py-0.5 text-sm">
          <input
            type="radio"
            name="remediation-method"
            checked={selectedIndex === index}
            onChange={() => onChange(index)}
          />
          {method.method_name}
          <span className="text-xs text-slate-400">({method.type})</span>
        </label>
      ))}
    </div>
  )
}
