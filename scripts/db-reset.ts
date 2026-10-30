// Production reset for the server SQLite DB: npm run db:reset -- --yes
// Clears every chemist's synced data (medicines, sales, customers, …), the old
// products/settings mirrors and M-Pesa history. STAFF ACCOUNTS, CHEMISTS AND
// SCHEMA ARE KEPT. Requires --yes to run. Records are marked deleted (not
// dropped), so every till removes them too on its next sync.
import { dbPath, sql } from '../server/db'

if (process.argv[2] !== '--yes') {
  console.error('This erases all chemist data and mpesa history (keeps staff and chemists). Re-run with: npm run db:reset -- --yes')
  process.exit(1)
}

sql.transaction(() => {
  for (const t of ['products', 'settings', 'mpesa_transactions']) {
    const info = sql.prepare(`DELETE FROM "${t}"`).run()
    console.log(`cleared ${t}: ${info.changes} row(s)`)
  }
  const rows = sql
    .prepare("SELECT tbl, scope, id FROM sync_records WHERE deleted = 0 AND tbl NOT IN ('users', 'branches')")
    .all() as { tbl: string; scope: number; id: string }[]
  const nextSeq = sql.prepare("UPDATE sync_meta SET v = v + 1 WHERE k = 'seq' RETURNING v")
  const del = sql.prepare('UPDATE sync_records SET deleted = 1, data = NULL, seq = ?, ts = ?, updated_at = ? WHERE tbl = ? AND scope = ? AND id = ?')
  const now = Date.now()
  for (const r of rows) del.run((nextSeq.get() as { v: number }).v, now, now, r.tbl, r.scope, r.id)
  console.log(`cleared chemist data (sync_records): ${rows.length} record(s)`)
})()

console.log(`\nkept: staff & chemists (${(sql.prepare("SELECT COUNT(*) AS n FROM sync_records WHERE tbl IN ('users', 'branches')").get() as { n: number }).n}), migrations (${(sql.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n})`)
console.log(`done — ${dbPath}`)
