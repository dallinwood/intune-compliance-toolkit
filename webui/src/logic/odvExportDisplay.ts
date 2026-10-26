import type { OrgDefinedValue } from './selectionEntry'
import { bashSingleQuote } from './scriptGen/bash'

const QUOTED_ODV_EXPANSION = '"$ODV"'

// True when every $ODV in the shell is a double-quoted variable expansion,
// so it behaves the same whether the generator text-replaces it or exports
// ODV as the variable-mode checks do.
export function expandsOdvOnlyAsQuotedVariable(shell: string): boolean {
  return !shell.replaceAll(QUOTED_ODV_EXPANSION, '').includes('$ODV')
}

// Exactly what the generated script runs for a variable-mode check: the
// value exported as ODV, then the unchanged check shell.
export function shellWithExportedOdv(shell: string, value: OrgDefinedValue): string {
  return `export ODV=${bashSingleQuote(String(value))}
${shell}`
}
