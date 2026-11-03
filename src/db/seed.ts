import { db, markRemote } from './db'
import { SEED_BRANCH, SEED_USERS } from './seedData'

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
