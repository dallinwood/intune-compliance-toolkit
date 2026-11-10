import { useState } from 'react'

export function vendorGroupKey(vendorId: string): string {
  return vendorId
}

// A family (Licences) or category (Products) inside a vendor.
export function subgroupKey(vendorId: string, name: string): string {
  return `${vendorId}/${name}`
}

// Which collapsible groups of a list are open. The list names the groups that
// start open; expand() opens more without closing any, collapse() closes some.
export function useExpandedGroups(initiallyExpandedKeys: readonly string[]) {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set(initiallyExpandedKeys))

  function isExpanded(key: string): boolean {
    return expandedKeys.has(key)
  }

  function toggle(key: string) {
    const next = new Set(expandedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedKeys(next)
  }

  function expand(keys: readonly string[]) {
    if (keys.every((key) => expandedKeys.has(key))) return
    setExpandedKeys(new Set([...expandedKeys, ...keys]))
  }

  function collapse(keys: readonly string[]) {
    if (keys.every((key) => !expandedKeys.has(key))) return
    setExpandedKeys(new Set([...expandedKeys].filter((key) => !keys.includes(key))))
  }

  function collapseAll() {
    if (expandedKeys.size > 0) setExpandedKeys(new Set())
  }

  function isAnyExpanded(keys: readonly string[]): boolean {
    return keys.some((key) => expandedKeys.has(key))
  }

  return { isExpanded, toggle, expand, collapse, collapseAll, isAnyExpanded }
}
