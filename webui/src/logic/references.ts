// Keys are shown exactly as mSCP writes them (e.g. macos_15): friendly
// names belong in baselines/_vocabulary.json, not in code.
export interface ReferenceNode {
  key: string
  values: string[]
  children: ReferenceNode[]
}

// mSCP shares reference trees across Apple platforms, so some levels are
// keyed by OS release (macos_15, ios_17, visionos_26). This tool only
// covers macOS, so those levels keep their macOS keys only.
const OS_KEY_PATTERN = /^(macos|ios|ipados|visionos|watchos|tvos)_\d+$/
const MACOS_KEY_PATTERN = /^macos_\d+$/

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nodeOf(key: string, value: unknown): ReferenceNode | null {
  if (Array.isArray(value)) {
    const values = value.map(String)
    return values.length > 0 ? { key, values, children: [] } : null
  }
  if (isObject(value)) {
    const children = macosReferences(value)
    return children.length > 0 ? { key, values: [], children } : null
  }
  if (value === null || value === undefined) return null
  return { key, values: [String(value)], children: [] }
}

export function macosReferences(references: Record<string, unknown>): ReferenceNode[] {
  const keys = Object.keys(references)
  const isKeyedByOs = keys.some((key) => OS_KEY_PATTERN.test(key))
  const keptKeys = isKeyedByOs ? keys.filter((key) => MACOS_KEY_PATTERN.test(key)) : keys

  const nodes: ReferenceNode[] = []
  for (const key of keptKeys) {
    const node = nodeOf(key, references[key])
    if (node) nodes.push(node)
  }
  return nodes
}
