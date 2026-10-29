import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { AVAILABILITIES } from '../../logic/catalogIndex'
import { effectiveInclusions, effectiveInclusionTree, type EffectiveInclusion, type InclusionNode } from '../../logic/catalogTree'
import { AVAILABILITY_LABELS, planLabelOf, type CatalogLookup } from '../../logic/inclusionDisplay'
import type { Availability, CatalogIndex, CatalogLicence } from '../../types/catalog'
import { CatalogLink } from './CatalogLink'
import { InclusionTree } from './InclusionTree'
import { RequirementText } from './RequirementText'

type AvailabilityFilter = Availability | 'all'

function matchesText(inclusion: EffectiveInclusion, text: string, lookup: CatalogLookup): boolean {
  if (text === '') return true
  const productTitle = lookup.productsById.get(inclusion.target)?.title ?? inclusion.target
  const planTitle = planLabelOf(inclusion, lookup)?.title ?? ''
  return [productTitle, planTitle, inclusion.note ?? ''].some((part) => part.toLowerCase().includes(text))
}

function countInclusions(nodes: InclusionNode[]): number {
  return nodes.reduce((total, node) => total + node.inclusions.length + countInclusions(node.children), 0)
}

// Licences carry many maintainer notes, so they start collapsed.
function ReviewCallout({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <details
      role="group"
      aria-label={`Needs review (${notes.length})`}
      className="rounded border border-warning-border bg-warning p-3 text-sm text-warning-foreground"
    >
      <summary className="cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none">
        Needs review ({notes.length})
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs break-words">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </details>
  )
}

function AvailabilityChips({
  value,
  counts,
  onChange,
}: {
  value: AvailabilityFilter
  counts: Record<AvailabilityFilter, number>
  onChange: (value: AvailabilityFilter) => void
}) {
  const options: AvailabilityFilter[] = ['all', ...AVAILABILITIES]
  return (
    <div role="group" aria-label="Availability" className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`rounded-full border px-3 py-1 text-xs focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none ${
            value === option ? 'border-primary bg-primary text-primary-foreground' : 'border-control-border hover:bg-muted'
          }`}
        >
          {option === 'all' ? 'All' : AVAILABILITY_LABELS[option]} ({counts[option]})
        </button>
      ))}
    </div>
  )
}

