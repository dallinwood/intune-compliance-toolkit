import { useId } from 'react'
import { benchmarksByScope } from '../../logic/ruleDisplay'
import { useVocabularyIndex } from '../../state/vocabularyContext'
import type { Applicability } from '../../types/library'
import { SectionHeading } from './CodeBlock'

export function RuleBenchmarks({ applicability, custom = false }: { applicability: Applicability; custom?: boolean }) {
  const index = useVocabularyIndex()
  const scopeIdPrefix = useId()
  const scopes = benchmarksByScope(applicability, index)

  return (
    <section aria-label="Benchmarks" className="space-y-1">
      <SectionHeading custom={custom}>Benchmarks</SectionHeading>
      {scopes.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-muted-foreground italic">Not in a benchmark</p>
      ) : (
        <div className="space-y-1.5 text-xs">
          {scopes.map((scope, scopePosition) => {
            // Scope keys contain spaces, which aria-labelledby would read as several ids.
            const scopeLabelId = `${scopeIdPrefix}-${scopePosition}`
            return (
              <div key={scope.scopeKey}>
                {scope.scopeLabel !== null && (
                  <p id={scopeLabelId} className="font-medium text-slate-600 dark:text-zinc-300">
                    {scope.scopeLabel}
                  </p>
                )}
                <ul aria-labelledby={scope.scopeLabel === null ? undefined : scopeLabelId} className="flex flex-wrap gap-x-3 gap-y-0.5 text-slate-500 dark:text-muted-foreground">
                  {scope.benchmarks.map((benchmark) => (
                    <li key={benchmark}>{benchmark}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
