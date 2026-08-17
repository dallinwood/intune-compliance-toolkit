import type { RemediationMethod } from '../../types/rule-detail'
import { RemediationMethodCard } from './RemediationMethodCard'

// Remediation is informational only - it never feeds a generated
// compliance script, so unlike audit methods there's no selection here.
export function RemediationMethodList({ methods }: { methods: RemediationMethod[] }) {
  return (
    <div className="space-y-2">
      <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Remediation methods</h5>
      {methods.map((method) => (
        <RemediationMethodCard key={method.method_name} method={method} />
      ))}
    </div>
  )
}
