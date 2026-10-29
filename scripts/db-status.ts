// Show server DB state: npm run db:status
// Prints the SQLite file path, applied migrations and row counts per table.
import { dbPath, isMigrated, sql } from '../server/db'

console.log(`SQLite file: ${dbPath}`)

const tables = (
  sql.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as {
    name: string
  }[]
).map((r) => r.name)

const migrationFiles = ['001_init.sql', '002_products.sql']
console.log(
  migrationFiles.map((f) => `  ${f}: ${isMigrated(f) ? 'applied' : 'PENDING (restart the server or run db:migrate)'}`).join('\n'),
)

console.log('\ntable              rows')
for (const t of tables) {
  const { n } = sql.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }
  console.log(`${t.padEnd(21)}${n}`)
}