export function LicenceDetail({ licence, catalog, lookup }: { licence: CatalogLicence; catalog: CatalogIndex; lookup: CatalogLookup }) {
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all')
  const [textFilter, setTextFilter] = useState('')
  const normalisedText = textFilter.trim().toLowerCase()
  const licencesById = useMemo(() => new Map(catalog.licences.map((entry) => [entry.id, entry])), [catalog.licences])
  const standaloneProductIds = useMemo(
    () => new Set(Object.entries(catalog.by_product).flatMap(([productId, entries]) =>
      entries.some((entry) => entry.via === 'direct' && entry.viaLicenceIds.length === 0) ? [productId] : [],
    )),
    [catalog.by_product],
  )

  const textMatches = useMemo(
    () => effectiveInclusions(licence, lookup.productsById, licencesById).filter((inclusion) => matchesText(inclusion, normalisedText, lookup)),
    [licence, lookup, licencesById, normalisedText],
  )
  const counts = useMemo(() => {
    const byAvailability: Record<AvailabilityFilter, number> = { all: textMatches.length, included: 0, add_on: 0 }
    for (const inclusion of textMatches) byAvailability[inclusion.availability] += 1
    return byAvailability
  }, [textMatches])
  const categories = useMemo(
    () =>
      effectiveInclusionTree(
        textMatches.filter((inclusion) => availabilityFilter === 'all' || inclusion.availability === availabilityFilter),
        lookup.productsById,
      ),
    [textMatches, availabilityFilter, lookup],
  )

  const vendorTitle = catalog.vendors.find((vendor) => vendor.id === licence.vendor)?.title ?? licence.vendor
  const missingReferences = useMemo(() => {
    const problems = new Set<string>()
    for (const inclusion of licence.includes) {
      if (inclusion.type === 'licence') {
        if (!licencesById.has(inclusion.target)) problems.add(`Missing licence: ${inclusion.target}`)
      } else {
        if (!lookup.productsById.has(inclusion.target)) problems.add(`Missing product: ${inclusion.target}`)
        if (inclusion.plan !== undefined && !lookup.productsById.get(inclusion.target)?.plans.some((plan) => plan.id === inclusion.plan)) {
          problems.add(`Missing plan: ${inclusion.target}.${inclusion.plan}`)
        }
      }
    }
    for (const inclusion of effectiveInclusions(licence, lookup.productsById, licencesById)) {
      if (!lookup.productsById.has(inclusion.target)) problems.add(`Missing product: ${inclusion.target}`)
    }
    return [...problems]
  }, [licence, licencesById, lookup])

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold break-words">{licence.title}</h2>
          <Badge variant={licence.kind === 'add_on' ? 'outline' : 'secondary'}>{licence.kind === 'add_on' ? 'Add-on' : 'Subscription'}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {vendorTitle} · {licence.family}
        </p>
        {licence.description !== null && <p className="text-sm break-words">{licence.description}</p>}
        {licence.requires !== null && (
          <p className="text-sm">
            <span className="text-muted-foreground">Requires: </span>
            <RequirementText
              requirement={licence.requires}
              renderId={(requiredId) => {
                const required = licencesById.get(requiredId)
                return required === undefined ? (
                  requiredId
                ) : (
                  <CatalogLink view="licences" id={requiredId}>
                    {required.title}
                  </CatalogLink>
                )
              }}
            />
          </p>
        )}
        {licence.links.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {licence.links.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline">
                  {link.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </header>

      <ReviewCallout notes={licence.review} />

      {missingReferences.length > 0 && (
        <section aria-label="Catalog reference problems" className="rounded border border-warning-border bg-warning p-3 text-sm text-warning-foreground">
          <h3 className="font-medium">Catalog reference problems</h3>
          <ul className="mt-1 list-disc pl-5">
            {missingReferences.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </section>
      )}

      {licence.includes.some((inclusion) => inclusion.type === 'licence') && (
        <section aria-label="Included and offered licences" className="rounded border border-border">
          <h3 className="border-b border-border bg-muted px-3 py-2 text-sm font-medium">Included and offered licences</h3>
          <ul className="divide-y divide-border px-3">
            {licence.includes.flatMap((inclusion) => {
              if (inclusion.type !== 'licence') return []
              const targetLicence = licencesById.get(inclusion.target)
              return (
                <li key={inclusion.target} className="flex flex-wrap items-center gap-x-2 py-2 text-sm">
                  {targetLicence === undefined ? inclusion.target : (
                    <CatalogLink view="licences" id={targetLicence.id}>{targetLicence.title}</CatalogLink>
                  )}
                  <span className="text-muted-foreground">{AVAILABILITY_LABELS[inclusion.availability]}</span>
                  {inclusion.note !== null && <span className="text-xs text-muted-foreground">{inclusion.note}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section aria-label="Inclusions" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <AvailabilityChips value={availabilityFilter} counts={counts} onChange={setAvailabilityFilter} />
          <Input
            type="search"
            value={textFilter}
            onChange={(event) => setTextFilter(event.target.value)}
            placeholder="Filter products, plans, notes…"
            aria-label="Filter inclusions"
            className="sm:max-w-xs"
          />
        </div>
        {categories.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches.</p>}
        {categories.map(({ category, roots }) => (
          <section key={category} aria-label={category} className="rounded border border-border">
            <h3 className="border-b border-border bg-muted px-3 py-2 text-sm font-medium">
              {category} <span className="font-normal text-muted-foreground">({countInclusions(roots)})</span>
            </h3>
            <div className="px-2 py-1">
              <InclusionTree roots={roots} lookup={lookup} standaloneProductIds={standaloneProductIds} />
            </div>
          </section>
        ))}
      </section>
    </div>
  )
}
