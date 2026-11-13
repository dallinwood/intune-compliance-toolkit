import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

function DisclosureChevron({ isOpen, className }: { isOpen: boolean; className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90", className)}
    />
  )
}

export { DisclosureChevron }
