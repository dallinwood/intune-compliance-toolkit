import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { ancestorsOf, productTree, searchProducts, type ProductTreeNode, type ProductTreeVendor } from '../../logic/productSearch'
import type { CatalogIndex, CatalogProduct } from '../../types/catalog'
import { CatalogLink } from './CatalogLink'
import { subgroupKey, useExpandedGroups, vendorGroupKey } from '../../hooks/useExpandedGroups'
import { CollapsibleHeading } from './CollapsibleHeading'

const INDENT_REM_PER_LEVEL = 1

function containsProduct(node: ProductTreeNode, productId: string): boolean {
  return node.product.id === productId || node.children.some((child) => containsProduct(child, productId))
}

function groupKeysContaining(vendors: ProductTreeVendor[], productId: string): string[] {
  return vendors.flatMap(({ vendor, categories }) =>
    categories.filter(({ roots }) => roots.some((root) => containsProduct(root, productId))).flatMap(({ category }) => [vendorGroupKey(vendor.id), subgroupKey(vendor.id, category)]),
  )
}

function ProductRow({
  node,
  depth,
  selectedProductId,
  expandedIds,
  onToggle,
}: {
  node: ProductTreeNode
  depth: number
  selectedProductId: string | null
  expandedIds: ReadonlySet<string>
  onToggle: (productId: string) => void
}) {
  const { product, children } = node
  const isExpanded = expandedIds.has(product.id)
  const isSelected = product.id === selectedProductId
  return (
    <li>
      <div className={`flex items-start gap-1 pr-4 ${isSelected ? 'bg-muted' : 'hover:bg-muted'}`} style={{ paddingLeft: `${1 + depth * INDENT_REM_PER_LEVEL}rem` }}>
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(product.id)}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${product.title} (${children.length} features)`}
            className="-ml-2 -mr-1 -mb-2 -mt-0.5 flex shrink-0 items-center rounded p-2 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
          >
            {isExpanded ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden="true" />
        )}
        <CatalogLink
          view="products"
          id={product.id}
          isCurrent={isSelected}
          className={`min-w-0 flex-1 py-1.5 text-sm break-words no-underline ${isSelected ? 'font-medium' : 'text-foreground'}`}
        >
          {product.title}
        </CatalogLink>
        {children.length > 0 && <span className="mt-1.5 shrink-0 text-xs text-muted-foreground tabular-nums">{children.length}</span>}
      </div>
      {isExpanded && children.length > 0 && (
        <ul>
          {children.map((child) => (
            <ProductRow key={child.product.id} node={child} depth={depth + 1} selectedProductId={selectedProductId} expandedIds={expandedIds} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  )
}

function SearchResults({ products, query, selectedProductId }: { products: CatalogProduct[]; query: string; selectedProductId: string | null }) {
  const results = useMemo(() => searchProducts(products, query), [products, query])
  if (results.length === 0) return <p className="px-4 py-3 text-sm text-muted-foreground">No products match.</p>
  return (
    <ul>
      {results.map(({ product, path }) => {
        const isSelected = product.id === selectedProductId
        return (
          <li key={product.id}>
            <CatalogLink
              view="products"
              id={product.id}
              isCurrent={isSelected}
              className={`block px-4 py-1.5 text-sm no-underline hover:bg-muted ${isSelected ? 'bg-muted font-medium' : 'text-foreground'}`}
            >
              <span className="break-words">{product.title}</span>
              {path.length > 0 && <span className="block text-xs font-normal break-words text-muted-foreground">{path.map((ancestor) => ancestor.title).join(' › ')}</span>}
            </CatalogLink>
          </li>
        )
      })}
    </ul>
  )
}

export function ProductList({ catalog, selectedProductId }: { catalog: CatalogIndex; selectedProductId: string | null }) {
  const [query, setQuery] = useState('')
  const vendors = useMemo(() => productTree(catalog.products, catalog.vendors), [catalog])
  const productsById = useMemo(() => new Map(catalog.products.map((product) => [product.id, product])), [catalog.products])
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const { isExpanded: isGroupExpanded, toggle: toggleGroup, expand: expandGroups } = useExpandedGroups(vendors.map(({ vendor }) => vendorGroupKey(vendor.id)))
  const [revealedProductId, setRevealedProductId] = useState<string | null>(null)

  // Vendors start open and categories collapsed, except the ones holding the selection, including
  // when it changes through navigation. A product opened from a link elsewhere
  // is revealed in the tree; adjusting state during render avoids an extra
  // pass through an effect.
  if (selectedProductId !== revealedProductId) {
    setRevealedProductId(selectedProductId)
    const selected = selectedProductId === null ? undefined : productsById.get(selectedProductId)
    if (selected !== undefined) {
      setExpandedIds(new Set([...expandedIds, ...ancestorsOf(selected, productsById).map((ancestor) => ancestor.id)]))
      expandGroups(groupKeysContaining(vendors, selected.id))
    }
  }

  function toggle(productId: string) {
    const next = new Set(expandedIds)
    if (next.has(productId)) next.delete(productId)
    else next.add(productId)
    setExpandedIds(next)
  }

  const listRef = useRef<HTMLElement>(null)
  // Only a change of selection scrolls; expanding a group must leave the list where it is.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedProductId])

  const isSearching = query.trim() !== ''
  return (
    <nav ref={listRef} aria-label="Products" className="pb-4">
      <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-2">
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products…" aria-label="Search products" />
      </div>
      {isSearching ? (
        <SearchResults products={catalog.products} query={query} selectedProductId={selectedProductId} />
      ) : (
        vendors.map(({ vendor, categories }) => (
          <div key={vendor.id}>
            <CollapsibleHeading level={3} isExpanded={isGroupExpanded(vendorGroupKey(vendor.id))} onToggle={() => toggleGroup(vendorGroupKey(vendor.id))} headingClassName="pt-2 text-sm font-semibold">
              {vendor.title}
            </CollapsibleHeading>
            {isGroupExpanded(vendorGroupKey(vendor.id)) &&
              categories.map(({ category, roots }) => {
                const isCategoryExpanded = isGroupExpanded(subgroupKey(vendor.id, category))
                return (
                  <div key={category}>
                    <CollapsibleHeading level={4} isExpanded={isCategoryExpanded} onToggle={() => toggleGroup(subgroupKey(vendor.id, category))} headingClassName="text-xs font-medium text-muted-foreground">
                      {category}
                    </CollapsibleHeading>
                    {isCategoryExpanded && (
                      <ul>
                        {roots.map((root) => (
                          <ProductRow key={root.product.id} node={root} depth={0} selectedProductId={selectedProductId} expandedIds={expandedIds} onToggle={toggle} />
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
          </div>
        ))
      )}
    </nav>
  )
}
