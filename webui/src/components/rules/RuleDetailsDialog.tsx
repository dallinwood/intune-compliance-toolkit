import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { RuleRef } from '../../logic/selectionEntry'
import { useRuleMappings } from '../../state/mappingsContext'
import { GoToRuleLink } from './GoToRuleLink'
import { RuleDetailPanel } from './RuleDetailPanel'

// A rule's details over the current page, so looking at a rule never loses the
// reader's place; Go to this rule leaves the page for the rule's own row.
export function RuleDetailsDialog({
  ruleRef,
  title,
  description,
  open,
  onOpenChange,
  nested = false,
  onGoToRule,
}: {
  ruleRef: RuleRef
  // "<upstream id> - <title>"
  title: string
  description: string
  open: boolean
  onOpenChange: (open: boolean) => void
  nested?: boolean
  // Runs after Go to this rule, for a screen that must close as well as the dialog.
  onGoToRule?: () => void
}) {
  const { rowsById } = useRuleMappings()
  const row = rowsById.get(ruleRef.id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="min-w-0 flex-1 break-words">{title}</DialogTitle>
          {row !== undefined && (
            <GoToRuleLink
              row={row}
              onNavigate={() => {
                onOpenChange(false)
                onGoToRule?.()
              }}
            />
          )}
        </DialogHeader>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <div className="overflow-y-auto">
          <RuleDetailPanel ruleRef={ruleRef} nested={nested} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
