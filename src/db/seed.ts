import { db, markRemote } from './db'
import { SEED_BRANCH, SEED_USERS } from './seedData'
import { sampleImageFor } from './sampleImages'

/**
 * Make sure a fresh till can sign in before it has ever reached the server:
 * the admin, the CHEM1 cashier and Chemist 1. They are written as "already in
 * sync" (_ts 0) so they are never uploaded over newer server copies — the
 * first download replaces them with whatever the admin has set since.
 */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction('rw', db.users, db.branches, async (tx) => {
    markRemote(tx)
    if ((await db.users.count()) === 0) {
      await db.users.bulkPut(SEED_USERS.map((u) => ({ ...u, _dirty: 0, _ts: 0 })))
    }
    if ((await db.branches.count()) === 0) {
      await db.branches.put({ ...SEED_BRANCH, _dirty: 0, _ts: 0 } as typeof SEED_BRANCH)
    }
  })
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
