import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { RuleRef } from '../../logic/selectionEntry'
import { RuleDetailPanel } from '../rules/RuleDetailPanel'

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="sr-only">Details of this supporting check. A value set here is used for the bundle.</DialogDescription>
        <div className="overflow-y-auto">
          <RuleDetailPanel ruleRef={ruleRef} nested />
        </div>
      </DialogContent>
    </Dialog>
  )
}
