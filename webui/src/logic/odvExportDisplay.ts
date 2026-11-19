import { odvPlaceholder, odvPlaceholderNames } from './odv'
import type { OrgDefinedValue } from './selectionEntry'
import { bashSingleQuote } from './scriptGen/bash'

// True when every placeholder for this ODV in the shell is a double-quoted
// variable expansion, so it behaves the same whether the generator
// text-replaces it or exports ODV_<name> as the variable-mode checks do.
export function expandsOdvOnlyAsQuotedVariable(shell: string, name: string): boolean {
  const quotedExpansion = `"${odvPlaceholder(name)}"`
  return !odvPlaceholderNames(shell.replaceAll(quotedExpansion, '')).includes(name)
}

// Exactly what the generated script runs for a variable-mode check: the
// value exported as ODV_<name>, then the unchanged check shell.
export function shellWithExportedOdv(shell: string, name: string, value: OrgDefinedValue): string {
  return `export ODV_${name}=${bashSingleQuote(String(value))}
${shell}`
}
