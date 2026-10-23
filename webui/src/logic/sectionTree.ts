import type { RuleRow } from '../types/rule-row'

// The ASCII unit separator never appears in a section title.
export const SECTION_ID_SEPARATOR = '\u001f'

export interface SectionNode {
  id: string
  label: string
  depth: number
  ruleCount: number
  children: SectionNode[]
  rules: RuleRow[]
}

export type VisibleItem = { kind: 'section'; node: SectionNode } | { kind: 'rule'; row: RuleRow; depth: number }

export interface Page {
  items: VisibleItem[]
}

export interface SectionTreeOptions {
  // Grouped section codes share one root: the vocabulary's group key.
  rootKeyOf?: (row: RuleRow) => string
  compareRoots?: (leftRootKey: string, rightRootKey: string) => number
}

interface MutableNode extends SectionNode {
  childrenByTitle: Map<string, MutableNode>
}

function newNode(id: string, label: string, depth: number): MutableNode {
  return { id, label, depth, ruleCount: 0, children: [], rules: [], childrenByTitle: new Map() }
}

function compareByLabel(left: SectionNode, right: SectionNode): number {
  return left.label.localeCompare(right.label)
}

function finish(node: MutableNode, compareChildren: (left: SectionNode, right: SectionNode) => number): SectionNode {
  const children = Array.from(node.childrenByTitle.values())
    .map((child) => finish(child, compareByLabel))
    .sort(compareChildren)
  const rules = [...node.rules].sort((left, right) => left.title.localeCompare(right.title))
  const ruleCount = rules.length + children.reduce((total, child) => total + child.ruleCount, 0)
  return { id: node.id, label: node.label, depth: node.depth, ruleCount, children, rules }
}

export function buildSectionTree(rows: RuleRow[], labelRoot: (code: string) => string, options: SectionTreeOptions = {}): SectionNode[] {
  const rootKeyOf = options.rootKeyOf ?? ((row: RuleRow) => row.sectionPath[0])
  const compareRoots = options.compareRoots ?? ((left: string, right: string) => left.localeCompare(right))
  const rootsByKey = new Map<string, MutableNode>()

  for (const row of rows) {
    const rootKey = rootKeyOf(row)
    let root = rootsByKey.get(rootKey)
    if (!root) {
      root = newNode(rootKey, labelRoot(rootKey), 1)
      rootsByKey.set(rootKey, root)
    }
    let node: MutableNode = root
    for (const title of row.sectionPath.slice(1)) {
      let child: MutableNode | undefined = node.childrenByTitle.get(title)
      if (!child) {
        child = newNode(`${node.id}${SECTION_ID_SEPARATOR}${title}`, title, node.depth + 1)
        node.childrenByTitle.set(title, child)
      }
      node = child
    }
    node.rules.push(row)
  }

  return Array.from(rootsByKey.values())
    .map((root) => finish(root, compareByLabel))
    .sort((left, right) => compareRoots(left.id, right.id))
}

export function visibleItems(tree: SectionNode[], expanded: ReadonlySet<string>): VisibleItem[] {
  const items: VisibleItem[] = []
  const visit = (node: SectionNode) => {
    items.push({ kind: 'section', node })
    if (!expanded.has(node.id)) return
    for (const rule of node.rules) items.push({ kind: 'rule', row: rule, depth: node.depth })
    node.children.forEach(visit)
  }
  tree.forEach(visit)
  return items
}

function itemDepth(item: VisibleItem): number {
  return item.kind === 'section' ? item.node.depth : item.depth + 1
}

// A page holds up to `size` rule rows; headers don't count. A page that
// starts part-way into a section repeats that section's headers first, so
// every page reads on its own.
export function paginate(items: VisibleItem[], size: number): Page[] {
  const pages: Page[] = []
  let currentItems: VisibleItem[] = []
  let rulesOnPage = 0
  // ancestors[depth - 1] is the open section header at that depth.
  const ancestors: SectionNode[] = []

  for (const item of items) {
    const depth = itemDepth(item)
    ancestors.length = depth - 1
    if (rulesOnPage === size) {
      pages.push({ items: currentItems })
      currentItems = ancestors.map((node) => ({ kind: 'section', node }))
      rulesOnPage = 0
    }
    currentItems.push(item)
    if (item.kind === 'section') ancestors.push(item.node)
    else rulesOnPage += 1
  }
  pages.push({ items: currentItems })
  return pages
}

// Infinite scroll: the leading items holding at most `ruleLimit` rule rows.
export function revealRules(items: VisibleItem[], ruleLimit: number): { items: VisibleItem[]; hasMore: boolean } {
  let rulesSeen = 0
  for (let position = 0; position < items.length; position += 1) {
    if (items[position].kind !== 'rule') continue
    rulesSeen += 1
    if (rulesSeen > ruleLimit) return { items: items.slice(0, position), hasMore: true }
  }
  return { items, hasMore: false }
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(pageCount, 1))
}

function walk(tree: SectionNode[], visitor: (node: SectionNode) => void) {
  const visit = (node: SectionNode) => {
    visitor(node)
    node.children.forEach(visit)
  }
  tree.forEach(visit)
}

export function allNodeIds(tree: SectionNode[]): Set<string> {
  const ids = new Set<string>()
  walk(tree, (node) => ids.add(node.id))
  return ids
}

// Every section in the tree holds at least one rule, since the tree is built
// from matching rules only.
export function searchExpanded(tree: SectionNode[]): Set<string> {
  return allNodeIds(tree)
}

interface VisibleSection {
  node: SectionNode
  isOpen: boolean
}

// The sections whose headers are showing (every ancestor open).
function visibleSections(tree: SectionNode[], expanded: ReadonlySet<string>): VisibleSection[] {
  const sections: VisibleSection[] = []
  const visit = (node: SectionNode) => {
    const isOpen = expanded.has(node.id)
    sections.push({ node, isOpen })
    if (isOpen) node.children.forEach(visit)
  }
  tree.forEach(visit)
  return sections
}

// Both one-level steps drop remembered open sections hidden under a closed
// parent, so neither ever leaves an open section below a closed one.
export function expandOneLevel(tree: SectionNode[], expanded: ReadonlySet<string>): Set<string> {
  const sections = visibleSections(tree, expanded)
  const next = new Set(sections.filter((section) => section.isOpen).map((section) => section.node.id))
  const collapsedDepths = sections.filter((section) => !section.isOpen).map((section) => section.node.depth)
  if (collapsedDepths.length === 0) return next
  const shallowestCollapsedDepth = Math.min(...collapsedDepths)
  for (const section of sections) {
    if (!section.isOpen && section.node.depth === shallowestCollapsedDepth) next.add(section.node.id)
  }
  return next
}

export function collapseOneLevel(tree: SectionNode[], expanded: ReadonlySet<string>): Set<string> {
  const openSections = visibleSections(tree, expanded).filter((section) => section.isOpen)
  if (openSections.length === 0) return new Set()
  const deepestOpenDepth = Math.max(...openSections.map((section) => section.node.depth))
  return new Set(openSections.filter((section) => section.node.depth !== deepestOpenDepth).map((section) => section.node.id))
}
