// Shared with the framework page's sub-tabs, so both rows of tabs look alike.
export function tabLinkClassName(isActive: boolean): string {
  return `inline-block border-b-2 px-3 py-2 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none ${
    isActive ? 'border-link font-medium text-link' : 'border-transparent text-muted-foreground hover:border-control-border hover:text-foreground'
  }`
}
