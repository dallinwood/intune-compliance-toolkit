// Placeholder until Plan 2 Task 4 rebuilds bundle generation on the v3
// library; coveredVersions is already threaded through for it.
export function GenerateReviewScreen({ onBack }: { coveredVersions: string[]; onBack: () => void }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 text-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Review &amp; generate</h2>
        <button type="button" onClick={onBack} className="text-xs text-slate-500 underline hover:text-slate-700">
          Back to browse
        </button>
      </div>
      <p className="text-slate-600">Bundle generation is being rebuilt for the new rule library.</p>
    </div>
  )
}
