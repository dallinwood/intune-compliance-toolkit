import { useMemo, type ReactNode } from 'react'
import { facetOptions } from '../../logic/ruleFilters'
import { useFilterStore } from '../../state/filterStore'
import type { RuleRow } from '../../types/rule-row'

const AUTOMATABLE_OPTIONS = [
  { value: 'all', label: 'All rules' },
  { value: 'automatable', label: 'Automatable' },
  { value: 'manual', label: 'Manual only' },
] as const

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
      <input
        type="search"
        aria-label="Search title or id"
        placeholder="Search title or id…"
        value={filters.search}
        onChange={(event) => filters.setSearch(event.target.value)}
        className="mb-4 w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />

      <FacetGroup title="Automation">
        {AUTOMATABLE_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2 py-0.5">
            <input
              type="radio"
              name="automatable"
              checked={filters.automatable === option.value}
              onChange={() => filters.setAutomatable(option.value)}
            />
            {option.label}
          </label>
        ))}
      </FacetGroup>

      <FacetGroup title="Product">
        {products.map((product) => (
          <Checkbox key={product} label={product} checked={filters.products.has(product)} onChange={() => filters.toggleProduct(product)} />
        ))}
      </FacetGroup>

      <FacetGroup title="Version">
        {versions.map((version) => (
          <Checkbox key={version} label={version} checked={filters.versions.has(version)} onChange={() => filters.toggleVersion(version)} />
        ))}
      </FacetGroup>

      <FacetGroup title="Platform">
        {platforms.map((platform) => (
          <Checkbox key={platform} label={platform} checked={filters.platforms.has(platform)} onChange={() => filters.togglePlatform(platform)} />
        ))}
      </FacetGroup>

      <FacetGroup title="Profile applicability">
        {profiles.map((profile) => (
          <Checkbox key={profile} label={profile} checked={filters.profiles.has(profile)} onChange={() => filters.toggleProfile(profile)} />
        ))}
      </FacetGroup>

      <button type="button" onClick={filters.clear} className="mt-2 text-xs text-slate-500 underline hover:text-slate-700">
        Clear filters
      </button>
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

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 py-0.5">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="truncate">{label}</span>
    </label>
  )
}
