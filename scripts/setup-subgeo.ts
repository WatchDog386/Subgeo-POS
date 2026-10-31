// One-time setup of the company's chemists: npm run setup:subgeo
// SUBGEO1 … SUBGEO12, each with a cashier "subgeo" / 0001 … 0012, plus HQ
// (subgeo / 0000); today's
// chemist 1 becomes SUBGEO12 with all its data. Safe to run more than once.
import { dbPath, migrate, sql } from '../server/db'
import { ensureSeeds, setupSubgeoChemists } from '../server/sync'

migrate()
ensureSeeds()
const done = setupSubgeoChemists(12)
console.log(done.length ? done.join('\n') : 'Already set up: SUBGEO1 … SUBGEO12 and their cashiers exist.')
console.log(`\nDatabase: ${dbPath}\nTills pick the changes up on their next sync. Sign in as cashier: subgeo / 0001 (SUBGEO1) … 0012 (SUBGEO12), 0000 (HQ).`)

// What each chemist holds now, so you can see your stocked chemist is SUBGEO12.
const rows = sql
  .prepare(
    `SELECT b.code, b.name,
       (SELECT COUNT(*) FROM products p WHERE p.branch_id = b.id) AS medicines,
       (SELECT COUNT(*) FROM sales s WHERE s.branch_id = b.id) AS sales
     FROM branches b ORDER BY b.number`,
  )
  .all() as { code: string; name: string; medicines: number; sales: number }[]
console.log('\nChemist     Name                          Medicines  Sales')
for (const r of rows) console.log(`${r.code.padEnd(12)}${r.name.slice(0, 28).padEnd(30)}${String(r.medicines).padStart(9)}${String(r.sales).padStart(7)}`)
