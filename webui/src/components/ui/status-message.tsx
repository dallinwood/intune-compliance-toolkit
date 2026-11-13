import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// Loading messages are announced politely; empty and error messages are
// already part of the page text.
function StatusMessage({ isLoading = false, className, children }: { isLoading?: boolean; className?: string; children: ReactNode }) {
  return (
    <p role={isLoading ? "status" : undefined} className={cn("p-4 text-sm text-muted-foreground", className)}>
      {children}
    </p>
  )
}

export { StatusMessage }
