import { Fragment, type ReactNode } from 'react'
import type { CatalogRequirement } from '../../types/catalog'

// A requirement written inline: group members joined by "and" (all_of) or
// "or" (any_of), with nested groups in brackets.
export function RequirementText({
  requirement,
  renderId,
  isNested = false,
}: {
  requirement: CatalogRequirement
  renderId: (id: string) => ReactNode
  isNested?: boolean
}) {
  if (typeof requirement === 'string') return <>{renderId(requirement)}</>
  const members = 'all_of' in requirement ? requirement.all_of : requirement.any_of
  const joiner = 'all_of' in requirement ? 'and' : 'or'
  return (
    <>
      {isNested && '('}
      {members.map((member, position) => (
        <Fragment key={position}>
          {position > 0 && <span className="text-muted-foreground"> {joiner} </span>}
          <RequirementText requirement={member} renderId={renderId} isNested />
        </Fragment>
      ))}
      {isNested && ')'}
    </>
  )
}
