import type { ReactNode } from "react"

interface PageTitleProps {
  title: ReactNode
  // A badge or icons shown beside the title.
  adornment?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}

// Every view's title is the same h2; the app's own title is the page's only h1.
function PageTitle({ title, adornment, subtitle, actions }: PageTitleProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold break-words text-foreground">{title}</h2>
          {adornment}
        </div>
        {subtitle !== undefined && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export { PageTitle }
