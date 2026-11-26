import { Tabs } from '@base-ui/react/tabs'
import type { ReactNode } from 'react'

export interface ScriptTabItem {
  key: string
  tabContent: ReactNode
  panel: ReactNode
  panelTestId?: string
}

const SCRIPT_TAB_CLASS =
  'inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-1 text-sm text-muted-foreground outline-none -mb-px hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-active:border-primary data-active:font-medium data-active:text-foreground'

// The scripts a check or remediation offers (e.g. PowerShell, Original goss
// test). One is always shown, starting with the first.
export function ScriptTabs({ items, ariaLabel }: { items: readonly ScriptTabItem[]; ariaLabel: string }) {
  return (
    <Tabs.Root defaultValue={items[0]?.key} className="space-y-2">
      <Tabs.List aria-label={ariaLabel} className="flex flex-wrap border-b border-border">
        {items.map((item) => (
          <Tabs.Tab key={item.key} value={item.key} className={SCRIPT_TAB_CLASS}>
            {item.tabContent}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {items.map((item) => (
        <Tabs.Panel key={item.key} value={item.key} data-testid={item.panelTestId} className="outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
          {item.panel}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  )
}
