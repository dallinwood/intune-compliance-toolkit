import { macosReferences, type ReferenceNode } from '../../logic/references'
import { SectionHeading } from './CodeBlock'
import { LinkedText } from './LinkedText'

function ReferenceList({ nodes }: { nodes: ReferenceNode[] }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.key} className="break-words">
          <span className="font-medium text-slate-600">{node.key}</span>
          {node.values.length > 0 && (
            <span className="text-slate-500">
              :{' '}
              {node.values.map((value, valueIndex) => (
                <span key={valueIndex}>
                  {valueIndex > 0 && ', '}
                  <LinkedText text={value} />
                </span>
              ))}
            </span>
          )}
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

export function RuleReferences({ references, custom = false }: { references: Record<string, unknown>; custom?: boolean }) {
  const nodes = macosReferences(references)
  if (nodes.length === 0) return null

  return (
    <div className="space-y-1">
      <SectionHeading custom={custom}>References</SectionHeading>
      <div className="text-xs">
        <ReferenceList nodes={nodes} />
      </div>
    </div>
  )
}
