import * as React from "react"

import { cn } from "@/lib/utils"

// An opaque background matters here: the browser paints the open option list
// from the control's own background, so a transparent select shows a white
// list in dark mode.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 rounded-md border border-control-border bg-background px-2 text-sm text-foreground outline-none focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
