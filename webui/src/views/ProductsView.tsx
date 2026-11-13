import { useMemo } from 'react'
import { WarningsNotice } from '../components/layout/WarningsNotice'
import { ProductDetail } from '../components/catalog/ProductDetail'
import { ProductList } from '../components/catalog/ProductList'
import { useCatalogIndex } from '../hooks/useCatalogIndex'
import { buildCatalogLookup } from '../logic/inclusionDisplay'
import { useFilterStore } from '../state/filterStore'
import { StatusMessage } from '@/components/ui/status-message'
import { BackLink } from '@/components/ui/back-link'

export function ProductsView() {
  const loadedCatalog = useCatalogIndex()
  const catalog = loadedCatalog?.index ?? null
  const productId = useFilterStore((state) => state.product)
  const setProduct = useFilterStore((state) => state.setProduct)
  const lookup = useMemo(() => (catalog === null ? null : buildCatalogLookup(catalog)), [catalog])

  if (loadedCatalog === null) {
    return (
      <main className="flex-1 overflow-y-auto">
        <StatusMessage isLoading>Loading the product and licence catalog…</StatusMessage>
      </main>
    )
  }
  if (catalog === null || lookup === null) {
    return (
      <main className="flex-1 overflow-y-auto">
        <WarningsNotice label="Catalog problems" summary="Some of the product and licence catalog could not be used:" warnings={loadedCatalog.warning === null ? [] : [loadedCatalog.warning]} />
        <StatusMessage>The product and licence catalog could not be loaded.</StatusMessage>
      </main>
    )
  }

  const selectedProduct = productId === null ? null : (lookup.productsById.get(productId) ?? null)
  const isRightPaneShown = selectedProduct !== null

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside aria-label="Product catalog" className={`${isRightPaneShown ? 'hidden lg:block' : 'block'} w-full shrink-0 overflow-y-auto border-border lg:w-80 lg:border-r`}>
        <h2 className="sr-only">Products</h2>
        <ProductList catalog={catalog} selectedProductId={productId} />
      </aside>
      <main className={`${isRightPaneShown ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col overflow-y-auto`}>
        <BackLink onClick={() => setProduct(null)} className="mx-4 mt-3 self-start lg:hidden">
          All products
        </BackLink>
        {selectedProduct !== null ? (
          <ProductDetail key={selectedProduct.id} product={selectedProduct} catalog={catalog} lookup={lookup} />
        ) : (
          <StatusMessage>Select a product to see which licences include it.</StatusMessage>
        )}
      </main>
    </div>
  )
}
