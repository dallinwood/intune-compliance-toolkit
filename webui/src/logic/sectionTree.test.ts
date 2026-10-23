import { describe, expect, it } from 'vitest'
import type { RuleRow } from '../types/rule-row'
import {
  allNodeIds,
  buildSectionTree,
  clampPage,
  collapseOneLevel,
  expandOneLevel,
  paginate,
  revealRules,
  searchExpanded,
  SECTION_ID_SEPARATOR,
  visibleItems,
  type SectionNode,
  type VisibleItem,
} from './sectionTree'

function row(id: string, title: string, sectionPath: string[]): RuleRow {
  return {
    ref: { id, path: `${id}.json` },
    title,
    targetKeys: [],
    section: sectionPath[0],
    sectionPath,
    sourceName: id.split('.')[0],
    releaseTag: 'release',
    assessment: { status: 'manual', manual_reason: 'manual' },
    architecture: null,
    applicability: [],
    scopeKeys: [],
    benchmarks: [],
    tags: [],
    hasOdv: false,
  }
}

const ROOT_LABELS: Record<string, string> = { audit: 'Auditing', os: 'Operating system' }
const labelRoot = (code: string) => ROOT_LABELS[code] ?? code
// Mirrors the vocabulary ordering: listed sections first in file order, then the rest by name.
const LISTED_ROOT_ORDER = ['os', 'audit']
function compareRoots(left: string, right: string): number {
  const leftPosition = LISTED_ROOT_ORDER.indexOf(left)
  const rightPosition = LISTED_ROOT_ORDER.indexOf(right)
  if (leftPosition !== -1 && rightPosition !== -1) return leftPosition - rightPosition
  if (leftPosition !== -1) return -1
  if (rightPosition !== -1) return 1
  return left.localeCompare(right)
}

const MIXED_ROWS: RuleRow[] = [
  row('mscp.audit_b', 'B audit rule', ['audit']),
  row('mscp.audit_a', 'A audit rule', ['audit']),
  row('mscp.os_a', 'An os rule', ['os']),
  row('asd_ism.ism-3', 'Control three', ['Guidelines for email', 'Email usage', 'Webmail']),
  row('asd_ism.ism-1', 'Control one', ['Guidelines for email', 'Email usage', 'Attachments']),
  row('asd_ism.ism-2', 'Control two', ['Guidelines for email', 'Email gateways', 'Relays']),
  row('asd_ism.ism-4', 'Control four', ['Guidelines for cryptography', 'Algorithms', 'Hashing']),
]

function mixedTree(): SectionNode[] {
  return buildSectionTree(MIXED_ROWS, labelRoot, { compareRoots })
}

function sectionId(...path: string[]): string {
  return path.join(SECTION_ID_SEPARATOR)
}

function describeItems(items: VisibleItem[]): string[] {
  return items.map((item) => (item.kind === 'section' ? `${'#'.repeat(item.node.depth)} ${item.node.label}` : item.row.title))
}

function sectionIdsByDepth(tree: SectionNode[]): Map<string, number> {
  const depthById = new Map<string, number>()
  const visit = (node: SectionNode) => {
    depthById.set(node.id, node.depth)
    node.children.forEach(visit)
  }
  tree.forEach(visit)
  return depthById
}

function parentId(id: string): string | null {
  const separatorPosition = id.lastIndexOf(SECTION_ID_SEPARATOR)
  return separatorPosition === -1 ? null : id.slice(0, separatorPosition)
}

