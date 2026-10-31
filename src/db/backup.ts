import { LEGACY_DOCS_PREFIX, LEGACY_TASKS_KEY, convertLegacyDocs, convertLegacyTasks } from './legacyDemo'
import { BRANCH_TABLES, GLOBAL_KV_KEYS, GLOBAL_TABLES, db, isLocalKvKey, stripMeta, type KV } from './db'

/** Everything of the open chemist plus the company-wide lists, as a JSON-able object. */
export async function exportBackup(): Promise<{ version: 3; exportedAt: number; data: Record<string, unknown[]> }> {
  const data: Record<string, unknown[]> = {}
  for (const name of [...GLOBAL_TABLES, ...BRANCH_TABLES]) data[name] = (await db.table(name).toArray()).map((r) => stripMeta(r as object))
  data.kv = (await db.kv.toArray()).filter((r) => !isLocalKvKey(r.key)).map((r) => stripMeta(r))
  return { version: 3, exportedAt: Date.now(), data }
}

const isBranchKv = (r: KV) => !isLocalKvKey(r.key) && !GLOBAL_KV_KEYS.has(r.key)

/**
 * Replace the open chemist's data with a backup. Company-wide lists (staff,
 * chemists, categories, suppliers) are merged, not wiped, so other chemists are
 * untouched. Everything restored uploads to the server on the next sync.
 */
export async function restoreBackup(data: Record<string, unknown[]>, opts: { includeCompanyLists: boolean }): Promise<void> {
  const tables = [...GLOBAL_TABLES, ...BRANCH_TABLES].map((n) => db.table(n))
  await db.transaction('rw', [...tables, db.kv], async () => {
    for (const name of BRANCH_TABLES) {
      await db.table(name).clear()
      if (Array.isArray(data[name])) await db.table(name).bulkPut(data[name].map((r) => stripMeta(r as object)))
    }
    const kv = (await db.kv.toArray()).filter(isBranchKv)
    await db.kv.bulkDelete(kv.map((r) => r.key))
    // Backups made before v4 kept documents and tasks as kv lists: convert them.
    const legacy = ((data.kv ?? []) as KV[]).filter((r) => r && typeof r.key === 'string' && (r.key.startsWith(LEGACY_DOCS_PREFIX) || r.key === LEGACY_TASKS_KEY))
    for (const r of legacy) {
      if (r.key === LEGACY_TASKS_KEY) await db.tasks.bulkPut(convertLegacyTasks(r.value) as never[])
      else await db.docs.bulkPut(convertLegacyDocs(r.key, r.value))
    }
    const incomingKv = ((data.kv ?? []) as KV[]).filter((r) => r && typeof r.key === 'string' && !isLocalKvKey(r.key) && !legacy.includes(r))
    await db.kv.bulkPut(incomingKv.filter((r) => opts.includeCompanyLists || !GLOBAL_KV_KEYS.has(r.key)).map((r) => stripMeta(r)))
    if (opts.includeCompanyLists) {
      for (const name of ['branches', 'categories', 'suppliers', 'messages']) {
        if (Array.isArray(data[name])) await db.table(name).bulkPut(data[name].map((r) => stripMeta(r as object)))
      }
      // Pre-2.0 backups hold PIN-only staff; those can't sign in any more and are skipped.
      const staff = ((data.users ?? []) as Record<string, unknown>[]).filter((u) => u.username && u.passHash && u.salt)
      if (staff.length) await db.users.bulkPut(staff.map((u) => stripMeta(u)) as never[])
    }
  })
}

/** Erase the open chemist's sales, stock, customers, shifts, jobs and logs (here and on the server). */
export async function resetChemist(): Promise<void> {
  await db.transaction('rw', [...BRANCH_TABLES.map((n) => db.table(n)), db.kv], async () => {
    for (const name of BRANCH_TABLES) await db.table(name).clear()
    const kv = (await db.kv.toArray()).filter(isBranchKv)
    await db.kv.bulkDelete(kv.map((r) => r.key))
  })
}
