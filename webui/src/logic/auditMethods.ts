import type { AuditMethod } from '../types/rule-detail'

// Generated compliance scripts only ever run scripted audit methods - a
// "Graphical Method" or other manual method has no check_command to run.
export function scriptedMethodIndexes(methods: AuditMethod[]): number[] {
  return methods.reduce<number[]>((indexes, method, index) => {
    if (method.type === 'scripted') indexes.push(index)
    return indexes
  }, [])
}

// Resolves which method a rule's selection actually uses for generation.
// selectedIndex is null until the admin explicitly picks among 2+ scripted
// methods - until then (and if a stale selection no longer points at a
// scripted method) this falls back to the first scripted method. Returns
// null only when the rule has no scripted method at all.
export function effectiveAuditMethodIndex(methods: AuditMethod[], selectedIndex: number | null): number | null {
  const scriptedIndexes = scriptedMethodIndexes(methods)
  if (selectedIndex !== null && scriptedIndexes.includes(selectedIndex)) return selectedIndex
  return scriptedIndexes[0] ?? null
}
