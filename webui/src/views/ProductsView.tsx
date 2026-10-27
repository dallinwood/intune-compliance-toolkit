import { ChevronLeft } from 'lucide-react'
import { useMemo } from 'react'
import { WarningsNotice } from '../components/layout/WarningsNotice'
import { ProductDetail } from '../components/catalog/ProductDetail'
import { ProductList } from '../components/catalog/ProductList'
import { useCatalogIndex } from '../hooks/useCatalogIndex'
import { buildCatalogLookup } from '../logic/inclusionDisplay'
import { useFilterStore } from '../state/filterStore'

function Message({ children }: { children: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>
}

export function ProductsView() {
  const loadedCatalog = useCatalogIndex()
  const catalog = loadedCatalog?.index ?? null
  const productId = useFilterStore((state) => state.product)
  const setProduct = useFilterStore((state) => state.setProduct)
  const lookup = useMemo(() => (catalog === null ? null : buildCatalogLookup(catalog)), [catalog])

  if (loadedCatalog === null) {
    return (
      <main className="flex-1 overflow-y-auto">
        <Message>Loading the product and licence catalog…</Message>
      </main>
    )
  }
  if (catalog === null || lookup === null) {
    return (
      <main className="flex-1 overflow-y-auto">
        <WarningsNotice label="Catalog problems" summary="Some of the product and licence catalog could not be used:" warnings={loadedCatalog.warning === null ? [] : [loadedCatalog.warning]} />
        <Message>The product and licence catalog could not be loaded.</Message>
      </main>
    )
  }

  const selectedProduct = productId === null ? null : (lookup.productsById.get(productId) ?? null)
  const isRightPaneShown = selectedProduct !== null

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className={`${isRightPaneShown ? 'hidden lg:block' : 'block'} w-full shrink-0 overflow-y-auto border-border lg:w-80 lg:border-r`}>
        <ProductList catalog={catalog} selectedProductId={productId} />
      </aside>
      <main className={`${isRightPaneShown ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col overflow-y-auto`}>
        <button
          type="button"
          onClick={() => setProduct(null)}
          className="flex items-center gap-1 px-4 pt-3 text-sm text-link hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none lg:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          All products
        </button>
        {selectedProduct !== null ? (
          <ProductDetail key={selectedProduct.id} product={selectedProduct} catalog={catalog} lookup={lookup} />
        ) : (
          <Message>Select a product to see which licences include it.</Message>
        )}
      </main>
    </div>
  )
}
