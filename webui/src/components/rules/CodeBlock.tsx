// Long shell lines and JSON scroll inside the block rather than widening
// the table cell (and with it the page on a phone).
export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded bg-slate-900 p-2 font-mono text-xs whitespace-pre text-slate-100">
      <code>{code}</code>
    </pre>
  )
}

export function SectionHeading({ children }: { children: string }) {
  return <h5 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{children}</h5>
}
