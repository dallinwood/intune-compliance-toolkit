import type { RuleRef } from '../../logic/selectionEntry'
import { RuleDetailsDialog } from '../rules/RuleDetailsDialog'

// The rule's own details, including its organization value editor, without leaving the
// Generate screen. The editor writes to the same store the row reads.
export function SupportingCheckDetailsDialog({
  ruleRef,
  title,
  open,
  onOpenChange,
}: {
  ruleRef: RuleRef
  // "<upstream id> - <title>"
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <RuleDetailsDialog
      ruleRef={ruleRef}
      title={title}
      description="Details of this supporting check. A value set here is used for the bundle."
      open={open}
      onOpenChange={onOpenChange}
      nested
    />
  )
}
