import { CUSTOM_CONTENT_CREDITS } from '../../data/customContentCredits'
import type { ManifestSource } from '../../types/library'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import { ThirdPartyPackages } from './ThirdPartyPackages'

const LINK_CLASS = 'underline hover:text-slate-700'
const SECTION_HEADING_CLASS = 'mb-2 text-sm font-semibold text-slate-900'

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className={LINK_CLASS} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

// Each source's CC BY 4.0 licence requires credit, a link to the licence, and
// a note that the content was modified.
export function AttributionFooter({ sources }: { sources: ManifestSource[] }) {
  return (
    <footer className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
      <Dialog>
        <DialogTrigger className="underline hover:text-slate-700">Sources &amp; licences</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sources &amp; licences</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 overflow-y-auto px-4 py-4 text-sm text-slate-700">
            <DialogDescription>
              Where the rules and scripts come from, and the open-source packages this site is built with.
            </DialogDescription>
            <section aria-labelledby="rule-sources-heading">
              <h3 id="rule-sources-heading" className={SECTION_HEADING_CLASS}>
                Rule sources
              </h3>
              <ul className="space-y-1">
                {sources.map((source) => (
                  <li key={source.name}>
                    Rules from the <ExternalLink href={source.repository_url}>{source.display_name}</ExternalLink> (
                    {source.release_tag}), licensed <ExternalLink href={source.license.url}>{source.license.name}</ExternalLink>
                    , modified for this tool.
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="custom-content-heading">
              <h3 id="custom-content-heading" className={SECTION_HEADING_CLASS}>
                Custom content
              </h3>
              <ul className="space-y-1">
                {CUSTOM_CONTENT_CREDITS.map((credit) => (
                  <li key={credit.url}>
                    Scripts from <ExternalLink href={credit.url}>{credit.name}</ExternalLink> (commit{' '}
                    <code className="font-mono break-all">{credit.commit}</code>). The Microsoft scripts keep their original
                    headers, including Microsoft's copyright and licence comment. The Blueprint site is licensed{' '}
                    <ExternalLink href={credit.licenceUrl}>{credit.licenceName}</ExternalLink>.
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="third-party-heading">
              <h3 id="third-party-heading" className={SECTION_HEADING_CLASS}>
                Third-party packages
              </h3>
              <ThirdPartyPackages />
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </footer>
  )
}
