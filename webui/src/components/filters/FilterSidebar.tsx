import { cloneElement, isValidElement, useId, useMemo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useStableFacetShown } from '@/hooks/useStableFacetShown'
import { allFacetValues, facetOptions } from '../../logic/ruleFilters'
import { useFilterStore, type AutomatableFilter } from '../../state/filterStore'
import type { RuleRow } from '../../types/rule-row'

const AUTOMATABLE_OPTIONS = [
  { value: 'all', label: 'All rules' },
  { value: 'automatable', label: 'Automatable' },
  { value: 'manual', label: 'Manual only' },
] as const

function isAutomatableFilter(value: string): value is AutomatableFilter {
  return AUTOMATABLE_OPTIONS.some((option) => option.value === value)
}

export function FilterSidebar({ rows }: { rows: RuleRow[] }) {
  const filters = useFilterStore()

  // Facets are derived from whatever data is actually loaded - never a
  // hardcoded list - so a new benchmark/profile shows up automatically.
  // Each facet is also narrowed by every *other* currently-applied filter
  // (picking product "windows_11" narrows the version list to versions
  // that actually occur under it), so a facet never offers a choice that
  // would filter the table down to zero rows.
  const products = useMemo(
    () => facetOptions(rows, filters, 'products', (row) => row.ref.product, filters.products),
    [rows, filters],
  )
  const versions = useMemo(
    () => facetOptions(rows, filters, 'versions', (row) => row.ref.version, filters.versions),
    [rows, filters],
  )
  const platforms = useMemo(
    () => facetOptions(rows, filters, 'platforms', (row) => row.platform, filters.platforms),
    [rows, filters],
  )
  const profiles = useMemo(
    () => facetOptions(rows, filters, 'profiles', (row) => row.profileApplicability, filters.profiles),
    [rows, filters],
  )

  return (
    <aside className="max-h-64 w-full overflow-y-auto border-b border-slate-200 p-4 text-sm md:max-h-none md:w-64 md:shrink-0 md:border-r md:border-b-0">
      <Input
        type="search"
        aria-label="Search title or id"
        placeholder="Search title or id…"
        value={filters.search}
        onChange={(event) => filters.setSearch(event.target.value)}
        className="mb-4 h-8 rounded text-sm"
      />

      <FacetGroup title="Automation">
        <RadioGroup
          value={filters.automatable}
          onValueChange={(value) => {
            if (isAutomatableFilter(value)) filters.setAutomatable(value)
          }}
          className="gap-1.5"
        >
          {AUTOMATABLE_OPTIONS.map((option) => (
            <FacetOption key={option.value} label={option.label}>
              <RadioGroupItem value={option.value} />
            </FacetOption>
          ))}
        </RadioGroup>
      </FacetGroup>

      <StableFacetGroup
        title="Product"
        rows={rows}
        valueOf={(row) => row.ref.product}
        reachable={products}
        selected={filters.products}
        onToggle={filters.toggleProduct}
      />

      <StableFacetGroup
        title="Version"
        rows={rows}
        valueOf={(row) => row.ref.version}
        reachable={versions}
        selected={filters.versions}
        onToggle={filters.toggleVersion}
      />

      <StableFacetGroup
        title="Platform"
        rows={rows}
        valueOf={(row) => row.platform}
        reachable={platforms}
        selected={filters.platforms}
        onToggle={filters.togglePlatform}
      />

      <StableFacetGroup
        title="Profile applicability"
        rows={rows}
        valueOf={(row) => row.profileApplicability}
        reachable={profiles}
        selected={filters.profiles}
        onToggle={filters.toggleProfile}
      />

      <Button type="button" variant="link" size="xs" onClick={filters.clear} className="mt-2 h-auto p-0">
        Clear filters
      </Button>
    </aside>
  )
}

function FacetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h2>
      <div>{children}</div>
    </div>
  )
}

// Pairs a Checkbox/RadioGroupItem with its Label via htmlFor/id rather than
// nesting it inside <label> - Base UI's checkbox/radio render a
// role="checkbox"/role="radio" element, not a native <input>, so the
// implicit label-wraps-control association isn't guaranteed the way it is
// for a real <input type="checkbox">. Facet values are free text
// ("Level 1 (L1)") so they aren't usable as DOM ids directly - useId()
// sidesteps that entirely.
function FacetOption({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  const id = useId()
  const control = isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children

  return (
    <div className="flex items-center gap-2 py-0.5">
      {control}
      <Label
        htmlFor={id}
        className={disabled ? 'truncate text-sm font-normal text-slate-400 line-through' : 'truncate text-sm font-normal'}
      >
        {label}
      </Label>
    </div>
  )
}

// A facet checkbox list, rendered in a fixed reference order (every value
// that ever occurs for this dimension, regardless of filters) rather than
// the dynamic reachable-only order `facetOptions` returns on its own - so
// checking a box collapses at most the rows that actually became
// unreachable instead of reshuffling the whole section. Values that fall
// out of `reachable` don't vanish immediately: `useStableFacetShown` keeps
// them rendered, disabled and struck-through, for a short quiet period
// (see that hook's comment) so a run of quick clicks doesn't make the panel
// keep reflowing under the user's cursor.
function StableFacetGroup({
  title,
  rows,
  valueOf,
  reachable,
  selected,
  onToggle,
}: {
  title: string
  rows: RuleRow[]
  valueOf: (row: RuleRow) => string | string[]
  reachable: string[]
  selected: ReadonlySet<string>
  onToggle: (value: string) => void
}) {
  const canonicalOrder = useMemo(() => allFacetValues(rows, valueOf), [rows, valueOf])
  const reachableSet = useMemo(() => new Set(reachable), [reachable])
  const shown = useStableFacetShown(reachable)

  return (
    <FacetGroup title={title}>
      {canonicalOrder
        .filter((value) => shown.has(value))
        .map((value) => {
          const isReachable = reachableSet.has(value)
          return (
            <FacetOption key={value} label={value} disabled={!isReachable}>
              <Checkbox checked={selected.has(value)} disabled={!isReachable} onCheckedChange={() => onToggle(value)} />
            </FacetOption>
          )
        })}
    </FacetGroup>
  )
}
