// Production reset for the server SQLite DB: npm run db:reset -- --yes
// Clears the products mirror, shop-settings mirror and M-Pesa transaction
// history. STAFF ACCOUNTS AND SCHEMA ARE KEPT. Requires --yes to run.
import { dbPath, sql } from '../server/db'

if (process.argv[2] !== '--yes') {
  console.error('This erases products, settings and mpesa history (keeps staff). Re-run with: npm run db:reset -- --yes')
  process.exit(1)
}

sql.transaction(() => {
  for (const t of ['products', 'settings', 'mpesa_transactions']) {
    const info = sql.prepare(`DELETE FROM "${t}"`).run()
    console.log(`cleared ${t}: ${info.changes} row(s)`)
  }
})()

console.log(`\nkept: users (${(sql.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n}), migrations (${(sql.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n})`)
console.log(`done — ${dbPath}`)
