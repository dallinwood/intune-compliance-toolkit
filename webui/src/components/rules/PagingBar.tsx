import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { clampPage } from '../../logic/sectionTree'
import { PAGE_SIZES, parsePageSize, type PageSize } from '../../state/urlState'

interface PagingBarProps {
  currentPage: number
  pageCount: number
  size: PageSize
  onPageChange: (page: number) => void
  onSizeChange: (size: PageSize) => void
}

function sizeLabel(size: PageSize): string {
  return size === 'all' ? 'Infinite scroll' : String(size)
}

export function PagingBar({ currentPage, pageCount, size, onPageChange, onSizeChange }: PagingBarProps) {
  const sizeSelectId = useId()
  const isPaged = size !== 'all'

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-slate-200 dark:border-border px-4 py-3 text-sm text-slate-600 dark:text-zinc-300">
      {isPaged && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Previous page" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span aria-live="polite" className="tabular-nums">
            Page {currentPage} of {pageCount}
          </span>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
          {/* Keyed by the page so the draft resets whenever the page changes elsewhere. */}
          <PageJumpInput key={currentPage} currentPage={currentPage} pageCount={pageCount} onPageChange={onPageChange} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <label htmlFor={sizeSelectId}>Rules per page</label>
        <select
          id={sizeSelectId}
          value={String(size)}
          onChange={(event) => {
            const nextSize = parsePageSize(event.target.value)
            if (nextSize !== null) onSizeChange(nextSize)
          }}
          className="h-8 rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-card px-2 text-sm text-slate-700 dark:text-zinc-200"
        >
          {PAGE_SIZES.map((option) => (
            <option key={String(option)} value={String(option)}>
              {sizeLabel(option)}
            </option>
          ))}
        </select>
      </div>
    </nav>
  )
}

interface PageJumpInputProps {
  currentPage: number
  pageCount: number
  onPageChange: (page: number) => void
}

function PageJumpInput({ currentPage, pageCount, onPageChange }: PageJumpInputProps) {
  const [draft, setDraft] = useState(String(currentPage))

  function jump() {
    const requested = Number.parseInt(draft, 10)
    const target = Number.isNaN(requested) ? currentPage : clampPage(requested, pageCount)
    setDraft(String(target))
    if (target !== currentPage) onPageChange(target)
  }

  return (
    <label className="flex items-center gap-2">
      <span aria-hidden="true">Go to</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={pageCount}
        aria-label="Page number"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={jump}
        onKeyDown={(event) => {
          if (event.key === 'Enter') jump()
        }}
        className="h-8 w-16 rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-card px-2 text-sm text-slate-700 dark:text-zinc-200 tabular-nums"
      />
    </label>
  )
}
