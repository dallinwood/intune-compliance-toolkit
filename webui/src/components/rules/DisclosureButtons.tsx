import { useId, useState, type ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The pill look of the check and fix target buttons; the open (or pressed)
// one gets the darker border.
const PILL_BUTTON_CLASS = cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'aria-expanded:border-foreground/60 aria-pressed:border-foreground/60')

export interface DisclosureItem {
  key: string
  buttonContent: ReactNode
  panel: ReactNode
  panelTestId?: string
}

// A row of toggle buttons that wraps onto further lines, with at most one
// item's content open under it. A single item starts open; several start
// closed so a long rule's details stay short. Ids come from useId because
// the same rule can be on screen twice (the table and a Mapped rules tab).
export function DisclosureButtons({ items }: { items: readonly DisclosureItem[] }) {
  const idPrefix = useId()
  const [openKey, setOpenKey] = useState<string | null>(items.length === 1 ? items[0].key : null)
  const openItem = items.find((item) => item.key === openKey)
  const regionId = `${idPrefix}-region`

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const isOpen = item.key === openKey
          return (
            <button
              key={item.key}
              type="button"
              id={`${idPrefix}-button-${item.key}`}
              aria-expanded={isOpen}
              aria-controls={isOpen ? regionId : undefined}
              onClick={() => setOpenKey(isOpen ? null : item.key)}
              className={PILL_BUTTON_CLASS}
            >
              {item.buttonContent}
            </button>
          )
        })}
      </div>
      {openItem && (
        <div id={regionId} role="region" aria-labelledby={`${idPrefix}-button-${openItem.key}`} data-testid={openItem.panelTestId}>
          {openItem.panel}
        </div>
      )}
    </div>
  )
}

export interface SelectionItem {
  key: string
  label: string
}

// The smaller second row: which of a platform's checks the content shows.
// Exactly one is selected at all times, so these are pressed-state buttons
// rather than disclosures.
export function SelectionButtons({
  items,
  selectedKey,
  onSelect,
  ariaLabel,
}: {
  items: readonly SelectionItem[]
  selectedKey: string
  onSelect: (key: string) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={item.key === selectedKey}
          onClick={() => onSelect(item.key)}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'xs' }),
            'h-5 px-2 text-[0.6875rem] aria-pressed:border-foreground/60 aria-pressed:bg-muted',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// Several pills that can each be on or off, in the same look as the target buttons.
export function ToggleButtons({
  items,
  pressedKeys,
  onToggle,
  ariaLabel,
}: {
  items: readonly SelectionItem[]
  pressedKeys: ReadonlySet<string>
  onToggle: (key: string) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const isPressed = pressedKeys.has(item.key)
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={isPressed}
            onClick={() => onToggle(item.key)}
            className={PILL_BUTTON_CLASS}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
