import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { copyTextToClipboard, type CopyOutcome } from '../../logic/copyToClipboard'

const CONFIRMATION_MILLISECONDS = 1500
const FAILURE_MILLISECONDS = 5000

const FAILURE_MESSAGES: Record<Exclude<CopyOutcome, 'copied'>, string> = {
  unavailable: 'Copying is not available here (the clipboard needs a secure connection). Select the text and copy it manually.',
  rejected: 'The browser refused to copy. Select the text and copy it manually.',
}

const TONE_CLASSES = {
  dark: 'text-slate-300 hover:bg-slate-700 hover:text-white',
  light: 'text-slate-600 hover:bg-slate-200 hover:text-slate-900',
} as const

type CopyState = { status: 'idle' } | { status: 'copied' } | { status: 'failed'; outcome: Exclude<CopyOutcome, 'copied'> }

// Sits in the top-right corner of a relatively positioned wrapper; the
// block it belongs to reserves right padding so wrapped lines stay clear.
export function CopyButton({ text, tone = 'dark' }: { text: string; tone?: keyof typeof TONE_CLASSES }) {
  const [state, setState] = useState<CopyState>({ status: 'idle' })
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  async function copy() {
    const outcome = await copyTextToClipboard(text)
    clearTimeout(resetTimer.current)
    setState(outcome === 'copied' ? { status: 'copied' } : { status: 'failed', outcome })
    const visibleMilliseconds = outcome === 'copied' ? CONFIRMATION_MILLISECONDS : FAILURE_MILLISECONDS
    resetTimer.current = setTimeout(() => setState({ status: 'idle' }), visibleMilliseconds)
  }

  const failureMessage = state.status === 'failed' ? FAILURE_MESSAGES[state.outcome] : null
  return (
    <>
      <button
        type="button"
        aria-label="Copy code"
        onClick={copy}
        className={`absolute top-1 right-1 rounded p-1 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none ${TONE_CLASSES[tone]}`}
      >
        {state.status === 'copied' ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state.status === 'copied' ? 'Copied' : (failureMessage ?? '')}
      </span>
      {failureMessage && (
        <span aria-hidden className="absolute top-8 right-1 left-1 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 shadow">
          {failureMessage}
        </span>
      )}
    </>
  )
}
