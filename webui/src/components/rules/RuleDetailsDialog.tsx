import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { RuleRef } from '../../logic/selectionEntry'
import { RuleDetailPanel } from './RuleDetailPanel'

// A rule's details over the current page, so looking at a rule never loses the reader's place.
export function RuleDetailsDialog({
  ruleRef,
  title,
  description,
  open,
  onOpenChange,
  nested = false,
}: {
  ruleRef: RuleRef
  // "<upstream id> - <title>"
  title: string
  description: string
  open: boolean
  onOpenChange: (open: boolean) => void
  nested?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="overflow-y-auto">
          <RuleDetailPanel ruleRef={ruleRef} nested={nested} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
