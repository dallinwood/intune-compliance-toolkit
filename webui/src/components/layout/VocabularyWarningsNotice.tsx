// Display-name problems never block the app: it falls back to raw codes for
// whatever the vocabulary file could not supply, and says so here.
export function VocabularyWarningsNotice({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null

  return (
    <div
      role="status"
      aria-label="Display name problems"
      className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs break-words text-amber-900"
    >
      {warnings.length === 1 ? (
        <p>{warnings[0]}</p>
      ) : (
        <>
          <p>Some display names could not be used:</p>
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
