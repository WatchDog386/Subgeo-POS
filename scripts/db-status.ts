// Show server DB state: npm run db:status
// Prints the SQLite file path, applied migrations and row counts per table.
import { dbPath, isMigrated, sql } from '../server/db'

console.log(`SQLite file: ${dbPath}`)

const tables = (
  sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as {
    name: string
  }[]
).map((r) => r.name)

const migrationFiles = ['001_init.sql', '002_products.sql', '003_sync.sql']
console.log(
  migrationFiles.map((f) => `  ${f}: ${isMigrated(f) ? 'applied' : 'PENDING (restart the server or run db:migrate)'}`).join('\n'),
)

console.log('\ntable              rows')
for (const t of tables) {
  const { n } = sql.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }
  console.log(`${t.padEnd(21)}${n}`)
}

// Company data per chemist (sync_records): scope 0 = company-wide lists.
if (tables.includes('sync_records')) {
  console.log('\nchemist records (scope 0 = company-wide)')
  const rows = sql
    .prepare('SELECT scope, tbl, COUNT(*) AS n FROM sync_records WHERE deleted = 0 GROUP BY scope, tbl ORDER BY scope, tbl')
    .all() as { scope: number; tbl: string; n: number }[]
  const names = new Map(
    (sql.prepare("SELECT id, data FROM sync_records WHERE tbl = 'branches' AND deleted = 0").all() as { id: string; data: string }[]).map((r) => {
      const b = JSON.parse(r.data) as { number: number; name: string }
      return [Number(r.id), `CHEM${b.number} ${b.name}`]
    }),
  )
  for (const r of rows) console.log(`  ${(r.scope === 0 ? 'company' : names.get(r.scope) ?? `#${r.scope}`).padEnd(28)}${r.tbl.padEnd(16)}${r.n}`)
}
