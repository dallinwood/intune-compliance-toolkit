import type { ManifestSource } from '../../types/library'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import { ThemeToggle } from './ThemeToggle'
import { ThirdPartyPackages } from './ThirdPartyPackages'

const LINK_CLASS = 'underline hover:text-slate-700 dark:hover:text-foreground'
const SECTION_HEADING_CLASS = 'mb-2 text-sm font-semibold text-slate-900 dark:text-foreground'

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
    <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-200 dark:border-border px-4 py-2 text-xs text-slate-500 dark:text-muted-foreground">
      <Dialog>
        <DialogTrigger className="underline hover:text-slate-700 dark:hover:text-foreground">Sources &amp; licences</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sources &amp; licences</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 overflow-y-auto px-4 py-4 text-sm text-slate-700 dark:text-zinc-200">
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
            <section aria-labelledby="third-party-heading">
              <h3 id="third-party-heading" className={SECTION_HEADING_CLASS}>
                Third-party packages
              </h3>
              <ThirdPartyPackages />
            </section>
          </div>
        </DialogContent>
      </Dialog>
      <ThemeToggle />
    </footer>
  )
}