describe('buildSectionTree', () => {
  it('nests each rule at the end of its section path, with depth-1 and depth-3 sources side by side', () => {
    const tree = mixedTree()
    expect(tree.map((node) => node.label)).toEqual(['Operating system', 'Auditing', 'Guidelines for cryptography', 'Guidelines for email'])
    expect(tree.map((node) => node.ruleCount)).toEqual([1, 2, 1, 3])
    expect(tree.map((node) => node.depth)).toEqual([1, 1, 1, 1])

    const audit = tree[1]
    expect(audit.id).toBe('audit')
    expect(audit.children).toEqual([])
    expect(audit.rules.map((rule) => rule.title)).toEqual(['A audit rule', 'B audit rule'])

    const email = tree[3]
    expect(email.rules).toEqual([])
    expect(email.children.map((node) => node.label)).toEqual(['Email gateways', 'Email usage'])
    const usage = email.children[1]
    expect(usage.id).toBe(sectionId('Guidelines for email', 'Email usage'))
    expect(usage.depth).toBe(2)
    expect(usage.ruleCount).toBe(2)
    expect(usage.children.map((node) => [node.label, node.depth, node.ruleCount])).toEqual([
      ['Attachments', 3, 1],
      ['Webmail', 3, 1],
    ])
    expect(usage.children[0].rules.map((rule) => rule.ref.id)).toEqual(['asd_ism.ism-1'])
  })

  it('falls back to the raw root code when the label function has none, and to name order without a comparator', () => {
    const tree = buildSectionTree([row('x.b', 'b', ['zeta']), row('x.a', 'a', ['alpha'])], (code) => code)
    expect(tree.map((node) => node.label)).toEqual(['alpha', 'zeta'])
  })

  it('keys roots by the given root key, so grouped section codes share one root', () => {
    const tree = buildSectionTree([row('x.a', 'a', ['code_a']), row('x.b', 'b', ['code_b'])], () => 'Shared', {
      rootKeyOf: () => 'group',
    })
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('group')
    expect(tree[0].ruleCount).toBe(2)
  })
})

describe('visibleItems', () => {
  it('shows only the root headers when nothing is expanded', () => {
    expect(describeItems(visibleItems(mixedTree(), new Set()))).toEqual([
      '# Operating system',
      '# Auditing',
      '# Guidelines for cryptography',
      '# Guidelines for email',
    ])
  })

  it('a collapsed section contributes its header but no rule items, even when its descendants are expanded', () => {
    const tree = mixedTree()
    const expanded = new Set([sectionId('Guidelines for email', 'Email usage'), sectionId('Guidelines for email', 'Email usage', 'Webmail')])
    const items = visibleItems(tree, expanded)
    expect(items.filter((item) => item.kind === 'rule')).toEqual([])
    expect(describeItems(items)).toContain('# Guidelines for email')
    expect(describeItems(items)).not.toContain('## Email usage')
  })

  it('lists every header and rule in order when everything is expanded, each rule at its section depth', () => {
    const tree = mixedTree()
    const items = visibleItems(tree, allNodeIds(tree))
    expect(describeItems(items)).toEqual([
      '# Operating system',
      'An os rule',
      '# Auditing',
      'A audit rule',
      'B audit rule',
      '# Guidelines for cryptography',
      '## Algorithms',
      '### Hashing',
      'Control four',
      '# Guidelines for email',
      '## Email gateways',
      '### Relays',
      'Control two',
      '## Email usage',
      '### Attachments',
      'Control one',
      '### Webmail',
      'Control three',
    ])
    expect(items.flatMap((item) => (item.kind === 'rule' ? [item.depth] : []))).toEqual([1, 1, 1, 3, 3, 3, 3])
  })
})

describe('expandOneLevel and collapseOneLevel', () => {
  it('walk depth 1 to 2 to 3 and back on mixed data, never leaving a section open under a closed parent', () => {
    const tree = mixedTree()
    const depthById = sectionIdsByDepth(tree)
    const openDepths = (expanded: ReadonlySet<string>) => [...new Set([...expanded].map((id) => depthById.get(id)))].sort()
    const expectNoOrphans = (expanded: ReadonlySet<string>) => {
      for (const id of expanded) {
        const parent = parentId(id)
        if (parent !== null) expect(expanded.has(parent)).toBe(true)
      }
    }

    let expanded: Set<string> = new Set()
    const expandedStates: number[][] = []
    for (let step = 0; step < 4; step += 1) {
      expanded = expandOneLevel(tree, expanded)
      expectNoOrphans(expanded)
      expandedStates.push(openDepths(expanded) as number[])
    }
    expect(expandedStates).toEqual([[1], [1, 2], [1, 2, 3], [1, 2, 3]])
    expect(expanded).toEqual(allNodeIds(tree))

    const collapsedStates: number[][] = []
    for (let step = 0; step < 4; step += 1) {
      expanded = collapseOneLevel(tree, expanded)
      expectNoOrphans(expanded)
      collapsedStates.push(openDepths(expanded) as number[])
    }
    expect(collapsedStates).toEqual([[1, 2], [1], [], []])
  })

  it('expand one level opens the shallowest collapsed visible sections, even when deeper ones elsewhere are open', () => {
    const tree = mixedTree()
    const emailId = 'Guidelines for email'
    const usageId = sectionId(emailId, 'Email usage')
    const expanded = expandOneLevel(tree, new Set([emailId, usageId]))
    expect(expanded).toEqual(new Set(['os', 'audit', 'Guidelines for cryptography', emailId, usageId]))
  })

  it('both ignore remembered open sections hidden under a closed parent and drop them', () => {
    const tree = mixedTree()
    const hiddenUsage = sectionId('Guidelines for email', 'Email usage')
    expect(collapseOneLevel(tree, new Set(['os', hiddenUsage]))).toEqual(new Set())
    expect(expandOneLevel(tree, new Set(['os', 'audit', 'Guidelines for cryptography', hiddenUsage]))).toEqual(
      new Set(['os', 'audit', 'Guidelines for cryptography', 'Guidelines for email']),
    )
  })
})

