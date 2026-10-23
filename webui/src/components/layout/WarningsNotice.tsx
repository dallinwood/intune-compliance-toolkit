// Problems with optional extras (display names, custom overlays) never block
// the app: it falls back to the imported data for whatever could not be
// used, and says so here.
export function WarningsNotice({ label, summary, warnings }: { label: string; summary: string; warnings: string[] }) {
  if (warnings.length === 0) return null

  return (
    <div
      role="status"
      aria-label={label}
      className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs break-words text-amber-900"
    >
      {warnings.length === 1 ? (
        <p>{warnings[0]}</p>
      ) : (
        <>
          <p>{summary}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
