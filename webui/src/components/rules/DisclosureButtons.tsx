import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The pill look of toggle buttons; a pressed one gets the darker border.
const PILL_BUTTON_CLASS = cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'aria-pressed:border-foreground/60')

export interface SelectionItem {
  key: string
  label: string
}

// A segmented control: which of a script's versions the content shows.
// Exactly one is selected at all times, so these are pressed-state buttons.
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
    <div role="group" aria-label={ariaLabel} className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-border bg-background">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={item.key === selectedKey}
          onClick={() => onSelect(item.key)}
          className="border-l border-border px-2.5 py-0.5 text-xs text-muted-foreground outline-none first:border-l-0 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
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
