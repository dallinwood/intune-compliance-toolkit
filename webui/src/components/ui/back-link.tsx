import { ChevronLeft } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

// The label names the destination ("Back to rules", "All frameworks").
function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="link" size="sm" onClick={onClick} className="-ml-3">
      <ChevronLeft aria-hidden="true" />
      {children}
    </Button>
  )
}

export { BackLink }
