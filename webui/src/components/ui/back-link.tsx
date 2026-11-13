import { ChevronLeft } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The label names the destination ("Back to rules", "All frameworks").
function BackLink({ onClick, className, children }: { onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <Button type="button" variant="link" size="sm" onClick={onClick} className={cn("-ml-3", className)}>
      <ChevronLeft aria-hidden="true" />
      {children}
    </Button>
  )
}

export { BackLink }
