import { db } from './db'
import type { Product } from './types'

const QUOTE_REFERENCE = 'DO-KE-20261015-000384'
const SUPPLIER_NAME = 'Spiro Optimus'

const QUOTED_PARTS: readonly { sku: string; name: string; category: string; cost: number; requestedQty: number }[] = []

const CATEGORY_COLORS: Record<string, string> = {}

/** Adds quote parts to the local catalog once by SKU; never changes existing products or stock. */
export async function importQuotationProducts(): Promise<number> {
  return db.transaction('rw', [db.categories, db.suppliers, db.products], async () => {
    const categories = await db.categories.toArray()
    const categoryIds = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id!]))
    const supplier = (await db.suppliers.toArray()).find((item) => item.name.trim().toLowerCase() === SUPPLIER_NAME.toLowerCase())
    const supplierId = supplier?.id ?? (await db.suppliers.add({
      name: SUPPLIER_NAME,
      notes: `Source quotation ${QUOTE_REFERENCE}. Availability was pending review when quoted.`,
    }))
    const now = Date.now()
    let added = 0

    for (const item of QUOTED_PARTS) {
      const existing = await db.products.where('sku').equals(item.sku).first()
      if (existing) continue

      const categoryKey = item.category.toLowerCase()
      let categoryId = categoryIds.get(categoryKey)
      if (categoryId === undefined) {
        categoryId = (await db.categories.add({ name: item.category, color: CATEGORY_COLORS[item.category] ?? '#64748b' })) as number
        categoryIds.set(categoryKey, categoryId)
      }

      const product: Product = {
        sku: item.sku,
        partNumber: item.sku,
        name: item.name,
        categoryId,
        fitment: [],
        supplierId,
        cost: Math.round(item.cost * 100),
        price: 0,
        stock: 0,
        reorderLevel: 0,
        taxable: true,
        serialized: false,
        trackStock: true,
        active: false,
        createdAt: now,
        updatedAt: now,
      }
      await db.products.add(product)
      added++
    }

    return added
  })
}

export const quotationImportSummary = {
  reference: QUOTE_REFERENCE,
  requestedUnits: QUOTED_PARTS.reduce((sum, item) => sum + item.requestedQty, 0),
  productCount: QUOTED_PARTS.length,
}

export const quotationProductSkus = new Set<string>(QUOTED_PARTS.map((item) => item.sku))
