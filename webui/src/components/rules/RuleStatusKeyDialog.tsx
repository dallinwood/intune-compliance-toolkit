import { KeyRound } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { statusKeyGroups, type StatusKeyEntry } from '../../logic/ruleStatusKey'
import { LINK_ICON, NO_TARGET_ICON, targetIconFor } from '../../logic/targetIcons'
import { useRuleMappings } from '../../state/mappingsContext'
import type { RuleRow } from '../../types/rule-row'
import { StatusGlyph } from './StatusGlyph'

function glyphMarkupOf(entry: StatusKeyEntry): string {
  if (entry.kind === 'link') return LINK_ICON
  if (entry.kind === 'no-target') return NO_TARGET_ICON
  return targetIconFor(entry.targetName ?? '').svgMarkup
}

// scopeRows are the rules of the current page, not narrowed by the filters,
// so the key does not change while filtering.
export function RuleStatusKeyDialog({ scopeRows }: { scopeRows: readonly RuleRow[] }) {
  const { byRule, rowsById } = useRuleMappings()
  const groups = useMemo(() => statusKeyGroups(scopeRows, byRule, rowsById), [scopeRows, byRule, rowsById])

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" size="xs" aria-label="Icon key" />}>
        <KeyRound aria-hidden="true" />
        Key
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Icon key</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 overflow-y-auto px-4 py-4 text-sm text-foreground/90">
          <DialogDescription>What the icons in the rules table mean, for the rules on this page.</DialogDescription>
          {groups.map((group) => (
            <section key={group.heading}>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{group.heading}</h3>
              <ul className="space-y-1.5">
                {group.entries.map((entry) => (
                  <li key={entry.text} className="flex items-center gap-2">
                    <StatusGlyph glyphMarkup={glyphMarkupOf(entry)} status={entry.status} />
                    {entry.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
