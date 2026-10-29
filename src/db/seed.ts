import { db } from './db'
import { sampleImageFor } from './sampleImages'

const PHARMACY_CATEGORIES = [
  { name: 'Medicines', color: '#0f766e' },
  { name: 'Services', color: '#2563eb' },
  { name: 'Medical Supplies', color: '#7c3aed' },
  { name: 'Vitamins & Supplements', color: '#b45309' },
  { name: 'Personal Care', color: '#be185d' },
]

/** Default staff so the till can be used on day one. Change their PINs in Staff. No products are pre-loaded. */
export async function seedIfEmpty(): Promise<void> {
  if ((await db.users.count()) > 0) return

  await db.users.bulkAdd([
    { name: 'Owner', pin: '1234', role: 'owner', active: true },
    { name: 'Cashier', pin: '0000', role: 'cashier', active: true },
  ])
  await db.categories.bulkAdd(PHARMACY_CATEGORIES.map((c) => ({ name: c.name, color: c.color })))
}

/** Backfill sample Unsplash photos on products that have none (existing installs). */
export async function backfillSampleImages(): Promise<void> {
  const cats = await db.categories.toArray()
  const catName = new Map(cats.map((c) => [c.id!, c.name]))
  const products = await db.products.toArray()
  const updates = products
    .filter((p) => !p.image)
    .map((p) => ({ key: p.id!, changes: { image: sampleImageFor(p.sku, catName.get(p.categoryId ?? -1)) } }))
    .filter((u) => u.changes.image)
  if (updates.length) await db.products.bulkUpdate(updates)
}
