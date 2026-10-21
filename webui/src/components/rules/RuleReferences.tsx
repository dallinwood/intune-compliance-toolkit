import { macosReferences, type ReferenceNode } from '../../logic/references'
import { SectionHeading } from './CodeBlock'

function ReferenceList({ nodes }: { nodes: ReferenceNode[] }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.key} className="break-words">
          <span className="font-medium text-slate-600">{node.label}</span>
          {node.values.length > 0 && <span className="text-slate-500">: {node.values.join(', ')}</span>}
          {node.children.length > 0 && (
            <div className="border-l border-slate-200 pl-3">
              <ReferenceList nodes={node.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function RuleReferences({ references }: { references: Record<string, unknown> }) {
  const nodes = macosReferences(references)
  if (nodes.length === 0) return null

  return (
    <div className="space-y-1">
      <SectionHeading>References</SectionHeading>
      <div className="text-xs">
        <ReferenceList nodes={nodes} />
      </div>
    </div>
  )
}
