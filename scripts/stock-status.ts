// What a chemist holds, and the stock that came in / was transferred:
//   npm run stock:status -- 12 10        (chemist numbers; HQ = 100)
// Read-only: changes nothing.
import { dbPath, migrate, sql } from '../server/db'
import { chemistByNumber } from '../server/sync'

const nums = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number)
if (!nums.length) {
  console.error('Which chemists? e.g.  npm run stock:status -- 12 10')
  process.exit(1)
}
migrate()
type Rec = Record<string, unknown>
const live = (tbl: string, scope: number): Rec[] =>
  (sql.prepare('SELECT data FROM sync_records WHERE tbl = ? AND scope = ? AND deleted = 0').all(tbl, scope) as { data: string }[]).map((r) => JSON.parse(r.data) as Rec)
const kes = (c: number) => (c / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ')

console.log(`Database: ${dbPath}`)
for (const n of nums) {
  const chem = chemistByNumber(n)
  if (!chem) {
    console.log(`\nNo chemist number ${n}.`)
    continue
  }
  const products = live('products', chem.id).filter((p) => p.trackStock !== false && !/^SRV-/i.test(String(p.sku)))
  const withStock = products.filter((p) => Number(p.stock) > 0)
  const units = products.reduce((s, p) => s + Number(p.stock || 0), 0)
  const value = products.reduce((s, p) => s + Math.max(0, Number(p.stock || 0)) * Number(p.cost || 0), 0)
  console.log(`\n══ ${chem.code} — ${chem.name}`)
  console.log(`   Medicines: ${products.length} (${withStock.length} with stock) · units in stock: ${units} · stock value at cost: KES ${kes(value)}`)
  const docs = live('docs', chem.id)
    .filter((d) => ['pur-grn-direct-invoice', 'pur-inv-grn', 'stock-adjust-plus'].includes(String(d.slug)))
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
  console.log(`   GRNs / uploads / Stock Adjust + here: ${docs.length}`)
  for (const d of docs.slice(0, 15)) {
    const v = (d.values ?? {}) as Record<string, string>
    const lines = (d.lines ?? []) as { qty: number }[]
    console.log(`     ${String(v.docNo ?? d.docNo ?? '').padEnd(12)} ${day(Number(d.createdAt))}  ${(v.vendorName ?? '').slice(0, 28).padEnd(28)} inv ${(v.invoice ?? '-').padEnd(10)} ${String(lines.length).padStart(4)} lines ${String(lines.reduce((s, l) => s + Number(l.qty || 0), 0)).padStart(6)} units  ${v.total ?? ''}${v.transferredFrom ? `  (moved from ${v.transferredFrom})` : ''}`)
  }
  const logs = live('logs', chem.id)
    .filter((l) => /Stock (transferred|received)/.test(String(l.action)))
    .sort((a, b) => Number(b.at) - Number(a.at))
  console.log(`   Transfers: ${logs.length}`)
  for (const l of logs.slice(0, 10)) console.log(`     ${day(Number(l.at))}  ${String(l.action).padEnd(32)} ${l.detail}  by ${l.userName ?? ''}`)
}