describe('searchExpanded', () => {
  it('opens every section that contains a rule', () => {
    const tree = mixedTree()
    expect(searchExpanded(tree)).toEqual(allNodeIds(tree))
    expect(allNodeIds(tree).size).toBe(11)
  })
})

describe('paginate', () => {
  it('has one page when everything is collapsed', () => {
    const pages = paginate(visibleItems(mixedTree(), new Set()), 25)
    expect(pages).toHaveLength(1)
    expect(describeItems(pages[0].items)).toHaveLength(4)
  })

  it('has one empty page when there is nothing to show', () => {
    expect(paginate([], 50)).toEqual([{ items: [] }])
  })

  it('repeats the guideline and sub-section headers at the top of page 2 when an expanded guideline spans the boundary', () => {
    const guideline = 'Guidelines for gateways'
    const rows = [
      ...Array.from({ length: 20 }, (_, position) => row(`asd_ism.a${position}`, `A rule ${String(position + 1).padStart(2, '0')}`, [guideline, 'Gateways', 'Filtering'])),
      ...Array.from({ length: 10 }, (_, position) => row(`asd_ism.b${position}`, `B rule ${String(position + 21).padStart(2, '0')}`, [guideline, 'Gateways', 'Logging'])),
    ]
    const tree = buildSectionTree(rows, labelRoot)
    const pages = paginate(visibleItems(tree, allNodeIds(tree)), 25)

    expect(pages).toHaveLength(2)
    const firstPage = describeItems(pages[0].items)
    expect(firstPage.slice(0, 3)).toEqual([`# ${guideline}`, '## Gateways', '### Filtering'])
    expect(firstPage.filter((label) => label.includes('rule'))).toHaveLength(25)
    expect(firstPage.at(-1)).toBe('B rule 25')
    expect(describeItems(pages[1].items)).toEqual([`# ${guideline}`, '## Gateways', '### Logging', 'B rule 26', 'B rule 27', 'B rule 28', 'B rule 29', 'B rule 30'])
  })

  it('starts a new page before headers that follow a full page, repeating their ancestors', () => {
    const tree = mixedTree()
    const pages = paginate(visibleItems(tree, allNodeIds(tree)), 3)
    expect(pages.map((page) => describeItems(page.items))).toEqual([
      ['# Operating system', 'An os rule', '# Auditing', 'A audit rule', 'B audit rule'],
      ['# Guidelines for cryptography', '## Algorithms', '### Hashing', 'Control four', '# Guidelines for email', '## Email gateways', '### Relays', 'Control two', '## Email usage', '### Attachments', 'Control one'],
      ['# Guidelines for email', '## Email usage', '### Webmail', 'Control three'],
    ])
  })

  it('does not count section headers toward the page size', () => {
    const tree = mixedTree()
    const pages = paginate(visibleItems(tree, allNodeIds(tree)), 50)
    expect(pages).toHaveLength(1)
  })
})

describe('revealRules', () => {
  it('takes items up to the given number of rule rows and reports whether more remain', () => {
    const tree = mixedTree()
    const items = visibleItems(tree, allNodeIds(tree))
    const revealed = revealRules(items, 2)
    expect(describeItems(revealed.items)).toEqual(['# Operating system', 'An os rule', '# Auditing', 'A audit rule'])
    expect(revealed.hasMore).toBe(true)
    expect(revealRules(items, 100)).toEqual({ items, hasMore: false })
  })
})

describe('clampPage', () => {
  it('keeps the page inside 1 to the page count', () => {
    expect(clampPage(3, 1)).toBe(1)
    expect(clampPage(0, 4)).toBe(1)
    expect(clampPage(2, 4)).toBe(2)
    expect(clampPage(Number.NaN, 4)).toBe(1)
  })
})
