// Clear one chemist's stock so it can be keyed in afresh.
//
//   npm run stock:reset -- 12          show what would be deleted for SUBGEO12 (changes nothing)
//   npm run stock:reset -- 12 --yes    back up the database, then delete it
//
// Deletes the chemist's medicines (services are kept), its stock movement
// history, and its Pur/GRN (Direct Invoice), STEP 3 GRN, Stock Adjust − / +
// and Medicine-form records. Sales, customers, shifts, indents and LPOs stay.
// Every till of that chemist removes the same records on its next sync.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPath, migrate, sql } from '../server/db'
import { chemistByNumber, planStockReset, resetChemistStock } from '../server/sync'

const args = process.argv.slice(2)
const num = Number(args.find((a) => /^\d+$/.test(a)))
const yes = args.includes('--yes')

if (!num) {
  console.error('Which chemist? e.g.  npm run stock:reset -- 12   (12 = SUBGEO12, 100 = HQ)')
  process.exit(1)
}
migrate()
const chem = chemistByNumber(num)
if (!chem) {
  console.error(`No chemist number ${num} in ${dbPath}.`)
  process.exit(1)
}

const plan = planStockReset(chem.id, chem.code, chem.name)
const docLabel: Record<string, string> = {
  'pur-grn-direct-invoice': 'Pur/GRN (Direct Invoice)',
  'pur-inv-grn': 'STEP 3: GRN',
  'stock-adjust-minus': 'Stock Adjust -',
  'stock-adjust-plus': 'Stock Adjust +(DBH)',
  medicine: 'Medicine form records',
}
console.log(`\n${chem.code} — ${chem.name}   (database ${dbPath})\n`)
const line = (label: string, n: number) => console.log(`  ${(label + ' ').padEnd(34, '.')} ${n}`)
line('Medicines to delete', plan.medicines)
line('Stock movements (history)', plan.movements)
for (const [slug, n] of Object.entries(plan.docs)) line(docLabel[slug], n)
line('Services kept', plan.services)
console.log(`  Sales, customers, shifts, indents and LPOs are kept.\n`)

if (!plan.total) {
  console.log('Nothing to delete: this chemist has no stock records.')
  process.exit(0)
}
if (!yes) {
  console.log(`Nothing changed. To delete these ${plan.total} records, run:\n\n  npm run stock:reset -- ${num} --yes\n`)
  process.exit(0)
}

// Safety copy first.
const here = path.dirname(fileURLToPath(import.meta.url))
const backupDir = process.env.BACKUP_DIR ?? path.join(here, '..', 'backups')
fs.mkdirSync(backupDir, { recursive: true })
const dest = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-before-stock-reset-${chem.code}.db`)
await sql.backup(dest)
console.log(`Backup saved: ${dest}`)

const n = resetChemistStock(chem.id)
const left = planStockReset(chem.id, chem.code, chem.name)
console.log(`Deleted ${n} records. ${chem.code} now has ${left.medicines} medicines.`)
console.log(`\nThe ${chem.code} tills, and the admin / purchase dashboards with ${chem.code} open, drop the old stock on their next sync (within a minute while online).`)
console.log(`Key the stock in again: Modules → Pur/GRN (Direct Invoice) (type it, or Upload Supplier Invoice (PDF)), Medicine → +, or Stock Adjust +(DBH) → Opening Stock.`)
console.log(`The backup above holds everything as it was before this reset.`)
