import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

// A titled block on the page: title, one muted line, then content, with
// dividers rather than nested cards inside.
function Card({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-lg border border-border bg-panel p-4", className)} {...props} />
}

export { Card }
