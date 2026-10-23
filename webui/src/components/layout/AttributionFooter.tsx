import type { ManifestSource } from '../../types/library'

const LINK_CLASS = 'underline hover:text-slate-700'

// Each source's CC BY 4.0 licence requires credit, a link to the licence, and
// a note that the content was modified.
export function AttributionFooter({ sources }: { sources: ManifestSource[] }) {
  return (
    <footer className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
      {sources.map((source) => (
        <p key={source.name}>
          Rules from the{' '}
          <a className={LINK_CLASS} href={source.repository_url} target="_blank" rel="noreferrer">
            {source.display_name}
          </a>{' '}
          ({source.release_tag}), licensed{' '}
          <a className={LINK_CLASS} href={source.license.url} target="_blank" rel="noreferrer">
            {source.license.name}
          </a>
          , modified for this tool.
        </p>
      ))}
    </footer>
  )
}
